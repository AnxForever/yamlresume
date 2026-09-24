# RA-015K：durable Run Provider 在途取消

> 状态：Implemented for single-host production baseline；not Enabled or Operational
> 最后审阅：2026-09-25
> 范围：让同主机 durable Run 的 OpenAI-compatible 请求在 service close、task lease loss 或 retry deadline
> 到达时真正停止；不改 UI、SQLite schema、公开 HTTP Run 契约、Provider 幂等或费用计量。

## 1. Context 与用户结果

当前 Run worker 已有 generation-fenced 写入、heartbeat、关闭接管、持久化退避与 retry admission deadline，
但这些机制只能阻止旧 worker 写结果，不能停止已经发出的 HTTP 请求。SIGTERM 路径依靠显式退出进程结束
socket；heartbeat 丢失后，旧 Provider 请求仍可能继续消耗连接、token 和外部配额；retry delivery 也可能在
截止点前开始，却在截止点之后继续运行。

本功能面向本地单机应用的异步 Run 主链路。完成后，内置 OpenAI-compatible adapter 必须响应 worker 的
取消信号，停止当前 fetch 或 transport retry 等待，不再开始新的 transport attempt；关闭或失租不写公开
失败态，保留既有 SQLite 租约接管；retry deadline 到达则写既有稳定 deadline 失败并 ack。

## 2. Hypothesis 与生产验收

我们相信，为 LLM seam 增加一个可选、标准的 `AbortSignal`，并让 RunService 独占取消原因与状态转换，
可以在不扩张 Store interface 的情况下消除旧 worker 的无效在途请求。

以下条件均已满足，因此本功能可称为“本地单机 production baseline”，而不是只有单元测试的原型：

1. OpenAI-compatible adapter 在 caller abort 后中断挂起 socket，返回稳定、脱敏且不可重试的取消错误；
2. caller abort 可打断 `Retry-After`/本地 backoff，且不会再发下一次 HTTP attempt；
3. Agent 的 normalization、JobSpec、Draft 和 structured-output Repair 都传播同一个 signal；
4. RunService close 会先通知所有当前 delivery 取消，再 abandon heartbeat；公开 Run 不被旧执行写成失败；
5. heartbeat renewal false/异常会取消 Provider 请求，takeover generation 可继续恢复；
6. retry delivery 在持久化 deadline 到达时取消在途请求，写
   `agent_task_retry_deadline_exceeded` 并 ack；旧 task 的第一次 delivery 兼容语义不变；
7. timeout 仍是可重试 `timeout`，外部取消是不可重试 `cancelled`，二者不会因竞态误分类；
8. timer、abort listener、heartbeat、socket 和 SQLite 句柄均有清理证据；错误、日志、Run 和 task row
   不包含 prompt、候选人材料、Provider body、key 或 signal reason；
9. 生产构建 API + 本地 HTTP mock 的 SIGTERM 演练观察到在途 Provider 连接断开，同一 Run 随后由新进程
   接管完成；crash 和 retry 演练不回归；
10. focused、包级、全仓测试，Biome、TypeScript、build 与 diff 门禁全部通过。

## 3. Interface 与 deep-module 决策

- `LlmClient.completeJson(request, options?: LlmCallOptions)` 增加唯一控制字段 `signal?: AbortSignal`。
  这是所有真实/fake adapter 已存在的 seam；不把 Run、lease 或 shutdown 概念泄漏给 Provider adapter。
- `ResumeTailoringRunOptions.signal` 与 `StructuredOutputSpec.signal` 只负责传播。Repair 复用同一 signal，
  budget wrapper 原样转发，不各自创建控制器。
- OpenAI-compatible adapter 组合 caller signal 与既有 per-attempt timeout；最先发生的原因决定安全错误。
  transport backoff 使用可取消等待，并在每个 attempt 前重新检查 signal。
- RunService 为每个 claimed delivery 创建内部 execution context：`AbortController`、取消原因和 deadline timer。
  heartbeat 只通过内部 callback 通知 lease loss；Store adapter 不理解 AbortSignal。
- service close 先 abort execution contexts，再 abandon heartbeat。内置 adapter 必须及时结算；任意注入且
  忽略 signal 的第三方 `LlmClient` 不在 production-candidate 保证内，仍受自身 timeout 约束。
