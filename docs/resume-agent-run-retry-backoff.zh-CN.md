# Resume Agent 持久化任务重试退避

> Feature ID：RA-015G
> 状态：Implemented for development（同主机 SQLite；不是 Enabled 或 Operational）
> 最后审阅：2026-09-24
> 范围：同主机 SQLite durable task 在 worker 基础设施异常后的持久化 release/backoff；本切片交付时不改变已处理的 Provider 失败语义，后续 RA-015H 已复用本机制处理明确瞬态错误；仍不实现 DLQ、jitter、多主机或 Provider exactly-once。

## 1. 用户结果与当前证据

本地 worker 遇到 task 执行外围异常时会 generation-safe `releaseTask()`，常驻 poller 随后可再次领取。
实现前的 release 只清空 lease，保留最初的 `available_at`，所以较短 poll 配置会立即重复领取同一任务。
现在异常任务至少等待一个有界且随 delivery attempt 增长的时间再试；等待时间写入 SQLite，即使 API
在等待期间重启也不能绕过。

现有证据：

- schema v2 已持久化 `available_at`，ready query 已要求 `available_at <= now`，无需 schema migration；
- claim 的 `attempt` 是 generation-safe 单调 delivery 计数，适合计算退避；
- ack/release 已匹配 task ID、owner 与 attempt，旧 worker 不能改写新 generation；
- `ResumeAgentRunService` 默认最多执行 3 次，第 4 次 claim 会把仍活跃的 Run 安全终止；
- 本切片交付时 Provider/工作流错误若已安全写入 Run，会 ack 并成为终态；后续 RA-015H 只把
  `LlmRequestError.retryable === true` 重新交给本 release/backoff，其他错误仍保持原语义。

## 2. 决策与替代方案

- 在既有 `DurableRunStore.releaseTask` interface 增加可选 `availableAt`；SQLite adapter 原子清 lease 并
  写入该时间。省略时保持立即 release，兼容维护工具和既有契约测试。
- RunService 负责 retry policy：第 n 次 delivery 失败后等待
  `min(1000 * 2^(n-1), 30000)` ms。Store 只持久化时间，不理解业务策略。
- 使用注入的 `now()` 计算时间，测试推进 fake clock，不 real sleep。
- 不把 sleep/timer 放进 worker；timer 在重启时会丢失，而 persisted `available_at` 是恢复事实。
- 不新增 schema 版本；目标列与索引已经存在。
- 不加随机 jitter：当前目标是单机单 worker 的确定性基线；多 worker/多主机前再用运行证据决定。
- 不实现 DLQ 或 Provider transport 重试；adapter transport retry 仍是独立预算，RA-015H 只在其耗尽后
  处理 typed delivery retry。

## 3. 状态转换与失败边界

```text
leased(attempt=n)
  ├─ success/handled failure -> ack -> deleted
  ├─ worker infrastructure exception
  │    -> release(availableAt=now+backoff(n))
  │    -> delayed(no lease, persisted available_at)
  │    -> before available_at: claim returns undefined
  │    -> at/after available_at: claim attempt=n+1
  └─ process crash/no release -> existing lease-expiry takeover path
```

`availableAt` 非法、非安全整数或 generation 不匹配时必须 fail closed/返回 false，不能释放别人的 lease。
task row 仍只包含 opaque ID、kind、时间、attempt 与 lease 元数据，不写 JD、简历、Prompt、Provider
错误或模型输出。

## 4. 验收证据

首个 tracer behavior 使用真实 SQLite 和公开 RunService/Store interface 注入一次 acknowledgement
基础设施失败，证明：

1. attempt 1 release 后 999ms 不可领取，精确 1000ms 可领取；
2. attempt 2 release 后再等待 2000ms，而不是立即或仍固定 1000ms；
3. 关闭并重开 SQLite 后，精确边界仍保留并可领取 attempt 3；
4. 已完成 Run 不重复调用模型，旧 generation fencing 与最大 attempts 回归不变；
5. focused Agent tests、全仓测试、TypeScript、Biome、build 与 diff gate 全部通过。

## 5. RED → GREEN 记录

- RED（Store interface）：真实 SQLite 测试以 `availableAt=t+1000ms` release，随后在 `t+999ms`
  成功领取 attempt 2；focused suite 为 1 failed / 40 passed，证明原实现忽略新的可领取时间。
- GREEN（Store interface）：`releaseTask(..., availableAt?)` 在同一条件 UPDATE 中清 lease 并更新既有
  `available_at`；省略参数仍立即 release。提前 1ms 返回 `undefined`，关闭并重开 Store 后精确边界
  领取 attempt 2；focused suite 41 passed，schema 版本保持 v2。
- RED（RunService policy）：acknowledgement 基础设施异常触发 release 后，在 `t+999ms`
  `recoverPendingTasks()` 返回 1 而不是 0；focused suite 为 1 failed / 41 passed，证明 service 尚未传入
  backoff 时间。
- GREEN（RunService policy）：attempt n 使用 `min(1000 * 2^(n-1), 30000)` ms 计算可领取时间并交给
  Store。attempt 1/2 分别在 1000/2000ms 精确边界恢复；第二次是 terminal replay，没有重复模型调用；
  重开 SQLite 后在累计 3000ms 领取 attempt 3。后续回归逐次推进 1/2/4/8/16/30/30 秒，证明上限保持
  30 秒；非法 `Date` fail closed。focused suite 43 passed，Agent TypeScript 与定向 Biome 通过。
- 调试记录：service 测试初版把生成结果姓名改成 `Backoff Candidate`，事实守卫正确把 Run 终止为
  `failed`，尚未到达退避断言；恢复与输入一致的 Ada fixture 后得到预期的“提前领取”RED，没有为测试
  放宽事实校验。

## 6. 剩余缺口

Provider 错误分类已由 RA-015H 补齐本地开发级证据；DLQ/redrive、Provider 请求级幂等/取消、jitter、
指标告警、多主机 clock 与 operational traffic evidence 仍未覆盖。本切片仍只能称为本地开发级持久化退避。

## 7. 验证记录

- `pnpm agent test src/workflow/sqlite-run-store.test.ts`：43 passed；
- `pnpm agent test`：320 passed，1 项按既有环境条件跳过；
- `pnpm local-app:crash-smoke` 与 `pnpm local-app:shutdown-smoke`：均退出 0，原 Run 被新进程接管完成；
- `pnpm test`：9 个 workspace 共 1808 passed，1 skipped；
- `pnpm check:ci`、`pnpm build`、定向 Biome 与 `git diff --check`：均退出 0；
- 首次全仓门禁只因新测试数组未按 Biome 换行而失败，机械格式修正后通过；两条既有 non-null
  assertion warning、缺少 `addlicense` binary 时的既有 skip，以及前端既有 React `act(...)` warning
  均未扩大。

全部测试使用合成数据、fake clock、本地 SQLite 与本地 mock Provider；未访问外网、真实 Provider、
真实简历或真实凭证。
