# Resume Agent 模型工作限流 Feature Brief

> Feature ID：RA-019
> 状态：Implemented for single-host production baseline；尚无生产流量与多主机证据
> 最后审阅：2026-09-24
> 范围：认证模式下，按账号限制会发起新模型工作的 HTTP 请求；不包含计费、套餐、IP 风控或多主机分布式配额。

## 1. 用户结果与生产风险

认证已经可以阻止匿名请求并隔离 Run，但实现本切片前，任一登录账号仍可无限调用
`POST /v1/chat`、`POST /v1/tailor-resume` 和 `POST /v1/runs`。这些入口都会启动新的模型工作；
失控客户端、脚本重试或被盗 session 会直接放大 Provider 费用、CPU、内存和任务队列。登录失败节流
不能覆盖这个风险。

本切片只建立生产最小护栏：一个账号在固定窗口内最多发起有限次新工作，超限得到稳定 429 和
`Retry-After`；计数保存在认证 SQLite 中，API 重启后仍有效。目标是限制事故半径，不是实现商业计费。

## 2. 研究证据与决策

| 问题 | 证据 | 决策 / 可证伪约束 |
| --- | --- | --- |
| 为什么必须限制 | OWASP API4:2023 Unrestricted Resource Consumption 把计算、第三方 API 和费用列为需要显式上限的资源 | 只覆盖会启动新模型工作的入口；健康检查、能力发现、Run 读取和静态产物不消耗配额 |
| 如何返回超限 | RFC 6585 定义 429；RFC 9110 定义 `Retry-After` 可用秒数或日期 | 返回 `429 work_rate_limited`、固定安全 message 和整数秒 `Retry-After`，不暴露内部行或账号信息 |
| 配额放在哪里 | 当前生产最小拓扑是单主机 SQLite；认证库已有用户外键、busy timeout 和持久登录节流 | 在 AuthService 深模块中用 `BEGIN IMMEDIATE` 原子消费；拒绝进程内 Map，因为重启与同机多进程可绕过 |
| 什么算一次工作 | 一个异步 Run 可能暂停并在回答后继续；按内部模型调用计数会把用户困在已接纳的工作中 | `chat`、同步生成、创建异步 Run 各消费一次；answer 是已接纳 Run 的继续，不再次消费；GET 永不消费 |
| 初始算法 | 生产最低要求是有界、可解释、可测试，不是精确平滑流量 | 采用每账号固定窗口，默认 15 分钟 10 次；环境变量可收紧/放宽；后续只有实际 burst 证据才升级 token bucket |

主要资料：

- OWASP API Security Top 10 2023，API4 Unrestricted Resource Consumption：
  <https://owasp.org/API-Security/editions/2023/en/0xa4-unrestricted-resource-consumption/>
- RFC 6585 §4 `429 Too Many Requests`：<https://www.rfc-editor.org/rfc/rfc6585#section-4>
- RFC 9110 §10.2.3 `Retry-After`：<https://www.rfc-editor.org/rfc/rfc9110#section-10.2.3>
- SQLite `BEGIN IMMEDIATE` 与 transaction：<https://www.sqlite.org/lang_transaction.html>

## 3. 契约与状态转换

配置：

| 变量 | 默认值 | 约束 |
| --- | ---: | --- |
| `RESUME_AGENT_WORK_RATE_LIMIT` | `10` | 每账号每窗口允许的新工作数，1–1000 的安全整数 |
| `RESUME_AGENT_WORK_RATE_WINDOW_MS` | `900000` | 窗口毫秒数，1000–86400000 的安全整数 |

状态按 `(user_id)` 保存一个当前窗口：

```text
无记录 / 窗口到期 --consume--> requests = 1, 新 resetAt, allowed
窗口内 requests < limit --consume--> requests + 1, allowed
窗口内 requests >= limit --consume--> 不修改, denied + Retry-After
```

同一账号的三个入口共享该状态，切换 endpoint 不能绕过。不同账号隔离；用户删除时由外键级联删除。
认证关闭的显式本地 demo 不启用账号配额，因为没有可信的账号 key；生产部署仍必须开启认证。

## 4. 安全、隐私与失败行为

- 数据库只保存用户 ID、计数和窗口起点，不保存请求正文、简历、JD、IP、session token 或 Provider 响应；
- 计数检查与更新在一个 `BEGIN IMMEDIATE` transaction 中完成；同机多个 API 连接不能同时越过最后名额；
- SQLite 失败时 fail closed 为既有安全 `authentication_failed`/500，不退化成无限调用；
- 超限必须发生在调用 Agent/Provider 之前；请求解析与 schema 错误不消费名额；
- 429 不撤销 session、不改变 Run，也不写入新的 Run；
- 固定窗口允许边界 burst，这是明确折中；若生产观测显示不可接受，再独立研究 token bucket/sliding window。

