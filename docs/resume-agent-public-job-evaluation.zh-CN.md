# Resume Agent 公开岗位派生评估 Feature Brief

> Feature ID：RA-010C
>
> 状态：Implemented for development；已取得真实 DeepSeek 与 StepFun campaign，但质量、延迟与稳定性未达标
>
> 证据覆盖：Partial
>
> 调研与实现日期：2026-09-16；最后审阅：2026-09-24

## 1. 为什么这一切片存在

RA-010/RA-010B 已经提供确定性 `EvalCase`、安全执行结果校验和聚合，但仓库只有一份完全
虚构的 platform engineer fixture。它能证明 runner 正常，却不能回答：

- Agent 能否从真实公开 JD 中识别职位和关键技能；
- 针对不同岗位族、不同候选人匹配度，结果是否稳定；
- 一次模型运行失败究竟是断言失败、输出协议损坏，还是 Provider 执行失败；
- prompt、model 或 runtime 变更后，维护者能否用同一配置重复采样并比较结果。

RA-010C 的用户结果是：维护者可以从包入口取得一组有来源版本、无真实候选人数据的
development corpus，用真实 `ResumeTailoringAgent` 重复执行，并获得不保存 JD、简历、Prompt、
completion 或异常正文的 campaign 报告。

## 2. 四种不能混淆的“真实”

| 证据层 | 本切片状态 | 准确含义 |
| --- | --- | --- |
| 真实公开 JD | 已有 | 案例需求来自发布方公开岗位，但只提交人工改写的需求摘要 |
| 真实候选人案例 | 没有 | 候选人全部为合成身份和合成经历，不是匿名真实简历 |
| 真实 Provider 调用 | 已有 | DeepSeek 与 StepFun 均已通过真实 OpenAI-compatible adapter 产生可评分结果；OpenAI 401、Gemini 400 是历史配置证据 |
| 真实模型质量达标 | 没有 | 小样本通过率、长尾延迟与随机执行失败仍未达到生产门槛 |

因此本功能不能被描述成“真实 Eval 已通过”。更准确的说法是：**公开 JD 派生数据集、真实
Agent campaign 通道与安全报告已实现；DeepSeek 与 StepFun 已产生可评分结果，但当前 campaign 未达标，
且仍有结构化输出执行失败。**

## 3. 调研证据与设计改变

### 3.1 本地证据

- 原有 runner 只断言 `targetTitle`、coverage 和 warning code。如果模型漏掉 JD 中的重要技能，
  但基于自己漏掉后的 `JobSpec` 算出高 coverage，原有断言仍可能通过。
- `TailorResumeResult.jobSpec.keywords` 已经存在，适合作为任务特定、可自动评分的观察面；无需把
  完整 JD 或生成简历写入报告。
- `ResumeTailoringAgent.run(request)` 的返回值天然满足 `EvalExecute` seam；无需增加只做透传的
  Agent adapter。
- 原有单次 `runEvaluation` 不保存 provider、model、prompt revision、runtime revision，也不负责
  重复采样。

### 3.2 外部一手证据

OpenAI《Evaluation best practices》建议使用代表真实分布的任务特定数据、持续扩充数据集，
并把自动评分与人工判断结合；生成式系统具有随机性，不能用一次最好结果代替重复评估。

Greenhouse 官方 Job Board API 文档说明公开 job board 可返回 JSON 岗位、稳定 job ID，并在
`content=true` 时提供岗位内容。本切片在 2026-09-16 读取三个发布方的公开响应，记录岗位 ID、
URL、观察日期和 `updated_at`，但不提交抓取到的原始 HTML。

这些证据改变了三项设计：

1. **adapt：** 真实公开 JD 只提炼为满足 Eval 目的的需求摘要，避免把整篇招聘文案复制进仓库；
2. **combine：** 对每份摘要同时保存来源版本和完全合成候选人声明；来源真实度不冒充候选人真实度；
3. **adapt：** 增加岗位关键词 gold assertions 和 campaign 聚合，而不是只依赖模型自己的 coverage。

## 4. 数据集组成

`publicJobDerivedDevelopmentCases` 当前包含三例：

