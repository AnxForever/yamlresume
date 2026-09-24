# RA-015J：持久化任务重试截止期

> 状态：Implemented for development
> 最后审阅：2026-09-24
> 范围：为同主机 durable Run task 增加跨 SQLite 重启的 elapsed-time 截止期；不改 UI、SQLite schema、
> Provider adapter、transport attempt 上限、Run 成功结果或费用计量。

## 1. 用户结果与当前证据

实施前，本地应用已经限制每个 Provider 调用的 transport attempts、每个 task 的 delivery attempts，并把
`Retry-After` 封顶为 30 秒，但还没有一个跨进程的时间截止点。应用长时间停止、连续超时或 Provider
反复建议等待时，旧 task 仍可能在很晚以后重新调用模型；这不符合生产基础对“最终停止”的要求。

实施前可复用的证据：

- `RunTask.createdAt` 已以整数毫秒持久化到 SQLite，并随 claim 返回；无需新增 deadline 列或 migration；
- `ResumeAgentRunService` 已独占 delivery attempt、backoff、heartbeat、fenced Run failure 与 ack/release；
- `taskRetryAvailableAt()` 已得到本地退避和安全 Provider 建议组合后的下一次领取时间；
- `RunBudget` 是一次内存 workflow execution 的逻辑模型调用/token 计量，不跨进程；HTTP adapter 内部失败的
  transport attempts 也不会逐次返回 metadata。因此本切片不能诚实地宣称解决费用预算。

## 2. 决策与 interface

- `ResumeAgentRunServiceOptions` 增加 `maxTaskRetryElapsedMs?: number`，默认 15 分钟，有效范围
  1 秒至 24 小时；API runtime 通过 `RESUME_AGENT_TASK_RETRY_ELAPSED_MS` 注入并在监听前校验。
- 截止点由 `task.createdAt + maxTaskRetryElapsedMs` 推导。`createdAt` 是既有持久化事实，Store interface、
  task row 和 schema 都不变。
- 第一次 delivery 即使 task 因应用停止而排队很久，仍允许尝试一次；预算只限制 retry。第一次失败后，
  若算出的 `availableAt >= deadline`，立即写安全终态并 ack，不安排一个注定不能执行的 retry。
- 第 2 次及后续 claim 若 `now >= deadline`，在任何模型调用前写安全终态并 ack。精确边界采用“等于即耗尽”。
- 新稳定错误为 `agent_task_retry_deadline_exceeded / The resume tailoring task exceeded its retry deadline.`；
  不包含错误正文、Header、Prompt、候选人材料、时间戳或配置值。
- attempt 上限先于 deadline 判定，保留既有 `agent_task_attempts_exhausted` 语义；暂停、完成、失败或缺失 Run
  仍只清理 stale task，不倒退状态。

这是现有 RunService 深模块中的策略，不新增 `RetryBudget` port：时间、claim 和 fenced mutation 都已经在
同一个 seam，拆出浅层 pass-through 只会把状态转换分散到调用方。

## 3. 状态转换

```text
claim delivery 1
  -> execute once even when task was queued for a long time
  -> retryable failure
       -> retryAt = max(local backoff, safe Retry-After)
       -> retryAt < persisted-derived deadline ? release(retryAt)
                                           : safe failed snapshot -> ack

claim delivery n > 1
  -> now >= deadline ? safe failed snapshot -> ack without Provider call
                     : execute under existing heartbeat/fencing
```

正在途的 Provider 请求可能在截止点之后才由既有 per-attempt timeout 返回。本切片保证的是“不在截止点
之后开始新的 durable delivery”，不是强行中断当前 fetch，也不是严格 wall-clock cancellation。
后续 RA-015K 已把 attempt > 1 的剩余持久化 deadline 变成在途 timer，并在精确到点时取消内置
OpenAI-compatible transport；本段保留 RA-015J 独立交付时的原始边界。

## 4. 一次一个行为的 TDD 执行顺序

1. Tracer：真实 SQLite task 在第一次 retryable failure 后得到恰好落在截止点的下一次时间；RED 会 release
   并保持非终态，GREEN 应立即安全失败、ack，且模型只调用一次。
