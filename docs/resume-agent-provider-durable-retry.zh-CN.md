# RA-015H：Provider 瞬态失败的持久化任务重试

> Feature ID：RA-015H / RA-009B-N
> 状态：Implemented for development（同主机 SQLite；不是 Enabled 或 Operational）
> 最后审阅：2026-09-24
> 范围：仅把 `LlmRequestError.retryable === true` 交给既有同主机 SQLite durable-task
> release/backoff；不新增界面、Store interface、schema、Provider SDK、DLQ 或 exactly-once 声明。

## 1. 用户结果与当前证据

用户需要本地应用在 Provider 短暂超时、断网、限流或服务端错误后不立即把一次 Run 永久判死；进程重启后也应继续遵守等待时间并恢复同一个 Run。配置错误、普通 4xx、无效响应、结构化输出校验和事实守卫失败不能盲目重试。

实现前证据：

- OpenAI-compatible adapter 已把 timeout、network、408、409、429 与 5xx 的最终失败表示为
  `LlmRequestError`，并通过 `retryable` 暴露稳定分类；配置、普通 4xx 与响应协议错误是不可重试；
- adapter 已在单次调用内部执行有界 transport retry，错误到达 Run workflow 时说明该预算已经耗尽；
- RA-015G 已把 task delivery 的 1s、2s、4s……最高 30s 等待写入 SQLite `available_at`，并以
  task ID、owner、attempt 做 generation fencing；
- 当前 `execute()` 与 `executeCompletion()` 会把除失租以外的所有错误立即写成终态 `failed`，因此
  RA-015G 尚不能恢复真实 Provider 瞬态失败；
- RunService 默认最多执行 3 个 delivery；第 4 次 claim 不调用模型，而是写入稳定的
  `agent_task_attempts_exhausted` 终态。

## 2. 决策与替代方案

- 复用 `LlmRequestError.retryable`，只在 Run workflow 的两个模型执行入口重新抛出该错误；外围
  `executeClaimedTask()` 继续负责停止 heartbeat、按 attempt 计算 `availableAt` 并 release。
- 不扩大 `DurableRunStore` interface，也不让 SQLite adapter 认识 Provider。错误分类属于 LLM adapter，
  delivery 策略属于 RunService，Store 只持久化可领取时间。
- 等待时保留最后一个已提交的非终态 status，不新增 `retrying` 状态。现有 GET Run interface 因而保持兼容；
  后续若真实用户研究证明需要展示等待原因，再单独设计安全、无敏感内容的可观测字段。
- 不按 `message`、HTTP 文本或未知异常猜测瞬态性；只有 typed error 加显式 boolean 才能进入重试。
- 不在本切片增加新的内存 timer 或 sleep；SQLite 中的 `available_at` 才是可重启事实。
- RA-015I 在不扩大 Store interface 的前提下，把 adapter 已归一化的 `retryAfterMs` 与本地 delivery
  backoff 取较大值；SQLite 仍只看最终 `available_at`，不认识 Provider Header 或错误正文。
- 不把 adapter transport retry 删除或合并。两层预算解决不同故障窗口，但必须公开复合成本：默认每个
  workflow delivery 的单个失败调用最多发出 3 次 transport 请求，最多 3 个 delivery，因此同一个持续
  瞬态失败点最多可能发出 9 次请求；Provider 仍是 at-least-once，远端已接收但本地未确认时可能重复。

曾考虑让所有 `Error` 进入 durable retry，但这会反复执行确定性代码缺陷与业务校验；也考虑给 Store
新增错误类型列，但当前恢复决策不需要持久化错误正文，新增列反而扩大隐私面和 migration 成本。

## 3. 状态转换、隐私与恢复边界

```text
claimed delivery n -> Provider adapter exhausts transport retry
  ├─ LlmRequestError(retryable=true)
  │    -> preserve last non-terminal Run snapshot
  │    -> stop heartbeat
  │    -> release(availableAt = now + max(backoff(n), retryAfterMs))
  │    -> process may restart
  │    -> claim delivery n+1 and resume from durable Run/checkpoint
  ├─ typed non-retryable / configuration / validation / unknown error
  │    -> safe terminal Run failure -> acknowledge task
  └─ claim n > maxTaskAttempts
       -> agent_task_attempts_exhausted -> acknowledge without model call
```

Provider 错误 message、响应正文、URL、凭证、JD、简历和模型输出均不得写入公开 Run 或 task row。
测试只允许合成 marker、本地 mock 与临时 SQLite，不访问真实 Provider 或 `.env.local-app`。

## 4. 已实现的逐行为 TDD 与验收

1. Tracer：真实 SQLite 中，prepare 阶段首次抛出含私密 marker 的 retryable `LlmRequestError`；Run 不写
   `failed` 且不泄漏 marker，task 在 999ms 前不可领取。关闭并重开数据库后，1000ms 精确边界可由新
   service 领取并完成原 Run。
2. 不可重试边界：`retryable: false` 仍立即写安全终态并 ack，数据库重开后没有 pending task。
3. completion/HITL 入口使用同一分类；不能只修复初始 prepare task。
4. 有界失败：连续 retryable 失败依次等待 1s、2s、4s；第 4 次 claim 写
   `agent_task_attempts_exhausted`，模型 delivery 不超过 3 次且 marker 不泄漏。
5. focused SQLite/Run tests、Agent 包、crash/shutdown smoke、全仓测试、TypeScript/Biome、build 与
   `git diff --check` 全部通过。

## 5. 当前缺口