- 第一次 delivery 继续遵守 RA-015J 的“旧 task 至少尝试一次”；只有 attempt > 1 才把剩余 retry deadline
  变成在途 timer。精确边界仍是“等于即耗尽”。

这个设计保持两个深模块：RunService 决定何时以及为什么取消，Provider adapter 决定如何终止 transport。
如果删除新增的 signal interface，取消逻辑会重新散落到 Agent、Repair、HTTP adapter 与 worker 调用方，
说明该 seam 具有实际 leverage，而不是测试专用的浅层 pass-through。

## 4. 状态转换

```text
claimed delivery -> heartbeat current -> Provider request(signal)
  service close
    -> cancel(service_closed) -> abort fetch/wait -> abandon heartbeat
    -> no fail / ack / release; persisted lease later expires for takeover

  heartbeat renewal false/error
    -> cancel(lease_lost) -> abort fetch/wait
    -> no stale Run mutation / ack / release

  retry deadline timer (attempt > 1)
    -> cancel(retry_deadline) -> abort fetch/wait
    -> fenced stable deadline failure -> ack

  provider timeout
    -> retryable timeout -> existing transport/durable retry policy
```

## 5. 一次一个行为的 TDD 顺序

1. Adapter tracer：挂起的 loopback HTTP 请求收到 caller abort，RED 应继续等到 timeout；GREEN 应立即以
   `cancelled` 结束并由 mock 观察到连接断开。
2. Adapter retry wait：收到 429/503 后进入长等待，caller abort 后不发送下一 attempt。
3. Propagation：normalization 与 JobSpec/Draft/Repair 通过公开 Agent interface 收到同一 signal；budget 不吞掉。
4. Service close：真实临时 SQLite + signal-aware fake，close 取消在途请求且不污染 Run/task。
5. Lease loss：heartbeat 失败立即取消，不等待 fake Provider 主动完成；下一 generation 可认领。
6. Deadline：retry delivery 在截止点前开始、到点取消，稳定失败并 ack；首次旧 delivery 与 deadline 前成功回归。
7. Executable smoke：收紧 SIGTERM 演练，断言 mock Provider 观察到 disconnect 后原 Run 被新进程恢复。
8. Full gates：包级、全仓、三类故障演练、类型/格式/构建/diff 与无残留进程。

## 6. Out of scope、风险与可逆证据

- 不实现同步 chat/tailor HTTP 请求与浏览器断连绑定；本切片只保证 durable Run delivery。
- 不声称 Provider 已停止计费：HTTP abort 只能停止本地等待和连接，远端可能已经接收或完成请求。
- 不实现 Provider exactly-once/idempotency key、精确费用、DLQ/redrive、jitter、跨主机 worker 或用户取消按钮。
- Abort 与成功响应可能竞争；RunService 的 generation fence 与 deadline 原因优先级必须决定最终可写结果。
- 若生产 adapter 或 Node fetch 的实测表明 abort 不能及时断开连接，必须回退“production candidate”状态，
  并考虑 undici dispatcher/连接池级关闭，而不是放宽验收。

## 7. RED → GREEN 与验证记录

- Adapter tracer RED：loopback mock 已收到挂起请求后调用 caller `AbortController.abort()`；既有 adapter
  忽略第二个参数，直到 500ms 自身 timeout 才返回 `timeout/retryable=true`。focused 结果为 37 passed、
  1 failed，证明缺口位于公开 LLM interface 到 fetch 的取消传播，而不是 mock 未收到请求。
- Adapter tracer GREEN：`LlmClient.completeJson` 增加可选 `LlmCallOptions.signal`；adapter 只把自己的
  controller 传给 fetch，通过 listener 合并 caller abort 与 timeout，并以首个原因分类。caller abort
  返回固定 `LLM request was cancelled / cancelled / retryable=false`，不携带私密 reason；timeout 语义不变，
  listener 与 timer 在 finally 清理。focused 结果 38 passed。
- Retry-wait 测试首轮只断言“不开始第二个 HTTP request”，因此意外 GREEN，但实测结算仍约 1003ms：
  取消只在 sleep 结束、进入下一 attempt 时被看见。测试收紧为 abort 后 250ms 内结算，避免把延迟取消误记
  为已中断等待。