| Case ID | 公开岗位来源 | 岗位更新时间 | 合成候选人设计 |
| --- | --- | --- | --- |
| `public-grafana-platform-metal-2026-09` | Grafana Labs，job `6144059004` | `2026-08-18T08:56:38-04:00` | 有 cloud Kubernetes、Terraform、Go、on-call；没有 bare-metal/Ceph 证据 |
| `public-cloudflare-senior-data-analyst-2026-09` | Cloudflare，job `8109620` | `2026-09-14T04:21:56-04:00` | 有 SQL、dbt、Airflow、GitHub、Python 和 stakeholder analytics |
| `public-anthropic-data-engineer-2026-09` | Anthropic，job `4956672008` | `2026-08-21T12:49:43-04:00` | 有 Python、SQL、Airflow 和数据质量；缺少 dbt 与要求年限 |

三份 case 都属于 `development` split。它们已经进入版本库，开发者与模型调优者可见，所以不能
冒充 held-out set。未来 held-out 数据需要独立访问控制、版本和揭盲流程。

每个 provenance 必须通过运行时 Schema：

- 来源 URL 必须使用 HTTPS；
- `observedAt` 必须是真实日历日期；
- `sourceUpdatedAt` 必须是带时区的 ISO datetime；
- 内容处理固定为 `paraphrased_requirements_only`；
- 候选人固定为 `synthetic` 且 `containsRealPersonalData: false`。

## 5. 新增断言：requiredJobKeywords

Case 可以声明：

```ts
expectations: {
  requiredJobKeywords: ['SQL', 'Airflow', 'dbt']
}
```

执行结果只在内存中暴露 `jobSpec.keywords`。runner 使用 Unicode NFKC、trim 和不区分大小写的
精确关键词匹配，逐个生成：

```ts
{
  code: 'required_job_keyword',
  subject: 'Airflow',
  passed: true
}
```

报告不会保存原始 JD、全部模型关键词或模型解释。精确关键词适合 SQL、dbt、Airflow、Kubernetes
等稳定术语；它不适合判断同义表达、责任理解或文字质量。后者仍需人工 rubric，不能把本断言
扩大解释为完整的 JD 理解准确率。

## 6. Campaign 深模块

包入口新增：

```ts
runEvaluationCampaign(cases, execute, {
  campaignId,
  provider,
  model,
  promptRevision,
  runtimeRevision,
  repetitions,
})
```

这个 module 在一个小 interface 后隐藏：配置验证、顺序重复运行、每轮安全报告和跨轮加权聚合。
删除它会迫使每个调用方重复相同的采样与聚合规则，因此它比单纯的 Agent 透传 adapter 更有深度。

约束：

- `repetitions` 为 1–20，防止一次误配置产生无界调用和费用；
- campaign 配置是 strict Schema，不接受 `apiKey` 等额外字段；
- 配置必须先验证，非法配置不会执行任何 case；
- case 在每轮内和轮次之间都顺序执行，避免基线工具主动制造限流峰值；
- coverage 按每轮 `scored` 数量加权，不把执行失败伪造成 0 分样本；
- 输出只包含安全配置、`EvalReport[]` 和安全聚合。

### 6.1 RA-010C-C：统计可信的重复运行报告

现有 aggregate 可以回答“本次 campaign 一共通过多少次”，却不能回答同一个 case 是否稳定、
小样本结果有多不确定，或延迟分布是否出现长尾。OpenAI Evaluation Best Practices 明确指出生成式
系统具有波动，应持续、重复地使用任务特定指标评估，并用人工判断校准自动指标。NIST 对二项比例
区间的说明推荐 Wilson 方法，因为普通 Wald 区间会在小样本和接近 0/1 时产生不可能的边界；NIST
也指出百分位插值不存在唯一通用定义，小样本下 R6、R7、R8 会给出不同结果。

本切片采用（adapt）以下契约：

- 总体和逐 case 都报告通过/失败、`scored`、稳定失败码计数和通过率；逐 case 按输入顺序排列；
- 通过率分母包括每次执行尝试；只有通过 `EvalExecutionResultSchema` 的结果进入 `scored`；
- 总体和逐 case 的通过率同时报告 95% Wilson interval，使用双侧标准正态临界值，计算后限制在
  `[0, 1]` 并统一四位小数；它只描述当前 observations 的不确定性，不是模型真实通过率的精确概率；
