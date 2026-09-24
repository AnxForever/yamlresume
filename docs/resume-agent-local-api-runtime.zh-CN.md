# Resume Agent 本地 API Runtime Feature Brief

> Feature ID：RA-009B
> 状态：Implemented for development；已在个人单机部署中 Enabled
> 最后审阅：2026-09-24
> 范围：本地单机 API 的 Provider、SQLite RunStore、启动恢复与关闭装配；不宣称生产部署可用。

## 1. 用户结果

用户只需执行一个本地应用命令即可启动 API 和 Web，并创建可跨进程重启保留的简历 Run。未配置
模型凭证时使用明确标注的离线 Provider 跑通工作流；它不改写文本，也不冒充真实模型质量。

## 2. 当前证据与修正

- 浏览器使用确定性测试 Provider 已走通“创建 Run → 主动提问 → 回答 → 完成 → 预览 → 下载”。这证明 HTTP/UI 契约可组合，不证明真实模型质量。2026-09-22 起该 Provider 进入源码：`RESUME_AGENT_LLM_PROVIDER=offline` 选择 `packages/resume-agent/src/llm/offline.ts` 的离线启发式客户端（不调用模型、不改写文本、找不到姓名时提 blocking 问题而不是猜），`scripts/demo.sh` 用它一条命令起 API 与工作台。在此之前，这句话描述的 Provider 只存在于测试文件的内联 fake 中。
- API runtime 本身默认 SQLite，但 `scripts/demo.sh` 又显式覆盖为 memory；2026-09-24 黑盒重启实验中，
  创建成功的 Run `d2bebd44-3c57-424f-81ae-c5f752de6a2e` 在脚本重启后稳定返回 404。这个入口只能
  称为易失 demo，还不能称为最小本地应用。
- `SqliteRunStore`、事务任务、租约续租、fenced Run 写入和 `recoverPendingTasks()` 已有真实 SQLite 测试，但 API 启动入口仍默认 `InMemoryRunStore`，也没有调用恢复或负责关闭 Store。
- `createDefaultAgent()` 在缺少 `OPENAI_API_KEY` 时直接抛错，导致 `/healthz` 和 `/v1/capabilities` 也无法使用。
- 2026-09-24 之前的可用 Provider 配置均返回 401/400，因此当时的切片只能证明运行基础设施。
  现在已有一个 StepFun 合成样本完成，但单个样本仍不能证明真实简历优化质量、费用或稳定性。
- 2026-09-24 使用用户提供的 StepFun 计划端点只读请求 `/models` 返回 200，确认
  `step-3.7-flash` 在当前凭证的模型清单中；凭证本身不进入代码、文档或测试输出。实现前的
  `demo.sh` 仍强制离线 Provider 并清除 `OPENAI_*`，所以真实 Provider 无法通过同一入口使用。

## 3. 决策

采用一个小的 runtime interface，把配置解析、Provider 可用性、Store adapter、Run worker、HTTP server 和资源关闭封装在启动入口后面：

- 本地命令默认使用仓库内 `.data/resume-agent/runs.sqlite`；显式 `RESUME_AGENT_RUN_STORE=memory` 可回退到易失模式。
- SQLite 目录不存在时由 runtime 以 0700 创建；每次打开 Store 都把主文件、WAL、SHM 收紧为 0600，
  权限处理失败则在监听前安全退出。Store 仍使用现有 versioned schema；调用方显式选择的既有父目录
  不会被擅自 `chmod`。
- 启动时先执行一次有界 `recoverPendingTasks()`，监听后由常驻 poller 继续接管后来 ready/expired 的
  task；基础设施异常与明确瞬态 Provider failure 使用持久化 attempt backoff，有界 `Retry-After` 不能
  缩短本地等待，task 创建 15 分钟后不再开始新的 retry delivery；这些能力不冒充 DLQ 或多主机 worker。
- 缺少 Provider key 时注入一个只会抛稳定 `LlmConfigurationError` 的 adapter；健康检查保持在线，同步请求返回 HTTP 503，异步 Run 进入带 `llm_not_configured` 的安全失败态。
- runtime 的 `close()` 先停止 HTTP 接入，再停止 lease heartbeat，最后关闭 SQLite；关闭幂等。
- 可执行 API 收到 SIGINT/SIGTERM 后先等待上述 runtime 资源关闭，再显式结束进程。未完成的 Provider
  调用不会继续持有进程；其 durable task 由 claim generation fence 隔离，并在租约过期后供新进程
  接管。当前选择是“安全重试”而不是等待任意长的 Provider drain。
- 无效端口、Store 模式、恢复上限或数据库路径在监听前 fail closed。
- 最小本地应用入口保持匿名单用户和离线 Provider，但默认把 Run 写入
  `.data/resume-agent/local-app.sqlite`；`pnpm local-app` 是用户需要记住的唯一命令。
