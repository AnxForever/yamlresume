# Resume Agent Run Task Lease Heartbeat 与失租写隔离

> Feature ID：RA-015E
> 状态：Implemented for development（仅同主机 SQLite；不是 Enabled 或 Operational）
> 最后审阅：2026-09-16
> 基线：`7d74e4e433103bd7e9c67b8daf6caf852e6d2bc3`
> 范围：在同主机 SQLite durable task 上增加 generation-safe lease renewal、worker Run mutation fencing 与 heartbeat 生命周期；继续采用 at-least-once，不实现生产 worker 或 exactly-once Provider side effect。

## 1. 用户问题与当前失败窗口

RA-015A–D 已提供 revision CAS、SQLite durable Store、transactional outbox、claim generation、same-Run serialization、lease takeover 与有界 delivery attempts，但固定 lease 仍留下以下窗口：

1. worker A claim `attempt=n` 后进入耗时超过 lease 的 Provider 调用；
2. expiry 到达后 worker B claim `attempt=n+1` 并开始重复调用；
3. A 的旧 ack/release 会被 generation fencing 拒绝，但 A 的 status、checkpoint、result 或 failed 写仍走普通 Run revision CAS；
4. 只要 A 读到 B 尚未写过的新 revision，普通 CAS 仍可能成功，导致失租 worker 改写公开 Run；
5. 即使应用层先检查 `leaseLost`，检查与普通 CAS 之间仍存在 TOCTOU；
6. `recoverPendingTasks(limit)` 先 claim 多个 task 再交给 schedule callback，排队时间会预先消耗 lease。

本切片的用户结果是：长任务在 heartbeat 正常时保持唯一当前 holder；一旦 heartbeat 明确失败、claim 到期或被接管，旧执行不能再提交任何 Run mutation，也不能 ack/release 新 generation。Provider 请求若已经发出仍可能重复；系统只丢弃失租后的结果，不作 exactly-once 声明。

## 2. 本地代码证据

基线源码与测试逐项审阅结果：

- `workflow/run.ts` 的 `executeClaimedTask()` 只把 task identity 传给 ack/release；`execute()`、`executeCompletion()`、`transition()`、`saveCheckpoint()`、`pause()`、`finish()` 和 `fail()` 都通过普通 `RunStore.compareAndSet()` 写 Run。
- `updateStoredRun()` 对普通 revision conflict 最多重算 3 次，这是可重算 workflow mutation 的既有策略；answer intent 则使用独立的 `compareAndSetWithTask()`/winner reread，不能改成 worker lease 写。
- `workflow/sqlite-run-store.ts` 的 claim 已用单条 `UPDATE ... RETURNING` 原子写 owner、expiry 与 `attempt + 1`；ack/release 已匹配 `task id + lease owner + attempt`。
- claim query 在同一 Run 存在未过期 lease 时排除其他 task，且 expiry 精确等于 `now` 时允许 takeover。
- SQLite schema v2 已包含 renewal 所需的 task ID、run ID、owner、attempt 与 expiry，无需 migration 或新依赖。
- `recoverPendingTasks(limit)` 在循环中先 claim，再 schedule；后排 callback 没有 timer，也不会在排队时 heartbeat。
- service 目前没有 shutdown interface，也没有 timer；SQLite tests 的 `afterEach` 会关闭全部连接并删除精确临时目录。
- RA-015D 文档已诚实标记 heartbeat、long-task fencing、自动 worker 与多主机为缺口，当前改动属于已记录缺口的 backfill。

## 3. 官方研究来源

以下资料于 2026-09-16 复核：

1. [AWS SQS Visibility Timeout](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html)
   - visibility 从 receive 时开始；未在 timeout 内删除会重新可见并可由另一 consumer 获取；
   - 官方建议长任务以 heartbeat 周期性延长 visibility；
   - standard queue 仍是 at-least-once，即使 visibility 尚未到期也不保证绝不重复。
