# Resume Agent 本地 API Runtime Feature Brief

> Feature ID：RA-009B
> 状态：Implemented for development；已在个人单机部署中 Enabled
> 最后审阅：2026-09-16
> 范围：本地单机 API 的 Provider、SQLite RunStore、启动恢复与关闭装配；不宣称生产部署可用。

## 1. 用户结果

用户只需启动 API 和 Web，即可创建可跨进程重启保留的简历 Run。未配置模型凭证时，API 仍能启动并响应健康检查和能力发现；真正提交任务时返回稳定、脱敏的配置错误，而不是让整个后端离线。

## 2. 当前证据与修正

- 浏览器使用确定性测试 Provider 已走通“创建 Run → 主动提问 → 回答 → 完成 → 预览 → 下载”。这证明 HTTP/UI 契约可组合，不证明真实模型质量。
- `SqliteRunStore`、事务任务、租约续租、fenced Run 写入和 `recoverPendingTasks()` 已有真实 SQLite 测试，但 API 启动入口仍默认 `InMemoryRunStore`，也没有调用恢复或负责关闭 Store。
- `createDefaultAgent()` 在缺少 `OPENAI_API_KEY` 时直接抛错，导致 `/healthz` 和 `/v1/capabilities` 也无法使用。
- 当前可用 Provider 配置均返回 401/400；因此本切片只能打通运行基础设施，不能把真实模型质量写成已验证。

## 3. 决策

采用一个小的 runtime interface，把配置解析、Provider 可用性、Store adapter、Run worker、HTTP server 和资源关闭封装在启动入口后面：

- 本地命令默认使用仓库内 `.data/resume-agent/runs.sqlite`；显式 `RESUME_AGENT_RUN_STORE=memory` 可回退到易失模式。
- SQLite 目录由 runtime 以仅当前用户可访问的目录权限创建；Store 仍使用现有 versioned schema。
- 启动时执行一次有界 `recoverPendingTasks()`；这解决重启时已经落库的 ready/expired task，不冒充持续轮询、DLQ 或多主机 worker。
- 缺少 Provider key 时注入一个只会抛稳定 `LlmConfigurationError` 的 adapter；健康检查保持在线，同步请求返回 HTTP 503，异步 Run 进入带 `llm_not_configured` 的安全失败态。
- runtime 的 `close()` 先停止 HTTP 接入，再停止 lease heartbeat，最后关闭 SQLite；关闭幂等。
- 无效端口、Store 模式、恢复上限或数据库路径在监听前 fail closed。

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
| `RESUME_AGENT_HOST` | `127.0.0.1` | 本地监听地址 |
| `PORT` | `8787` | 监听端口 |

## 5. 行为切片与验收

1. 无 Provider key：服务可启动；health/capabilities 可读；同步调用为 503；异步 Run 为安全失败。
2. 默认 SQLite：创建的数据跨 runtime 关闭/重启仍可查询。
3. 启动恢复：预先持久化的 task 被有界认领并执行到终态。
4. 关闭：HTTP、heartbeat 与数据库句柄都被释放；重复关闭不报错。
5. 配置错误：在监听前失败，错误不包含 key、JD、简历、数据库内容或底层 SQLite 消息。

至少覆盖的边缘情况：缺 key、无效 Provider 参数、无效 Store 模式、数据库父目录不存在、重启残留 task、恢复上限、端口 0 测试监听、重复关闭、启动中途失败、SQLite 文件损坏/版本过新。

## 6. 证据台账

| Feature ID | 生命周期 / 用户结果 | Delivery | Evidence | Decision | Coverage | Historical gap | Remaining gap |
| --- | --- | --- | --- | --- | --- | --- | --- |
| RA-009B-A | 无 Provider 的启动与安全失败 | Implemented | HTTP health/capabilities、同步 503 与异步安全失败测试 | Adapt | Covered for local contract | Backfilled | 部署告警与前端引导仍需完善 |
| RA-009B-B | SQLite runtime 装配与重启读取 | Enabled on one personal host | close/reopen HTTP test；部署 SQLite 与 restart 后 Run 读取 | Reuse | Covered for one host | Backfilled | 备份/retention 和多主机仍未实现 |
| RA-009B-C | 启动恢复 pending task | Implemented | 真实 SQLite 预置 task，runtime 启动认领并完成 | Reuse | Partial | Backfilled | 仍是单次有界 drain，不是持续 worker poller |
| RA-009B-D | 关闭与资源释放 | Enabled on one personal host | runtime close；SIGTERM 后 API systemd clean exit | Combine | Partial | Backfilled | power-loss 和长 Provider 请求关闭仍未注入 |

## 7. 不在本切片

- 真实 Provider 输出质量、费用和稳定性；
- 认证、Run ownership 和凭证 vault；
- 持续 poller、claim-ahead、DLQ/backoff、跨主机数据库；
- Provider 请求 exactly-once、取消和幂等；
- 生产备份、retention、加密、监控和 runbook；
- Web 前端缺陷修复（由独立前端线程负责）。

## 8. RED → GREEN 与运行证据

- RED：无 Provider key 时 capabilities 缺少运行态，且启动入口会直接抛错。GREEN：health/capabilities 可用；同步请求返回安全 503；异步 Run 以 `llm_not_configured` 失败。
- RED：`startAgentApiServer()` 只返回裸 HTTP server，重启后 Run 不存在。GREEN：runtime 默认装配 SQLite，关闭/reopen 后完成态 Run 可继续读取。
- RED：预置事务 task 因测试时间错误地落在未来而未被认领。GREEN：用真实当前时间构造 ready task，启动恢复计数为 1 并执行到 completed。
- 部署首次启动暴露 `MemoryDenyWriteExecute=true` 与 Node/V8 JIT 不兼容，进程以 SIGTRAP 退出；删除该不兼容规则后，保留其他 systemd 隔离并稳定启动。
- DeepSeek 最小 JSON 调用成功；清除父进程遗留的旧 Provider 环境变量后，合成简历的完整 Agent 请求返回 HTTP 200、`completed` 和 YAML artifact。
- 本切片定向 API 测试为 18/18。共享工作树中的并行 RA-016 文件曾导致 package TypeScript 门禁出现其未完成代码的 unused 错误，不属于本切片。