- 可选的 `.env.local-app` 是本地启动配置 seam：显式选择 `openai-compatible` 并提供
  `OPENAI_*` 时，同一个命令使用真实 Provider；文件不存在时仍回退离线模式。该文件必须被
  Git 忽略且仅当前用户可读写。
- 不复用已有 `.env.local`，因为它还承载 API 端口和 Store 等其他运行配置，整体加载会让本地
  数据位置和启动行为发生隐式变化；专用文件只承载这个 launcher 的选择。也不根据任意继承的
  API key 自动开启付费调用：真实调用必须显式设置 `RESUME_AGENT_LLM_PROVIDER=openai-compatible`。
- 没有新增 Anthropic adapter：StepFun 已通过现有 OpenAI-compatible adapter 完成真实 Run，新增
  第二个 adapter 只会扩大当前 interface。若后续证据表明 Messages 接口的质量或能力显著更好，
  再重新评估这个决定。
- 失败与恢复保持简单：上游错误进入既有脱敏失败态；移除 `.env.local-app` 即恢复离线模式，
  SQLite 中已完成的 Run 不受 Provider 切换影响。凭证文件不进入 Git、日志或学习记录。
- 仓库级 smoke 命令只使用离线 Provider、临时 SQLite 和生产构建后的 API 进程。它通过 HTTP 创建、
  轮询和重启后读取 Run，不读取 `.env.local-app`、不继承 Provider 凭证，也不直接查询 SQLite 表。
  这样验收 interface 与真实客户端一致，存储实现仍可替换。
- 本地数据保护使用 Node 22.21.1 已提供的 SQLite Online Backup API，而不是直接复制 WAL 模式下的
  主文件。备份先写入临时数据库，经过 RunStore schema 与 `quick_check` 验证后才以 0600 权限发布；
  恢复先验证备份并为现有目标创建安全副本，检测到 WAL/SHM 活动态时拒绝替换。命令不输出简历、
  Run 内容或底层 SQLite 异常正文。
- 进程中断恢复使用本地 OpenAI-compatible mock 作为外部 Provider seam：第一次请求保持 in-flight，
  API 在持有任务租约时被 `SIGKILL`，随后同一 SQLite 上的新 API 依靠租约过期与常驻 poller 接管。
  smoke 可显式缩短 task lease/poll 配置，但不直接改任务表、不伪造时钟，也不调用外部模型。
- 本地 SQLite 主文件、WAL、SHM 与备份临时产物都可能包含简历内容；不能只依赖父目录权限。runtime
  应把自己管理的数据库产物收紧为 0600，备份流程必须清理临时 sidecar，权限处理失败时启动应
  fail closed。
- 本地自检必须只读打开既有 SQLite，执行完整性与 schema 兼容性检查后返回结构化状态；不能为了
  “验证”而迁移、创建数据库、切换 journal mode、认领任务或加载 Provider 凭证。缺失数据库表示
  首次启动尚未初始化，不应被误报为损坏。

## 4. 状态与接口

```text
config -> open store -> construct worker -> bounded recovery -> listen
   |           |              |                 |             |
   +-----------+--------------+-----------------+----> safe startup failure

listening -> stop HTTP -> close RunService -> close Store -> closed
```

环境契约：

| 变量 | 默认值 | 含义 |
| --- | --- | --- |
| `RESUME_AGENT_RUN_STORE` | `sqlite` | `sqlite` 或 `memory` |
| `RESUME_AGENT_RUN_DB_PATH` | `.data/resume-agent/runs.sqlite` | 可信本地 SQLite 文件 |
| `RESUME_AGENT_RECOVERY_LIMIT` | `100` | 单次启动最多认领的历史 task，范围 1–1000 |
| `RESUME_AGENT_TASK_LEASE_MS` | `60000` | durable task 租约，范围 100–86400000 ms |
| `RESUME_AGENT_TASK_POLL_MS` | `1000` | 常驻 worker 轮询间隔，范围 10–60000 ms |
| `RESUME_AGENT_TASK_RETRY_ELAPSED_MS` | `900000` | 从 task 创建起允许开始 retry delivery 的窗口，范围 1000–86400000 ms |
| `RESUME_AGENT_HOST` | `127.0.0.1` | 本地监听地址 |
| `PORT` | `8787` | 监听端口 |

## 5. 行为切片与验收

1. 无 Provider key：服务可启动；health/capabilities 可读；同步调用为 503；异步 Run 为安全失败。
2. 默认 SQLite：创建的数据跨 runtime 关闭/重启仍可查询。
3. 启动恢复：预先持久化的 task 被有界认领并执行到终态。
4. 关闭：HTTP、heartbeat 与数据库句柄都被释放；重复关闭不报错。
5. 配置错误：在监听前失败，错误不包含 key、JD、简历、数据库内容或底层 SQLite 消息。
6. 本地应用入口：Web、API 和离线完整工作流一条命令启动；Run 在停止并重启同一命令后仍可读取。
7. 可选真实 Provider：配置 `.env.local-app` 后，同一命令报告 `openai-compatible`，并通过
   HTTP 创建一个使用真实模型完成的脱敏 Run；删除配置不会破坏原有离线入口。
