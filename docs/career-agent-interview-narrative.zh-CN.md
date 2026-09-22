# Career Agent 开发叙事与问题记录

> 用途：项目复盘与面试复述。每个结论都指回仓库里的文档、测试或提交；没有来源的话不写。
> 最后复核：2026-09-22。状态词汇沿用路线图：`Idea / Planned / Implemented / Enabled / Operational`。
> 本文不含候选人真实数据、API Key、原始模型 completion。数字口径见 `node scripts/project-metrics.mjs`。

## 0. 这份文档怎么用

- §1–§3 是三种长度的项目自述：30 秒、2 分钟、白板。
- §4 是十个「问题 → 根因 → 修法 → 证据 → 追问预演」的故事，按被追问的概率排序。
- §5 是这个项目做错过什么。面试官会问，先自己说。
- §6 是学习指南 12.1 能力清单的逐条自答，附代码位置。
- §7 是本仓库里 Session / Run / State / Checkpoint / Memory 的确切含义，避免和通用术语混用。

## 1. 三十秒版本

我做了一个 Agent，把岗位描述和候选人的原始材料变成一份定制简历。难点不在让模型写得流畅，
而在于**流畅但错误的条目，在面试官追问之前和正确的一模一样**。所以我把模型当不可信组件：
每条产出必须指回候选人的源材料，指不回就丢弃；三个 LLM 边界全部做运行时 Schema 校验，
至多一次 Repair；正确性用确定性 Eval 度量，不用 LLM 打分。真实模型 campaign 从 0/3 通过
做到 4/6，需求覆盖率从 0.37 到 0.57。样本只有 3 个合成案例，我把它当基线，不当成绩。

## 2. 两分钟版本

**架构。** 固定阶段的有界工作流，不是 ReAct 循环：输入提取 → 候选人归一化 → JD 结构化分析
→ 确定性需求匹配 → 证据约束草拟 → Schema 与不可变事实校验 → Diff / 质量报告 → 确定性渲染。
只有三个 LLM 边界（归一化、JD 分析、草拟），其余全是普通代码。选有界工作流是因为成本、
延迟、失败和验证都能推理；工具调用只在具体能力需要时再引入。

**可靠性层。** 传输层（timeout、429/5xx 有界重试）、JSON 语法层、领域 Schema 层三种失败分开
处理和计数；Schema 失败先保守归一化再至多一次 Repair。每次 Run 有模型调用数和 token 上限。

**执行层。** SQLite durable Run Store：revision CAS 防 lost update，transactional outbox 保证
Run 和任务原子写入，lease 心跳加 generation fencing 防止失租 worker 改写公开 Run，常驻
poller 捡起释放和迟到的任务。Human-in-the-loop：缺关键事实时暂停成 `needs_input`，回答
按幂等键接收，从正确阶段恢复。

**评测层。** 版本化 EvalCase 契约，断言包括岗位关键词金标、需求覆盖率、必备项覆盖率、
禁止出现的 warning；campaign 做重复采样并报 Wilson 区间；盲化人评契约只收分类和 issue code。
报告只存 case ID、布尔断言、耗时和稳定失败码，不存输入、简历或 completion。

**交付状态。** 全部 `Implemented for development`。真实 Provider 通道打通，质量与稳定性
未达 `Operational`。已部署到一台个人服务器（Nginx + systemd + SQLite）。

## 3. 白板图

```text
JD + 候选人材料
      │
      ▼
文件提取与候选人归一化 ── LLM 边界 1 + Schema
      │
      ├──→ 证据索引（每条事实一个稳定 evidence ID）
      │                           │
      ▼                           │
JD 结构化分析 ────────── LLM 边界 2 + Schema
      │                           │
      ▼                           │
确定性需求匹配 ◀──────────────────┘
      │
      ▼
证据约束草拟 ────────── LLM 边界 3 + Schema
      │      selectedEvidenceIds 只能来自证据索引
      ▼
Schema + 不可变事实校验 → Diff / QualityReport → YAML / HTML / LaTeX / PDF / DOCX …
```

