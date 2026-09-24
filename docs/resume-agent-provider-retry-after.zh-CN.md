# RA-014D / RA-015I：Provider Retry-After 有界等待

> 状态：Implemented for development（同主机 SQLite；不是 Enabled 或 Operational）
> 最后审阅：2026-09-24
> 范围：OpenAI-compatible retryable HTTP 响应的 `Retry-After` 归一化，以及 transport/durable
> 两层等待的组合；不改 UI、Run 状态、SQLite schema、Provider SDK、attempt 上限或总时间预算。

## 1. 用户结果与现有证据

当 Provider 以 429、503 等可重试状态明确要求稍后再试时，本地应用不应按更短的固定退避反复请求。
adapter 对 408、409、429 与 5xx 做有界 transport retry，RA-015H 又在 transport 预算耗尽后做
1s/2s/4s durable delivery retry。两层现已采用同一个安全、封顶的 `retryAfterMs` 建议，不再用更短的
本地等待覆盖 Provider 的明确要求。失败请求也可能计入限流窗口，因此该行为减少无意义的过早重试。

已有研究与代码证据：

- RFC 9110 §10.2.3 定义 `Retry-After = HTTP-date / delay-seconds`；
- 既有 Provider transport brief 已记录官方建议：有效 Header 优先于更短的本地指数退避，同时必须限制
  次数和总时间；该能力此前明确延期；
- 实现前，`LlmRequestError` 已是 adapter 到 Run workflow 的 typed failure interface，只含稳定摘要、
  reason、retryable 与可选 status；
- SQLite task 已能持久化最终 `available_at`，无需保存 Header、Provider body 或新增 schema。

## 2. 决策与 interface

- HTTP adapter 独占不可信 Header 的解析。只接受纯十进制非负秒数，或 `Date.parse` 可识别的 HTTP-date；
  空白、负数、小数、混合文本和无效日期都视为缺失。
- 所有有效值归一化为非负整数毫秒并封顶 30 秒。过去日期归一为 0；极大纯数字归一为 30 秒，而不是
  发生 Infinity/溢出。
- 只为 retryable HTTP status 读取该 Header；普通 4xx 与 200 协议错误不能借 Header 变成可重试错误。
- `LlmRequestError` 增加可选安全数字 `retryAfterMs`。构造器本身也做有限数、非负、整数化和 30 秒封顶，
  因而 workflow 不需要再次理解 HTTP 或信任任意调用者。
- transport attempt n 等待 `max(retryDelayMs * 2^(n-1), retryAfterMs ?? 0)`；最后一次失败不额外 sleep。
- durable delivery n 等待 `max(1000 * 2^(n-1), retryAfterMs ?? 0)`，仍受既有 30 秒上限；Store 只接收
  算好的 `availableAt`。
- 不把原始 Header、响应正文、URL、Prompt、凭证或模型输出写入错误、Run、task、日志或文档。

不新增 `RetryPolicy` interface 或 Store 方法：当前只有一个 HTTP adapter 和一个 Run delivery policy，
把解析留在 adapter、把等待选择留在各自模块具有更小 interface 和更好的 locality。

## 3. 状态转换

```text
retryable HTTP response
  -> parse and clamp Retry-After to safe retryAfterMs
  -> more transport attempts?
       yes: sleep max(transport backoff, retryAfterMs) -> next HTTP attempt
       no:  throw safe LlmRequestError(retryAfterMs)
  -> durable claimed Run catches typed retryable error
       -> release at now + max(delivery backoff, retryAfterMs)
       -> SQLite persists only available_at
```

非 durable Run 仍按 RA-015H 立即写安全终态；Header 不会制造一个不存在的恢复机制。

## 4. 已实现的逐行为 TDD 与验收

1. Tracer：本地 HTTP server 首次返回 `429 Retry-After: 1`、第二次成功；即使配置 transport delay 为 0，
   两次请求仍至少间隔约 1 秒。
2. Header contract：delay-seconds 与 HTTP-date 转成毫秒；过去日期为 0；超大值封顶 30 秒；invalid
   Header 不出现在 error，回退配置退避；非 retryable 400 忽略 Header。
3. 安全序列化：最终 retryable error 只暴露封顶的 `retryAfterMs` 数字，不包含原始 Header/响应 marker；
   constructor 对 NaN、Infinity、负数 fail closed。
