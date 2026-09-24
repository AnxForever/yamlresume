# Resume Agent Provider 传输可靠性 Feature Brief（RA-014 / Unit 6A-H）

## 1. 状态与范围

- Feature ID：`RA-014`
- 能力：OpenAI-compatible Provider 传输可靠性
- 当前交付状态：**Implemented**（2026-09-16，本地实现和验证完成，未上线）
- 当前证据覆盖：**partial**
- 历史研究缺口：**backfilled**；继承的 adapter 已有 timeout 和 retry，但此前没有
  逐类错误契约、脱敏契约或 abort/socket 生命周期证据；本切片已补齐开发级证据，
  生产证据仍是明确缺口
- 用户结果：Provider 短暂故障可在严格上限内恢复；不能恢复时，调用方得到稳定、
  可机器判断且不泄露请求或响应内容的错误
- 范围仅限 `OpenAICompatibleClient` 的配置、单次 HTTP 交换、传输重试、
  Provider 响应解码和本地可重复验证；不改工作流、API、前端或模型 Repair

本文是开发级 Feature Brief 和学习记录，不是生产运行手册。本文的
`Implemented` 只会表示本地实现和 fake/local-server 证据；没有真实 Provider、
生产限流或线上故障演练证据时，不得标记为 `Operational`。

### 1.1 2026-09-24 本地运行观察

在一个依赖小写 `https_proxy` 出网的 Node 22.21.1 环境中，`curl` 访问默认 OpenAI endpoint
得到预期的未鉴权 401，但 Node 内建 `fetch` 直连为 `ETIMEDOUT`，API 对外稳定返回
`502 llm_request_failed / LLM network request failed`。以
`NODE_OPTIONS=--use-env-proxy` 重启后，网络错误消失，API 收到 Provider 的 401 并返回稳定的
`LLM request failed with HTTP status 401`；没有产生 token。当前环境只有一个非空
`OPENAI_API_KEY`，没有与它匹配的 `OPENAI_BASE_URL` 或 `OPENAI_MODEL` 配置，因此该证据只证明
环境代理与安全错误路径，不证明凭据有效或真实模型运行成功。运行 README 已补充代理启动条件；
不得通过记录 key、Provider body 或放宽 401 来“修复”配置问题。

## 2. 问题定义

现有实现已经设置 `AbortController`、重试上限和状态码分类，但仍有以下风险：

1. Provider 的原始 `error.message`、JSON 解析器消息或底层网络错误消息会直接进入
   `LlmRequestError`，可能携带响应正文、URL 或其他不受信任信息；
2. timeout 只由代码形状暗示，测试没有证明请求真的被 abort；
3. 网络失败、非 JSON HTTP body、200 协议损坏和模型 content JSON 语法错误没有
   独立、稳定的机器可读原因；
4. 408/409/429/5xx 与普通 4xx 的请求次数没有逐项证据；
5. 测试 server 的连接与 timer 清理策略不明确，失败用例可能留下 keep-alive socket
   或长 timer；
6. 传输 retry 和 Structured Output Repair 容易被混为同一种“再试一次”，导致成本、
   telemetry 和失败语义失真。

成功标准是让现有 `OpenAICompatibleClient / LlmClient` 调用方式保持不变，同时把上述
复杂度收进 adapter 这一深模块：调用方只需理解 `completeJson`、配置约束、成功
metadata 和一组安全的 `LlmRequestError` 原因，不需要复制 Provider 分类逻辑。

## 3. 研究问题与证据

### 3.1 Node / WHATWG Fetch abort

本切片运行时检查为 Node `v22.21.1`、内置 Undici `6.22.0`。以下来源于
2026-09-16 查阅：

- Node.js v22 文档说明全局 `fetch` 是浏览器兼容实现、底层基于 Undici；
  `AbortController.abort()` 会触发 signal，`AbortSignal.timeout(delay)` 会在延迟后
  abort。Node 还要求 abort listener 使用 `{ once: true }` 以免泄漏。
