# Resume Agent 公开岗位派生评估 Feature Brief

> Feature ID：RA-010C
>
> 状态：Implemented for development；已取得一次真实 DeepSeek campaign，但质量与稳定性未达标
>
> 证据覆盖：Partial
>
> 调研与实现日期：2026-09-16

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
| 真实 Provider 调用 | 已尝试 | 默认 Node 出网未读取代理；启用 env-proxy 后 OpenAI 返回 401、Gemini 返回 400 |
| 真实模型质量达标 | 没有 | 3 个案例都未进入评分，不能据此判断模型好坏 |

因此本功能不能被描述成“真实 Eval 已通过”。更准确的说法是：**公开 JD 派生数据集、真实
Agent campaign 通道与安全报告已实现；DeepSeek 已产生可评分结果，但当前 campaign 未达标，
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
| RA-010C-C | 配置 → 重复采样 → 统计可信的安全聚合 | Implemented for development | 重复运行、逐 case 稳定性、Wilson 95% 区间、R7 latency、空 observation、混合失败和隐私回归；campaign 10 tests | Partial | backfilled | 尚无可评分真实 Provider observations；独立同分布假设未获运行证据；token、费用和持久化未实现 |
| RA-010C-D | corpus → 真实 Agent/Provider → 可评分结果 | Implemented but not operational | 默认网络、env-proxy、OpenAI 401 与 Gemini 400 均产生安全分类证据 | Gap | none | 需有效 Provider 凭证/配置并取得重复、可评分结果 |
| RA-010C-E | 模型结果 → 盲化人工质量记录与安全聚合 | Implemented for development | `resume-human-review-v1` 四维 anchored rubric、strict/bounded Schema、重复提交拒绝、分类分布、描述性 pairwise exact agreement 与 14 tests | Partial | backfilled | assignment UI、随机化、评审者招募/资格、授权真实数据、pilot、chance-corrected IAA/CI、裁决、持久化与 judge calibration |

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