- 延迟统计覆盖成功、断言失败、无效结果和执行异常，因为这些都是用户实际等待的执行尝试；
- p95 固定采用 Hyndman-Fan R7 线性插值，即位置 `1 + p(n - 1)`。选择 R7 是因为它是 R 与
  Excel 的常用默认值，且 NIST 将 R6/R7/R8 都列为通常可接受的方法；报告不得称其为“精确 p95”；
- 空 case 集合保留既有 `passRate: 0` 以兼容旧报告，但新增 confidence interval、平均延迟和 p95
  使用 `null` 表示没有 observation，不能生成 `NaN`、`Infinity` 或伪造的零延迟；
- 新字段是 `EvalCampaignReport` version 1 的 additive development contract；本切片不新增依赖、
  持久化、token/费用、Provider adapter 或人工 rubric。

Wilson 的频率学解释还依赖 observations 近似独立同分布。Provider 缓存、模型滚动更新、共享限流、
时间相关故障或 prompt/runtime 漂移都会破坏这个假设。因此 report 保留 provider、model、prompt 与
runtime revision，区间只用于暴露当前固定配置下的小样本宽度；它不能证明未来流量中的真实成功率，
也不能把相邻配置的 observations 混在一起计算。

安全界面不变：统计实现只消费 `EvalReport.results` 中的 case ID、布尔值、稳定失败码和毫秒耗时。
报告不得增加 request、JD、简历、Prompt、completion、Provider message、异常正文或凭证。

已验收行为是：单 case 一过一败；Wilson 的 `0/n`、`n/n`、`1/2` 和单 observation；可控时钟下的
总体/逐 case 平均值与 R7 p95；多 case 原始顺序和不同失败类型；空集合；以及序列化报告的敏感
标记回归。

### 6.2 RA-010C-E1：盲化人工评审契约

自动断言仍不能判断事实忠实、需求重点、证据具体性和表达清晰度。RA-010C-E1 已实现版本化的
`resume-human-review-v1`：四个独立 anchored dimensions、固定 issue codes、strict/bounded blind
review Schema、重复 assignment/reviewer-item 拒绝、安全分类聚合，以及描述性的 pairwise exact
agreement。它不计算 ordinal mean，也不在没有真实 pilot 时选择 chance-corrected IAA 或区间。

该开发契约不包含 assignment UI、随机化、评审者招募/资格、授权数据、真实 review、裁决或持久化，
因此不能作为“人工校准完成”的证据。完整研究、RED → GREEN 和验证记录见
[`resume-agent-human-evaluation.zh-CN.md`](./resume-agent-human-evaluation.zh-CN.md)。

## 7. 隐私、版权与安全边界

### 7.1 为什么不提交原始公开 JD

“公开可读”不等于“可以无条件复制并重新分发”。Eval 需要的是岗位失败机制和需求分布，而不是
招聘页面的品牌文案、福利、薪酬、平等就业声明或整页 HTML。因此只保留人工改写的最小需求摘要，
同时保存链接和版本供维护者核验。

### 7.2 为什么不把真实简历去掉姓名后直接提交

姓名只是直接标识符之一；雇主、项目、地点、精确日期、罕见技能组合和指标都可能重新识别个人。
本切片没有候选人授权、人工去标识复核、访问控制、保留期或删除流程，因此选择完全合成候选人。
这保护隐私，但也意味着案例不能证明真实简历分布上的表现。

### 7.3 报告边界

campaign 配置没有 key、endpoint 或请求头字段；case report 没有 request、JD、resume、Prompt、原始
completion、warning message、Zod issue 或异常正文。真实执行诊断也只允许输出稳定错误类别和安全
状态。

## 8. RED → GREEN 记录

1. **公开来源契约：** RED 时 strict `EvalCaseSchema` 拒绝 provenance；GREEN 后合法来源通过，HTTP
   URL 和 `containsRealPersonalData: true` 被拒绝。
2. **公开岗位派生 corpus：** RED 时 fixture module 不存在；GREEN 后三例通过数据集 Schema，并由
   production resume parser 验证候选人。
3. **岗位关键词断言：** RED 时 `requiredJobKeywords` 是未知字段；GREEN 后大小写归一匹配，并能在
   同一 case 内分别报告通过与失败关键词。
4. **包入口：** RED 时 corpus 从 `@/index` 得到 `undefined`；GREEN 后 Schema、runner、campaign、
   类型和 corpus 都从包入口导出。