8. 可重复 smoke：单个无费用命令完成健康检查、创建 Run、等待完成、关闭 API、用同一 SQLite
   重启 API，并从公开 HTTP interface 读回相同产物。
9. 本地数据保护：可为默认 Run 数据库创建一致、私有且可验证的备份；应用停止后可恢复备份，
   同时保留恢复前数据库，并通过 HTTP 读回同一 Run。
10. 进程中断恢复：任务已进入 Provider 请求后强制终止 API；新进程在租约过期后接管同一任务，
    最终通过 HTTP 返回同一 Run 的完成态和产物。
11. 只读启动前检查：数据库健康时报告当前 schema；未创建时报告可首次初始化且不创建文件；损坏、
    未来 schema 或非空 WAL 用稳定错误拒绝，不启动应用或 Provider。
12. 受控关闭恢复：Provider 请求挂起时收到 SIGTERM，API 在关闭 HTTP、停止租约并关闭 SQLite 后及时
    干净退出；新进程接管同一 Run 并完成，而不是等待上游超时。
13. 重试退避：worker 基础设施异常释放 task 后，下一次 delivery 按 attempt 延后且等待时间持久化；
    API 重启不能绕过等待窗口。
14. Provider 瞬态失败：只有 typed retryable Provider error 进入同一持久化退避；配置、普通 4xx、协议、
    校验和未知错误仍安全终止；3 次 delivery 后有界失败，原始错误不进入公开 Run 或 task row；有效
    `Retry-After` 在 transport 与 durable 两层都不能被更短的本地退避覆盖。
15. 重试截止期：旧 task 的第一次 delivery 仍可执行；第一次失败算出的下次时间若到达截止点则立即
    安全终止，已 release 的 task 跨重启后在精确截止点也不能再次调用模型。
16. durable Run 在途取消：内置 OpenAI-compatible adapter 在 service close、heartbeat 失租或 retry
    deadline 到达时中断当前 fetch/body/retry wait；关闭与失租不写旧 generation，deadline 写稳定失败并 ack。

至少覆盖的边缘情况：缺 key、无效 Provider 参数、无效 Store 模式、数据库父目录不存在、重启残留 task、恢复上限、端口 0 测试监听、重复关闭、启动中途失败、SQLite 文件损坏/版本过新、既有宽松数据库权限、备份临时 sidecar、备份目标已存在、无效备份、运行中恢复和恢复前安全副本。

## 6. 证据台账