## 5. 实现旅程：单行为 RED → GREEN

| 行为 | RED | GREEN / 设计结果 |
| --- | --- | --- |
| 账号窗口上限 | `consumeWorkQuota is not a function` | `AuthService.consumeWorkQuota` 返回 allowed、remaining、resetAt 和 retry 秒数 |
| 重启与窗口到期 | 新 SQLite 行为测试 | 真实临时数据库 reopen 后保持计数，到期后从 1 重新开始 |
| 两连接最后名额 | 新双连接行为测试 | `BEGIN IMMEDIATE` 包住读取和更新，两个连接只有一个 allowed |
| 三入口共享 | `POST /v1/runs` 在已用完的 chat 名额后仍返回 202 | schema 成功后、Agent/Run 启动前统一 admission，返回 429 且模型未再次调用 |
| 无效请求、账号隔离 | 新 HTTP 行为测试 | 无效 body 先返回 400；账号分别按 user ID 计数 |
| 已接纳 Run 继续 | 新 GET/HITL HTTP 行为测试 | Run 读取不扣名额；配额耗尽后 answer 仍返回 202 |
| 浏览器与部署契约 | CORS/OpenAPI 首次缺少限流声明 | 暴露 `Retry-After`；capabilities、OpenAPI、env 示例和运行文档同步 |

## 6. 验收与剩余缺口

验收覆盖确定性 fake clock、真实临时 SQLite reopen、双连接最后名额、HTTP 429/`Retry-After`、
Agent 调用次数、账号隔离、无效请求、Run GET/HITL continuation、配置边界和机器可读契约。最终全仓命令
与结果记录在下节；license 工具若在本机缺失，必须如实记录 skip，不能算作扫描通过。

完成后最多标记 `Implemented for single-host production baseline`，不能标记分布式或商业级：多主机共享
配额、IP/设备风险、按 token/费用计量、管理员豁免、监控告警和自动封禁仍是后续独立切片。

2026-09-24 验收结果：

- `pnpm agent-api test`：136 passed；
- `pnpm agent test`：312 passed，1 skipped（可选 transformers 环境用例）；
- `pnpm check:ci`：通过，保留 2 条既有 `noNonNullAssertion` warning；`addlicense` binary 缺失，
  脚本明确 skip，不能算作 license 扫描证据；
- `pnpm test`：1785 passed，1 skipped；
- `pnpm build`：9 个 workspace project 构建通过；
- 构建产物 localhost smoke：注册 201，第一次 chat 200，第二次 chat 429，`Retry-After: 60`，
  `work_rate_limited`，capabilities 报告 `{ limit: 1, windowSeconds: 60 }`；
- `git diff --check`：通过。

## 7. 证据台账

| Field | Evidence |
| --- | --- |
| Feature ID | RA-019 |
| Parent / lifecycle | authenticated user → new model-backed work → admit or 429 |
| Delivery state | Implemented for single-host production baseline；未达到多主机或商业计费级别 |
| Current evidence | 认证模式默认启用 10 次/15 分钟固定窗口；三个新工作入口共享 SQLite 账号配额，429 提供 Retry-After |
| Decision | 单主机 SQLite 固定窗口、三个新工作入口共享、answer/GET 不重复消费 |
| Edge cases | restart、window boundary、two connections、cross-user、invalid body、endpoint switching、storage failure、auth disabled |
| Acceptance | API 136、Agent 312+1 skip、全仓 1785+1 skip、check:ci、build、localhost 201→200→429 smoke 与 diff check 均通过；license 工具缺失被明确记录为 skip |
| Remaining gap | distributed quota、token/cost accounting、IP abuse、admin policy、metrics/alerts |

## 8. 会推翻方案的证据

- 若最小部署立即需要多主机，认证 SQLite 不能成为配额真相源，应改用共享数据库/Redis 原子操作；
- 若一次请求的 token/费用差异超过请求数护栏可接受范围，应保留请求 admission，再增加预算计量，不能静默把固定窗口称为费用上限；
- 若 HITL continuation 的实际 Provider 成本远高于初始 Run，应为“已接纳工作预算”建独立契约，而不是在 answer endpoint 临时扣第二次并把用户困住。