5. **campaign：** RED 时 `runEvaluationCampaign` 不存在；GREEN 后两次相反结果按 case 数量和
   `scored` 权重聚合。
6. **来源版本：** RED 时 `sourceUpdatedAt` 为 `undefined`；GREEN 后三例固定到 Greenhouse 返回的
   带时区更新时间。
7. **配置安全：** strict config 拒绝额外 `apiKey`，21 次采样也在执行 case 前拒绝。
8. **逐 case 稳定性：** RED 时 `caseAggregates` 为 `undefined`；GREEN 后同一 case 两次一过一败
   得到 2 次执行、50% 通过率、2 个 scored 和准确失败码计数，并保持输入顺序。
9. **Wilson 区间：** RED 时总体 interval 为 `undefined`；GREEN 后总体和逐 case 的 `1/2` 得到
   `[0.0945, 0.9055]`，后续回归覆盖单 observation 的 `0/n` 与 `n/n` 边界。
10. **延迟分布：** RED 时 aggregate 没有 latency 字段；GREEN 后可控时钟下 10ms/30ms 的平均值为
    20ms，R7 p95 为 29ms；空 observations 返回 `null`。
11. **混合失败与隐私：** 回归覆盖合法断言失败、执行异常和无效结果的 `scored`/失败计数语义，
    并证明新增统计不会序列化 request、候选人或异常标记。

当前定向结果：campaign 10 个测试通过；runner + campaign 共 39 个测试通过。包含公开岗位 fixture
时，3 个测试文件共 41 个测试；相对 RA-010C-C 开始前新增 7 个 campaign 行为测试。

## 9. 2026-09-16 真实运行证据

### 默认 Node fetch

- OpenAI-compatible 和 Gemini-compatible 路径都先得到
  `LlmRequestError(reason = network_error, retryable = true)`；
- 同一环境的 `curl` 可以访问公开站点；
- 环境存在 proxy variables，而 Node 22.21.1 默认 `fetch` 不读取这些变量。

### 启用 Node 22.21.1 `--use-env-proxy`

- 无认证 OpenAI `/models` 探针得到预期 `401`，证明网络和代理路径可达；
- 正式 OpenAI campaign 使用 `gpt-4o-mini`、3 个 case 和正式
  `runEvaluationCampaign`，得到 `execution_failed = 3`、`scored = 0`；
- 安全诊断为 `LlmRequestError(reason = http_status, status = 401,
  retryable = false)`，说明当前 OpenAI 凭证无效或已过期；
- Gemini-compatible 单案例探针使用 `gemini-2.5-pro`，安全诊断为非重试
  `HTTP 400`；带认证的 `/models` 探针也为 400，说明当前 Gemini 兼容配置或凭证不可用；
- Node 将 `EnvHttpProxyAgent` 标记为 Experimental，本切片只在受控 Eval
  命令中启用，没有静默改变生产客户端默认行为。

最终阻塞已经从笼统的网络错误收敛到环境配置：默认 Node 需要显式代理开关，同时现有 OpenAI
凭证和 Gemini 兼容配置都不可用。由于没有任何合法执行结果进入评分，不能计算模型 coverage，
也不能调整阈值来“让测试通过”。

### DeepSeek 真实 campaign（2026-09-16）

在清除继承的旧 `OPENAI_*` 环境变量、使用专用 `.env.local` 后，3 个公开岗位派生合成案例通过
真实 DeepSeek adapter 执行一次 `runEvaluationCampaign`。报告只保留安全聚合：

- `totalCaseExecutions = 3`，`passed = 0`，`failed = 3`，`scored = 2`；
- `failureCodeCounts` 为 `assertion_failed = 2`、`execution_failed = 1`、
  `invalid_execution_result = 0`；
- 有效结果的平均 requirement coverage 为 `0.365`，must-have coverage 为 `0.41`，
  平均耗时约 `10.553s`，p95 约 `11.130s`；
- 脱敏复跑诊断观察到一次 `structured_output_validation_failed`，另一个案例通过全部断言，
  说明当前单次样本同时存在输出质量不足和 Provider/structured-output 稳定性问题。

