# Resume Agent 多 Worker Lease 接管与故障验证

> Feature ID：RA-015D
> 状态：Implemented for development（同主机故障注入；不是 Enabled 或 Operational）
> 最后审阅：2026-09-16
> 范围：在 RA-015C 同主机 SQLite outbox 上补强 claim generation、多 worker 竞争、lease 接管与故障注入；不实现 heartbeat、自动 poller、跨主机队列或生产运维。

## 1. 问题与用户结果

RA-015C 消除了 Run mutation 与 task enqueue 的双写窗口，但“有 lease”不等于“处理严格一次”。进程可能在执行前退出，执行可能超过 lease，ack 可能丢失；相同 worker ID 甚至可能在旧执行尚未结束时重新 claim 同一 task。若 ack 只检查 `taskId + workerId`，旧执行可能误删较新的 lease。

RA-015D 的开发级结果是：

- 两个连接竞争同一 ready task 仍只有一个当前 holder；
- 同一 Run 的多个 task 不同时 lease，避免 prepare replay 与 completion 并行推进同一状态机；
- 每次 claim 的 `attempt` 是 delivery generation，ack/release 必须同时匹配 task、owner 与 generation；
- worker 在执行前崩溃时，另一 service 可在 fake clock 推进到 expiry 后接管并完成；
- recovery batch 有界，配置错误稳定失败，不引入常驻 timer 或悬挂句柄；
- task、公开 Run 与安全错误不携带 Prompt、JD、简历、checkpoint、answer 或原始异常；
- delivery attempt 默认最多执行 3 次；下一次 claim 对仍活跃的 Run 写入稳定失败，对已暂停/终态的 stale task 只 ack；
- 仍明确采用 at-least-once，不把 ack fencing 误写成外部 side effect exactly-once。

## 2. 研究证据