| Feature ID | 生命周期 / 用户结果 | Delivery | Evidence | Decision | Coverage | Historical gap | Remaining gap |
| --- | --- | --- | --- | --- | --- | --- | --- |
| RA-009B-A | 无 Provider 的启动与安全失败 | Implemented | HTTP health/capabilities、同步 503 与异步安全失败测试 | Adapt | Covered for local contract | Backfilled | 部署告警与前端引导仍需完善 |
| RA-009B-B | SQLite runtime 装配与重启读取 | Enabled on one personal host | close/reopen HTTP test；部署 SQLite 与 restart 后 Run 读取 | Reuse | Covered for one host | Backfilled | 备份/retention 和多主机仍未实现 |
| RA-009B-C | 启动与常驻 worker 恢复 pending task | Implemented | 真实 SQLite 预置 task 的启动认领；常驻 poller 包内测试；真实进程 crash smoke；RA-015G/H classified release backoff | Reuse | Covered for local single worker | Backfilled | DLQ/redrive、jitter 与跨主机协调仍未实现 |
| RA-009B-D | 关闭与资源释放 | Enabled on one personal host | runtime close；SIGTERM 后 API systemd clean exit；Provider in-flight 时 SIGKILL 与 SIGTERM 注入；内置 adapter 主动取消由 RA-015K 覆盖 | Combine | Partial | Backfilled | 忽略 AbortSignal 的第三方 adapter 完成式 drain、Windows 信号语义与多平台 CI 仍未覆盖 |
| RA-009B-E | 一条命令的本地单用户应用 | Implemented for local development | `pnpm local-app` 创建 Run；停止整套应用并以同一命令重启后，原 Run 仍返回 200、`completed` 且产物可读 | Deepen existing launcher | Covered for local restart | `demo.sh` 曾覆盖 runtime 的 SQLite 默认值 | 仍需真实 Provider 质量、备份和故障恢复证据，不能称为生产可用 |
| RA-009B-F | 同一本地入口使用真实 Provider | Implemented for local development | StepFun `/models` 与 Chat Completions 返回 200；`pnpm local-app` 报告 `openai-compatible`；合成 Run 完成并生成 YAML；无配置重启后回退 offline 且原 Run 可读 | Deepen existing launcher | One synthetic end-to-end sample | launcher 曾强制 offline 并清除凭证 | 仍需多样本质量、费用、限流和故障恢复证据 |
| RA-009B-G | 一条命令重复验证本地持久化主链路 | Implemented for development | `pnpm local-app:smoke` 以离线 Provider、临时 SQLite 和两个生产构建 API 进程完成 HTTP 创建、轮询、重启读取及产物一致性检查 | Deepen HTTP interface | One synthetic restart smoke | 验收步骤曾依赖聊天记录和人工操作 | 仍需 CI/多平台运行证据 |
| RA-009B-H | 本地 Run 数据库备份与恢复 | Implemented for local development | online backup；0600 与 SHA-256；无效源/已有目标/运行中或残留 WAL 恢复拒绝；恢复前安全备份；8 tests；HTTP 丢失恢复 smoke；真实 CLI backup 与隔离目标 restore | Add a narrow data-maintenance interface | One synthetic recovery drill | 只有 SQLite 重启读取，没有数据丢失恢复路径 | CI/多平台、断电注入、异地备份、加密、retention 与真实数据恢复演练仍未覆盖 |
| RA-009B-I | Provider 调用中进程崩溃后的自动接管 | Implemented for local development | `pnpm local-app:crash-smoke`：本地 mock 首次请求 in-flight 后 SIGKILL；新 API 依靠租约过期与 poller 接管；同一 Run 经 HTTP 完成并生成 YAML | Reuse durable task seam | One synthetic process-crash drill | 重启 smoke 只覆盖已完成 Run | Provider exactly-once、外部副作用幂等、断电/多平台与多 worker 演练仍未覆盖 |
| RA-009B-J | 本地 SQLite 敏感产物保持私有 | Implemented for local development | runtime 重开将主库/WAL/SHM 从 0644 修复为 0600；备份目录成功后只剩发布文件；真实本地数据目录 0700、四个数据库产物复核为 0600 | Deepen local data seam | Two focused tests plus real local permission repair | 文档只承诺目录与已发布备份权限，未验证 runtime DB 和临时 sidecar | Windows/多平台权限语义、静态加密、既有父目录审计仍未覆盖 |
| RA-009B-K | 启动前只读检查本地 Run 数据库 | Implemented for local development | `checkLocalRunDatabase()` 使用 immutable 只读连接；有效库检查前后目录与字节一致；缺失库不创建；未来 schema 与非空 WAL 稳定拒绝；真实 `pnpm local-app:doctor` 报告 schema 2 | Deepen local data seam | Four focused behaviors plus real CLI | 用户只能尝试启动应用或备份，无法区分未初始化、健康、不兼容 schema 和未停止状态 | Windows/多平台、正在变化文件的强锁与 Provider 配置检查仍未覆盖 |
| RA-009B-K2 | 损坏 Run 数据库的 doctor CLI 安全失败 | Implemented for local development | `pnpm local-app:doctor-smoke` 在最小环境以真实 CLI 拒绝合成损坏库；stderr 仅含稳定错误；源文件和目录不变 | Validate existing CLI seam | One synthetic corrupt-file process smoke | 包内 interface 已收敛 SQLite 错误，但没有证明 CLI 退出码、输出和磁盘副作用 | CI/多平台与并发修改期间的竞态仍未覆盖 |
| RA-009B-L | Provider in-flight 时的 SIGTERM 受控关闭与接管 | Implemented for single-host production baseline | `pnpm local-app:shutdown-smoke`：60 秒 Provider 超时下发送 SIGTERM；mock 观察连接关闭；首进程及时 code 0 退出；新进程接管同一 Run 并生成 YAML | Validate executable process seam | One synthetic process-shutdown drill plus package lifecycle tests | 原信号 handler 只设置 exitCode，活动 Provider socket 会阻止退出；后续显式退出只解决进程收敛，未证明主动 abort | 忽略 AbortSignal 的第三方 adapter 完成式 drain、Windows 信号语义、多平台 CI 与真实 Provider 证据仍未覆盖 |
| RA-009B-M / RA-015G | 持久化 durable-task 重试退避 | Implemented for local development | release 可持久化 `availableAt`；RunService 按 attempt 使用 1s/2s/4s…、最高 30s；精确边界、重开与 terminal replay 测试 | Deepen durable task seam | One real-SQLite fake-clock lifecycle | 较短 poll 下基础设施异常 task 可立即重新领取 | DLQ/redrive、jitter、指标与 operational traffic evidence 仍未覆盖；Provider 分类由 RA-015H 补齐 |
| RA-009B-N / RA-015H | 明确瞬态 Provider 失败的持久化恢复 | Implemented for local development | retryable/non-retryable typed error、prepare/post-HITL completion、999/1000ms 与重开、3-delivery exhaustion、非 durable 兼容和隐私测试 | Deepen existing RunService seam | Real temporary SQLite plus fake Provider; same-host only | RA-015G 只覆盖外围基础设施异常 | Provider exactly-once 与精确 cost accounting、DLQ/redrive、jitter、指标、多主机和 operational traffic evidence；Retry-After、deadline 与在途取消由 RA-015I/J/K 补齐 |
| RA-009B-O / RA-015H-P1 | HTTP adapter 到 durable worker 的瞬态失败组合演练 | Implemented for local development | `pnpm local-app:provider-retry-smoke`：生产 API entry + 临时 SQLite + 本地 mock；3 次带 `Retry-After: 2` 的 503 耗尽 transport retry，两次 transport 与一次 durable gap 均 ≥1.9s，第 4 次请求恢复并完成 YAML | Validate executable composition | One synthetic same-process recovery drill | 包内测试直接构造 typed error，未穿过真实 HTTP adapter/runtime 装配 | 真实 Provider、进程重启恰落在 backoff 窗口、CI/多平台、指标告警与运维演练仍未覆盖 |
| RA-009B-P / RA-014D / RA-015I | Provider 建议的有界跨层等待 | Implemented for local development | strict seconds/date、invalid/cap/privacy、adapter timing、SQLite 4.999/5s restart boundary 与 2s executable smoke | Deepen existing adapter and RunService seams | Loopback HTTP plus real temporary SQLite; same-host only | transport 与 durable policy 都曾只使用各自本地 backoff | 精确 transport/cost accounting、真实 Provider、jitter、指标和多主机协调；delivery deadline/cancellation 由 RA-015J/K 补齐 |
| RA-009B-Q / RA-015J | 持久化 task retry 截止期 | Implemented for local development | `createdAt` 推导 15 分钟默认 deadline；下一次时间等于 deadline 立即失败；SQLite 重开后精确边界不再调用模型；旧 task 首次 delivery 兼容；运行时配置 fail closed；RA-015K 补齐在途 timer | Deepen existing RunService seam | Real temporary SQLite plus fake clock/Provider; same-host only | attempts 与单次等待封顶不能限制跨重启 elapsed time | 精确 transport/cost accounting、真实流量、指标与多主机时间源 |
| RA-009B-R / RA-015K | durable Run Provider 在途取消 | Implemented for single-host production baseline; not Enabled or Operational | 41 个 loopback adapter tests、51 个 SQLite lifecycle tests、Agent 传播回归，以及 shutdown/crash mock disconnect + takeover smokes | Combine existing LLM and RunService seams | Built-in adapter and same-host durable Run | close/heartbeat 曾只 fence 写入，SIGTERM 曾依靠进程退出断开 socket，RA-015J 曾只拒绝新 delivery | 同步 HTTP disconnect、忽略 signal 的 adapter、远端计费证明、Provider exactly-once/idempotency、多主机和 operational traffic evidence |