这是真实可评分基线，不是通过证据：模型调用已打通，但必须先定位结构化输出失败、提升覆盖率并
进行多次重复 campaign，再讨论阈值或 Operational 状态。原始 JD、候选简历、Prompt、completion、
Provider message 和异常正文均未写入报告或文档。

随后以同一 prompt/runtime 配置重复 2 次（共 6 次 case execution）：仅 1 次通过，整体
`passRate = 0.1667`，`scored = 3`；失败计数为 `assertion_failed = 2`、
`execution_failed = 3`、`invalid_execution_result = 0`。Wilson 95% 区间为 `[0.0301, 0.5635]`，
样本太小且方差明显，不能作为生产成功率估计。

为支持下一轮诊断，API 的 `agent_validation_failed` 现在可携带受限的 `stage` 枚举
（`candidate_input`、`candidate_normalization` 或 `draft_validation`）。该字段只描述工作流阶段，
不包含 JD、候选人材料、模型 completion 或底层异常；它用于区分线上 422 的来源，不改变评分规则，
也不能把失败运行计入 `scored`。

### 2026-09-16 P0-B 最新真实 DeepSeek campaign

在 `20260916T121500` 部署、候选源文本回退和草稿可选条目修复后，使用同一三份公开岗位派生
合成案例再次执行一次真实 campaign。安全聚合为：

- `totalCaseExecutions = 3`，`passed = 1`，`failed = 2`，`scored = 3`；
- `failureCodeCounts`：`assertion_failed = 2`、`execution_failed = 0`、
  `invalid_execution_result = 0`；
- `passRate = 0.3333`，Wilson 95% 区间 `[0.0615, 0.7923]`；
- 平均耗时约 `18.942s`，p95 约 `30.838s`；
- 平均 requirement coverage `0.4067`，平均 must-have coverage `0.4533`；
- 三个 case 中 Anthropic data engineer 通过，Grafana platform-metal 与 Cloudflare data analyst
  仍因断言失败未通过。

这次结果证明真实 Provider、Eval runner、断言和安全聚合已经形成可重复的运行闭环，但质量仍未
达标，且只有一次重复样本。RA-010C 继续保持 `Implemented for development`，不能提升为
`Enabled` 或 `Operational`；下一步应增加重复 campaign、分析失败断言并改善 JD 覆盖率。

随后在同一 `atomic-requirements-v3` prompt/runtime 配置下进行了 2 次重复（共 6 次执行）：

- `passed = 4`、`failed = 2`、`scored = 4`，`passRate = 0.6667`；
- `failureCodeCounts` 为 `execution_failed = 2`，没有 assertion 或 invalid-result 失败；
- Wilson 95% 区间为 `[0.3, 0.9032]`，平均 requirement coverage `0.565`，must-have coverage
  `0.605`；
- Anthropic case 两次均通过，Grafana 和 Cloudflare 各一次 Provider/执行失败。

这组重复样本显示匹配器修复消除了上一轮两个确定性的 coverage assertion failure，但 Provider
执行稳定性仍不足以宣称生产质量；当前证据适合指导下一轮诊断，不适合作为成功率门槛。

随后对三个 case 各做一次受控错误分类复跑，三者均能完成（Grafana requirement/must-have
`0.36/0.47`、Cloudflare `0.87/0.85`、Anthropic `0.47/0.44`）。这说明重复 campaign 中的两次
`execution_failed` 更可能是 Provider/网络瞬态，而非稳定的业务代码回归；仍需更长序列、重试
分布和运行监控后才能把该结论提升为 Operational 证据。

### 2026-09-23 RA-018 对照 campaign：词法 vs 混合匹配

同一 prompt 主干、同一模型（`deepseek-chat`）、同一裁判（词法 coverage + 金标关键词），
5 案例（本文 3 例 + 2 个改写密集合成案例）× 3 轮，命令为
`pnpm --filter @yamlresume/resume-agent exec tsx scripts/campaign.ts`：

- 词法匹配器：`passed = 11/15`，`passRate = 0.7333`，Wilson [0.4805, 0.891]，`scored = 13`，
  平均需求覆盖 0.6015，必备覆盖 0.6623，`assertion_failed = 2`、`execution_failed = 2`；
- 混合匹配器：`passed = 11/15`，`passRate = 0.7333`，Wilson [0.4805, 0.891]，`scored = 14`，
  平均需求覆盖 0.6093，必备覆盖 0.6614，`assertion_failed = 3`、`execution_failed = 1`。