运行状态机（路线图 §3.4）：`queued → ingesting_inputs → normalizing_candidate → analyzing_jd
→ matching_evidence → drafting → validating → rendering → evaluating → completed / failed`，
其中归一化、匹配、校验三处可以进入 `needs_input` 再回到原阶段。

## 4. 十个故事

### 4.1 HTTP 200 和 `JSON.parse` 成功，都不代表输出能进业务流程

**问题。** 接真实 OpenAI-compatible 服务后，返回的是合法 JSON，但结构不对：`job_title`
而不是 `targetTitle`；`requirements` 是字符串数组而不是对象数组；`importance`、`category`
返回枚举之外的值；整个对象包在 `data` / `result` / `output` 里；必填字段缺失。服务接受了
structured output 参数，底层模型或代理并没有严格遵守。

**根因。** 把「传输成功」「JSON 语法成功」「领域 Schema 成功」当成一件事。

**修法。** 三层分工。Provider adapter 只负责传输：timeout、408/409/429/5xx 有界重试，
清理已知 Markdown fence，最终抛出带稳定 reason 的 `LlmRequestError`（`timeout`、
`network_error`、`http_status`、`response_body_invalid_json`、`response_content_missing`、
`response_content_invalid_json`）。结构化输出层顺序固定：先直接 Zod 校验；失败再做一层
已知 envelope 解包和**保守**归一化，只映射已经观察到的偏差；再失败才做至多一次 Repair，
Repair 是携带验证反馈的**新**模型调用，不是重复请求。telemetry 分别记录 `repairAttempts`
和 `normalizedOutput`，两种「再试一次」永远分开计数。

**证据。** [结构化输出可靠性](./resume-agent-structured-output-reliability.zh-CN.md) §2–§5、§11；
[Provider 传输可靠性](./resume-agent-provider-transport-reliability.zh-CN.md) §4.2 分类表；
`packages/resume-agent/src/llm/structured-output.ts`、`openai-compatible.ts` 及相邻测试。

**追问预演。**
- 为什么 Repair 只允许一次？成本要可预算；无限重试会把系统性 prompt 问题藏起来；
  一次 Repair 修不好的通常不是随机噪声。
- 为什么不直接用 Provider 的 strict JSON Schema？不是所有兼容服务都支持，上游代理会静默
  放宽；本地校验是不依赖供应商的最后防线（§11.1）。
- 传输重试和 Repair 的区别一句话：前者重复同一个请求，后者是带反馈的新请求；混在一起
  就算不清真实成本和可靠性。

### 4.2 模型给自己算的覆盖率是幻觉

**问题。** 第一次真实 DeepSeek campaign：3 个案例 0 通过，2 个断言失败，1 个执行失败。
翻 runner 发现它只断言 `targetTitle`、coverage 和 warning code，而 coverage 是基于模型
自己产出的 `JobSpec` 算的。模型漏掉 JD 里的重要技能，coverage 反而更高。

**根因。** 评分面和被评对象同源。另外，词法匹配器拿整句需求「Advanced SQL on large
datasets」去和证据做子串匹配，匹配不上就判 missing。

**修法。** 三件事一起做。(a) 增加 `requiredJobKeywords` 金标断言：从公开 JD 人工提炼、写在
case 里、模型碰不到。(b) JD 分析 prompt 改成「原子需求，不合并无关子句，每条 1 到 5 个可
字面匹配的 canonical keywords」。(c) 匹配器增加有意义 token 匹配，并过滤 `experience`、
`strong`、`team` 这类泛词，避免虚匹配。

**证据。** 序列：0/3（覆盖率 0.365）→ 1/3（passRate 0.3333，Wilson 95% [0.06, 0.79]）→
同一 prompt 版本重复 2 轮 4/6（0.6667，[0.30, 0.90]，覆盖率 0.565）。两次剩余失败是
Provider 瞬态，受控复跑三个案例都能完成。见[公开岗位派生评估](./resume-agent-public-job-evaluation.zh-CN.md)
§3.1、§5、§9；提交 d4e98af；`match.test.ts` 用例「matches an explicit keyword inside a
longer atomic requirement」。