1. [Amazon SQS visibility timeout](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html) 说明 visibility 从 delivery 时开始；若未在到期前删除，消息会重新可见并可被另一 consumer 获取。长任务应调整或延长 timeout，同时标准队列仍是 at-least-once。
2. [Amazon SQS DeleteMessage](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_DeleteMessage.html) 明确：同一消息每次 receive 得到不同 `ReceiptHandle`，删除必须使用最近一次 handle；旧 handle 即使请求成功也可能没有删除消息。这里据此把 `attempt` 作为本地 receipt generation，而不只依赖稳定 worker ID。
3. [SQLite RETURNING](https://www.sqlite.org/lang_returning.html) 说明 DML 直接返回被修改行；当前单条 `UPDATE ... RETURNING` 可把选择、attempt 增量与 lease 写入保持在一个 statement 中。
4. 本地 RA-015A/C 代码与真实 SQLite 双连接实验已经证明 revision CAS、lease expiry 和 terminal replay；本切片用故障注入验证 service 生命周期，而不是仅从 SQL 推断。
5. [Amazon SQS dead-letter queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html) 用 `maxReceiveCount` 限制 delivery 次数，并强调阈值过低会损害 resilience。这里采用有界 delivery count，但因没有独立 dead-letter 存储，不把终态 Run failure 称为 DLQ。

## 3. 采用、调整与拒绝

| 方案 | 决策 | 理由 |
| --- | --- | --- |
| `attempt` 作为 claim generation | Adapt | 类似最新 receipt handle；无需新增 schema 列，且能区分同 owner 的新旧 delivery |
| ack/release 条件包含 generation | Adopt | 防止旧执行确认或释放后来重领的 lease |
| 同一 Run 最多一个 active lease | Adopt | Run 是串行状态机；并行 prepare/completion 会产生无意义的重复模型调用和 CAS 竞争 |
| fake clock + 两个真实 SQLite 连接 | Adopt | 可重复验证 expiry/takeover，无真实 sleep |
| lease = exactly-once | Reject | expiry 前后可重叠执行，外部模型调用没有分布式事务 |
| 自动 heartbeat | Defer | 需要可靠 timer、shutdown 和延长失败策略；应独立设计 |
| 自动后台 poller | Defer | 当前包没有 worker 生命周期/关闭接口，隐藏 timer 会制造句柄和部署歧义 |
| 仅加大固定 lease | Reject | 降低重复概率但放大 crash 恢复延迟，不能解决长尾或卡死 |
| 有界 delivery attempts | Adapt | 默认允许 3 次执行；第 4 次 claim 终止仍活跃的 Run，避免无限 poison loop |
| 把超过上限称为 DLQ | Reject | task 会在记录安全 Run failure 后 ack/delete，没有独立可检查或 redrive 的 dead-letter record |

## 4. 深模块契约

Store seam 继续隐藏 SQL、竞争与 fencing：

```ts
interface ClaimedRunTask extends RunTask {
  attempt: number
  leaseOwner: string
  leaseExpiresAt: string
}

interface DurableRunStore extends RunStore {
  claimNextTask(options: ClaimRunTaskOptions): Promise<ClaimedRunTask | undefined>
  acknowledgeTask(taskId: string, leaseOwner: string, attempt: number): Promise<boolean>
  releaseTask(taskId: string, leaseOwner: string, attempt: number): Promise<boolean>
}

interface ResumeAgentRunServiceOptions {
  maxTaskAttempts?: number // default 3; integer 1..1000
}
```

调用者必须传回 claim 得到的三元组；`false` 表示 task 已不存在或 claim 已过时，不暴露是哪一种底层竞争。`attempt` 是单 task 单调 generation，也是 service 的 delivery-attempt 计数；它不是 Provider transport retry 次数、全局顺序或 exactly-once token。

## 5. 状态转换

```text
ready(attempt=n, no lease)
  └─ claim(owner=A) -> leased(owner=A, attempt=n+1, expiry=t1)
       ├─ ack(A,n+1) -> deleted
       ├─ release(A,n+1) -> ready(attempt=n+1)
       ├─ crash/no ack -> leased until t1 -> reclaimable
       └─ reclaim at/after t1 by B -> leased(B,n+2,t2)
             ├─ stale ack/release(A,n+1) -> false, unchanged
             ├─ stale ack/release(B,n+1) -> false, unchanged
             └─ ack/release(B,n+2) -> current mutation

claim(attempt > maxTaskAttempts)
  ├─ Run queued/active -> stable failed snapshot -> ack/delete task
  └─ Run needs_input/completed/failed/missing -> no state regression -> ack/delete stale task
```

若同一 Run 已有未过期 lease，其余 ready task 暂不参与 claim；当前 task ack/release/expiry 后才可领取下一 task。不同 Run 不互相串行化。

## 6. 失败语义与隐私

| 失败 | 稳定结果 | 恢复 |
| --- | --- | --- |
| 两 worker 同时 claim | 一个返回 task，一个返回 `undefined` | loser 可在后续 drain 重试 |
| holder 执行前崩溃 | task 保持 leased | expiry 后另一 worker claim，attempt + 1 |
| 旧 generation ack/release | `false`，新 lease 不变 | 当前 holder 继续 |
| task 执行抛错 | 当前 generation 条件 release | 后续显式 drain 重试 |
| ack 丢失或返回 false | task 保持 lease | expiry 后 at-least-once replay |
| delivery attempts 超过上限 | 活跃 Run 写入 `agent_task_attempts_exhausted`；暂停/终态不倒退 | 当前 claim ack；无 DLQ/redrive |
| recovery limit 非法 | 稳定配置错误，不 claim | caller 修正配置 |
| Store/record 损坏 | 安全 `RunStoreError` | fail closed，不回显数据 |

任务表只保存 opaque task/run ID、kind、时间、attempt 与 lease 元数据。测试可使用隐私 marker 验证序列化 task row、错误与 public Run 都不出现正文，但数据库中的 trusted Run record 本来就包含 request/checkpoint；本切片不宣称静态加密。

## 7. 单行为 RED → GREEN 记录

| 行为 | RED / 风险证据 | GREEN / 设计影响 |
| --- | --- | --- |
| same-owner generation fencing | 测试显示旧 attempt 能删除同 worker ID 重领的新 lease | ack/release SQL 同时匹配 `id + owner + attempts`；旧 generation 返回 false |
| different-owner takeover | RA-015C 只以 owner 为条件 | 所有调用传回 claim attempt；旧 owner/generation 均不能改变当前 lease |
| same-Run serialization | 两个 task 可由两个连接同时 claim 并推进同一状态机 | candidate query 排除同 Run 的未过期 active lease；ack 后下一 task 可领 |
| crash before execution | claim 成功但 callback 未执行时没有 service-level takeover 证据 | 关闭 holder 连接并推进 fake clock；第二 service 在 expiry 精确接管并完成 |
| bounded recovery | default batch 有上限但边界未证明 | limit=2 只 claim 两个不同 Run；第三个仍 ready；0、小数、1001 稳定拒绝 |
| worker configuration | worker/lease/max attempts 只有实现检查 | 空 owner、非正/非整数 lease、0/1001 attempts 均在 claim 前失败 |
| privacy | task schema 没有 marker regression | `SELECT *` task row、public Run 和序列化错误均不含私密 marker |
| poison delivery bound | 反复 release 可无限 claim | 默认 3 次执行；第 4 次不调用模型并写稳定 Run failure |
| stale paused task | 初版 attempt 上限把合法 `needs_input` Run 错误改成 failed | 超限前先读状态；暂停/终态 task 只 ack，不回退公开状态 |
| compatibility | Store 方法加入 generation 可能破坏 worker/test adapter | wrapper 与所有调用点同步；RA-015A/B/C 和顺序 Run tests 继续通过 |

## 8. 证据台账

| 能力 | Delivery | 当前证据 | Coverage | Historical gap | 剩余缺口 |
| --- | --- | --- | --- | --- | --- |
| claim generation fencing | Implemented | SQS latest receipt guidance；same/different-owner generation tests | Covered for local adapter | Reopened-by-change：RA-015C 只检查 owner | 不能 fencing 已开始的外部 side effect |
| same-Run execution serialization | Implemented | Run 串行状态机；双连接 two-task test | Covered for current claim query | None | 公平性/吞吐未测 |
| crash-before-execution takeover | Implemented | visibility timeout guidance；service close/fake-clock takeover test | Covered for local process model | None | OS kill/power loss 未注入 |
| bounded recovery/config | Implemented | limit 与 worker/lease/attempt boundary tests | Covered | Inherited-unassessed → Backfilled | 无自动 polling/backpressure |
| privacy/cleanup | Implemented | task-row/public/error marker test；afterEach close/rm | Covered for tests | None | 静态加密/retention 未实现 |
| poison delivery bound | Implemented | SQS maxReceiveCount guidance；active/stale attempt tests | Partial | None | 无 DLQ、redrive、backoff 或 operator alert |
| long-task safety | Deferred | 官方建议 extend visibility；本地无 heartbeat | Gap | None | heartbeat/extendLease 与 side-effect idempotency |
| operational multi-host worker | Deferred | 无部署、队列、指标或 runbook | Gap | None | production adapter and operations |

## 9. 会推翻方案的证据

- 若业务允许同一 Run 的 task 并行且每个 stage 已完全隔离，同 Run serialization 可能造成不必要的 head-of-line blocking；应以吞吐测量和状态机证据推翻，而不是猜测。
- 若 attempt 会被清零、回绕或跨 migration 丢失，它不能作为 generation；应改用随机 receipt token/fencing column。
- 若模型调用时长经常接近或超过 lease，只有 ack fencing 不够，必须加入可验证的 heartbeat/extendLease 或 stage-specific idempotency。
- 若部署要求多主机，SQLite WAL 与本地时钟不再满足协调假设，应替换为服务端数据库/队列并复跑同一契约测试。

## 10. 明确不在本切片

- heartbeat/lease extension、自动 poller、backoff/jitter、DLQ/redrive；
- 跨主机/多区域部署、clock-skew 容忍和 leader election；
- exactly-once Provider 调用或 workflow side effect；
- 生产 metrics、alerts、容量/延迟压测与 runbook。

建议的安全指标名称仅作为后续设计输入：ready task age、claim count、expired lease takeover、attempt distribution、stale ack/release count、recovery batch size。它们只包含 ID/计数/时长，不应包含用户正文；本切片不会声称这些指标已采集。

## 11. 验证记录

```bash
pnpm agent test src/workflow/sqlite-run-store.test.ts
# 1 file passed；28 tests passed

pnpm agent test src/workflow/run.test.ts
# 1 file passed；18 tests passed

pnpm agent test
# 13 files passed；157 tests passed

pnpm --filter @yamlresume/resume-agent exec tsc --noEmit
# exit 0

pnpm agent build
# ESM 与 DTS build success

pnpm exec biome check packages/resume-agent/src/workflow/run.ts packages/resume-agent/src/workflow/sqlite-run-store.ts packages/resume-agent/src/workflow/sqlite-run-store.test.ts
# checked 3 files；无错误

git diff --check
# exit 0
```

所有测试使用本地 SQLite、fake agent 与 fake clock，不访问外网 Provider，不读取真实凭证，不使用长时间 sleep。测试后显式关闭每个 adapter 并删除精确临时目录；实现未创建 timer 或 socket。`node:sqlite` 的 ExperimentalWarning 是 Node 22.21.1 Stability 1.1 的已知开发级限制。
