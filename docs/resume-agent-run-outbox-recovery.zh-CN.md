# Resume Agent Transactional Outbox 与任务恢复

> Feature ID：RA-015C
> 状态：Implemented for development（显式 drain；不是 Enabled 或 Operational）
> 最后审阅：2026-09-16
> 范围：消除 Run 提交与内存调度之间的双写窗口，为 SQLite durable Store 增加同事务 outbox、lease、ack/release 与显式重启 drain；不宣称 exactly-once 或多主机生产调度。

## 1. 问题与用户结果

RA-015B 让 Run record 可持久化，但 `compareAndSet` 成功后仍要单独调用内存 `schedule()`。若进程在两者之间崩溃，回答和 checkpoint 已提交，completion 却永远不会运行。反向顺序同样不安全：先发任务再提交状态会让 worker 看到未提交或回滚的数据。

RA-015C 的结果是：

- Run create/CAS 与对应 workflow task 在同一 SQLite 事务提交或回滚；
- 调度提示丢失不再丢任务，新 service 可显式 drain committed outbox；
- task 被 worker claim 后暂时不可被其他 worker 获取，lease 过期后可接管；
- 成功处理后以 task ID + lease owner 条件 ack；失败可 release；
- delivery 是 at-least-once，workflow 必须容忍 task 重放，不伪称 exactly-once；
- 不具备 durable-task 契约的现有 `RunStore` 与测试 schedule seam 保持兼容。

## 2. 研究证据