没有可测差异；逐案例与解释见
[`resume-agent-semantic-evidence-retrieval.zh-CN.md`](./resume-agent-semantic-evidence-retrieval.zh-CN.md)
§12.2。这次 campaign 首次通过可提交的命令重跑，报告里的 `runtimeRevision` 记录的是运行时
HEAD（`00d855c`），RA-018 代码当时尚未提交，随后提交为 13479eb / b7b3490 / ac3aed2。

### 2026-09-24 StepFun 本地基线

使用现有可提交 campaign runner、词法匹配器、`atomic-requirements-v3` prompt、
`step-3.7-flash` 和 runtime revision `5d851c0`，对三份公开岗位派生合成案例各运行一次。命令
显式清除了父进程继承的 `OPENAI_*`，再从 Git 忽略且权限为 0600 的 `.env.local-app` 加载配置；
未保存原始 JD、候选人、Prompt、completion、Provider 错误正文或凭证。

安全聚合结果：

- `totalCaseExecutions = 3`，`passed = 1`，`failed = 2`，`scored = 2`；
- `passRate = 0.3333`，Wilson 95% 区间 `[0.0615, 0.7923]`；
- `failureCodeCounts`：`assertion_failed = 1`、`execution_failed = 1`、
  `invalid_execution_result = 0`；
- 平均 requirement coverage `0.73`，平均 must-have coverage `0.75`；覆盖率只统计两个成功进入
  评分的执行，不能把未评分的执行失败当作零，也不能据此掩盖失败；
- 平均端到端耗时约 `190.4s`。Grafana、Cloudflare、Anthropic 三例分别约为
  `176.1s`、`203.1s`、`217.5s`；当前延迟不适合交互式生产体验；
- Grafana 案例通过；Cloudflare 案例进入评分但有断言失败；Anthropic Data Engineer 案例以
  `DraftValidationError` 失败。

对失败的 Anthropic 案例做了一次只输出安全字段的固定输入复跑：`139.384s` 完成，职位为
`Data Engineer`，requirement/must-have coverage 为 `0.70/0.75`。同一案例从草稿验证失败变为
成功，支持“当前模型输出存在随机性”，不支持放宽 YAMLResume Schema、事实不变式或针对一次结果
修改 prompt。因为未保存原始 completion，无法离线重放第一次失败；继续定位需要更多受控重复或
仅记录验证错误路径的安全观测面。

这次 campaign 证明 StepFun 能完成真实 Agent 工作流，但不能证明生产质量。当前最小结论是：
Provider 可用，事实保护在失败时 fail closed；主要风险是约 2–4 分钟延迟、1/3 执行失败和小样本
质量波动。下一轮应先改善可观测性并做有预算的重复采样，而不是增加新功能或降低验证标准。

RA-010C-F 的用户结果是：草稿验证失败仍归入 `execution_failed`，同时报告一个严格
白名单的诊断对象，只含 `stage`、稳定错误码和可选 YAMLResume 字段路径。异常消息、字段值、
候选人内容和模型 completion 必须继续被丢弃；普通 Provider 异常不能伪装成草稿诊断。

公开 interface 是 `EvalCaseResult.diagnostic?`：

```json
{
  "stage": "draft_validation",
  "code": "draft_schema_invalid",
  "path": "content.work.0.startDate"
}
```

状态转换保持兼容：

```text
DraftValidationError
  -> execution_failed
  -> copy allowlisted code
  -> copy path only when it matches a bounded YAMLResume path shape

other exception
  -> execution_failed
  -> no diagnostic
```

稳定错误码只有 `draft_validation_failed`、`draft_content_invalid`、`draft_schema_invalid`、
`draft_immutable_fact_changed` 和 `draft_unsupported_entry`。Schema 第一条 issue、不可变 basics/location/
section 字段以及无来源 section 都在错误产生的 module 内写入结构化 path；evaluator 只做白名单投影，
不解析异常 message。非法或超长 path 会被省略，但稳定 code 保留。campaign CLI 在存在诊断时额外
输出 repetition、case ID、stage、code 和 path 表格；`--out` 保存的安全报告也包含同一对象。

RED → GREEN：