**追问预演。**
- 为什么不上 embedding？先要一个确定性、可解释的基线。现在的词法匹配器就是下一步语义
  检索切片的 before，同一套 campaign 直接给 after。
- 泛词列表会不会过拟合这 3 个案例？会。这是已知缺口，扩大 corpus 之前不能说它泛化。
- 为什么只有 3 个案例？公开 JD 只提炼需求摘要不复制原文，候选人完全合成；真实简历去掉
  姓名不等于匿名化（评估框架 §6）。

### 4.3 模型漏字段时，补默认值，但不编造

**问题。** 真实模型经常漏掉可选集合或给出不完整条目：`education` 整个缺失、`skills` 条目
没有 name、可选条目缺必填子字段。Zod 直接拒绝，整个 Run 返回 422。

**根因。** Schema 把「模型没写」和「模型写错」当同一种失败。业务上，「没有教育经历」是
合法状态，「编一段教育经历」才是灾难。

**修法。** 归一化层分三类处理。缺失集合 → 默认空数组并记 warning。不完整的可选条目 →
剔除，并在结果上标记 `omittedOptionalEntries`。摘要缺失 → 从已提取的源文本回退前 1024
个字符，并标记 `usedSourceSummary`；回退内容来自源材料，仍然可追溯。必填事实缺失 →
走 HITL 提问，绝不填。

**证据。** 提交 5ffe8c7、f2a6838、04a77ec、1928dba、ebde5e5 及其测试名。部署记录：
`20260916T120500` 之后同一 RTF 请求从 422 变为 `200 completed`，但 `mustHaveCoverage = 0`，
因为材料本身只有姓名、摘要和少量技能线索，系统保留告警没有编造；`20260916T121500` 加入
源文本回退后 `requirementCoverage = 1`、`keywordCoverage = 0.6`（[后端文档](./resume-agent-backend.md)
证据台账、提交 cb6e94b、842cb6a）。

**追问预演。** 这不就是放宽校验吗？不是。姓名、日期、公司这类不可变事实仍然严格；放宽的
只是可选集合的存在性。每次容错都留 telemetry 标记，Eval 看得见容错发生了多少次。

### 4.4 真实模型第一次跑不通，锅不在模型

**问题。** OpenAI-compatible 和 Gemini-compatible 全部返回 `network_error, retryable`；
同一台机器 `curl` 正常。

**根因。** 三层叠在一起。Node 22.21.1 默认 `fetch` 不读代理环境变量；开启
`--use-env-proxy` 后变成 401 / 400，说明凭证过期或兼容配置不可用；部署时旧进程继承的
`OPENAI_*` 变量优先级高于专用环境文件，又是一个 401。

**修法。** 诊断顺序固定：先用无认证的 `/models` 探针证明网络可达（预期 401），再逐个
Provider。只在受控 Eval 命令里启用 Node 标记为 Experimental 的 `EnvHttpProxyAgent`，
不静默改生产客户端默认行为。systemd 使用专用 `EnvironmentFile`，启动前清除继承变量。

**证据。** [公开岗位派生评估](./resume-agent-public-job-evaluation.zh-CN.md) §9；
[单机部署](./resume-agent-single-host-deployment.zh-CN.md)「现状证据」。

**追问预演。** 为什么不在客户端里直接读代理变量？实验性 API 不进生产路径；把环境问题
和产品行为分开，下次同样的症状才能一步定位。

### 4.5 小样本不用 Wald 区间

**问题。** 3 个案例跑一次，「通过率 33%」没有任何不确定性描述；重复之后要说清同一个
case 是否稳定。

**根因。** 正态近似（Wald）区间在样本小、比例接近 0 或 1 时给出越界的边界。

**修法。** 用 Wilson score interval（NIST 手册推荐），双侧标准正态临界值，结果限制在
[0, 1]，统一四位小数。通过率分母是每次执行尝试；执行失败不冒充 0 分样本；延迟统计包含
失败尝试，因为那是用户真实等待的时间。区间只描述当前观测的不确定性，不是未来成功率。