上述行为已在同主机 SQLite 开发路径实现，RA-015I 又补上了有界 `Retry-After`，RA-015J 阻止在持久化
task 截止点后开始新的 delivery，RA-015K 会在 close、失租或 retry deadline 时取消内置 adapter 的在途
请求；但 Provider 请求仍不是 exactly-once，还缺少请求幂等键、失败 transport attempt 的精确成本计量、
jitter、DLQ/redrive、指标告警、多主机协调和真实授权流量证据，不能标记为 Enabled 或 Operational。

## 6. RED → GREEN 与验证记录

- RED（prepare tracer）：新增真实 SQLite 测试后，43 个既有测试通过，唯一新失败为预期
  `analyzing_jd`、实际 `failed`。GREEN：durable claim 中的 retryable typed error 重新抛给外层；999ms
  不可领取，关闭并重开数据库后在 1000ms 恢复原 Run，focused suite 44 passed。
- 不可重试边界：把既有 Provider failure 测试收紧为 `LlmRequestError(retryable=false, status=400)`；仍写
  安全终态、清 heartbeat、ack task，私密 marker 不出现在公开 Run。该行为是既有语义的特征化回归，
  加测时直接 GREEN。
- RED（completion task）：HITL 回答后由 `complete` task 抛出的 retryable timeout 仍被写成 `failed`；
  44 个既有/前序测试通过。GREEN：第二个模型执行入口使用同一分类，1 秒后恢复并完成，45 passed。
- RED（非 durable 兼容）：默认 `InMemoryRunStore` 没有 release 路径，无条件重新抛会让公开 scheduled
  task reject 并留下非终态 Run；Run focused suite 为 1 failed / 23 passed。GREEN：只有存在当前 durable
  claim heartbeat 时才重新抛；内存路径仍安全终止，两份 focused 文件合计 69 passed。
- 有界失败：持续 503 typed error 在 1s/2s/4s 后共执行 3 个 delivery；第 4 次 claim 不调用模型，写
  `agent_task_attempts_exhausted` 并 ack。该行为由既有 attempt 上限与新分类组合而成，加测后 SQLite
  focused suite 46 passed。

最终验证：

- `pnpm agent test`：25 files，323 passed，1 skipped；
- `pnpm local-app:crash-smoke`、`pnpm local-app:shutdown-smoke`：均退出 0，新进程接管并完成原 Run；
- `pnpm test`：9 个 workspace 共 1811 passed，1 skipped；
- `pnpm check:ci`、`pnpm build`、定向 TypeScript/Biome 与 `git diff --check`：均退出 0；
- `check:ci` 只报告两条既有 non-null assertion warning；缺少 `addlicense` binary 时按既有逻辑跳过；
  全仓测试保留既有 React `act(...)` warning；
- 检查时没有残留 API、Next、Vitest 或 smoke 进程；生产构建生成的 `next-env.d.ts` 已恢复为原有开发态
  `.next/dev/types` 引用。

全部新证据来自合成数据、本地 mock、fake clock 与临时 SQLite；未读取 `.env.local-app`，未访问外网、
真实 Provider、真实简历或真实凭证，不把这些结果描述为生产运行证据。

## 7. RA-015H-P1：可执行组合验证

> 状态：Implemented for development（不是真实 Provider 或 Operational 证据）

包内测试直接构造 typed error，不能单独证明生产构建中的 OpenAI-compatible HTTP adapter、API runtime、
SQLite worker 与 RA-015H policy 能正确组合。现已增加独立、无费用的本地 smoke：

1. 本地 mock 对同一 JobSpec 调用连续返回 3 次带 `Retry-After: 2` 的 503，恰好耗尽默认 2 次
   transport retry；
2. 公开 Run 保持最后一个非终态且不包含 mock 响应中的私密 marker；
3. 第 1→2、2→3 个请求的 transport 间隔与第 3→4 个请求的 durable delivery 间隔均不少于 1.9 秒，
   证明两层都不会用更短的本地 backoff 覆盖 Provider 建议；
4. 第 4 个 JobSpec 请求和随后 draft 请求成功，原 Run 通过真实 HTTP interface 完成并含 YAML；
5. 精确断言 4 个 JobSpec 请求、1 个 draft 请求，并在退出时关闭 API、mock socket、SQLite 与临时目录。

该 smoke 不读取 `.env.local-app`，只向子进程传合成 key，不访问外网。它补强可执行组合证据，不把
同主机 mock 演练升级为真实 Provider 或 Operational 证据。

实现与验证记录：

- `pnpm local-app:provider-retry-smoke` 构建真实 core/Agent/API 包，启动生产 API entry、本地 HTTP mock
  和临时 SQLite；前 3 个 JobSpec 请求返回带私密 marker 与 `Retry-After: 2` 的 503，第 4 个 JobSpec
  与唯一 draft 返回 schema-valid 合成响应；
- 当前组合行为通过：公开 Run 在等待期为 `analyzing_jd` 且无 marker，两次 transport gap 与一次 durable
  gap 均不少于 1.9 秒，最终同一 Run 完成并产生包含合成候选人姓名的 YAML；精确计数为 JobSpec 4、
  draft 1；
- 首版 smoke 成功路径的 `Promise.race` 未清除 5 秒失败 timer，命令会无意义驻留；用 `finally` 清 timer
  后，`node --check scripts/local-app-provider-retry-smoke.mjs` 与完整 smoke 再次退出 0；
- finally 路径关闭 API、所有 mock sockets 并删除临时目录；检查后无残留 API 或 smoke 进程。
