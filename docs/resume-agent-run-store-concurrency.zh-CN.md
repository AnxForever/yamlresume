# Resume Agent RunStore 乐观并发与原子回答接收

> Feature ID：RA-015A
> 状态：Implemented for development（仅单进程内存 adapter；不是 Enabled 或 Operational）
> 最后审阅：2026-09-16
> 范围：只硬化简历生成后端的进程内 RunStore 与回答接收；不实现数据库、进程重启恢复、分布式锁或前端。

## 1. 问题与用户结果

现有服务用 `get → 校验 → save` 更新 Run。两个请求可以读到同一份旧记录，各自通过校验并先后覆盖存储，形成 lost update。回答路径因此可能重复写 receipt、覆盖 checkpoint，或为同一个最后问题调度两次恢复任务。

本切片要让一次版本匹配的写入成为不可分割的 Store 操作，并让回答接收在竞争后重新读取事实：

- 同一幂等键、同一回答只产生一次逻辑写入与一次恢复调度；竞争者得到语义相同的成功结果；
- 同一幂等键、不同回答稳定返回 `idempotency_conflict`；
- 不同命令竞争同一当前问题时只接受一个，失败方稳定返回 `answer_conflict`；
- 每次更新保留 request、checkpoint、receipt 与公开 snapshot；
- 内部 revision、request、checkpoint、receipt 不进入公开 `ResumeAgentRun`。

## 2. 研究证据

### 2.1 权威来源