## 7. 不在本切片

- 真实 Provider 输出质量、费用和稳定性；
- 认证、Run ownership 和凭证 vault；
- claim-ahead、DLQ/redrive、retry jitter、跨主机数据库；
- Provider 请求 exactly-once/idempotency、同步 chat/tailor HTTP 断连取消，以及远端停止执行或计费证明；
- 异地/自动备份、retention、加密、监控和生产 runbook；
- Web 前端缺陷修复（由独立前端线程负责）。

## 8. RED → GREEN 与运行证据

- RED：无 Provider key 时 capabilities 缺少运行态，且启动入口会直接抛错。GREEN：health/capabilities 可用；同步请求返回安全 503；异步 Run 以 `llm_not_configured` 失败。
- RED：`startAgentApiServer()` 只返回裸 HTTP server，重启后 Run 不存在。GREEN：runtime 默认装配 SQLite，关闭/reopen 后完成态 Run 可继续读取。
- RED（RA-009B-E）：原 `demo.sh` 强制使用 memory；创建 Run `d2bebd44-3c57-424f-81ae-c5f752de6a2e`，停止整套应用并重启后，`GET /v1/runs/{id}` 返回 404。
- GREEN（RA-009B-E）：`pnpm local-app` 启动日志显示仓库根目录的绝对 SQLite 路径；创建 Run `07d1cb53-6256-423c-9b24-67e7e4ff56d0` 并等待 `completed`，停止整套应用、重新执行同一命令后，原 Run 返回 HTTP 200，姓名与 YAML/HTML 产物保持不变；`git check-ignore -v .data/resume-agent/local-app.sqlite` 也确认本地数据不会进入版本控制。
- RED（RA-009B-F）：即使进程显式提供 `openai-compatible` 和 `OPENAI_*`，原 launcher 仍覆盖为 offline 并清除凭证，启动日志稳定报告 `provider offline`。
- GREEN（RA-009B-F）：`.env.local-app` 权限为 0600 且命中 `.gitignore`；同一个 `pnpm local-app` 报告 `provider openai-compatible`。合成 Run `c7198d44-6f2b-4959-af76-dff715f97dc6` 经真实 `step-3.7-flash` 完成，保留合成姓名、识别目标职位 `TypeScript Backend Engineer` 并生成 YAML。停止后用不存在的配置文件路径重启，入口报告 offline，原 Run 仍返回 HTTP 200 和 `completed`。
- RED（RA-009B-G）：`pnpm local-app:smoke` 不存在；本地持久化主链路只能依赖包内测试或人工启动、
  `curl`、记录 Run ID、停止和重启。