- WHATWG Fetch Living Standard（页面标注 2026-08-20 更新）规定 abort 会把 fetch
  controller 置为 `aborted`，无自定义原因时使用 `AbortError` `DOMException`，并把
  进行中的网络操作变成 aborted network error。
- 本地安全实验：本地 HTTP server 先发送未完成 JSON，20ms 后调用
  `controller.abort()`；Node 客户端观察到 `AbortError`，server 观察到 request abort
  和未完成 response close。实验未访问外网、未读取凭证。

**采用：** 每次 attempt 创建一个 controller 和一个有界 timer；timer 回调先记录
timeout 状态再 abort。`finally` 无条件 `clearTimeout`。测试不仅断言错误类型，还等待
本地 server 观察到未完成连接关闭。

**拒绝：** 只用 `Promise.race` 制造超时。它会让调用方提前失败，却不能证明底层
HTTP 被取消。

### 3.2 Provider HTTP 与限流

以下官方资料于 2026-09-16 查阅：

- Anthropic 官方 Python SDK 文档：默认有限重试 connection error、408、409、429
  和 `>=500`，普通 4xx 不在默认重试集合；默认重试 2 次并使用短指数退避。
- OpenAI 官方 Error Codes：500/503 建议短暂等待后重试；429 既可能是暂时限流，
  也可能是余额、配额或 spend limit，后者重试不能恢复。
- OpenAI 官方 Rate Limits：自建 HTTP client 应优先遵守有效 `Retry-After`，否则使用
  带 jitter 的指数退避，并同时限制次数和总时间；失败请求也计入分钟限额。

**采用（本切片）：** 与成熟 SDK 一致，网络错误、client timeout、408、409、429、
全部 5xx 可重试；其他 4xx 不重试；`maxRetries` 表示首次请求后的额外尝试数，范围
0–5，故总 attempt 永远不超过 `maxRetries + 1`。延迟使用由 `retryDelayMs` 起始的
有界指数增长。RA-014D 现进一步接受 RFC 9110 的 delay-seconds 与三种 HTTP-date
格式，把有效值归一化为 0–30 秒的安全整数毫秒；每次 transport 等待取本地退避与
Provider 建议的较大值。总 attempt 上限保持不变。

**适配：** OpenAI-compatible 服务没有统一、可信的错误 `code` 方言。为避免依赖或
暴露 Provider 原始错误正文，本切片对所有 429 做有界重试，不读取正文来判断 quota。
这可能为永久 quota 错误多花少量请求，但不会无限重试。

### 3.3 证据可推翻点

若真实兼容 Provider 证明某个 409 是确定性业务冲突、某类 5xx 带有明确
`x-should-retry: false`，或 429 有稳定且非敏感的机器 code，应把状态规则收窄；不能
仅凭本地测试把当前跨 Provider 折中视为永恒正确。

## 4. 契约与关键决策

### 4.1 配置契约

- `apiKey`、`baseUrl`、`model` 必须包含非空白字符；错误不得回显配置值；
- `timeoutMs` 必须是有限正数；
- `maxRetries` 必须是 0–5 的整数；
- `retryDelayMs` 必须是有限非负数；
- 默认值保持兼容：timeout 60s、max retries 2、base delay 250ms。

### 4.2 HTTP / 网络分类

| 观察结果 | `reason` | 可重试 | 请求次数规则 |
| --- | --- | --- | --- |
| client timer 触发 abort | `timeout` | 是 | 最多 `maxRetries + 1` |
| fetch/读取 body 的网络失败 | `network_error` | 是 | 最多 `maxRetries + 1` |
| 408、409、429、5xx，body 为 JSON | `http_status` | 是 | 最多 `maxRetries + 1` |
| 其他非 2xx，body 为 JSON | `http_status` | 否 | 1 |
| 非 2xx，body 不是 JSON | `response_body_invalid_json` | 由 HTTP status 决定 | 同对应 status |
| 200，HTTP body 不是 JSON | `response_body_invalid_json` | 否 | 1 |
| 200，缺少非空字符串 content | `response_content_missing` | 否 | 1 |
| 200，content 不是合法 JSON | `response_content_invalid_json` | 否 | 1 |