1. [RFC 9110：HTTP Semantics，If-Match](https://httpwg.org/specs/rfc9110.html#field.if-match) 说明条件请求可防止并行修改造成的 lost update；前置条件为 false 时，服务器不得执行目标方法。该协议语义对应本模块的“版本匹配才写”。
2. [RFC 9110：Idempotent Methods](https://httpwg.org/specs/rfc9110.html#idempotent.methods) 将幂等定义为相同请求执行多次与执行一次具有相同预期效果。这里采用“重复命令返回已提交的当前结果”，而不是重复产生副作用。
3. [Amazon DynamoDB optimistic locking](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/BestPractices_OptimisticLocking.html) 使用随更新递增的版本和条件写；版本不匹配时拒绝写入，以避免覆盖其他写入。文档也提醒重读重试应有界。
4. [DynamoDBMapper optimistic locking](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBMapper.OptimisticLocking.html) 将新记录的“不存在”条件与更新的版本条件分开，并指出 global tables 的 last-writer-wins 不遵守单一版本条件写语义。
5. [Amazon Builders' Library：Making retries safe with idempotent APIs](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/) 建议由调用方提供 request identifier 表达重试意图；相同 identifier 但不同参数属于不同意图，不能静默当作相同请求。
6. [Java `AtomicReference.compareAndSet`](https://docs.oracle.com/en/java/javase/22/docs/api/java.base/java/util/concurrent/atomic/AtomicReference.html#compareAndSet(V,V)) 给出 CAS 的最小语义：当前值等于 expected 时原子替换并返回 true，否则返回 false。

以上证据支持“条件写 + 版本递增 + 语义幂等判定”，但不能证明当前内存实现具有数据库 durability、跨进程一致性或生产可用性。

### 2.2 Adopt / Adapt / Reject

| 结论 | 决策 | 理由 |
| --- | --- | --- |
| 单调 revision 与条件写 | Adopt | 直接封闭 stale overwrite；future durable adapter 可映射到数据库 conditional update |
| create 与 update 分离 | Adopt | `create` 原子要求 ID 不存在；`compareAndSet` 原子要求 revision 匹配 |
| 同 token 重放返回语义成功 | Adapt | 还要比较 interaction ID 与答案指纹，避免 token 被不同意图复用 |
| CAS 冲突后一律盲重试 | Reject | Answer 可能代表不同用户意图；盲重算会把竞争失败伪装成顺序接受 |
| 进程内 mutex / 全局锁 | Reject | Map 的同步 check-and-set 足够证明端口语义；锁会扩大临界区且不能迁移到多实例 |
| last-writer-wins | Reject | 它正是 lost update 的根因，并会擦除 checkpoint 或 receipt |
| 数据库、分布式锁、事务框架 | Defer | 超出本切片；没有新增依赖，也不宣称 durable |

## 3. 契约与状态模型

### 3.1 Store 契约

内部 `StoredResumeAgentRun` 增加 `revision: number`。revision 初值为 `0`，只由 Store 在成功更新时加一。

```ts
interface RunStore {
  get(id: string): Promise<StoredResumeAgentRun | undefined>
  create(run: StoredResumeAgentRun): Promise<boolean>
  compareAndSet(run: StoredResumeAgentRun): Promise<boolean>
}
```

- `create`：仅当 ID 不存在且传入 revision 为 `0` 时保存并返回 true；否则不修改状态并返回 false。
- `compareAndSet`：把传入 record 的 revision 作为 expected revision。当前记录存在且 revision 相等时，原子保存完整 next record，并令存储后的 revision 为 `expected + 1`；否则不修改状态并返回 false。
- `get`、`create` 输入与 CAS 输入都与内部 Map 做结构化克隆隔离；调用方不能通过共享引用绕过 revision。
- `InMemoryRunStore` 的比较与 `Map.set` 之间没有 `await`，因此在单个 Node.js event loop/单个 adapter 实例中是不可分割的同步临界段。
- boolean 只表达“条件写成功/未成功”。业务层在失败后重新读取，依据领域事实分类；Store 不理解 answer。

### 3.2 Answer 状态转换

```text
读取 revision r
  ├─ 已有同 key + 同 interaction/value 指纹 ──> 幂等成功（不写、不调度）
  ├─ 已有同 key + 不同 interaction/value ─────> idempotency_conflict
  └─ 校验 waiting / active interaction / checkpoint / answer
       └─ 构造完整 next record，CAS(expected = r)
            ├─ 成功且仍有问题 ──> needs_input，新问题，不调度
            ├─ 成功且最后问题 ──> analyzing_jd，只调度一次 completion
            └─ 失败 ──> 重新读取 winner
                 ├─ 同 key + 同答案 ──> 幂等成功
                 ├─ 同 key + 不同答案 ─> idempotency_conflict
                 └─ 其他 winner ───────> answer_conflict
```

相同答案但不同幂等键是不同命令；若两者竞争同一问题，CAS 失败方返回 `answer_conflict`，不会根据答案文本自动合并意图。

### 3.3 其他状态更新

`transition`、checkpoint 保存、pause、fail、finish 也必须走 CAS，并始终从完整 current record 派生 next record。可安全重算的内部状态更新可以在 CAS 冲突后重新读取，但重试必须有界；状态已经等于目标时视为成功。Answer 不做这种盲重试。

## 4. 失败语义与安全边界

| 场景 | 结果 | 写入/调度 |
| --- | --- | --- |
| create ID 已存在或初始 revision 非 0 | `false`；原记录不变 | 0 / 0 |
| stale CAS 或记录不存在 | `false`；原记录不变 | 0 / 0 |
| 同 key、同 interaction、同 value 重放 | 当前公开 snapshot | 0 / 0 |
| 同 key、不同 interaction 或 value | `RunAnswerError('idempotency_conflict')` | 0 / 0 |
| 不同命令竞争当前问题 | winner 成功；loser 为 `answer_conflict` | 1 / 最多 1 |
| 非 waiting、stale interaction、无 checkpoint、无效 answer | 沿用稳定领域错误 | 0 / 0 |

公开查询只返回 clone 后的 `snapshot`。revision、原始 request、checkpoint、pendingInteractions 与 answerReceipts 都留在可信 Store record；receipt 只保存 SHA-256 指纹而不保存原始答案。

## 5. 已知失败模式与生产缺口

- CAS 成功后、进程把 completion 放入内存队列前崩溃：回答已接收但任务可能未调度。本切片不实现 transactional outbox 或 durable queue。
- 进程退出会丢失全部内存记录；多个进程/多个 `InMemoryRunStore` 实例互不协调。
- 高冲突可造成内部状态更新达到重试上限；没有公平性、排队或 starvation 保证。
- JavaScript number 的 revision 最终存在安全整数上限；本切片不实现溢出迁移。
- future durable adapter 必须提供真正的条件写隔离；“先 SELECT 再无条件 UPDATE”不满足契约。
- multi-region last-writer-wins 会破坏 CAS 假设；不能仅靠字段名叫 revision 就宣称安全。
- 本切片不实现数据库、加密持久化、保留/删除策略、认证、进程重启恢复、跨实例协调或 operational 验证。

## 6. 可能推翻方案的证据

- 若真实负载显示同一 Run 的冲突率高且 CAS 重试频繁耗尽，应评估按 Run 串行 actor/队列或带租约的单写者，而不是无限提高重试次数。
- 若一次状态转换必须与 durable task enqueue、审计事件或多个实体共同提交，应改用数据库事务与 transactional outbox。
- 若部署要求 active-active multi-region 且底层只提供 last-writer-wins，应重新选择一致性模型或所有权路由；当前 CAS 契约不够。
- 若 revision 接近 `Number.MAX_SAFE_INTEGER`，需要 bigint/数据库原生版本或受控迁移。

## 7. 单行为 RED → GREEN 记录

| 行为 | RED 证据 | GREEN / 设计影响 |
| --- | --- | --- |
| 原子 create | `TypeError: store.create is not a function` | 增加 absent check；目标 ID 已存在或初始 revision 非 0 时零写入 |
| revision 匹配 CAS | `TypeError: store.compareAndSet is not a function` | 同步 compare + set；Store 保存 revision + 1 |
| stale CAS 与 clone 隔离 | 在 CAS 原语后逐项加入契约测试 | stale 返回 false 且 winner 不变；create/CAS/get 均 structured clone |
| 内部 revision / 公开隔离 | `expected undefined to be 0` | `start` 改为 `create({ revision: 0 })`；public get 仍只返回 snapshot |
| 同 key 同答案竞争 | barrier 测试先观察到 successful CAS 为 0，证明仍走无条件 save | Answer 改走 CAS；loser 重读同 receipt 后幂等成功；只有 winner 调度 |
| 所有状态写入版本化 | Answer 局部 CAS 后，既有多问题顺序测试错误得到 `answer_conflict`；根因是旧 pause 写入没有 revision，后续形成无效版本 | 删除 `save` 契约；transition/checkpoint/pause/fail/finish 全部通过最多 3 次的 CAS 更新器并保留完整 current record |
| 同 key 不同值 | 在冲突 resolver 落地后独立加入并发分支测试，首轮 GREEN | loser 重读 winner receipt 后返回 `idempotency_conflict`；checkpoint/receipt/request/status 保留 |
| 不同命令不同答案 | 独立加入并发分支测试，首轮 GREEN | winner 唯一；无匹配 receipt 的 loser 返回 `answer_conflict`，且不调度 |
| 顺序暂停与恢复回归 | 局部 CAS 阶段曾失败，完成全写路径迁移后复测 | focused Run tests 18/18；最终验证时共享工作树中的完整 agent package 125/125 |

并发测试只使用本地 fake agent 与测试内 barrier，不访问网络、不读取凭证，也不依赖真实时间 sleep。

## 8. 证据台账

| 项目 | 当前证据 | 状态 | 缺口 |
| --- | --- | --- | --- |
| 旧 `get → save` 会 lost update | 代码审阅；barrier RED 观察到并发回答没有 CAS 写入 | Backfilled | durable adapter 仍需独立复现 |
| CAS 可阻止 stale overwrite | RFC 9110、DynamoDB、AtomicReference；revision match/mismatch tests | Covered in memory | 数据库 conditional update 尚未实现 |
| 幂等键表达重放意图 | AWS Builders' Library；顺序与并发同值/不同值 tests | Covered in memory | 跨重启重放未证明 |
| 回答只调度一次 | 同答案、同键不同值、不同命令三组 barrier tests | Covered in memory | CAS 与 durable enqueue 尚非同一事务 |
| 内部状态不公开 | public get 对 revision/request/checkpoint/receipt 的回归断言 | Covered | future API/adapter 需保持边界 |
| clone 隔离 | create、CAS 输入与 get 输出突变测试 | Covered | 仅证明当前 adapter |
| durable / restart / multi-instance | 无 | Not implemented | future adapter、outbox、恢复演练 |

## 9. 验证记录

截至实现完成，定向测试、当前共享工作树中的全 agent package 测试、TypeScript、Biome 与 diff check 均通过：

```bash
pnpm agent test src/workflow/run.test.ts
# 1 file passed；18 tests passed

pnpm agent test
# 12 files passed；125 tests passed（其中包含其他线程新增的 rendering/agent tests）

pnpm --filter @yamlresume/resume-agent exec tsc --noEmit
# exit 0

pnpm exec biome check packages/resume-agent/src/workflow/run.ts packages/resume-agent/src/workflow/run.test.ts
# checked 2 files；无错误

git diff --check
# exit 0
```