- GREEN（RA-009B-G）：同一命令先构建 core、Agent 与 API，再以不继承 Provider 凭证的最小环境
  启动离线 API；健康与能力检查通过，HTTP 202 创建的合成 Run 完成且 YAML 产物包含预期姓名。
  第一个进程正常关闭后，第二个进程以同一临时 SQLite 启动，HTTP 200 读回相同 Run、终态和完全
  相同的 YAML；命令退出 0，临时目录被清理。
- RED（RA-009B-H）：仓库没有本地数据库备份或恢复 interface；直接复制
  `.data/resume-agent/local-app.sqlite` 会忽略 WAL 一致性，且无法证明副本可由当前 RunStore 打开。
- GREEN（RA-009B-H）：`backupLocalRunDatabase()` 在源 Store 保持打开时通过 SQLite Online Backup
  生成候选库，经当前 RunStore schema 与 `quick_check` 验证后以 0600 权限发布；无效源和已存在目标
  均 fail closed。`restoreLocalRunDatabase()` 对已存在目标先生成独立安全备份，用同目录候选库可回滚
  换入；即使主文件缺失，只要检测到 WAL/SHM 也拒绝运行；无效备份不改变当前库。8 个定向行为测试通过。
- GREEN（RA-009B-H recovery drill）：`pnpm local-app:data-smoke` 以离线 Provider 和临时数据经 HTTP
  创建完成态 Run，在线备份后关闭 runtime，移走原数据库，再恢复并启动新 runtime；同一 Run 与
  YAML 产物经 HTTP 完全一致。`pnpm local-app:backup` 也已对默认本地库创建 0700/0600 的一致备份；
  `RESUME_AGENT_RUN_DB_PATH` 指向隔离临时目标的真实 `pnpm local-app:restore -- <path>` 退出 0。
- 调试记录（RA-009B-H）：首次 CLI 恢复把 pnpm 传入的字面量 `--` 当成第二个业务参数，在构建前以
  usage 失败，未写目标库。根因是脚本直接解构 `process.argv`；修复为先移除可选分隔符，再解析唯一
  路径，隔离目标复跑通过。
- RED（RA-009B-I）：现有 `local-app:smoke` 只在 Run 完成后正常关闭进程；没有命令能证明 Provider
  请求 in-flight 时的强制终止会在租约过期后由新进程接管。runtime 的固定 60 秒 lease 也使黑盒
  故障实验无法快速、确定地执行。
- GREEN（RA-009B-I）：runtime 接受有界且在监听前校验的 `RESUME_AGENT_TASK_LEASE_MS` 与
  `RESUME_AGENT_TASK_POLL_MS`。`pnpm local-app:crash-smoke` 使用最小环境、临时 SQLite、合成候选人
  和本地 OpenAI-compatible mock；mock 收到第一次 JobSpec 请求后保持连接，API 在持有租约时被
  `SIGKILL`。第二个 API 使用同一数据库启动，在旧租约过期后由常驻 poller 接管；mock 观察到
  JobSpec 共 2 次、Draft 1 次，原 Run 最终经 HTTP 返回 `completed`，YAML 包含合成姓名。脚本不读取
  `.env.local-app`、不继承真实 Provider 凭证、不改 task 表、不伪造时钟，退出 0 后清理临时数据。
- RED（RA-009B-J）：2026-09-24 对真实本地数据只读执行 `stat`，默认
  `.data/resume-agent/local-app.sqlite`、`-wal` 与 `-shm` 均为 0644；备份目录还遗留两个以随机
  `.sqlite.tmp` 命名的 0644 WAL/SHM。目录本身为 0700，降低了当前可达性，但文件权限和临时清理
  没有兑现“敏感 SQLite 产物自身私有”的不变量。
- GREEN（RA-009B-J）：公开 runtime interface 的测试先把主库/WAL/SHM 全部放宽为 0644，重开后
  三者都为 0600，新建数据库目录为 0700；任何非 ENOENT 的权限失败沿既有 `store_open_failed`
  在监听前失败。Online Backup 先以 0600 原子创建随机候选主库，成功与失败都会清理候选主库、WAL
  和 SHM；备份成功后的目标目录测试只包含显式发布的文件。真实 `.data/resume-agent` 与 backups
  目录复核为 0700，`local-app.sqlite`、其 WAL/SHM 和 `runs.sqlite` 已修复为 0600；两个没有对应
  临时主库的历史 sidecar 已删除，正式备份未改动。
