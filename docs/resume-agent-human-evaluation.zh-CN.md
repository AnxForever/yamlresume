# Resume Agent 盲化人工质量评审 Feature Brief

> Feature ID：RA-010C-E1
>
> 状态：Implemented for development（非 Enabled / Operational）
>
> 证据覆盖：Partial
>
> 调研日期：2026-09-16

## 1. 用户结果

现有确定性 Eval 可以检查职位名、关键词、coverage、warning 和执行协议，却不能可靠判断生成简历
是否忠于候选人事实、是否真正把 JD 重点放在正确位置、是否使用了具体证据，以及文字是否清晰。
维护者需要一份可版本化、可盲化、可重复聚合的人工评审契约，才能把“我感觉不错”变成可以复核的
开发证据，并最终校准自动断言或 LLM judge。

本切片的成功结果是：维护者可以提交一批只含 opaque assignment/reviewer/variant 标识和固定分类的
人工评审，得到不包含评审者标识、原始 JD、简历、模型输出或自由文本的安全汇总；汇总按首次出现
顺序展示每个 case/盲化 variant 的分类分布、issue code 和明确命名的 pairwise exact agreement。

## 2. 本切片不是什么

- 不创建标注 UI、任务分配器、持久化或招聘评审者；
- 不把 Provider/model/prompt 映射交给评审者，也不负责揭盲；
- 不导入真实候选人数据，不保存原始 JD、简历、completion 或自由文本 rationale；
- 不计算 overall quality 单分、ordinal mean、显著性、chance-corrected agreement 或 agreement CI；
- 不声称 rubric 已经过 pilot、专家校准、评审者资格验证或真实岗位分布验证；
- 不启用 LLM-as-a-judge，也不把 development 人评分数提升为 CI 门禁。

这些都是独立生命周期。契约和 fake tests 只能证明记录与聚合行为，不能证明评审本身可靠。

## 3. 证据与设计改变

### 3.1 本地证据

- `EvalReport` 有意删除 request、JD、简历、completion、异常正文和 Provider message；人工汇总不能
  重新打开这条数据泄露路径。
- RA-010C 的三份 case 是公开 JD 派生、完全合成候选人且属于 development split；它们可以用于
  rubric 演练，但不能代表授权匿名真实候选人分布。
- `requiredJobKeywords` 适合稳定术语，不适合语义完整性、事实保真和写作质量；这些维度必须独立
  评审，不能由模型自己的 coverage 代替。
- Campaign 已能固定 provider/model/prompt/runtime revision；人工记录只需要 blind variant ID，
  Provider 映射应保留在评审界面之外。

### 3.2 外部一手与独立研究

OpenAI Evaluation Best Practices 指出生成式系统有波动，应使用任务特定 Eval，并用人工反馈持续
校准自动评分；开放式生成不应只依赖笼统通用指标。

van der Lee 等人在 INLG 2019 的综述建议：分开评价标准、明确定义、使用多个评审者、报告
inter-annotator agreement 和 percentage agreement，并通过随机/平衡顺序降低顺序效应。Howcroft
等人在 INLG 2020 对 165 篇 NLG 人评论文的审计进一步发现，同名标准经常含义不同、混合多个标准
会增加回答差异，实验设计和报告字段缺失使结果难以复现。

Mousavi 等人在 GEM 2022 的可复现协议把人评分为任务设计、评审者招募、执行和报告四个阶段；其
协议保留“不知道/无法判断”，避免强迫评审者在证据不足时给出虚假确定答案，并强调清晰中性的
问题、资格任务和持续质量控制。

据此本切片选择：

1. **adapt：** 不照搬通用 fluency/helpfulness 量表，而是固定简历任务的四个独立维度；
2. **adapt：** 使用带语义标签的四级分类 `meets / minor_issue / major_issue / not_assessable`，每个
   维度提供自己的锚点；不把 ordinal 类别伪装成等距数值；
3. **combine：** 绝对评审一次只看一个 blind variant，机器汇总保留分类分布与 pairwise exact
   agreement；随机呈现和 variant 映射留给未来 assignment/UI 生命周期；
4. **decline：** 不在没有真实 pilot 时预先选择 Fleiss kappa、Krippendorff alpha 或 agreement CI。
   同一 item 内的 reviewer pairs 并不独立，直接套 Wilson 会给出过度自信区间。Pilot 后应预注册
   与抽样/量表匹配的 chance-corrected 指标和按 item 重采样的区间方法。

## 4. Rubric v1