### 4.3 为什么不重试 200 协议损坏

本切片明确**不重试** HTTP 200 但 outer body、`choices/message/content` 或 content JSON
损坏的响应。此时 Provider 已完成并可能计费一次模型调用；官方 SDK 的默认瞬态集合
也以连接/timeout/HTTP status 为依据，而不是把成功响应的任意解析错误当传输失败。
盲目重复相同请求会掩盖 Provider 协议缺陷，并把不可预测成本归入“transport retry”。

这是一项保守的失败安全决策，不表示此类结果永远不可恢复。若后续 Eval 证明 JSON
语法 Repair 有明确收益，应设计显式、单独计数并带反馈的新调用，而不是暗中扩张
transport retry。

### 4.4 Transport retry 与 Structured Output Repair

| 机制 | 输入是否已有可信 JSON 值 | 是否改变请求 | 计数 |
| --- | --- | --- | --- |
| Provider transport retry | 否；请求未得到可靠应用响应 | 原请求等价重发 | `metadata.attempt` / transport attempts |
| Structured-output Repair | 是；JSON 可解析但不符合领域 Schema | 新 Prompt，携带安全的校验反馈 | model calls / repair attempts |

Repair 由 `structured-output.ts` 负责；本切片不修改其接口。传输层不能把 Provider 原始
body 上送给 Repair，也不能把 Schema 失败算作 transport retry。

### 4.5 错误安全

`LlmRequestError` 只允许包含：稳定英文摘要、机器可读 `reason`、`retryable` 和可选
HTTP `status`，以及可选、非负、封顶 30 秒的整数 `retryAfterMs`。其 message、stack
和 JSON 序列化不得包含：

- API key 或 Authorization header；
- system/user Prompt、JD、简历或图片 Data URL；
- 原始 HTTP body；
- Provider 原始 `error.message`；
- 底层 fetch/JSON parser 的原始 message 或 cause。

原始请求和响应只在当前函数内存中用于发送/解析，不进入错误对象、日志或测试
snapshot。本模块不新增日志。

## 5. 状态机

```text
construct
  ├─ invalid config → LlmConfigurationError
  └─ valid → ready

ready → attempt N → start timer + fetch
  ├─ valid 200 + valid content JSON → clear timer → success(metadata.attempt=N)
  ├─ timeout/network/retryable status（含该 status 的非 JSON body）
  │    → normalize Retry-After when present
  │    → clear timer → N < max attempts ? max(local backoff, retryAfterMs) → attempt N+1
  │                                      : safe LlmRequestError(retryAfterMs)
  └─ ordinary 4xx / 200 invalid body / missing content / invalid content JSON
       → clear timer → safe LlmRequestError（无重试）
```

每个 attempt 的 timer 都在 `finally` 清理。测试 server 记录所有 socket，在 teardown
中先停止接收连接并销毁仍存活 socket，避免 keep-alive、悬挂响应或失败断言留下句柄。

## 6. 失败模式与边缘案例

1. timeout 可能发生在等待 headers 或读取 body 时；两者都由同一个 signal 中断；
2. timeout/连接中断存在“Provider 已处理但客户端未收到”的歧义，重试可能重复计费；
3. server 返回 HTML/text 错页；分类先保留 HTTP status 的 retry 语义，不回显正文；
4. server 返回 JSON `null`、array 或缺 choices；200 下属于协议损坏且不重试；
5. content 是空字符串、null 或非字符串；统一为 content missing；
6. content 是 Markdown `json` fence；继续兼容剥离一层 fence；
7. content JSON 语法错误可能包含私密片段；parser message 不进入错误；
8. 429 可能是临时限流或永久 quota；当前统一有界重试是兼容性折中；
9. `maxRetries=0` 只发送一次；`retryDelayMs=0` 不创建不必要的退避 timer；
10. `Retry-After` 可能是负数、小数、混合文本、过去日期或极大数字；invalid 值忽略，过去日期为 0，
    有效值封顶 30 秒，普通 4xx 与 200 协议错误不读取该建议；