**证据。** [公开岗位派生评估](./resume-agent-public-job-evaluation.zh-CN.md) §6.1；
`campaign.test.ts`：1/2 得到 [0.0945, 0.9055]，另有 0/n、n/n、单观测边界回归。

**追问预演。** 为什么不做两个 prompt 的显著性检验？样本太小，先报区间宽度让人看到
不确定性；重复达到十轮以上再谈检验。

### 4.6 全绿但进程不退出：没有稳定 RED，就不许修

**问题。** Vitest 报告 14 个文件 150 个测试全部通过，进程不自然退出。直觉嫌疑是 lease
heartbeat 定时器。

**根因。** 没能建立。四个可证伪假设逐一给出预测再验证：heartbeat 或 SQLite 遗留 timer
（最小组合应稳定留资源，实际没有）；HTTP fixture 没关 socket（单文件重复应挂起，实际
只有 50 ms 内消失的关闭中 socket）；特定组合触发泄漏（精确重建的 14 文件集合连续 20 次、
完整套件连续 12 次自然退出）；并发负载下外层 guard 返回 124（当时测试尚未完成，不是同一
症状）。

**修法。** 不修。拒绝 `process.exit`、延长 timeout、关闭泄漏检测、写一个永远 GREEN 的
「资源清理测试」。记录为未决的环境层诊断，并写下再现时的下一步：保留 PID 与 active
resources，在同一进程快照里二分。

**证据。** [Run 租约心跳](./resume-agent-run-lease-heartbeat.zh-CN.md) §11.1；
[学习指南](./career-agent-learning-guide.zh-CN.md) §8.1。

**追问预演。** 那你怎么知道现在没问题？不知道。我只知道没有可复现的 RED，也没有产品代码
的根因证据。这是诚实的边界，比一个安慰性的修复更有价值。

### 4.7 租约到期后的「僵尸 worker」会改写公开 Run

**问题。** worker A claim 任务后，Provider 调用超过 lease 时长；到期后 worker B 以
`attempt = n + 1` 接管并重复调用。A 的旧 ack / release 会被 generation fencing 拒绝，但
A 对 status、checkpoint、result 的写入走的是普通 revision CAS，只要 A 读到的 revision
恰好是新的，写入就成功，失租的 worker 改写了公开 Run。应用层先检查 `leaseLost` 也无用，
检查和写入之间有 TOCTOU。

**根因。** 只在 ack / release 上做了 fencing，没把 claim generation 带进所有 Run mutation。

**修法。** exact-generation 的心跳续租；Run mutation 在 Store 层带 generation 谓词，失租
后任何写入原子拒绝；`recoverPendingTasks` 不再一次 claim 多个任务预先消耗 lease。

**证据。** [Run 租约心跳](./resume-agent-run-lease-heartbeat.zh-CN.md) §1、§9；
[RunStore 并发](./resume-agent-run-store-concurrency.zh-CN.md)；`sqlite-run-store.test.ts`
40 个用例。

**追问预演。** 为什么不用 Redis 或消息队列？单机 SQLite 是有意选择：先手工理解一遍
lease、fencing、outbox 的语义，再用同一组验收场景比较框架（学习指南 §9）。

### 4.8 HITL 的幂等记录只存回答指纹

**问题。** 客户端重试同一个回答会重复写回；同一幂等键换了 payload 应稳定失败；回答原文
可能含隐私。

**修法。** receipt 只存 interaction ID、值指纹和时间。同键同 payload 返回当前 Run；同键
不同 payload 报冲突；过期 interaction 拒绝。`file` 控件的回答不走字段 patch，而是把新
文件并入原材料重新归一化，因为新证据可能改动档案任何部分；两条回答路径共用同一段
「暂停或继续」代码，幂等与冲突语义不分叉。

**证据。** [HITL 交互](./resume-agent-hitl-interaction.zh-CN.md) §5、§5.1；提交 a933156；
`run.test.ts` 的 stale answer 与幂等冲突用例。