- RED：`DraftValidationError` 进入 runner 后只剩 `execution_failed`；新增公开行为测试稳定失败，
  同时证明旧逻辑仍未泄露异常正文。
- GREEN：runner 保留安全 code/path；普通敏感异常无 `diagnostic`；非法 path 被丢弃；campaign
  保留诊断但不保留异常 message。
- RED：真实 `prepareDraftResume()` 的 Schema、不可变事实和无来源条目错误仍只有 message。
- GREEN：三个行为分别产生 `draft_schema_invalid`、`draft_immutable_fact_changed` 和
  `draft_unsupported_entry` 以及对应字段路径；事实验证规则本身没有放宽。

## 10. 验收门禁

```text
pnpm agent test src/evaluation/runner.test.ts \
  src/evaluation/campaign.test.ts \
  src/evaluation/fixtures/public-job-derived.test.ts
pnpm --filter @yamlresume/resume-agent exec tsc --noEmit
pnpm agent build
pnpm biome check packages/resume-agent/src/evaluation \
  packages/resume-agent/src/index.ts
git diff --check
pnpm license:check
```

RA-010C-C 在 2026-09-16 的本地验证：

- `pnpm agent test src/evaluation/runner.test.ts src/evaluation/campaign.test.ts
  src/evaluation/fixtures/public-job-derived.test.ts`：3 files / 41 tests 通过；
- `pnpm agent test`：15 files / 228 tests 通过；这次全包结果同时包含共享工作树中尚未提交的 ODT
  输入测试，RA-010C-C 自身的定向证据仍以上一项为准；
- `pnpm agent test:cov src/evaluation/campaign.test.ts`：campaign module 的 statements、branches、
  functions、lines 均为 100%；该命令只用于本 module 覆盖率，不把同进程加载的其他 module 低覆盖
  误写成项目整体覆盖率；
- `pnpm --filter @yamlresume/resume-agent exec tsc --noEmit`：通过；
- `pnpm agent build`：ESM 与 DTS 构建通过；
- 两个 campaign TypeScript 文件的目标 Biome：通过；
- 四个本切片文件的 `git diff --check`：通过；
- `pnpm license:check`：退出码 0，但共享 `scripts/addlicense.mjs` 报告环境缺少 `addlicense` binary，
  因此跳过实际扫描；两个既有 TypeScript 文件仍保留完整 MIT header。

RA-010C-E1 在 2026-09-16 的本地验证：human review 14 tests；runner、campaign、公开岗位 fixture 与
human review 共 4 files / 55 tests；Resume Agent 全包 16 files / 246 tests；human-review module 的
statements、branches、functions、lines 均为 100%；TypeScript、ESM/DTS build、目标 Biome 与
`git diff --check` 通过。`license:check` 同样因缺少 `addlicense` binary 跳过实际扫描，新增文件的
MIT header 已保留。

2026-09-24 StepFun 基线验证：

- `pnpm agent test src/evaluation/runner.test.ts src/evaluation/campaign.test.ts
  src/evaluation/fixtures/public-job-derived.test.ts`：3 files / 41 tests 通过；
- 清除继承的 `OPENAI_*` 后执行 `pnpm --filter @yamlresume/resume-agent exec tsx
  scripts/campaign.ts --matcher lexical --repetitions 1 --cases public --env ../../.env.local-app`：命令
  退出 0，得到 3 个执行、1 个通过、2 个进入评分和上述安全聚合；
- Anthropic Data Engineer 固定案例的安全单案例复跑：命令退出 0，`139384ms` 完成并得到
  `0.70/0.75` coverage；只输出 case ID、终态、耗时、目标职位和覆盖率。

2026-09-24 RA-010C-F 验证：

- `pnpm agent test src/validation/resume.test.ts src/evaluation/runner.test.ts
  src/evaluation/campaign.test.ts`：3 files / 48 tests 通过；
- `pnpm agent test`：25 files 通过，317 tests 通过、1 skipped；
- `pnpm agent-api test`：7 files / 136 tests 通过；
- `pnpm check:ci`：退出 0；保留 2 条与本切片无关的既有 API 测试 non-null assertion warning；
- `pnpm build`：9 个 workspace package 全部构建通过；
- 没有重跑付费 campaign：新行为在 evaluator 的公开 interface 以确定性错误对象验证，下一次真实
  Provider 自然失败时即可获得 code/path，不需要为观测主动制造失败。