11. teardown 时 server 仍有 keep-alive socket；显式销毁，不能只依赖默认 close 行为。

## 7. 本切片采用、拒绝与延期

### 7.1 采用

- 保持 `OpenAICompatibleClient / LlmClient` 调用方式；
- 在 `LlmRequestError` 增加本模块内的稳定 `reason`；
- 按 attempt 新建 AbortController、硬上限重试、安全错误、0-delay 快速测试；
- 本地 HTTP server / socket-destroy fake，不读真实凭证、不访问真实 Provider。

### 7.2 拒绝

- 回显 Provider 原始 message 来换取诊断细节；
- 对所有异常无差别重试；
- 200 协议损坏盲重试；
- 引入 Provider SDK、retry 依赖或 Agent 框架；
- 用长时间真实 sleep 证明退避。

### 7.3 后续补齐与明确延期

- **durable Run 在途硬截止：已由 RA-015K 补齐。** RA-014D / RA-015I 已实现 `Retry-After` 的
  秒数/HTTP-date、30 秒封顶与 transport/durable 组合等待，RA-015J 禁止截止点后开始新的 durable
  delivery；RA-015K 进一步让 close、失租或 retry deadline 中断内置 adapter 的 fetch/body/retry wait。
  同步 HTTP disconnect 绑定与远端停止执行证明不在该保证内。
- **精确费用预算：延期。** 失败 attempt 仍没有持久化费用元数据。详见
  [`Provider Retry-After brief`](./resume-agent-provider-retry-after.zh-CN.md)与
  [`Provider cancellation brief`](./resume-agent-provider-cancellation.zh-CN.md)。
- **随机 jitter：延期。** 生产需要避免 herd effect，但需可注入 random/clock seam 才能
  确定性验证；本切片只实现有界指数 delay。
- **熔断：延期。** 需要跨请求共享状态、并发语义、half-open 恢复、指标和实例范围，
  超出单次 adapter 调用；当前不能声称具备故障隔离。
- Provider-specific quota code、`x-should-retry`、幂等 key、总 retry time budget、集中
  metrics/trace 与真实模型故障演练均延期。

## 8. 一次一个行为的 RED → GREEN 计划与记录

实现严格按垂直切片推进；每一项回到 GREEN 后才加入下一行为：

1. **成功 metadata（characterization GREEN）：** 扩充既有成功测试，确认 data、model、
   usage、request ID、attempt；现有实现已满足，不伪造 RED。
2. **Timeout RED → GREEN：** RED 暴露 timeout 没有稳定 reason 且 message 含配置细节；
   GREEN 增加 `timeout` reason 和固定摘要，保留 attempt 硬上限，并由 server 的两个
   未完成 response close 证明两次请求都实际 abort。
3. **网络失败 RED → GREEN：** socket 在 headers 前销毁时，RED 得到不安全的底层
   fetch message；GREEN 归一为 `network_error`，3 次请求后稳定失败。随后增加 body
   读取中断切片；RED 发现 `response.json()` 把断流误报为 JSON 语法错误，GREEN 改为
   先读取 text、再单独 `JSON.parse`，使断流进入 network retry。
4. **HTTP status RED → GREEN：** 408/409/429/500/503 和 400 的 RED 暴露 Provider
   原始 message 且缺机器 reason；GREEN 只保留安全 status 摘要，前五类各请求 2 次，
   400 只请求 1 次。