**追问预演。** 为什么一次只公开一个问题？减少用户负担，也让「回答了哪一个」无歧义；
内部可信 record 和公开快照分离，前端拿不到未公开的问题。

### 4.9 渲染：一个格式失败不能拖死全部

**问题。** 2026-09-16 审查发现六处：变体 label 直接用了 style ID；多样式请求把第一个
template 错报给所有变体；进入逐格式 `try/catch` 之前一次性渲染五种格式，任一 renderer
抛错整个变体失败；`ArtifactFailure.message` 直接暴露捕获异常，可能带临时目录和编译器
输出，还被复制进公开 warnings；模块没有相邻测试；会计算未请求的格式。

**根因。** 渲染模块的接口契约没有被测试约束，样式 metadata 在调用方二次推断。

**修法。** 格式选择、renderer 查找、二进制编码、命名、失败隔离、脱敏全部收进现有深模块；
失败契约只暴露稳定 code；补相邻测试覆盖顺序、去重、编码、字节数、DOCX 包结构、失败隔离。

**证据。** [渲染可靠性](./resume-agent-rendering-reliability.zh-CN.md) §2、§6。

### 4.10 拆提交时，行号是相对 HEAD 的（2026-09-22）

**问题。** 把 88 个在途文件按功能拆成 8 个提交。脚本按当前 HEAD 的 diff hunk 行号选片；
提交两次后 HEAD 变了，行号失效，脚本对某个文件报错，但流水线继续往下走，两个提交各漏了
几个文件。

**根因。** 两层。脚本把「某文件的 hunk 行号」当成全局稳定的标识。外层用了 `set -e`
指望失败就停，但事后验证发现：这个执行环境的 shell 在顶层不遵守 `set -e`（交互式语义，
失败命令之后的命令照跑），只有在 `bash -c` 子 shell 里才遵守。我没有先验证就依赖了它，
脚本报错后 `commit` 照跑。

**修法。** 回退到最后一个正确的提交，每次提交后重新计算 hunk 键。终态用提交前的备份逐
文件 `cmp`，88 个文件零差异；再逐提交检查共享文件在每个中间提交里的内容。

**教训。** 任何相对某个基准的标识都要在基准变化后重算；校验要对终态做，不能相信中间步骤
没报错；对「失败就停」这类安全网，先用一条必败命令验证它真的会停，再把工作压上去。

## 5. 这个项目做错过什么

1. **一天 70 个提交，19 个 fix 没有 body。** 后果是今天要从测试名反推每个修复的原因。
   修正：2026-09-17 之后的提交每条写清为什么；本文 §4 把散落的原因收回来。
2. **范围蔓延。** 路线图 §7 写着「后端协议未稳定前不投入大量自定义前端」，但 auth、OAuth、
   邮件、职业档案都做了。修正：交付范围冻结在 RP-001，README「项目状态」和路线图顶部
   都写明。
3. **文档多于理解。** 7.4K 行设计文档，学习指南 12.1 的能力清单 10 项全部未勾。修正：§6 逐条
   自答并给代码位置；答不出的算下一次小实验。
4. **文档与代码漂移。** 本地运行时 brief 写「浏览器使用确定性测试 Provider 走通了」，但源码里
   没有可脚本化的 Provider 模块，只有测试文件里的内联 fake。修正：补 scripted `LlmClient`
   让这句话为真，并作为一键 demo 的基础。
5. **对外数字没有可复现口径。** 「14.8K 行 / 67 个模块」对不上任何统计方式。修正：
   `scripts/project-metrics.mjs`，只数 git 跟踪文件，不含许可头。
6. **小样本被当成成绩。** 4/6 的 Wilson 区间是 [0.30, 0.90]。修正：README 明确它是诊断
   基线，不是效果宣称。

## 6. 能力清单自答（学习指南 12.1）