真实模型验收还需在允许 Node `fetch` 访问 Provider 的受控环境中：

1. 固定 provider、model、prompt revision 和 runtime revision；
2. 至少运行 3 次而不是挑选一次结果；
3. 保存安全 campaign report，不保存原始输入输出；
4. 记录 Schema 成功率、断言分布、延迟、token 和费用；
5. 使用已实现的 rubric/记录契约执行真实盲化 pilot，并补齐随机化、评审者资格、一致性区间与争议裁决；
6. 未经人工校准前，不把 development thresholds 升为 CI 门禁。

## 11. 证据台账

| Feature ID | 生命周期 / 用户结果 | 交付 | 当前证据 | 覆盖 | 历史缺口 | 剩余缺口 |
| --- | --- | --- | --- | --- | --- | --- |
| RA-010C-A | 公开 JD → 可追溯 development case | Implemented for development | 3 个一手来源、版本化 provenance、Schema 与生产 Resume parser tests | Partial | none | 岗位族、语言、地区和非技术岗位覆盖很窄 |
| RA-010C-B | 模型解析 JD → 关键术语断言 | Implemented | required keyword RED/GREEN 与安全报告 | Partial | backfilled | 同义词、责任语义和人工 gold labels 未覆盖 |
| RA-010C-C | 配置 → 重复采样 → 统计可信的安全聚合 | Implemented for development | 重复运行、逐 case 稳定性、Wilson 95% 区间、R7 latency、空 observation、混合失败和隐私回归；DeepSeek/StepFun 真实 observations；campaign 11 tests | Partial | backfilled | 真实样本仍少；独立同分布假设未获充分运行证据；token、费用和持久化未实现 |
| RA-010C-D | corpus → 真实 Agent/Provider → 可评分结果 | Implemented but not operational | DeepSeek 与 StepFun 真实 campaign；StepFun 3 executions、1 passed、2 scored、平均耗时约 190.4s，并有一次安全的失败案例复跑 | Backfilled | previously-overclaimed | 需更多重复样本、断言明细、安全诊断的真实运行观测、真实候选分布和质量门槛；仍无 Operational 证据 |
| RA-010C-E | 模型结果 → 盲化人工质量记录与安全聚合 | Implemented for development | `resume-human-review-v1` 四维 anchored rubric、strict/bounded Schema、重复提交拒绝、分类分布、描述性 pairwise exact agreement 与 14 tests | Partial | backfilled | assignment UI、随机化、评审者招募/资格、授权真实数据、pilot、chance-corrected IAA/CI、裁决、持久化与 judge calibration |
| RA-010C-F | 草稿验证失败 → 安全可定位诊断 | Implemented for development | runner/campaign 安全诊断；Schema、不可变事实、无来源条目 RED→GREEN；非法路径与敏感异常隐私回归；3 files / 48 tests | Extend existing report interface | 旧报告有意丢弃全部异常详情 | 尚无第二次真实 DraftValidationError 观测；code/path 聚合、告警和留存策略未实现 |

## 12. 参考资料

- OpenAI Evaluation best practices：
  <https://developers.openai.com/api/docs/guides/evaluation-best-practices>
- NIST/SEMATECH Wilson proportion interval：
  <https://itl.nist.gov/div898/handbook/prc/section2/prc241.htm>
- NIST/SEMATECH percentile methods：
  <https://www.itl.nist.gov/div898/handbook/prc/section2/prc262.htm>
- Greenhouse Job Board API：
  <https://developers.greenhouse.io/job-board.html>
- Grafana Labs source posting：
  <https://job-boards.greenhouse.io/grafanalabs/jobs/6144059004>
- Cloudflare source posting：
  <https://boards.greenhouse.io/cloudflare/jobs/8109620?gh_jid=8109620>
- Anthropic source posting：
  <https://job-boards.greenhouse.io/anthropic/jobs/4956672008>
- 盲化人工评审 Feature Brief：
  [`resume-agent-human-evaluation.zh-CN.md`](./resume-agent-human-evaluation.zh-CN.md)
- RA-010/RA-010B 基础框架：
  [`resume-agent-evaluation-harness.zh-CN.md`](./resume-agent-evaluation-harness.zh-CN.md)
