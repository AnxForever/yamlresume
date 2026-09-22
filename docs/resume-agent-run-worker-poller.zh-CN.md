# RA-015F：Durable Run 常驻任务轮询

> 状态：Implemented for development；同主机 SQLite，尚未 Operational
>
> 目标：让 durable RunStore 在启动恢复之外，持续发现新任务和执行失败后释放的任务，并在关闭时停止轮询。

## 为什么需要这个切片

RA-015C 的显式 `recoverPendingTasks()` 只覆盖进程启动窗口。任务在运行时由另一个请求写入，或 callback 因 lease/瞬态错误释放后，如果没有新的请求触发 schedule，它会一直留在 outbox 中。RA-015F 用显式生命周期 `startWorker()` 加一个有界 timer poller 补上这个空窗；它不改变 claim、lease、heartbeat 或 fenced Run mutation 的语义。

## 合同与状态

- `startWorker()` 只对 `DurableRunStore` 生效，重复调用幂等；内存 Store 不创建后台句柄。
- 每轮最多 claim/执行一个任务，下一轮等待 `taskPollMs`（默认 1 秒），避免无界 claim-ahead。
- timer 使用 `unref()`，`close()` 清除 timer，并先放弃活动 heartbeat。
- 任务仍通过既有 `claimNextTask → heartbeat → execute → ack/release` 路径；poller 不直接修改 Run，也不绕过 generation fencing。
- 启动顺序是：打开 Store → 有界 startup recovery → 监听 API → `startWorker()`。

## RED → GREEN 记录

1. RED：只调用 startup recovery 时，启动后才插入的 durable task 不会执行。
2. GREEN：`startWorker()` 定期 claim，测试插入 task 后最终得到 `completed`。
3. GREEN：API runtime 在监听成功后启动 poller；`close()` 清理 timer，不留下测试或部署句柄。

## 验收证据

- `packages/resume-agent/src/workflow/run.test.ts`：22 tests passed，包含“polls durable tasks inserted after worker startup”。
- `packages/resume-agent-api/src/server.test.ts`：21 tests passed，包含 SQLite startup recovery 与 runtime restart。
- `pnpm --filter @yamlresume/resume-agent build`：通过。
- `pnpm --filter @yamlresume/resume-agent-api exec tsc --noEmit`：通过。
- API 集成测试使用可绑定本地 HTTP socket 的环境执行；普通受限沙箱会得到 `listen EPERM`，不作为应用失败证据。

## 尚未解决

这是单主机、单进程的开发级 worker。仍缺：并发度/backpressure 配置、指数 backoff/jitter、DLQ/redrive、Provider side-effect idempotency/cancellation、跨主机数据库时钟证据、metrics/alerts/runbook，以及电源断电和真实长 Provider 请求演练。因此 RA-015F 不能升级为 Operational，也不能宣称 exactly-once。

## 学习要点

持久化 outbox 解决“任务意图不会丢”；poller 解决“任务最终会被再次观察”；lease/heartbeat/fencing 解决“多个观察者不会安全边界外写入”。这三层分别对应 durable state、liveness 和 concurrent mutation，不能用一个内存 `setTimeout` 代替全部语义。