Rubric revision 固定为 `resume-human-review-v1`，一次 batch 不能混入其他 revision。

| Dimension | 评审问题 | `meets` | `minor_issue` | `major_issue` | `not_assessable` |
| --- | --- | --- | --- | --- | --- |
| `factual_fidelity` | 重要陈述是否都能由候选人证据支持且不矛盾？ | 重要陈述都有证据 | 仅有局部含糊或轻微过度表达 | 存在重要无依据、捏造或矛盾陈述 | 提供的源证据不足以判断 |
| `requirement_focus` | 内容是否优先回应 JD 的核心要求而非泛化改写？ | 重点与核心要求一致 | 有少量错位或遗漏 | 主要重点错误、泛化或遗漏核心要求 | JD 证据不足以判断 |
| `evidence_specificity` | 关键匹配是否使用具体、相关、可核验的候选人证据？ | 一贯具体且相关 | 少量表述过泛或证据连接较弱 | 大量空泛表述或证据错配 | 候选人证据不足以判断 |
| `clarity` | 在不改变事实的前提下是否清晰、简洁且组织合理？ | 清晰简洁、结构合理 | 有局部冗余或轻微理解障碍 | 明显难读、混乱或妨碍理解 | 输出无法完整查看或语言能力不足 |

`overallRecommendation` 只允许 `accept / revise / reject / not_assessable`，它是工作流建议，不是四个
维度的数学平均。一个 `major_issue`，尤其事实保真问题，可以直接导致 `reject`；聚合器不替评审者
或未来政策自动推导 recommendation。

Issue code 使用固定枚举，不允许自由文本：`unsupported_claim`、
`contradicted_candidate_evidence`、`omitted_must_have`、`irrelevant_emphasis`、`vague_evidence`、
`unclear_language`、`poor_content_organization`、`insufficient_source_evidence`、
`requires_domain_expert`。

## 5. 记录与安全汇总契约

输入 batch：

- `version: 1` 与 literal rubric revision；
- 0–10,000 条 review，防止误输入无界数组；
- `assignmentId`、`reviewerPseudonym`、`caseId`、`blindedVariantId` 都是有界 stable code；
- blind variant 必须使用 `blind-` 前缀，reviewer pseudonym 使用 `reviewer-`，assignment 使用
  `assignment-`；这降低把真实姓名或 Provider 名直接放入字段的概率，但不能替代流程审计；
- ratings 是四个固定维度的 strict object；issue code 唯一且有上限；
- 同一 assignment ID 不能重复，同一 reviewer/case/blind variant 不能重复计数；
- strict Schema 拒绝 `notes`、原始 request、resume、completion、provider、model 和其他额外字段。

输出 report：

- 只返回 revision、总 review 数、按首次出现顺序的 case/blind variant aggregate；
- 每个 aggregate 返回 review 数、四维分类计数、overall recommendation 计数和固定 issue code 计数；
- agreement 对每个维度和 overall recommendation 报告 reviewer pair comparisons、exact matches 和
  四位小数 rate；没有至少两份同 item 评审时 rate 为 `null`，不能产生 `NaN`；
- 不返回 assignment ID 或 reviewer pseudonym，也没有自由文本承载面。

Pairwise exact agreement 是描述性诊断，不校正偶然一致，也不是“评审者已校准”的证明。未来 pilot
必须同时报告 percentage agreement、预注册的 chance-corrected 指标、区间、rubric revision、样本
构成、评审者类型/资格、随机化方式、排除规则和争议裁决流程。

## 6. RED → GREEN 记录

1. **公开入口与最小汇总：** RED 时测试无法从包入口导入人评 Schema、rubric 和汇总函数；GREEN
   后单份合法 blind review 可以解析，并按固定四维分类、recommendation 和 issue code 输出计数。
2. **固定分类与有界输入：** 重复 issue code 和 10,001 条 review 起初可进入待聚合输入；增加唯一性
   refine 和 batch 上限后 GREEN，并保留 issue 数量上限。strict object 同时拒绝自由文本 notes、
   Provider/model 字段与其他未声明数据。
3. **身份与重复提交：** RED 时重复 assignment，以及同 reviewer 对同一 case/blind variant 的重复
   review 会被累计；batch 级 `superRefine` 后在聚合前拒绝两类重复，并要求三类 opaque 标识使用固定
   前缀和有界 stable code。