- RED（RA-009B-K）：仓库没有 `checkLocalRunDatabase()` 或 `pnpm local-app:doctor`；现有备份路径
  虽会执行 `quick_check`，但会创建目标文件，不能充当只读启动前检查；直接使用 `SqliteRunStore.open()`
  还会迁移 schema、启用 WAL 并改变文件状态。
- GREEN（RA-009B-K）：`checkLocalRunDatabase(path)` 对有效库通过 `file:` URL 的 `immutable=1` 只读
  执行 `quick_check`，测试逐字节证明调用前后主库及目录内容不变；Store schema 版本由 Agent 包的
  单一导出提供，未来版本返回 `unsupported_schema`。缺失路径返回 `missing` 且不创建文件；检查
  前后发现非空 WAL 都返回 `database_in_use`，不忽略可能尚未 checkpoint 的提交。CLI 仅选择默认或
  `RESUME_AGENT_RUN_DB_PATH`、打印状态和退出码，不加载 `.env.local-app`、不启动 API/Web、不调用
  Provider。真实默认库执行 `pnpm local-app:doctor` 退出 0，报告 `ready` 与 schema 2；隔离的缺失路径
  报告可首次初始化，命令后仍不存在数据库文件。
- RED（RA-009B-K2）：`pnpm local-app:doctor-smoke` 不存在，损坏库只有包内函数断言；无法证明真实
  CLI 子进程的退出码、错误输出和文件副作用。
- GREEN（RA-009B-K2）：`pnpm local-app:doctor-smoke` 在 0700 临时目录创建仅含合成敏感标记的 0600
  损坏库，以只传 `PATH`、locale、时区、Node 警告控制和临时数据库路径的环境运行真实 doctor CLI。
  CLI 非零退出且 stderr 严格等于 `Local Run database is invalid`，不含合成标记或 SQLite 原始错误；
  主库字节、权限和目录条目保持不变，没有 WAL/SHM。脚本不加载 `.env.local-app`、不向子进程传递
  Provider 凭证，并在退出前清理临时目录。
- 调试记录（RA-009B-K2）：首轮 GREEN 中业务错误已正确收敛，但 Node 的 SQLite 实验性警告也写入
  stderr，使“仅一条稳定错误”断言保持 RED；在隔离子进程中设置 `NODE_NO_WARNINGS=1` 后重新运行通过，
  没有放宽业务错误断言。
- RED（RA-009B-L）：`pnpm local-app:shutdown-smoke` 把本地 mock Provider 的请求保持 in-flight，并把
  client 超时设为 60 秒；首个 API 收到 SIGTERM 后超过 15 秒仍未退出，测试助手最终以 SIGKILL 清理并
  报告 `Local API did not stop in time.`。根因是信号 handler 只设置 `process.exitCode`，活动 fetch socket
  仍让事件循环存活。
- GREEN（RA-009B-L）：可执行 server 的信号 handler 先等待 `runtime.close()` 停止 HTTP、abandon
  heartbeat、关闭 Store/Auth，再显式 `process.exit(0)`；嵌入式 `runtime.close()` interface 不变。
  `pnpm local-app:shutdown-smoke` 现验证首进程在 5 秒预算内 code 0 退出；同一 SQLite 上的新进程等待旧
  租约过期后重试 JobSpec 一次、Draft 一次并完成原 Run。原 `pnpm local-app:crash-smoke` 也复跑通过，
  证明 SIGKILL 接管路径未回归；两个 drill 都只用合成数据、合成 key 和本地 mock，不读取真实凭证。
- RED → GREEN（RA-009B-P / RA-014D / RA-015I）：Provider 的 `Retry-After` 最初不影响 transport 或
  durable wait；Header 解析、typed safe hint 和 SQLite `available_at` 组合后，本地 mock 的三个
  `503 Retry-After: 2` 使第 1→2、2→3、3→4 个 JobSpec 请求间隔都不少于 1.9 秒。公开 Run 等待时仍为
  `analyzing_jd` 且无私密 marker，第 4 个 JobSpec 与唯一 draft 成功后完成原 YAML。该演练不读取
  `.env.local-app`，不访问外网或真实 Provider。