5. **非 JSON body RED → GREEN：** 503/400/200 的 RED 暴露 JSON parser message 且
   reason 不稳定；GREEN 使用 `response_body_invalid_json`，分别证明请求 2/1/1 次。
6. **缺 content RED → GREEN：** 缺 choices、缺 message content 和 JSON `null` 的 RED
   被当作可重试输出或网络错误；GREEN 统一为不可重试 `response_content_missing`，
   每例 1 次请求。
7. **content 非法 JSON RED → GREEN：** RED 会盲重试并可能暴露 parser message；
   GREEN 固定为不可重试 `response_content_invalid_json`，只请求 1 次。
8. **Markdown fence（characterization GREEN）：** 既有兼容逻辑继续返回解析后的 data，
   没有伪造 RED。
9. **配置 RED → GREEN：** 数值非法项的 characterization 已通过；空白 key/base URL/
   model 的 RED 未被拒绝，GREEN 在构造期拒绝，并继续覆盖 timeout、maxRetries、
   retryDelayMs 的范围和有限数约束。
10. **脱敏与序列化 RED → GREEN：** 注入 key、私密 Prompt、原始 body 和 Provider 原始
    message；内容型断言已安全，但 RED 显示原生序列化缺少稳定 message 契约；GREEN
    通过显式 `toJSON` 仅输出 name/message/reason/retryable/status；RA-014D 后只再允许安全数值
    `retryAfterMs`。全部注入值在 message、stack 和序列化字符串中均不可见。
11. **Retry-After RED → GREEN（2026-09-24）：** 1 秒建议最初未影响 transport 间隔；未来
    HTTP-date 和非 JSON 503 又分别暴露丢失路径，`-1`/`1.5` 暴露宽松日期解析。GREEN 将解析集中在
    adapter，并只通过安全 `retryAfterMs` 穿过 typed error seam；37 个 adapter tests 与 2 秒本地组合
    smoke 证明有效建议不能被较短本地退避覆盖。完整过程见独立 Feature Brief。

实现中还完成两个 GREEN 后重构：0 delay 直接 resolve，非零 delay 改为 attempt 有界的
指数增长；未知内部异常不再拼接原始 message，也不误当作可重试网络错误。所有 payload
metadata 字段改为从 `unknown` 做运行时读取，避免类型断言把损坏值带给调用方。

测试可靠性修正：最初 20ms timeout 在负载下可能在第二条连接到达 server 前触发，改为
仍然短且有界的 100ms；最初用错误 Content-Length 模拟断流会等待 Undici 连接超时，
改为写入一个 chunk 后主动销毁 response，使断流测试稳定在毫秒级。所有测试 server
绑定 `127.0.0.1`、跟踪 socket，并在 teardown 销毁残留连接。

## 9. 验收与验证矩阵

| 行为 | 证据 | 当前状态 |
| --- | --- | --- |
| success data/model/usage/requestId/attempt | local server test | Implemented |
| timeout abort + hard cap | server observes 2 disconnects + request count 2 | Implemented |
| network retry exhausted | socket destroy before headers/during body + counts | Implemented |
| status retry matrix | 408/409/429/500/503 = 2；400 = 1 | Implemented |
| bounded `Retry-After` | seconds/date/invalid/cap/privacy tests；2s executable timing smoke | Implemented for development |
| non-JSON retry/non-retry | 503 = 2；400/200 = 1 | Implemented |
| missing/invalid content | 200 local responses + exact count/reason | Implemented |
| Markdown fence | local response | Implemented |
| invalid config | 10 table-driven constructor cases | Implemented |
| no secret leakage | error message/stack/JSON adversarial checks | Implemented |
| no external I/O/credentials | loopback-only server helper inspection | Implemented |

2026-09-16 验证记录：