1. [AWS Prescriptive Guidance：Transactional outbox](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html) 把数据库更新与通知分开称为 dual write；任一步失败都会产生不一致。outbox row 与业务记录必须在同一事务写入，rollback 时两者都不出现。
2. 同一 AWS 文档明确提示 duplicate delivery，并要求 consumer 幂等；因此本切片采用 at-least-once + 状态幂等，不承诺 exactly-once。
3. [Amazon SQS visibility timeout](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html) 给出 lease 类似语义：消息被接收后暂时不可见；成功后删除，未在 timeout 内删除则重新可见。
4. [SQLite RETURNING](https://www.sqlite.org/lang_returning.html) 允许 UPDATE/DELETE/INSERT 返回被修改的行。单条 `UPDATE ... RETURNING` 可原子选择并 lease 一个 ready task。
5. [SQLite Transactions](https://www.sqlite.org/lang_transaction.html) 说明 `BEGIN IMMEDIATE` 立即取得写事务，SQLite 同时仅允许一个 writer；这使 Run mutation 与 outbox insert 可在同一提交边界内完成。

## 3. 采用、调整与拒绝

| 方案 | 决策 | 理由 |
| --- | --- | --- |
| business row + outbox row 同事务 | Adopt | 直接消除 commit/schedule 双写窗口 |
| lease + ack/release | Adopt | 支持 worker crash 后接管，不需长时间 sleep |
| deterministic task ID | Adopt | `runId + kind + targetRevision` 可审计并阻止同一 mutation 重复入队 |
| at-least-once delivery | Adopt | crash 可发生在 workflow side effect 完成与 ack 之间 |
| exactly-once 声明 | Reject | 没有分布式事务；LLM 调用等外部 side effect 可能重复 |
| 仅在启动时扫描 Run status | Reject | status 不能区分“无需任务”和“任务丢失”，outbox 才是事实来源 |
| 无限 lease | Reject | worker crash 后任务永不恢复 |
| 自动后台 polling timer | Defer | 本切片提供显式 drain 和现有 schedule trigger，避免隐藏 timer/句柄 |

## 4. 契约

### 4.1 Durable task types

```ts
type RunTaskKind = 'prepare' | 'complete'

interface RunTask {
  id: string
  runId: string
  kind: RunTaskKind
  createdAt: string
}

interface ClaimedRunTask extends RunTask {
  attempt: number
  leaseOwner: string
  leaseExpiresAt: string
}
```

`RunTask` 不含 Prompt、JD、简历、checkpoint 或答案；worker 只凭 runId 重新读取可信 Store record。

### 4.2 DurableRunStore

```ts
interface DurableRunStore extends RunStore {
  createWithTask(run: StoredResumeAgentRun, task: RunTask): Promise<boolean>
  compareAndSetWithTask(
    run: StoredResumeAgentRun,
    task: RunTask
  ): Promise<boolean>
  claimNextTask(options: ClaimRunTaskOptions): Promise<ClaimedRunTask | undefined>
  acknowledgeTask(taskId: string, leaseOwner: string, attempt: number): Promise<boolean>
  releaseTask(taskId: string, leaseOwner: string, attempt: number): Promise<boolean>
}
```

- `createWithTask`：ID 不存在且 revision 0 时，在一个事务中 insert Run 与 task。
- `compareAndSetWithTask`：revision 匹配时，在一个事务中 update Run、revision + 1 并 insert task；CAS 失败时 task 也不存在。
- `claimNextTask`：选择 ready 或 lease 已过期的最旧 task，原子写 owner、expiry、attempt + 1 并返回。
- `acknowledgeTask`：当前 lease owner 与 claim attempt 都匹配时才可删除 task。
- `releaseTask`：当前 owner 与 attempt 都匹配时才可清空 lease；record 和 task 不包含原始错误。

## 5. SQLite schema v2

```sql
CREATE TABLE resume_agent_tasks (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('prepare', 'complete')),
  created_at INTEGER NOT NULL,
  available_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_owner TEXT,
  lease_expires_at INTEGER,
  FOREIGN KEY (run_id) REFERENCES resume_agent_runs(id) ON DELETE CASCADE
) STRICT;
```

索引按 `available_at, lease_expires_at, created_at, id` 支持 ready scan。v1 数据库迁移到 v2 时只新增表和索引，不改 Run payload。

## 6. Service 状态转换

```text
start
  └─ createWithTask(queued run, prepare task) -- one transaction
       ├─ commit -> schedule one drain hint
       └─ rollback/conflict -> neither row exists

final answer
  └─ compareAndSetWithTask(analyzing_jd, complete task) -- one transaction
       ├─ winner -> receipt/checkpoint/task commit; schedule drain hint
       └─ loser  -> no task; re-read winner using RA-015A semantics

drain
  └─ claim ready task with lease
       ├─ workflow success/terminal no-op -> conditional ack
       ├─ handled workflow failure -> Run failed, conditional ack
       ├─ worker exception -> conditional release
       └─ process crash -> no ack; lease expiry makes task ready again
```

`prepare` 重放规则：terminal / `needs_input` Run 视为已完成 task；已有 checkpoint 时跳过已经完成的 prepare；较早 status callback 不允许把公开状态倒退。仍可能重复尚未 checkpoint 的模型调用，这是明确剩余限制。

## 7. 失败语义与安全

- task ID collision、invalid task、数据库错误会回滚整个 Run + task transaction，并转换为安全 `RunStoreError`。
- CAS false 是正常竞争，不创建 orphan task。
- stale worker 或旧 claim generation 不能 ack/release 当前 lease。
- lease 时间由服务注入的 `now()` 计算；测试直接推进 fake clock，不 real sleep。
- `recoverPendingTasks(limit)` 有界，防止一次启动无限占用 event loop。
- workerId、taskId、attempt 可用于安全诊断，但不得包含用户正文。
- 没有自动 timer，所以测试和进程关闭不产生悬挂句柄。

## 8. 单行为 RED → GREEN 记录

| 行为 | RED 证据 | GREEN / 设计影响 |
| --- | --- | --- |
| schema v1 迁移 v2 | v1 数据库没有 task table，无法 enqueue | migration 在同一事务保留已有 Run 并新增 task table/index，`user_version` 变为 2 |
| create + task 原子提交 | Run create 后 schedule 丢失时没有 durable work | `createWithTask` 同事务 insert；duplicate create 不产生第二 task |
| CAS + task 原子提交 | 回答 CAS 与 completion schedule 存在 crash 窗口 | `compareAndSetWithTask` 同事务 update/insert；stale CAS 不产生 orphan task |
| task insert 失败回滚 | 人为复用 task ID 会留下已更新 Run | collision 转为安全 `storage_failed`，Run create/update 与 task 一起回滚 |
| 双连接 claim | 两个 adapter 都可能观察 ready task | 单条 `UPDATE ... RETURNING` 只给一个连接 lease |
| lease lifecycle | worker crash 后 task 无恢复路径 | owner-only ack/release；fake clock 到期后另一 owner 接管，attempt 递增 |
| start hint 丢失 | 禁用原 service 的 schedule 后 Run 永久 queued | reopen Store 后显式 drain prepare task，Run 完成并 ack |
| answer hint 丢失 | receipt/checkpoint 已提交但 completion 不运行 | reopen 后 drain completion task；receipt/checkpoint 保留且只产生一次逻辑完成 |
| 多 service drain | 两个 service 同时恢复可能重复执行 | 当前 lease 只有一个执行者；另一 service 得到 0 个 task |
| ack 丢失后的重放 | workflow 已完成而 task 未删除 | lease 到期后重放只确认 terminal Run，不再次调用模型 |
| 兼容回归 | durable capability detection 可能改变 in-memory 路径 | 原 Run tests 与完整 package suite 保持通过 |

## 9. 证据台账

| 能力 | 当前证据 | 状态 | 缺口 |
| --- | --- | --- | --- |
| dual-write 风险 | AWS transactional outbox；schedule-hint-loss restart tests | Covered for local SQLite | OS/power-loss fault injection 未执行 |
| atomic Run + task | SQLite transaction 语义；success/stale/collision rollback tests | Covered for current statements | 磁盘满与 COMMIT I/O fault 未注入 |
| lease | SQS visibility timeout/receipt handle 类比；SQLite RETURNING；双连接、generation、过期接管 tests | Covered for one host | 无 heartbeat/执行 side-effect fencing；长任务可越过 lease |
| idempotent replay | RA-015A revision/idempotency；terminal replay test | Partial | 非 terminal LLM 阶段仍可能重复调用 |
| exactly-once | 无法证明 | Rejected claim | 保持 at-least-once 文档 |
| automatic polling | 无 | Deferred | 需要外部生命周期显式调用 drain；尚无 production worker/runbook |

## 10. 会推翻方案的证据

- 若单个 LLM 阶段时长经常超过固定 lease，应增加安全 heartbeat/extendLease；不能仅把 timeout 无限调大。
- 若多个 task kind 需要严格全局顺序或优先级，应引入显式 sequence/partition，而不是依赖时间戳碰巧排序。
- 若工作流外部 side effect 无法幂等，必须增加 effect-specific idempotency key 或拆出 saga；outbox 本身不提供 exactly-once。
- 若需要跨主机 worker，SQLite 文件 adapter 必须替换为服务端数据库/队列，并复跑同一契约测试。

## 11. 明确延期

- 自动常驻 poller、heartbeat、dead-letter storage/redrive、backoff/jitter 和运维指标；
- 完整 stage checkpoint，避免 crash 时重复未完成的 LLM 调用；
- PostgreSQL task claim（例如 `FOR UPDATE SKIP LOCKED`）与多主机部署；
- exactly-once 外部 side effect 声明。

此外，`recoverPendingTasks(limit)` 会先取得至多 `limit` 个 lease，再把执行交给注入的 schedule seam。队列拥塞时，后排 task 可能在真正执行前消耗部分 lease；本切片用有界 limit 控制风险，但没有把它描述成公平或长任务安全的生产 worker。ack 返回 `false` 时 task 仍保留当前 lease，要等 lease 过期后恢复；不会把“未删除”误报为 exactly-once 成功。

## 12. 验证记录

```bash
pnpm agent test src/workflow/sqlite-run-store.test.ts
# 1 file passed；20 tests passed

pnpm agent test src/workflow/run.test.ts
# 1 file passed；18 tests passed

pnpm agent test
# 13 files passed；149 tests passed

pnpm --filter @yamlresume/resume-agent exec tsc --noEmit
# exit 0

pnpm agent build
# ESM 与 DTS build success

pnpm exec biome check packages/resume-agent/src/workflow/run.ts packages/resume-agent/src/workflow/sqlite-run-store.ts packages/resume-agent/src/workflow/sqlite-run-store.test.ts packages/resume-agent/src/index.ts
# checked 4 files；无错误

git diff --check
# exit 0
```

当前开发证据仅来自本地 SQLite、fake agent 与 fake clock；未访问外网、真实 Provider、真实简历或生产队列。`node:sqlite` 的 ExperimentalWarning 与 RA-015B 记录一致，未被隐藏。