- 调试记录（RA-009B-F）：第一次合成 Run 使用了非法小写技能等级 `advanced`，因此在异步任务中进入统一失败态；把它改为 YAMLResume 枚举中的 `Advanced` 后原 HTTP 链路通过。最小 adapter 请求、完整直连 Agent 和完整 HTTP Run 逐层排除了凭证、Base URL、模型与结构化输出问题；没有保存原始模型响应。
- RED：预置事务 task 因测试时间错误地落在未来而未被认领。GREEN：用真实当前时间构造 ready task，启动恢复计数为 1 并执行到 completed。
- 部署首次启动暴露 `MemoryDenyWriteExecute=true` 与 Node/V8 JIT 不兼容，进程以 SIGTRAP 退出；删除该不兼容规则后，保留其他 systemd 隔离并稳定启动。
- DeepSeek 最小 JSON 调用成功；清除父进程遗留的旧 Provider 环境变量后，合成简历的完整 Agent 请求返回 HTTP 200、`completed` 和 YAML artifact。
- 2026-09-24 收尾验证：本地启动、doctor、主链路、数据恢复与进程崩溃 smoke 脚本语法通过；
  `pnpm local-app:doctor`、`pnpm local-app:doctor-smoke`、`pnpm local-app:smoke`、
  `pnpm local-app:data-smoke`、`pnpm local-app:crash-smoke`、
  `pnpm local-app:shutdown-smoke` 均退出 0；
  `pnpm test` 的 9 个 workspace 共 1808 项通过、1 项按既有环境条件跳过；API 包 151 项全部通过；`pnpm build`、
  `pnpm check:ci` 与 `git diff --check` 均
  退出 0。`check:ci`
  仍报告 2 个既有 non-null assertion warning，且本机缺少 `addlicense` binary 时许可证脚本按
  现有设计跳过检查；前端测试仍输出既有 React `act(...)` warning，这些都不是本切片新增的失败。
- 2026-09-24 Retry-After 增量验证：37 个 adapter、47 个 SQLite、24 个 Run tests 通过；Agent 包
  332 passed、1 skipped，全仓 1820 passed、1 skipped；provider-retry、crash、shutdown smokes 均退出
  0。TypeScript/Biome、build 与 diff 门禁结果记录在独立
  [`Provider Retry-After brief`](./resume-agent-provider-retry-after.zh-CN.md)。
- RED → GREEN（RA-009B-Q / RA-015J）：第一次 durable delivery 的可重试失败最初仍会把 task release 到
  恰好等于截止点的 `availableAt`，Run 保持 `analyzing_jd`；RunService 现在从持久化 `createdAt` 推导
  deadline，下一次时间到达截止点便立即安全失败并 ack。若 task 已在截止点前 release，SQLite 重开后
  于精确截止点 claim 也会在模型调用前终止；旧 task 的第一次 delivery 仍至少执行一次，截止点前的
  5 秒 Provider 等待仍可恢复完成。运行时非法 elapsed 配置会在监听前返回 `invalid_configuration`。
- 2026-09-24 Retry deadline 增量验证：SQLite workflow 定向测试 50 passed；Agent 包 335 passed、
  1 skipped；API 包 152 passed；全仓 1824 passed、1 skipped；provider-retry、crash、shutdown smokes
  均退出 0；聚焦 Biome、`pnpm check:ci`、`pnpm build` 与 `git diff --check` 均通过。`check:ci`
  仍只报告 2 个既有 non-null assertion warning，本机缺少 `addlicense` 时许可证脚本按现有设计跳过。
  该能力只限制新的 durable delivery admission，不会硬取消正在途请求，也不提供精确
  transport/cost accounting；完整证据见
  [`task retry deadline brief`](./resume-agent-task-retry-deadline.zh-CN.md)。
- RED → GREEN（RA-009B-R / RA-015K）：内置 adapter 最初忽略 caller signal，挂起请求只能等 500ms
  timeout；transport retry wait 也会在 abort 后继续 sleep 约 980ms。`LlmClient` 增加一个可选
  `AbortSignal` 后，normalization、Repair、JobSpec、Draft 复用同一 signal；fetch、response body 与
  Retry-After wait 均能立即返回稳定、脱敏、不可重试的 `cancelled`。RunService 在 close、heartbeat
  renewal false/error 和 attempt > 1 的精确 retry deadline 上取消当前 delivery：前两者不写旧
  generation，deadline 写 `agent_task_retry_deadline_exceeded` 并 ack，旧 task 首次 delivery 保持兼容。
- 2026-09-25 Provider cancellation 最终验证：adapter 41、Agent propagation 16、SQLite lifecycle 51
  tests 通过；Agent 包 341 passed、1 skipped，API 包 152 passed，全仓 1830 passed、1 skipped；
  `pnpm local-app:shutdown-smoke`、`pnpm local-app:crash-smoke` 与
  `pnpm local-app:provider-retry-smoke` 均退出 0，前两者的本地 mock 都观察到首个 Provider 连接关闭，
  后继进程完成原 Run。focused Biome、`pnpm check:ci`、`pnpm build` 与 `git diff --check` 全部通过；
  仍只有两个既有 non-null warning，且本机缺少 `addlicense` 时许可证检查按仓库脚本设计跳过。该结论
  只覆盖内置 adapter 的同主机 durable Run，不覆盖同步 HTTP disconnect、忽略 signal 的第三方 adapter、
  远端停止执行/计费、Provider exactly-once/idempotency 或精确 transport/cost accounting。
