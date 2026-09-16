# Resume Agent Durable RunStore

> Feature ID：RA-015B
> 状态：Implemented for development（仅同主机 SQLite；不是 Enabled 或 Operational）
> 最后审阅：2026-09-16
> 范围：记录 RA-015B 引入的可重启、同主机跨进程 SQLite adapter；当前代码已由 RA-015C 将 schema v1 迁移到 v2 并加入 transactional outbox，但仍不包含跨主机数据库或生产部署声明。

## 1. 问题与用户结果

RA-015A 已阻止单个 `InMemoryRunStore` 内的 stale overwrite，但进程退出会丢失 Run、checkpoint 与 receipt，不同进程也无法共享内存 Map。RA-015B 的用户结果是：

- Run 在关闭并重新打开 Store 后仍可读取；
- `create` 和 revision CAS 由数据库单条条件写保证，而不是应用层 `SELECT → UPDATE`；
- 两个连接竞争同一 revision 时只有一个成功；
- adapter 继续满足 clone 隔离和公开 Run 隐私边界；
- 数据库 schema 有明确版本，连接可显式关闭，测试不会遗留文件或句柄。

RA-015B 提交时只解决 durable state，未解决“状态已提交但任务未调度”的双写窗口。该历史缺口已由 RA-015C transactional outbox 在当前 schema v2 中补上；heartbeat、自动 poller 与生产 worker 仍未实现。

## 2. 研究证据与技术选择

### 2.1 权威来源

