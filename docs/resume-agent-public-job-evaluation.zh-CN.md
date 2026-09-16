# Resume Agent 公开岗位派生评估 Feature Brief

> Feature ID：RA-010C
>
> 状态：Implemented for development；真实模型质量基线尚未取得
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
Agent campaign 通道与安全报告已实现；当前执行环境尚未取得可评分的真实模型结果。**

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

当前定向结果：3 个测试文件、34 个测试通过，其中 RA-010C 新增 7 个测试，原 RA-010/010B 回归
29 个测试继续通过。

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

真实模型验收还需在允许 Node `fetch` 访问 Provider 的受控环境中：

1. 固定 provider、model、prompt revision 和 runtime revision；
2. 至少运行 3 次而不是挑选一次结果；
3. 保存安全 campaign report，不保存原始输入输出；
4. 记录 Schema 成功率、断言分布、延迟、token 和费用；
5. 对事实保真和表达质量做盲化人工复核；
6. 未经人工校准前，不把 development thresholds 升为 CI 门禁。

## 11. 证据台账

| Feature ID | 生命周期 / 用户结果 | 交付 | 当前证据 | 覆盖 | 历史缺口 | 剩余缺口 |
| --- | --- | --- | --- | --- | --- | --- |
| RA-010C-A | 公开 JD → 可追溯 development case | Implemented for development | 3 个一手来源、版本化 provenance、Schema 与生产 Resume parser tests | Partial | none | 岗位族、语言、地区和非技术岗位覆盖很窄 |
| RA-010C-B | 模型解析 JD → 关键术语断言 | Implemented | required keyword RED/GREEN 与安全报告 | Partial | backfilled | 同义词、责任语义和人工 gold labels 未覆盖 |
| RA-010C-C | 配置 → 重复采样 → 安全聚合 | Implemented for development | 重复运行、加权聚合、无界次数与 secret-bearing config tests | Partial | none | token、费用、置信区间和持久化未实现 |
| RA-010C-D | corpus → 真实 Agent/Provider → 可评分结果 | Implemented but not operational | 默认网络、env-proxy、OpenAI 401 与 Gemini 400 均产生安全分类证据 | Gap | none | 需有效 Provider 凭证/配置并取得重复、可评分结果 |
| RA-010C-E | 模型结果 → 人工质量判断 | Planned | OpenAI eval guidance 与本地质量风险审计 | Gap | none | rubric、盲化标注、一致性与争议流程均未实现 |

## 12. 参考资料

- OpenAI Evaluation best practices：
  <https://developers.openai.com/api/docs/guides/evaluation-best-practices>
- Greenhouse Job Board API：
  <https://developers.greenhouse.io/job-board.html>
- Grafana Labs source posting：
  <https://job-boards.greenhouse.io/grafanalabs/jobs/6144059004>
- Cloudflare source posting：
  <https://boards.greenhouse.io/cloudflare/jobs/8109620?gh_jid=8109620>
- Anthropic source posting：
  <https://job-boards.greenhouse.io/anthropic/jobs/4956672008>
- RA-010/RA-010B 基础框架：
  [`resume-agent-evaluation-harness.zh-CN.md`](./resume-agent-evaluation-harness.zh-CN.md)