2. Restart：第一次失败仍能在截止点前 release；关闭重开 SQLite，在精确截止点 claim 后不调用模型并写
   `agent_task_retry_deadline_exceeded`。
3. Recovery：截止点前的 retry 仍可正常完成，证明预算不是“所有 retry 都失败”的开关。
4. Compatibility：首次领取的旧 task 至少执行一次；attempt 上限优先；非 durable 路径保持现有行为。
5. Configuration：service 与 API runtime 对非整数、低于 1 秒和高于 24 小时 fail closed；默认值不破坏
   provider-retry、crash 与 shutdown smokes。
6. Privacy：Provider 私密 marker、deadline/config 值不进入公开 Run 或 task row。

## 5. 采用、拒绝与剩余缺口

- 采用：复用 task `createdAt`、现有 fake clock、真实临时 SQLite 和 generation-fenced failure/ack。
- 拒绝：新增 schema deadline 列、在 Store 中理解 Provider、用 wall-clock sleep 做包内测试、把 task age
  错称为精确费用。
- 后续：正在途请求的 deadline-aware cancellation 已由 RA-015K 补齐；仍缺 transport attempt 的持久
  计数/费用估算、token 单价、DLQ/redrive、jitter、指标告警、多主机时间源与真实 Provider 故障演练。

## 6. RED → GREEN 与验证记录

- Tracer RED：真实 SQLite task 第一次收到可重试错误，Provider 建议的 5 秒等待恰好等于截止点；
  既有实现仍 release task，Run 保持 `analyzing_jd`。定向测试为 47 passed、1 failed。
- Tracer GREEN：RunService 在 `retryAt >= deadline` 时通过既有 generation-fenced 写入安全失败态并 ack；
  公开错误稳定为 `agent_task_retry_deadline_exceeded`，私密 Provider marker 不泄漏，模型只调用一次。
- Restart GREEN：第一次失败在截止点前正常 release；关闭并重开真实临时 SQLite 后，在精确截止点 claim，
  worker 在模型调用前安全失败并清除 task，证明截止期由持久化 `createdAt` 恢复而非依赖内存 timer。
- Recovery GREEN：把既有 5 秒 `Retry-After` 恢复行为配置为 5001 毫秒窗口；4.999 秒仍不可领取，
  5 秒可领取并完成，证明截止期之前的合法 retry 未被误杀。
- Compatibility GREEN：超过窗口才第一次 claim 的旧 task 仍执行一次并完成；初版测试误用了不完整候选人
  fixture，触发普通输入校验失败，改用既有合法 `completeCandidate` 后通过，业务实现无需放宽。
- Configuration RED → GREEN：`RESUME_AGENT_TASK_RETRY_ELAPSED_MS=999` 最初未被读取，server 仍进入监听；
  runtime 接入统一整数范围解析后，在监听前以稳定 `invalid_configuration` 拒绝。RunService 同时拒绝小于
  1 秒、非整数和大于 24 小时的值。

2026-09-24 的最终证据：

- SQLite workflow 定向测试 50 passed；Agent 包 335 passed、1 skipped；API 包 152 passed；
- 全仓 `pnpm test` 为 1824 passed、1 skipped，保留既有 React `act(...)` warning；
- `pnpm local-app:provider-retry-smoke`、`pnpm local-app:crash-smoke` 和
  `pnpm local-app:shutdown-smoke` 均退出 0；
- 聚焦 Biome、`pnpm check:ci`、`pnpm build` 与 `git diff --check` 均退出 0；`check:ci` 仍只报告
  2 个既有 non-null assertion warning，本机缺少 `addlicense` 时许可证脚本按现有设计跳过；
- 所有验证只使用 fake clock、本地 fake/HTTP Provider、合成数据和临时 SQLite，没有读取
  `.env.local-app`，也没有访问真实 Provider。

这些 RA-015J 证据只证明同主机 durable delivery admission 在截止点后不再开始新的模型工作。RA-015K
后续已独立证明 retry delivery 的正在途请求会被本地硬取消，但仍不构成远端停止计费或精确费用预算：
adapter 内部失败的 transport attempts 仍未逐次持久计数，`RunBudget` 也仍只统计成功返回的逻辑调用及
独立 repair 调用。