4. Durable tracer：真实 SQLite 中 retryable error 携带 5 秒建议；t+4999ms 不可领取，t+5000ms 可领取
   并完成同一 Run；关闭重开数据库后边界保持。
5. 复合边界：本地指数退避比 Header 更长时不能被缩短；30 秒 cap、三次 delivery 上限、非 durable 和
   retryable=false 回归不变。
6. 可执行组合验证：生产 API entry、真实 HTTP adapter、临时 SQLite worker 与本地 mock 组合；连续三个
   `503 Retry-After: 2` 使两次 transport 间隔和一次 durable delivery 间隔都不少于 1.9 秒，原 Run 最终
   完成且只发出一个 draft 请求。

## 5. 明确不在本切片

- 本切片不含正在途 transport 的 deadline-aware cancellation；RA-015J 只保证 task 截止点后不开始新的
  durable delivery，后续 RA-015K 已补齐内置 adapter 的 durable Run 取消；失败 HTTP attempt 的持久化
  费用计量仍缺；
- jitter、Provider-specific quota code、`x-should-retry`、熔断、DLQ/redrive、指标告警；
- exactly-once、请求幂等键、同步请求断连取消、多主机协调或真实 Provider 故障演练。

## 6. RED → GREEN 与验证记录

- RED（transport tracer）：`429 Retry-After: 1` 下两次请求只间隔约 4ms。GREEN：transport 取配置指数
  退避与安全 Header 值的较大者；本地 HTTP 测试稳定观察到不少于 900ms 的间隔。
- RED（HTTP-date）：最终 503 错误丢失未来 HTTP-date。GREEN：adapter 接受 IMF-fixdate、RFC850 与
  asctime 形式，按当前时间归一化并封顶；focused test 观察到约 3.5–5 秒的剩余等待。
- RED（非 JSON 503）：分类保留 retryable status，却丢失 Header。GREEN：JSON 与非 JSON retryable
  响应共用同一安全解析结果；7 秒建议进入 typed error，原始 body 不进入错误。
- RED（严格语法）：宽松 `Date.parse` 曾把 `-1`、`1.5` 当成日期。GREEN：先验证纯十进制秒数或明确的
  HTTP-date 语法，再解析；invalid 值回退本地策略。超大值、构造器 NaN/Infinity/负数、普通 400 和
  安全序列化边界均有回归测试。
- RED（durable tracer）：携带 5 秒建议的 retryable error 仍在本地 1 秒窗口恢复。GREEN：RunService
  取两种等待的较大值并只把最终 `available_at` 交给 Store；真实 SQLite 在关闭重开后 t+4.999s 仍不可
  领取，t+5s 恢复并完成。500ms 建议的既有测试仍等满本地 1 秒，证明 Header 不能缩短本地退避。
- 可执行组合验证：`pnpm local-app:provider-retry-smoke` 精确观察 4 个 JobSpec 请求、1 个 draft 请求；
  前三个 503 均带 `Retry-After: 2`，两次 transport gap 和一次 durable gap 均不少于 1.9 秒。等待期间
  公开 Run 为 `analyzing_jd` 且不含私密 marker，最终 YAML 包含合成候选人姓名。

2026-09-24 当前验证：focused adapter/SQLite/Run 共 108 passed；Agent 包 332 passed、1 skipped；全仓
1820 passed、1 skipped；provider-retry、SIGKILL crash 与 SIGTERM shutdown smoke 均退出 0；
`pnpm check:ci`、`pnpm build` 与 `git diff --check` 通过。`check:ci` 只报告两条既有 non-null assertion
warning，本机缺少 `addlicense` binary 时许可证脚本按既有逻辑跳过；Next 构建生成的
`packages/agent-web/next-env.d.ts` 已恢复为原开发态引用。

所有证据只使用本地 HTTP mock、合成数据、fake clock 与临时 SQLite；未读取 `.env.local-app`，未访问
真实 Provider、真实简历或真实凭证。RA-015J 已补充持久化 delivery admission deadline，RA-015K 又补齐
同主机 durable Run 的在途取消；精确费用预算与 operational evidence 仍缺，因此不能称为 Operational。