2. [AWS SQS ChangeMessageVisibility](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_ChangeMessageVisibility.html)
   - 新 timeout 从调用 `ChangeMessageVisibility` 的时刻开始计时；
   - 续租依赖本次 receive 的 receipt handle；message 不再 in flight 或 handle 无效是稳定失败；
   - 该调用不提供 exactly-once，也不能无限突破 SQS 的总 in-flight 上限。
3. [AWS SQS DeleteMessage](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_DeleteMessage.html)
   - 同一消息每次 receive 都得到不同 `ReceiptHandle`；删除必须使用最近一次 handle；
   - 旧 handle 请求甚至可能返回成功却未删除消息，因此本地 adapter 继续以严格 `attempt` generation 条件和 boolean 结果为准。
4. [Node.js v22.21.1 Timers](https://nodejs.org/download/release/v22.21.1/docs/api/timers.html)
   - `setInterval()` 返回 `Timeout`，`clearInterval()` 可取消；
   - timer 默认保持 event loop 存活，`unref()` 后若无其他活动，进程可在 callback 前退出；
   - timer 只保证尽可能接近 delay，不保证精确时刻；小于 1、超过 `2^31-1` 或非整数 delay 会被重写/截断，配置必须在应用层先拒绝。
5. [SQLite Transactions](https://www.sqlite.org/lang_transaction.html) 与 [Isolation](https://www.sqlite.org/isolation.html)
   - 每条读写 statement 都在事务内；SQLite 同时只允许一个 writer，并以写串行化提供默认 serializable isolation；
   - `BEGIN IMMEDIATE` 先取得 write transaction，可把条件 UPDATE 与失败分类查询置于同一竞争快照。
6. [SQLite UPDATE](https://www.sqlite.org/lang_update.html)
   - `WHERE` 为 false 时更新零行且不是错误，适合表达 revision + lease identity + unexpired predicate 的条件写。
7. [SQLite RETURNING](https://www.sqlite.org/lang_returning.html)
   - SQLite 3.35+ 的 top-level INSERT/UPDATE/DELETE 可返回直接修改的行；当前 adapter 已用它 claim，renewal 也可用同一模式返回新 expiry。

## 4. 采用、调整、拒绝与延期

| 方案 | 决策 | 证据与影响 |
| --- | --- | --- |
| 未过期 claim 的周期 renewal | Adopt | 对应 SQS visibility heartbeat；降低长任务 expiry takeover |
| 已到期 claim 续租 | Reject | exact expiry 即失效；旧 worker不得复活 lease |
| identity = task ID + run ID + owner + attempt | Adopt | owner 不是 generation；run ID 防止错误 task/run 组合 |
| 新 expiry = `max(oldExpiry, now + leaseDuration)` | Adapt | 采用 AWS 的调用时刻基准，同时保证提前 heartbeat 不缩短 lease；不使用 `oldExpiry + duration`，避免频繁 heartbeat 无限堆高恢复延迟 |
| 只设置内存 `leaseLost` | Reject | 检查与普通 CAS 之间有 TOCTOU |
| leased Run CAS 下沉 DurableRunStore | Adopt | revision 与当前有效 claim 在同一 SQLite transaction/条件 statement 判断；调用者不接触 SQL |
| lease lost 与 revision conflict 统一成 false | Reject | 普通 conflict 应重算，lease lost 必须立即停止；统一会导致旧 worker盲重试 |
| answer 的 `compareAndSetWithTask()` 改为 lease CAS | Reject | answer 是用户命令，不是 durable worker mutation；保持既有 idempotency/conflict 语义 |
| `setInterval` heartbeat + 单飞串行门 | Adapt | interval 易被 fake timers 验证；renewal 与 worker mutation 经同一内部队列串行，避免同一 task 重叠 renewal |
| timer `unref()` | Adopt | heartbeat 不应单独阻止 Node 退出；仍必须显式 clear |
| claim-ahead 在本切片彻底重构 | Defer to RA-015F | 当前没有 poller/backpressure/concurrency lifecycle interface；本切片不宣称 heartbeat 覆盖 callback 排队时间 |
| callback 开始时先 renewal | Adopt | 排队期间若已失租则在 Provider 前停止；若仍有效则从执行开始重新得到完整、非缩短的 lease 窗口 |
| Provider exactly-once | Reject | 已发出的远端请求不可由 SQLite transaction 撤销；保持 at-least-once |

## 5. 深模块 interface

`DurableRunStore` 继续作为唯一持久化 seam。SQL、clock predicate、generation 匹配与失败分类留在 SQLite adapter 内；workflow 只消费稳定结果。

已实现：

```ts
interface RunTaskClaimIdentity {
  id: string
  runId: string
  leaseOwner: string
  attempt: number
}

interface RenewRunTaskLeaseOptions extends RunTaskClaimIdentity {
  now: Date
  leaseDurationMs: number
}

type TaskFencedRunUpdateResult =
  | 'updated'
  | 'revision_conflict'
  | 'lease_lost'

interface DurableRunStore extends RunStore {
  renewTaskLease(
    options: RenewRunTaskLeaseOptions
  ): Promise<ClaimedRunTask | undefined>

  compareAndSetForTask(
    run: StoredResumeAgentRun,
    claim: RunTaskClaimIdentity,
    now: Date
  ): Promise<TaskFencedRunUpdateResult>
}
```

- renewal 返回更新后的 claim，便于通过 interface 观察 expiry；`undefined` 统一表达 missing/stale/expired claim，原始 SQLite error 仍转换为安全 `RunStoreError`。
- leased CAS 返回三态：`updated`；`revision_conflict`（继续既有最多 3 次重算）；`lease_lost`（不重试、不 fail、不 ack/release）。
- SQLite leased CAS 在 `BEGIN IMMEDIATE` 中执行带 `EXISTS` 的条件 UPDATE；UPDATE 同时匹配 Run revision，以及 task ID、run ID、owner、attempt 和 `lease_expires_at > now`。若零行，再在同一 write transaction 内仅查询 claim 是否仍有效，从而把 revision conflict 与 lease lost 稳定分类。
- in-memory adapter 没有 durable task，继续只实现 `RunStore`，现有调用方式不改变。

## 6. Worker 与 heartbeat 状态机

```text
ready
  -> claim(owner=A, attempt=n, expiry=t1)
  -> scheduled (RA-015F: callback 排队仍消耗 t1)

scheduled -> callback starts
  -> immediate conditional renew(id, runId, A, n, old expiry > now)
     -> success: executing(expiry=max(old, now+duration))
     -> stale/expired/storage uncertainty: lease_lost; do not call Provider

executing + heartbeat before expiry
  -> serialized conditional renew(A,n)
     -> success: executing(new expiry)
     -> false/error: lease_lost -> clear timer -> reject later mutations

executing + workflow mutation
  -> serialized leased CAS(revision + current unexpired claim)
     -> updated: continue
     -> revision_conflict: bounded reread/recompute
     -> lease_lost/storage uncertainty: stop workflow writes

executing + success/provider failure
  -> clear timer + await queued/in-flight renewal
  -> if lease still owned: generation-safe ack (or leased fail then ack)
  -> otherwise: no ack/release

executing + service.close()
  -> clear timer + await/隔离 in-flight renewal
  -> mark context stopped; later Provider result cannot mutate Run
  -> task remains recoverable by expiry; shutdown does not claim exactly-once

no heartbeat/process crash
  -> expiry -> worker B claim(attempt=n+1)

worker A after takeover
  -> renew undefined
  -> leased CAS = lease_lost
  -> stale ack/release false
```

## 7. Renewal 与 clock 语义

- 只有 `current leaseExpiresAt > now` 才能 renew；到期前最后 1 ms 可续，到期时与到期后不可续。
- 新 expiry 是 `max(current leaseExpiresAt, now + taskLeaseMs)`：不会缩短，也不会把每次 heartbeat 的 duration 累加到旧 expiry。
- `now()`、claim、renew 与 fenced CAS 假设同主机 wall clock。clock 向后跳可能延长旧 lease，向前跳可能提前失租；当前 SQLite adapter 不提供多主机 clock-skew 容忍。
- Node timer 是唤醒提示，不是时间真相；Store 使用传入的 `now` 和 persisted expiry 判断有效性。

## 8. Heartbeat 配置与生命周期

已实现配置：

- `taskLeaseMs` 默认 `60_000`；最小 `2`，最大 `2_147_483_647`；
- `taskHeartbeatMs` 默认 `floor(taskLeaseMs / 3)`，至少 `1`；最小 `1`，最大 `2_147_483_646`；
- 必须满足 `taskHeartbeatMs < taskLeaseMs`，且两者均为 safe integer；非法配置统一抛 `Run task worker configuration is invalid`，不进入 claim；
- 每个 executing task 只有一个 timer 和一个串行 operation queue；tick 发现 renewal 已排队/运行时不再创建重叠 renewal；
- 正常完成、Provider 异常、lease lost、ack 失败与 service close 都 clear timer；停止会等待已经排队/执行的 renewal，保证 ack 之后不会再续租；
- timer 创建后调用 `unref()`，但 unref 不替代 clear。

## 9. Lease lost、shutdown 与 recovery 语义

- renewal 的 `undefined` 是稳定 lease-lost 结果；storage error 也按安全不确定性 fail closed，worker 不再尝试 Run mutation。
- lease lost 不调用普通 `fail()`，不保存 checkpoint/result/receipt，不 ack/release later generation。
- 已开始且不能取消的 Provider 请求可以继续在远端产生 side effect；本地等待结果后将其丢弃。重复调用仍可能发生。
- 普通 revision conflict 仍最多重算 3 次；只有当前 lease 在 Store-side atomic predicate 下仍有效时才允许重试。
- `close()` 只负责本 service 的 active heartbeat 与写隔离，不关闭外部注入的 Store，也不假装能取消 Provider transport。
- crash 没有 cleanup 路径；expiry 是恢复机制。heartbeat 停止后第二 worker 在 persisted expiry 到达时可接管。
- claim-ahead：`recoverPendingTasks(limit)` 仍会先 claim 再 schedule。排队 callback 没有 heartbeat，可能先到期；callback 启动时的 immediate renewal 能阻止 stale callback 调 Provider，但不能消除提前占用、吞吐与公平性问题。该生命周期重构延期到 RA-015F。

## 10. 安全与隐私边界

- task/renew/fenced-CAS interface 只携带 opaque ID、owner、attempt 与时间，不携带 JD、简历、Prompt、answer、checkpoint 或 Provider 正文。
- `RunStoreError` 继续只暴露稳定 code 与通用消息；heartbeat 不记录 raw error、SQL、数据库路径或 payload。
- SQLite 文件仍保存 trusted request/checkpoint；本切片不增加静态加密、retention 或访问控制。
- public `ResumeAgentRun` 继续只返回 snapshot；revision、request、checkpoint 与 answer receipts 不公开。
- worker ID 不是授权凭证；安全性来自 Store 内的完整 claim generation 条件，仅适用于可信同主机进程模型。

## 11. 单行为 RED → GREEN 记录

Feature Brief 完成后按下列顺序逐个加入行为测试，并在每个 RED 与 GREEN 后更新了本节：

| 序号 | 行为 | RED 证据 | GREEN / 设计影响 |
| --- | --- | --- | --- |
| 1 | 当前未过期 generation 续租并向后移动 expiry | 新测试调用缺失的 `renewTaskLease`，focused suite 为 1 failed / 28 passed，失败是 `TypeError: store.renewTaskLease is not a function` | 新增完整 claim identity renewal interface 与单条 `UPDATE ... WHERE ... lease_expires_at > now RETURNING`；expiry 使用 `MAX(old, now + duration)`；focused suite 29 passed |
| 2 | missing/错误 run/owner/attempt/expired 在精确边界拒绝续租 | 边界测试首次执行即为 GREEN：第 1 个 tracer bullet 的安全条件已完整匹配 identity 与严格 `expiry > now`；没有人为回退实现制造失败 | 增加显式回归：四类 identity mismatch 返回 `undefined`，`expiry - 1ms` 成功，精确 expiry 返回 `undefined`；focused suite 30 passed，无额外实现 |
| 3 | leased CAS 原子区分 revision conflict 与 lease lost | 新测试调用缺失的 `compareAndSetForTask`，focused suite 为 1 failed / 30 passed，失败是 `TypeError: store.compareAndSetForTask is not a function` | 新增三态契约；`BEGIN IMMEDIATE` 内以 revision + correlated current-claim `EXISTS` 条件 UPDATE，零行时在同一 write transaction 分类；current update、revision conflict、takeover 后 lease lost 均通过，31 passed |
| 4 | deferred task 跨多个原始 lease 周期仍阻止第二 worker claim | fake timer 推进到第一个 900ms expiry 时，第二连接成功 claim `attempt=2`；focused suite 1 failed / 31 passed | task 执行开始先 renewal，再以 300ms interval 单飞 renewal；timer `unref`，stop clear 并等待在途 renewal；跨 3 个原始 lease 周期竞争者始终得到 `undefined`，32 passed |
| 5 | renewal failure 后不提交 status/result/failure、不 ack/release 新 generation | 注入第二次 renewal 返回 `undefined`，expiry 后 B claim `attempt=2`；旧 Provider 后续使 Run 从 `analyzing_jd` 被普通 CAS 写成 `failed`，focused suite 1 failed / 32 passed | heartbeat renewal 与 leased CAS 共用 task-local 串行门；所有 durable worker transition/checkpoint/pause/result/failure/poison 写走三态 fenced CAS；lease lost 抛内部终止信号且跳过普通 fail/ack/release；Run 保持 `analyzing_jd`，B generation 可正常 ack，33 passed |
| 6 | success、Provider error、lease lost、ack failure、close 清 timer | `close()` 测试因 `TypeError: service.close is not a function` 失败，focused suite 为 1 failed / 33 passed | 增加幂等 async `close()` 与 active-heartbeat 隔离；成功、Provider error、lease lost、ack false、close 均验证 fake timer count 为 0；deferred renewal 证明无重叠且 close 等待在途 renewal；39 passed |
| 7 | 非法 heartbeat 配置、隐私 marker 与无句柄泄漏 | 配置/隐私回归在实现边界后首次执行即 GREEN；storage-error 测试初版使用无效 resume fixture 导致 Provider-start wait 超时，修复为既有合法 fixture 后通过，未为测试改业务实现 | lease/heartbeat min、max、整数与 `< lease` 稳定拒绝；raw Provider/heartbeat error、JD、owner marker 不进入 public Run/安全错误；`afterEach` 恢复 real timers、关闭全部 Store、删除精确临时目录；39 passed |
| 8 | RA-015A–D 全量回归 | Store/worker 与 Run focused suites 没有新失败；RA-015E 提交当时的 package suite 中，14 个文件/149 tests 通过，但 `src/llm/openai-compatible.test.ts` 从首个 case 起超时 | 当时只把 57/57 in-scope regression 记为通过；后续 RA-015E-H 诊断在相同 Node/Vitest 版本和固定快照上无法复现，见下节。没有把环境变化误写成 heartbeat 修复 |

### 11.1 RA-015E-H：完整测试进程不退出的后续诊断

ODT 开发前曾再次观察到 14 个文件、150 个测试已全部报告通过，但 Vitest 进程未自然退出。
本轮把“测试断言通过”和“进程完成退出”拆成两个信号，先按测试文件组合二分，再检查
`process.getActiveResourcesInfo()` 与定向 timer/server/socket 生命周期。可证伪假设及结果如下：

1. **heartbeat 或 SQLite adapter 遗留 timer/连接。** 若成立，最小的
   `run.test.ts + sqlite-run-store.test.ts` 组合应稳定留下额外资源；实际单文件、两文件和加入
   LLM suite 的三文件组合均自然退出，资源快照没有额外 timer/server。
2. **OpenAI-compatible HTTP fixture 没有关闭 server/socket。** 若成立，LLM 单文件重复运行应
   稳定挂起；实际重复运行自然退出。测试结束瞬间只看到正在关闭的 `Server/Socket`，50ms 后
   消失，不能解释无限等待。
3. **特定测试顺序或组合触发资源泄漏。** 若成立，重建的精确 14 文件/150 测试集合应提高
   复现率；该集合连续 20 次自然退出，完整 package suite 连续 12 次自然退出。
4. **并发负载下的慢测试等同于退出泄漏。** 四个 suite 并发时外层 guard 曾返回 124，但当时
   SQLite tests 尚未完成断言；这不是“全部测试通过后仍不退出”的同一症状，已排除。

因此当前没有满足 diagnosing loop 的稳定 RED，也没有能归因到产品代码的根因。相似的
Vitest issue `vitest-dev/vitest#10162` 同样因缺少最小复现而关闭，不能当成本仓库根因证据。
按照 TDD，只有能先捕获真实故障的正确 seam 才能形成回归测试；本轮没有制造永远为 GREEN 的
“资源清理测试”，也没有修改 heartbeat、调用 `process.exit`、延长 timeout 或关闭泄漏检测。
在 `9b5993f` 加入 ODT 后，完整 Agent suite 为 15 files / 184 tests、exit 0，并再次自然退出。
历史事件保留为环境/runner 层的未决诊断记录；若再次出现，下一步是保留当次 PID、active
resource 与诊断报告后在同一进程快照二分，而不是先改产品生命周期。

## 12. Evidence ledger

| Field | Content |
| --- | --- |
| Feature ID | RA-015E |
| Parent / lifecycle | RA-009/RA-015C durable task：claim → schedule → execute → renew → mutate → ack/release → shutdown/takeover |
| Feature | 长任务 lease heartbeat 与失租 Run 写隔离；用户不会看到旧 worker 在 takeover 后覆盖当前 Run |
| Delivery state | Implemented for development |
| Current state | SQLite adapter 支持 generation-safe renewal 与三态 leased CAS；durable worker 以单飞 heartbeat 续租并在失租/close 后隔离全部 Run mutation；用户 answer CAS 未改变 |
| Primary evidence | AWS SQS visibility/ChangeMessageVisibility/latest ReceiptHandle；Node 22.21.1 timers；SQLite transaction/UPDATE/RETURNING |
| Independent evidence | 本地真实 SQLite 双连接、fake clock、deferred fake agent 与 fake timer；39 个 focused Store/service tests 与 18 个 Run regression tests |
| Decision | Adapt visibility heartbeat；combine generation identity 与 leased Run CAS；decline expired revival、memory-only fencing 与 exactly-once |
| Edge cases | missing task、wrong run/owner/attempt、exact expiry、same owner new generation、revision conflict、renew storage error、Provider in flight、ack false/error、close、claim-ahead |
| Acceptance | focused Store/service + Run regression、TypeScript、build、Biome、diff check；RA-015E-H 后续重建精确 14/150 集合 20 次、完整 suite 12 次均自然退出，ODT 后 15 files / 184 tests 仍自然退出；全部连接/timer/临时目录清理 |
| Coverage | Partial：同主机应用代码与注入故障已覆盖；Provider side effect、claim-ahead 与生产运行未覆盖 |
| Historical gap | Reopened-by-change；RA-015C/D 明确记录 fixed lease 与 mutation fencing 缺口，未曾宣称解决 |
| Gap origin | RA-015C 固定 lease；RA-015D 只保护 ack/release generation |
| Remaining gap | claim-ahead/自动 worker、Provider idempotency/cancellation、multi-host clock、DLQ/backoff、metrics/runbook |
| Last reviewed | 2026-09-16；Node 22.21.1、Vitest 4.0.16、SQLite schema v2、后续快照 `9b5993f` |

## 13. 可能推翻方案的证据

- 若 production adapter 提供数据库 server time 与原子 lease token，应以 server time 替换同主机 wall clock，而不是保留客户端 `Date`。
- 若 Provider 支持强 idempotency key 或可验证 cancellation，应把 task generation 接入 effect-specific contract；仍需独立证明，不能由 heartbeat 推导 exactly-once。
- 若测量显示 `setInterval` 在 event-loop blocking 下经常错过安全窗口，应采用独立 worker/thread/process 或更长 lease；`node:sqlite` 同步阻塞本身也可能推翻当前开发 adapter。
- 若 recovery 需要高吞吐、公平调度或每 Run 多并发，claim-ahead 与 same-Run serialization 应由可测量的 worker lifecycle/partition 方案替代。
- 若 renewal 的 SQLite lock contention 造成不可接受延迟，应迁移异步服务端数据库；不能通过允许 expired renewal 来掩盖。

## 14. 验证结果

RA-015E 提交当时的结果（保留历史原貌）：

```bash
pnpm agent test src/workflow/sqlite-run-store.test.ts
# exit 0；1 file passed；39 tests passed

pnpm agent test src/workflow/run.test.ts
# exit 0；1 file passed；18 tests passed

pnpm agent test
# 未通过：RA-015E 所在 14 files / 149 tests passed；
# 未修改的 src/llm/openai-compatible.test.ts 按 20s/case 超时，
# 约 71s 时为避免遗留进程中止（当时 6 failed，剩余 cases 未执行）。

pnpm agent test src/llm/openai-compatible.test.ts
# 只读归因诊断，同样从首个 case 起超时；约 35s 时中止。
# 本任务不修改 LLM 禁止目录，不能把该 suite 记为通过。

pnpm --filter @yamlresume/resume-agent exec tsc --noEmit
# exit 0

pnpm agent build
# exit 0；ESM 与 DTS build success

pnpm exec biome check \
  packages/resume-agent/src/workflow/run.ts \
  packages/resume-agent/src/workflow/run.test.ts \
  packages/resume-agent/src/workflow/sqlite-run-store.ts \
  packages/resume-agent/src/workflow/sqlite-run-store.test.ts \
  packages/resume-agent/src/index.ts
# exit 0；Checked 5 files；No fixes applied

git diff --check
# exit 0
```

RA-015E-H 后续诊断与复验结果：

```bash
# 精确重建原 14 files / 150 tests（排除后来新增的 evaluation runner）
# 连续 20 次均完成断言并自然退出，exit 0

pnpm agent test
# 固定诊断快照连续 12 次自然退出，exit 0

# ODT 提交 9b5993f 后再次复验
pnpm agent test
# 15 files / 184 tests passed；exit 0；进程自然退出
```

由于真实症状在固定快照上没有稳定复现，以上是“当前无法归因”的证据，不是故障已经被某个
源码改动修复的证据。RA-015E 的 timer/Store 清理测试继续保护已知生命周期，但不能被误称为
这次历史挂起的 RED → GREEN 回归。

正常 pre-commit 首次执行了 staged-file `pnpm check`：Biome 覆盖 351 个文件且
无修改，随后 monorepo `tsc --noEmit` 被未暂存的 `packages/playground` 阻断，
错误是共享依赖状态下 Monaco/Tabler icon 与 React 19 types 的 JSX element type
不兼容。RA-015E 定向 TypeScript 仍为 exit 0；本任务未修改 playground、前端、
`package.json` 或 lockfile。lint-staged 已恢复并清除临时 stash，因此最终提交按
共享工作树例外使用 `--no-verify`，不能把全仓 pre-commit 记为通过。

清理证据：heartbeat 的 success、Provider error、lease loss、ack false 与
`close()` tests 均断言 `vi.getTimerCount() === 0`；deferred renewal test 证明
`close()` 等待在途 renewal。SQLite suite 的 `afterEach` 恢复 real timers，关闭
登记的每个 Store，并只删除本 test 创建的临时目录。两次超时诊断进程均收到
`Ctrl-C` 并退出，没有保留 Vitest session。

## 15. 明确的生产缺口

- Provider 调用与其他外部 side effect 仍是 at-least-once，可能重复；
- RA-015F：claim-ahead、自动常驻 poller、concurrency/backpressure、完整 worker shutdown/drain；
- DLQ/redrive、backoff/jitter、operator metrics/alerts/runbook；
- Provider cancellation 与 effect-specific idempotency；
- PostgreSQL/Redis/SQS、多主机 clock 与生产部署；
- SQLite `node:sqlite` 同步、Stability 1.1，仅是同主机开发级 adapter；
- 加密、retention、备份、租户隔离与 OS/power-loss fault injection。