```bash
pnpm agent test src/llm/openai-compatible.test.ts
pnpm --filter @yamlresume/resume-agent exec tsc --noEmit
pnpm exec biome check packages/resume-agent/src/llm/openai-compatible.ts packages/resume-agent/src/llm/openai-compatible.test.ts
git diff --check
```

- `pnpm agent test src/llm/openai-compatible.test.ts`：1 个文件、29 个测试通过；
- `pnpm --filter @yamlresume/resume-agent exec tsc --noEmit`：通过；
- `pnpm exec biome check ...`：2 个目标文件通过，无需修复；
- `git diff --check`：通过；目标 3 文件的 staged diff 检查也通过。

2026-09-24 增量验证：adapter focused suite 37 passed；与 SQLite/Run focused suite 合计
108 passed；`pnpm local-app:provider-retry-smoke` 观察两次 transport 和一次 durable gap 均不少于
1.9 秒；Agent 包 332 passed、1 skipped，全仓 1820 passed、1 skipped。完整门禁与限制记录见
[`Provider Retry-After brief`](./resume-agent-provider-retry-after.zh-CN.md)。

## 10. 证据台账

| Feature ID | 生命周期 | 用户结果 | 交付 | 主要/独立证据 | 决策 | 覆盖 | 历史缺口 | 剩余缺口 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RA-014-A | config | 启动前拒绝危险配置 | Implemented | 本地源码；10 个构造测试 | adapt | covered | backfilled | 未验证 env/部署配置 |
| RA-014-B | timeout/network | 短暂断连有界恢复且 socket 被取消 | Implemented | Node/WHATWG；本地 abort 实验；headers 前/读取 body 测试 | adopt | partial | backfilled | 真实网络、重复计费歧义未验证 |
| RA-014-C | HTTP retry | 状态分类一致、次数有上限 | Implemented | Anthropic SDK、OpenAI 官方文档；状态矩阵测试 | adapt | partial | backfilled | 429 subtype、Provider 方言和精确费用预算；Retry-After/在途取消由 RA-014D/RA-015K 实现 |
| RA-014D / RA-015I | Header-aware wait | Provider 建议不会被更短的 transport/durable 本地退避覆盖 | Implemented for development | seconds/date/invalid/cap/privacy focused tests；SQLite restart；2s executable smoke | deepen existing seams | partial | RA-014C 明确延期 | 精确费用、真实 Provider、jitter 与 operational evidence；delivery admission deadline/cancellation 由 RA-015J/K 实现 |
| RA-014-D | protocol decode | 损坏响应稳定、安全失败 | Implemented | 相邻 structured-output 契约；非 JSON/missing/invalid 测试 | adapt | covered | backfilled | 真实 Provider 异常样本未验证 |
| RA-014-E | privacy | 错误不暴露请求/响应内容 | Implemented | 本地源码审计；四类 secret 对抗测试 | adopt | partial | backfilled | 上层日志不在本切片 |
| RA-014-F | resource cleanup | 测试不留 timer/socket 句柄 | Implemented | Node abort 行为；socket 跟踪和 teardown；目标测试退出 | adopt | partial | backfilled | CI 多平台与高并发证据未验证 |

最后复核基线：Node `v22.21.1`、Undici `6.22.0`、Vitest `4.0.16`，日期
2026-09-16。

## 11. 参考资料

- Node.js v22 Global objects（AbortController、AbortSignal、fetch）：
  <https://nodejs.org/docs/latest-v22.x/api/globals.html>
- WHATWG Fetch Living Standard：<https://fetch.spec.whatwg.org/>
- Anthropic Python SDK（Errors、Retries、Timeouts）：
  <https://platform.claude.com/docs/en/cli-sdks-libraries/sdks/python>
- OpenAI Error Codes：
  <https://developers.openai.com/api/docs/guides/error-codes>
- OpenAI Rate Limits：
  <https://developers.openai.com/api/docs/guides/rate-limits>
- 相邻模块设计：`docs/resume-agent-structured-output-reliability.zh-CN.md`