1. [Node.js v22.21.1 `node:sqlite`](https://nodejs.org/download/release/v22.21.1/docs/api/sqlite.html) 提供同步 `DatabaseSync`、prepared statement、`run().changes` 和显式 `close()`；同时标为 Stability 1.1（Active development）。因此可用于本仓库的开发级 adapter，但不能据此宣称生产稳定。
2. [SQLite Transactions](https://www.sqlite.org/lang_transaction.html) 说明所有读写都发生在事务中，多个连接/进程可同时读，但同一时刻只有一个写事务。
3. [SQLite Isolation](https://www.sqlite.org/isolation.html) 说明默认事务具有 serializable isolation；WAL 模式允许 reader 与 writer 并行，并向 reader 提供 snapshot isolation。
4. [SQLite Write-Ahead Logging](https://www.sqlite.org/wal.html) 说明 WAL 要求进程位于同一主机，不能把网络文件系统当作跨主机协调方案。
5. [SQLite `PRAGMA synchronous`](https://www.sqlite.org/pragma.html#pragma_synchronous) 区分提交的持久性保证；本 adapter 选择 `FULL`，优先保证已确认事务在操作系统/硬件能力范围内的持久性，而不是使用 WAL 常见的 `NORMAL` 性能折中。
6. RA-015A 已记录 RFC 9110 lost-update、DynamoDB version conditional write 与 CAS 证据；本切片把该抽象映射到真实 SQL 条件写。

### 2.2 Adopt / Adapt / Reject

| 方案 | 决策 | 理由 |
| --- | --- | --- |
| Node 内建 SQLite | Adopt for development | 无新增依赖，当前运行时为 Node 22.21.1，能做真实磁盘与跨连接条件写 |
| `UPDATE ... WHERE id = ? AND revision = ?` | Adopt | 检查和写入由数据库作为一条 statement 完成 |
| WAL + `synchronous=FULL` | Adopt | reader/writer 并行，同时优先提交持久性 |
| schema version | Adopt | 为 RA-015C outbox 表提供可演进的 migration 边界 |
| 应用层 `get` 后无条件 `UPDATE` | Reject | 会重新引入 lost update |
| 把 JSON payload 当作 revision 真相 | Reject | 独立 INTEGER revision 列用于条件写；读取时校验 JSON 与列一致 |
| 新增第三方 SQLite/ORM 依赖 | Reject for this slice | 共享 package/lock 正被其他线程修改，且内建模块足以验证 Store 契约 |
| PostgreSQL / 云数据库 | Defer | 需要部署、连接池、迁移和故障环境；应由后续 operational adapter 独立验证 |

## 3. 契约与数据模型

### 3.1 公共构造边界

```ts
const store = await SqliteRunStore.open('/trusted/path/runs.sqlite')
try {
  // RunStore operations
} finally {
  store.close()
}
```

- 动态加载 `node:sqlite`，避免仅导入 resume-agent 包就强制旧 Node 运行时解析该模块。
- 路径为空时使用稳定配置错误；目录创建由部署者负责，adapter 不猜测文件系统布局。
- `close()` 幂等；关闭后的业务方法返回稳定 Store 错误，而不是泄露 SQLite 原始消息。

### 3.2 RA-015B 引入的 schema v1

```sql
CREATE TABLE resume_agent_runs (
  id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL CHECK (revision >= 0),
  record_json TEXT NOT NULL
);
```

- `PRAGMA user_version = 1` 标记 schema；高于实现支持版本时 fail closed。
- `create` 只接受 revision 0，使用 `INSERT ... ON CONFLICT DO NOTHING`。
- `compareAndSet` 序列化 revision + 1 后执行：

```sql
UPDATE resume_agent_runs
SET revision = ?, record_json = ?
WHERE id = ? AND revision = ?;
```

- `changes === 1` 表示成功；`0` 表示 missing 或 revision conflict，且不改变状态。
- `get` 解析 JSON 后校验 id、revision、snapshot 最小形状；损坏记录只抛数据安全的 `RunStoreError`，不回显数据库正文或 SQLite 原始 error message。

当前 adapter 的 `user_version` 已是 2。RA-015C 保留上述 Run table 与 CAS 语义，通过 v1→v2 migration 新增 `resume_agent_tasks`；详见 [`resume-agent-run-outbox-recovery.zh-CN.md`](./resume-agent-run-outbox-recovery.zh-CN.md)。

## 4. 状态与失败语义

```text
closed ── open(path) + migrate ──> ready ── close() ──> closed
                  │
                  └─ config/schema/open failure ──> safe RunStoreError

ready + create(revision 0)
  ├─ ID absent ──> committed(true)
  └─ ID exists ──> unchanged(false)

ready + compareAndSet(expected r)
  ├─ current revision = r ──> committed(revision r+1, true)
  └─ missing / stale ───────> unchanged(false)
```

稳定原因码计划为：

- `invalid_configuration`：空路径或非法 timeout；
- `open_failed`：文件无法打开/初始化；
- `unsupported_schema`：数据库版本高于 adapter；
- `closed`：关闭后继续调用；
- `serialization_failed`：输入不能安全序列化；
- `corrupt_record`：读取的数据不满足 Store record 最小不变量。
- `storage_failed`：数据库操作失败；不透传底层消息。

错误消息不得包含 Run payload、JD、简历、答案、SQLite 原始消息或完整数据库路径。

## 5. 隐私与安全边界

- SQLite 文件包含原始 request、checkpoint 与 receipt，必须位于可信目录；本切片不实现字段级或数据库级加密。
- adapter 错误只暴露稳定原因码和通用消息。
- prepared statements 绑定所有 id、revision 和 JSON；不拼接业务数据到 SQL。
- public `ResumeAgentRunService.get()` 仍只返回 snapshot；durable adapter 不改变该边界。
- 数据删除、retention、备份、密钥管理和磁盘权限属于后续 production hardening。

## 6. 单行为 RED → GREEN 记录

| 行为 | RED 证据 | GREEN / 设计影响 |
| --- | --- | --- |
| 关闭并 reopen 后读取 | 测试因 `@/workflow/sqlite-run-store` 不存在而失败 | 增加动态加载、schema v1、create/get 与幂等 close；真实磁盘 reopen 成功 |
| 匹配 revision CAS | `compareAndSet` 稳定抛出 `storage_failed` | 单条条件 UPDATE 保存 revision + 1；再次 reopen 后仍正确 |
| 双连接唯一 winner | 在 SQL CAS 后独立加入契约测试 | 两个连接持有同一 stale record 时结果严格为 `[false, true]` |
| 条件失败与 clone | 逐项加入契约测试 | duplicate create、missing/stale CAS 零写入；JSON 边界隔离输入输出引用 |
| 关闭与配置错误 | 逐项加入安全测试 | close 幂等；关闭后、空路径、负数/小数 timeout 使用稳定原因码 |
| 错误脱敏 | 注入私密路径、循环 resume body 与 corrupt record marker | `open_failed`、`serialization_failed`、`corrupt_record` 均不包含注入值或原始 SQLite 消息 |
| schema fail closed | 构造 `user_version = 999` 数据库 | open 返回 `unsupported_schema`，检查版本前不改变持久化 journal mode |
| service 重建隐私 | 使用 SQLite 关闭/重开两个 service | public Run 与创建时 snapshot 相同；revision/request/checkpoint/receipt 不公开 |

所有测试只使用本地文件和 fake agent；未访问外网、真实凭证或生产数据库。

## 7. 验证策略

- 所有测试只使用 `mkdtemp` 下的本地 SQLite 文件；不访问外网或真实凭证。
- 每个 Store 在 `finally` / `afterEach` 中关闭，再删除精确的临时目录。
- 跨连接测试打开两个 adapter 指向同一文件，使用相同 stale record 竞争 CAS。
- 不用 sleep 证明并发；依赖数据库条件 statement 的返回值和最终 winner。
- 运行 focused tests、完整 agent tests、package TypeScript、定向 Biome、license 和 `git diff --check`。

## 8. 证据台账

| 能力 | 当前证据 | 状态 | 缺口 |
| --- | --- | --- | --- |
| 磁盘 reopen | 官方 API、SQLite transaction 文档、本地 close/reopen test | Covered for local file | 断电/文件系统故障未注入 |
| SQL CAS | SQLite serializable/single-writer、双连接唯一 winner test | Covered for one host | 多主机数据库未实现 |
| migration | schema v1 初始化、重复打开、future version 拒绝；RA-015C v1→v2 保留 Run test | Covered through current v2 | 更复杂的多步/回滚 migration 尚无 production evidence |
| safe errors | 私密路径、循环正文、损坏记录注入 tests | Covered | 磁盘满/权限变化故障未注入 |
| public privacy | SQLite service 关闭/重建 test | Covered | API 进程自动装配未启用 |
| outbox / crash dispatch | RA-015C 同事务 task 与显式 restart drain tests | Implemented after RA-015B | heartbeat、自动 poller 与 operational worker |
| multi-host / production DB | 无 | Not implemented | 独立 adapter 与部署验证 |

## 9. 可能推翻方案的证据

- 若支持的最低 Node 版本低于 22.5，或 `node:sqlite` Active development 发生破坏性变化，应改用受支持驱动或单独 package export。
- 若同步数据库调用对 event-loop 延迟产生不可接受的测量结果，应迁移到异步 driver/worker thread。
- 若部署跨主机、多副本共享存储，应使用 PostgreSQL 等服务端数据库；SQLite WAL 不能满足。
- 若存储合规要求静态加密、细粒度访问审计或托管备份，当前文件 adapter 不应启用。
- 若 payload 尺寸和更新频率导致整份 JSON 重写成本不可接受，应规范化 schema，而不是继续扩展单列 JSON。

## 10. 明确延期

- RA-015C 已实现：transactional outbox、lease、owner-only ack/release、answer CAS 与 completion enqueue 同事务、显式进程重启 drain。
- RA-015D：补强多 worker 故障注入、claim fencing/长任务 lease 风险与 operational 指标设计；仍不宣称生产多主机调度。
- 生产 adapter：PostgreSQL/托管数据库、连接池、加密、备份、retention 和 runbook。

## 11. 验证记录

```bash
pnpm agent test src/workflow/sqlite-run-store.test.ts
# 1 file passed；10 tests passed

pnpm agent test
# 13 files passed；139 tests passed

pnpm --filter @yamlresume/resume-agent exec tsc --noEmit
# exit 0

pnpm agent build
# ESM 与 DTS build success

pnpm exec biome check packages/resume-agent/src/workflow/sqlite-run-store.ts packages/resume-agent/src/workflow/sqlite-run-store.test.ts packages/resume-agent/src/index.ts
# checked 3 files；无错误
```

`node:sqlite` 在每次真实 adapter 测试中输出 ExperimentalWarning；这是 Node 22.21.1 Stability 1.1 的预期证据，而不是被隐藏的测试噪声。RA-015B 因此保持 `Implemented for development`，不标记为 Operational。