4. **描述性一致率：** RED 时 report 没有 agreement 字段；GREEN 后按每个 case/blind variant 的
   分类计数计算 reviewer pair comparisons 与 exact matches，不做 O(n²) reviewer 两两枚举，也不把
   ordinal label 求平均。
5. **分组、顺序与空集合：** 回归证明 case/blind variant 不混组、aggregate 保持首次出现顺序；少于
   两份 review 的 item 不进入 agreement 分母，空 batch 的 rate 为 `null` 且序列化不出现
   `NaN`/`Infinity`。
6. **安全报告：** 测试注入 assignment/reviewer 敏感标记，证明 report 不返回两类标识；Schema 拒绝
   未盲化 variant、非 pseudonymous reviewer 和其他 rubric revision。

## 7. 实现与验证证据

开发契约位于 `packages/resume-agent/src/evaluation/human-review.ts`，并由根包入口导出。测试只调用
公开 Schema、rubric 和 `summarizeResumeHumanReviews`，没有 mock 内部函数。当前验证结果：

- `human-review.test.ts`：14 个测试通过；
- runner、campaign、公开岗位 fixture 与 human review：4 files / 55 tests 通过；
- Resume Agent 全包：16 files / 246 tests 通过；
- human-review module 的 statements、branches、functions、lines 均为 100%；
- Resume Agent TypeScript、ESM/DTS build、目标 Biome 与 `git diff --check` 通过；
- `pnpm license:check` 返回 0，但环境缺少 `addlicense` binary，因此脚本跳过实际扫描；两个新增
  TypeScript 文件已确认保留完整 MIT header。

这些结果证明开发期记录、校验、聚合与脱敏契约，不证明评审者能够稳定判断真实生成质量。

## 8. Evidence ledger

| 字段 | RA-010C-E1 记录 |
| --- | --- |
| Parent / lifecycle | RA-010C：模型结果 → 盲化人工评审记录 → 安全分布与一致性诊断 |
| Feature | 用任务特定 rubric 记录人工质量判断，同时避免把评审身份和敏感案例内容带入报告 |
| Delivery state | Implemented for development（非 Enabled / Operational） |
| Current state | 版本化四维 anchored rubric、strict/bounded review Schema、重复提交拒绝、安全分类聚合与描述性 pairwise exact agreement 已从根包导出；尚无 assignment UI 或真实 review |
| Primary evidence | OpenAI Evaluation Best Practices，2026-09-16 查阅 |
| Independent evidence | van der Lee et al. 2019、Howcroft et al. 2020、Mousavi et al. 2022（ACL Anthology） |
| Decision | Adapt 四维任务特定 anchored categories；combine blind identifiers 与安全分布；decline 无 pilot 的 ordinal mean、chance correction 和 CI |
| Edge cases | 空 batch、未知字段、PII/内容泄露、重复 assignment、同 reviewer/item 重复、混合 revision、单 reviewer 无 agreement、N/A、一致与不一致 reviewer pairs、顺序稳定性、无界数组 |
| Acceptance | 14 个公开行为测试；四个 Eval 文件共 55 tests；Agent 全包 246 tests；模块 100% coverage；TypeScript、build、Biome、license 与 diff check |
| Coverage | Partial |
| Historical gap | backfilled；RA-010C 已把人工 rubric 列为 Planned，但此前没有 feature-specific 人评方法证据 |
| Gap origin | `resume-agent-public-job-evaluation.zh-CN.md` 的 RA-010C-E 行 |
| Remaining gap | 真实 assignment/UI、随机化、招募/资格、授权数据、pilot、chance-corrected agreement、CI、裁决、持久化和 LLM judge calibration |
| Last reviewed | 2026-09-16，基线 commit `26f68ea`，Zod 4.3.6、Vitest 4.0.16 |

## 9. 参考资料

- OpenAI Evaluation Best Practices：
  <https://developers.openai.com/api/docs/guides/evaluation-best-practices>
- van der Lee et al., 2019, *Best practices for the human evaluation of automatically generated text*：
  <https://aclanthology.org/W19-8643/>
- Howcroft et al., 2020, *Twenty Years of Confusion in Human Evaluation*：
  <https://aclanthology.org/2020.inlg-1.23/>
- Mousavi et al., 2022, *Evaluation of Response Generation Models: Shouldn’t It Be Shareable and Replicable?*：
  <https://aclanthology.org/2022.gem-1.12/>
- 自动 Eval 与公开 JD development corpus：
  [`resume-agent-public-job-evaluation.zh-CN.md`](./resume-agent-public-job-evaluation.zh-CN.md)