- Retry-wait RED → GREEN：收紧后观察到 abort 后仍等待约 980ms，focused 为 38 passed、1 failed；
  retry sleep 改为 signal-aware timer，abort 会清 timer/listener 并立即返回同一安全取消错误，不再开始下一
  request。focused 最终 39 passed，原 1 秒 `Retry-After` 时序回归仍通过。
- Agent propagation RED → GREEN：公开 `agent.run(..., { signal })` 首先让 JobSpec/Draft 两次调用都收到
  `undefined`，focused 为 15 passed、1 failed；加入 `ResumeTailoringRunOptions.signal`、
  `StructuredOutputSpec.signal` 并让 budget wrapper 原样转发后，两次收到同一 signal。随后收紧已有候选人
  Repair 测试，第一次 normalization 和 Repair 仍为 `undefined`；把 signal 传入 normalization seam 后，
  CandidateNormalization、Repair、JobSpec、Draft 四次均复用同一 signal，focused 最终 16 passed。
- Service close RED → GREEN：真实临时 SQLite 的既有 close/fencing 测试中，Provider 首先收到
  `undefined` signal，focused 为 49 passed、1 failed；RunService 为每个 claimed delivery 建立内部
  AbortController，close 先 abort active deliveries，再 abandon heartbeat。Provider 观察到 signal 已取消，
  timer 清零，旧执行仍不能写失败/result，SQLite suite 回到 50 passed。
- Lease loss RED → GREEN：既有 deferred Provider/takeover 测试中，第二次 heartbeat renewal 已返回 false，
  但 signal 仍为未取消，focused 为 49 passed、1 failed；heartbeat 的首次 `markLeaseLost()` 现在通过
  内部 callback abort delivery，重复 abandon 不重复通知。Provider 观察到取消，旧 generation 仍无
  status/result/error、ack 或 release，新 generation 可认领；SQLite suite 回到 50 passed。
- Deadline RED → GREEN：第一次瞬态失败在 1 秒后进入 attempt 2，持久化 retry deadline 为 1.5 秒；
  既有 worker 没有在途 timer，signal 不取消并使测试 10 秒超时，其余 50 项通过。现在 attempt > 1 会按
  `deadline - now` 安排 unref timer；截止点前 1ms signal 仍有效，精确到点 abort，generation-fenced 写入
  `agent_task_retry_deadline_exceeded` 后 ack，私密取消 marker 不进入公开 Run。SQLite suite 为 51 passed。
- Transport 边缘回归：response headers 已返回但 body 挂起时仍能被 caller abort；pre-aborted signal 不建立
  HTTP 请求；私密 `AbortSignal.reason` 不进入稳定错误。OpenAI-compatible focused suite 为 41 passed。
- 包级回归：Agent suite 为 341 passed、1 skipped；API suite 为 152 passed。
- 全仓回归：`pnpm test` 为 1830 passed、1 skipped；仅保留既有 React `act(...)` warning。
- 进程故障演练：`pnpm local-app:shutdown-smoke`、`pnpm local-app:crash-smoke` 与
  `pnpm local-app:provider-retry-smoke` 均退出 0。shutdown/crash mock 都观察到首个 Provider 连接关闭，
  后继进程从同一临时 SQLite 接管原 Run 并完成；retry 演练的跨层等待与完成态未回归。
- 最终门禁：涉及文件的 focused Biome check 无错误；`pnpm check:ci`、`pnpm build` 与
  `git diff --check` 均退出 0。`check:ci` 仍只报告两个既有 non-null assertion warning，本机缺少
  `addlicense` binary 时许可证脚本按仓库既有设计跳过；Next 构建生成的 `next-env.d.ts` 路径已恢复为
  构建前开发态，未混入功能改动。

测试只使用合成数据、本地 fake/HTTP Provider、fake clock 和临时 SQLite；不读取 `.env.local-app`，
不调用真实 Provider，也不保存原始模型输出。该结论只覆盖内置 OpenAI-compatible adapter 的 durable Run：
同步 chat/tailor 的 HTTP disconnect 绑定、任意忽略 signal 的第三方 adapter、远端是否停止执行或计费、
Provider exactly-once/idempotency 与精确 transport/cost accounting 仍不在保证内。