| 能力 | 一句话答案 | 代码位置 |
| --- | --- | --- |
| 解释每个 LLM 边界 | 三个：候选人归一化 → `CandidateNormalizationResponse`；JD 分析 → `JobSpec`；草拟 → `DraftResponse`。每个都过同一个结构化输出模块。另有 `chat` 和 Repair 调用，也走预算 | `workflow/agent.ts`、`prompts.ts`、`llm/structured-output.ts` |
| 区分传输重试、Schema Repair、业务重试 | 传输重试重复同一请求（408/409/429/5xx，`maxRetries + 1` 次）；Repair 是带验证反馈的新调用（默认 ≤ 1 次）；业务重试是任务级：lease 释放后由 poller 重新 claim，受 delivery attempts 上限 | `llm/openai-compatible.ts`、`llm/structured-output.ts`、`workflow/run.ts` |
| 写 fake LLM 测试复现失败 | 内联实现 `LlmClient.completeJson`，按 `schemaName` 返回成功、畸形、可修复或拒绝的输出 | `workflow/agent.test.ts`、`llm/structured-output.test.ts` |
| 设计任务特定 Eval | 版本化 `EvalCase`，断言 `requiredJobKeywords`、`minimumRequirementCoverage`、`minimumMustHaveCoverage`、`requiredWarningCodes`、`forbiddenWarningCodes`；不用 LLM 判分 | `evaluation/contracts.ts`、`runner.ts`、`campaign.ts` |
| 实现并测试一次暂停和恢复 | `needs_input` 暂停，回答按幂等键接收，写回 checkpoint 后从 JD 分析继续 | `workflow/run.ts`（`answer`、`resumeAfterAnswer`）、`run.test.ts` |
| 设计带权限、预算和审批的工具 | 预算：`RunBudget`（8 次调用 / 200k token）。审批：HITL 提问。权限：Run 归属与 session。**尚无工具调用**，这是有界工作流的有意选择 | `workflow/budget.ts`、`resume-agent-api/src/auth.ts` |
| 解释 Session / Run / State / Checkpoint / Memory | 见 §7 | `contracts.ts` |
| 说明为什么 Career Agent 与简历 Capability 必须分层 | 顶层 Agent 负责意图、会话、规划与能力选择；简历定制是第一个能力模块；把新能力堆进同一工作流会让它变成不可测的总入口 | 路线图 §1.1、学习指南 §1.2 |
| 用验收场景比较框架 | 标准是可恢复性、可测试性、权限、可观测性、迁移成本；先手写状态机理解语义，需要多能力路由时再比较 LangGraph / Agents SDK | 学习指南 §1.3、§9 |
| 说出哪些功能只是 Idea / Planned / Gap | RP-000、RP-003 到 RP-006 全部 Idea / Planned；RP-001、RP-002 是 Implemented for development，Operational 是 Gap | 路线图 §2.2 |

## 7. 本仓库里的词汇

- **Run**：`ResumeAgentRun`，一次完整执行的公开快照：`id`、`status`、可选的 `interactions`、
  `result`、`error`。前端只看到它。
- **Checkpoint**：`ResumeTailoringCheckpoint`，可恢复的内部状态：`jobText`、两组 artifacts、
  归一化后的 `candidate`、`preferences`、待答 `questions`、`warnings`、`trace`。回答写回的是它。
- **State**：路线图 §3.4 的状态机，加 trace 里的阶段名（`ingest_inputs`、`normalize_candidate`、
  `analyze_job`、`match_evidence`、`draft_resume`、`validate_resume`、`assess_resume`、
  `render_resume`）。
- **Session**：在本仓库指 `AuthSession`，登录会话，不是对话会话。这是最容易混的一个词。
- **Memory**：目前只有按用户加密存储的职业档案；没有跨 Run 的 Agent 记忆，也不打算在
  RP-001 阶段加。

## 8. 接下来

- 一键 demo：脚本化 `LlmClient` + 内存 Store + 关闭认证，一条命令起 API 和工作台。
- 语义检索切片：用 embedding 混合检索替换词法匹配器，草拟阶段只喂 top-k 证据；同一套
  campaign 给出 before / after。在此之前，§4.2 的匹配器就是 before。
