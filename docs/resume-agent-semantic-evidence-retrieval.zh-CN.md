# Resume Agent 语义证据检索 Feature Brief（RA-018）

> 状态：Implemented for development；默认关闭（`RESUME_AGENT_SEMANTIC_MATCHING` 开关），未 Enabled
> 最后复核：2026-09-23
> 代码：`packages/resume-agent/src/retrieval/`、`evaluation/retrieval.ts`、提交 13479eb / b7b3490 / ac3aed2
> 范围：把「需求 ↔ 候选人证据」的匹配从纯词法扩展为词法 + 向量混合检索，并用它给草拟阶段
> 提供聚焦的证据提示。不改变 Eval 裁判。不引入向量数据库。
> 依赖：RA-010（确定性 Eval）、RA-010C（公开岗位派生 campaign）、`matching/match.ts`

## 1. 用户问题与成功结果

用户上传材料后，工作台展示「哪些岗位需求有证据支撑、哪些缺失」。现在的匹配器是 148 行的
子串与 token 包含判断（`matching/match.ts`）。它对换了说法的证据是盲的：

- JD 写「provision Kubernetes clusters on bare metal」，简历写「operated k8s workloads」→ 判 missing；
- JD 写「熟悉向量检索与 Embedding」，简历写「用 FAISS 做过语义搜索」→ 判 missing；
- 上传的整份文档是**一条**证据项（`artifactEvidence` 把全文当一个 item），任何 token 命中都
  把整份文档标成该需求的证据，用户看不出是哪一段。

后果有三层：用户看到错误的缺口、Agent 可能就已有事实追问、草拟 prompt 里没有「这条需求对应
这几条证据」的指引。2026-09-16 的真实 campaign 中，两个确定性的 coverage 断言失败正是这一类
（见公开岗位评估 §9）。

可观察的成功结果：

1. 在一组人工标注的「需求 → 相关证据」金标对上，混合匹配器的召回率显著高于词法匹配器，
   同时精确率不明显下降（具体门槛见 §9）；
2. 工作台里 MatchReport 对换说法的证据给出 `partial` 而不是 `missing`，rationale 说明是语义匹配及分数；
3. 草拟 prompt 收到每条需求的 top-k 证据 ID 提示；当证据索引很大时只喂相关子集；
4. 上传文档被切成可引用的段落，证据 ID 精确到段。

## 2. 范围与非目标

做：

- `EmbeddingClient` 端口（与 `LlmClient` 同款：可注入、可 fake）；
- 确定性的 hash n-gram embedding（测试与离线 demo 用，只捕捉表面相似）；
- 本地 transformers.js 适配器（`Xenova/multilingual-e5-small`，中英双语，384 维，q8 量化）；
- 长证据切段、混合匹配报告、草拟提示；
- 检索金标集与 precision / recall / F1 评测（零 token、确定性）；
- 可复用的 campaign 命令，让 before / after 可以重跑。

不做：

- 不改变 `transparency/quality.ts` 里的 coverage 计算（见 §4 裁判分离）；
- 不引入向量数据库、不做持久化索引；每次 Run 现算，证据规模在几十到几百条；
- 不做 rerank 模型、不做查询改写；
- 不把 embedding 调用交给付费 Provider：**DeepSeek 没有 embeddings 接口**（2026-09-23 探针：
  `text-embedding-3-small`、`embedding-2`、`BAAI/bge-m3` 全部 404），本地模型不依赖新的密钥；
- 不宣称语义匹配「更准」，直到金标集和 campaign 给出数字。

## 3. 为什么需要向量而不是更多规则

同义改写、中英混排、缩写（k8s / Kubernetes、CI / GitHub Actions）、上下位词（PostgreSQL / 关系
型数据库）无法用有限的同义词表穷举；每加一条规则都在过拟合当前三个案例。向量相似度把
「说法不同、意思相近」变成可度量的分数，规则只保留在确定性的部分：切段、去重、阈值、top-k。

但向量不是裁判。它给出候选与分数；是否算「有证据」由阈值和金标集校准决定，最终事实校验
仍由 Schema 与不可变事实规则完成。

## 4. 确定性边界

### 4.1 裁判分离（最重要的决定）

`buildQualityReport` 内部也调用 `buildMatchReport` 计算 `requirementCoverage`；Eval 的 coverage
断言读的就是它。如果把匹配器直接换成语义的，等于让新匹配器给自己打分：同一份简历会因为
裁判更宽松而「变好」，before / after 不可比。这正是 RA-010C §3.1 记录过的「评分面与被评对象
同源」陷阱。

因此：

- **草拟阶段**使用混合匹配（选证据、给提示）；
- **质量报告与 Eval 裁判**保持词法匹配 + 金标关键词不变；
- 语义匹配的效果只能通过两条独立通道证明：金标集上的 P/R/F1，以及固定裁判下最终简历的
  coverage 变化。

若将来要把语义匹配提升为裁判，必须作为版本化变更（报告里带 `matcherRevision`），并同时
保留旧裁判一段时间做对照。

### 4.2 阈值必须校准，不能拍脑袋

2026-09-23 对 `multilingual-e5-small` 的探针（q8，mean pooling，L2 归一化）：

| 查询 | 段落 | 余弦 |
| --- | --- | ---: |
| Provision and operate Kubernetes clusters on bare-metal hardware | Operated AWS Kubernetes workloads and joined an on-call rotation. | 0.840 |
| 同上 | Ran k8s clusters on physical servers in a colocation data centre. | 0.854 |
| 同上 | Presented findings to stakeholders and maintained dashboards. | 0.758 |
| 熟悉向量检索与 Embedding | 用 FAISS 做过语义搜索，接入过 bge 向量模型。 | 0.884 |
| 同上 | 负责前端页面开发与 CSS 动画。 | 0.850 |

相关与无关之间的差距只有 0.03 到 0.10。e5 系列的余弦分布本来就压缩在高区间，固定阈值 0.7
会把所有东西判成匹配。因此阈值是模型相关的配置，默认值由 §7 的金标集选出，报告里记录
模型 ID 与阈值；换模型必须重新校准。

### 4.3 其余由代码控制的部分

- 切段：只对 `uploaded-document` 这类长证据切段（按空行、换行、句末标点），每段 ≤ 300 字符，
  ID 形如 `artifact.<id>#<n>`，段落映射回原证据 ID 以保持引用可追溯；
- 去重：同一需求的多段命中同一原证据只记一次；
- top-k：每条需求最多 k 条语义证据（默认 3）；
- 词法优先：词法命中的需求不再做语义补充，避免把弱语义证据混进强词法证据；
- 只补缺口：语义只为词法判 missing 的需求找证据，状态最高为 `partial`，rationale 带分数；
- 预算：embedding 调用不计入 LLM 预算，但每次 Run 只 embed 一次证据集，查询按需求条数；
- 失败退化：embedding 客户端失败时回退到纯词法并写 warning，不让整个 Run 失败。

## 5. 输入、输出和数据来源

- 输入：`JobSpec.requirements`（text + keywords）、`Evidence[]`（来自 `buildEvidenceIndex` 与
  `artifactEvidence`）；
- 输出：`MatchReport`（结构不变，额外可选字段 `semantic`：模型 ID、阈值、每条语义命中的
  requirementId / evidenceId / score）；草拟 prompt 新增 `REQUIREMENT EVIDENCE HINTS` 块；
- 模型来源：`Xenova/multilingual-e5-small`（Apache-2.0，ONNX，约 130 MB 含 tokenizer），首次
  运行时下载到 transformers.js 缓存目录；国内环境需要代理或 `HF_ENDPOINT=https://hf-mirror.com`；
- 隐私：向量在进程内存中，不落盘、不外发；本地模型不把简历发给任何服务。

## 6. 状态与恢复

匹配是纯函数式的阶段（`match_evidence`），不改变 Run 状态机。混合匹配是异步的（要 embed），
`complete()` 内部 await；失败退化到词法并加 warning，trace 记录 `matcher: 'lexical' | 'hybrid'`
与模型 ID。checkpoint 不保存向量。

## 7. Eval 与指标

### 7.1 检索金标集（确定性、零 token）

`evaluation/fixtures/retrieval-paraphrase.ts`：约 20 组合成的「需求 → 证据列表 → 相关证据 ID」，
覆盖英文同义改写、中文同义改写、缩写、中英混排、以及必须判 missing 的负例。评测函数
`evaluateRetrieval(cases, matcher)` 输出逐 case 命中与宏平均 precision / recall / F1。

三个被比较的匹配器：词法（现状）、hash n-gram 混合（无模型，表面相似）、e5 混合。前两个进
单元测试；e5 通过脚本运行并把结果记入本文 §10。

门槛（development）：e5 混合的召回率 ≥ 词法 + 0.3，精确率 ≥ 0.8，负例全部保持 missing。
达不到就调阈值或承认失败，不改金标。

### 7.2 固定裁判下的 LLM campaign

同一 prompt revision、同一模型（DeepSeek）、同一裁判（词法 coverage + 金标关键词），比较
`matcher = lexical` 与 `matcher = hybrid`，每种至少 3 轮，报告 Wilson 区间。案例集 = 原 3 个
公开 JD 派生案例 + 2 个改写密集的合成案例。

预期：hybrid 不应降低任何案例的通过率；改写密集案例的 coverage 应上升。若 hybrid 没有可测
差异，也如实记录：那说明在小证据集上模型本来就看得到全部证据，收益要在大输入下才出现。

## 8. 失败模式

1. 模型未下载且无网络：适配器抛稳定错误 → 退化到词法 + warning；
2. 模型加载慢（首次约 15 s）：只在需要时加载，进程内缓存 pipeline；
3. 余弦区间压缩导致全部命中：阈值校准 + top-k 上限 + 只补缺口；
4. 长文档切段切碎了一句话：按标点与换行切，段落有最小长度合并；
5. 中英混排 token 化差异：金标集包含混排样本；
6. 对抗输入（简历里塞满 JD 关键词）：不属于本切片，事实校验与人评负责。

## 9. 测试证据（2026-09-23）

| 行为 | RED | GREEN | 证据 |
| --- | --- | --- | --- |
| 余弦与归一化 | 模块不存在 | 平行向量 1、正交 0、零向量 0、长度不等抛错 | `retrieval/embeddings.test.ts` |
| hash embedding 确定性 | 模块不存在 | 同文两次同向量且单位长；共享子串高于无关文本（中英）；空文零向量；维度 < 8 拒绝 | 同上 |
| 长证据切段 | 正则在多行模式下用 `$` 结束懒匹配，一段文档被截成一行；标题被并进前一段 | 按段落与句末标点切、编号 `id#n`、短标题并入后一段、尾片并入前一段、拒绝非法边界 | `retrieval/passages.test.ts` |
| 混合匹配只补缺口 | — | 词法命中的需求原样保留；缺口升为 `partial` 且 rationale 带分数；不到门槛保持 missing | `retrieval/hybrid.test.ts` |
| 去重与 top-k | — | 同一文档多段只记一次，上限 `topK`，passage ID 指回证据 ID | 同上 |
| 词法全覆盖时零 embedding 调用 | — | 调用计数为 0 | 同上 |
| 背景差值规则 | 固定阈值语言偏置（§12.1） | 每查询取背景均值 + margin；背景向量按客户端缓存，第二次调用不重算 | 同上 |
| embedding 失败退化 | — | 返回词法报告并标 `fallback`；Run 完成并带 warning；trace 记 `semanticFallback` | 同上、`workflow/agent.test.ts` |
| 草拟提示块 | — | draft prompt 含 `REQUIREMENT EVIDENCE HINTS` 并标 `(semantic)`；JD 分析 prompt 不含 | `workflow/agent.test.ts` |
| 裁判分离 | — | 有无检索的 `quality` 报告逐字相同 | 同上 |
| 金标集与评测 | 词法 recall 0.056 | Schema 拒绝池外 ID 与重复 ID；oracle 得 1/1/1；贪心与沉默匹配器的 P/R 正确记账 | `evaluation/retrieval.test.ts` |
| 真实模型适配器 | — | 384 维；改写句高于无关句；不存在的模型报 `EmbeddingModelUnavailableError` | `retrieval/transformers-embeddings.test.ts`（真模型用例需 `RESUME_AGENT_TEST_EMBEDDINGS=1`） |
| API 开关 | — | `hash` 时 capabilities 公布 `runtime.semanticMatching`；未设不公布；非法值启动失败 | `resume-agent-api/src/server.test.ts` |

命令与结果（2026-09-23）：`pnpm agent test` 25 files / 312 tests（1 skipped：真模型用例）；
`pnpm agent-api test` 7 files / 123 tests；两包 `tsc --noEmit` 通过；`pnpm agent build` ESM/DTS 通过；
`RESUME_AGENT_TEST_EMBEDDINGS=1 NODE_OPTIONS=--use-env-proxy pnpm agent test src/retrieval/transformers-embeddings.test.ts` 3 tests 通过。

## 10. 决策记录

| 选项 | 决定 | 原因 |
| --- | --- | --- |
| Provider 端 embeddings API | 拒绝 | DeepSeek 无此接口（2026-09-23 探针三种模型名全部 404）；引入新付费依赖与密钥 |
| 本地 transformers.js + e5-small | 采用 | 中英双语、约 130 MB、无密钥、可复现；首次加载约 15 s，7 句 27 ms |
| bge-m3 | 延期 | 更强但 q8 仍约 570 MB，首次体验太重 |
| 向量数据库 | 拒绝 | 证据规模几十到几百条，内存现算足够 |
| 语义匹配当裁判 | 拒绝 | 裁判同源；先证明再版本化升级 |
| 只做同义词表 | 拒绝 | 过拟合当前案例 |
| 固定余弦阈值 | 拒绝 | 语言偏置：0.85 时中文召回 1.0、英文 0.1（§12.1） |
| 背景差值 margin = 0.10 | 采用为默认 | 唯一满足 §7.1 门槛的规则：P 0.82 / R 0.50，语义部分陷阱零误报 |
| 背景差值 margin = 0.08 | 记录为备选 | F1 最高（0.74）但 P 0.76 低于 0.8 门槛 |
| 默认开启语义匹配 | 拒绝 | §12.2 的 campaign 没有测出下游差异；先在工作台缺口展示上验证价值 |

## 11. 剩余缺口

- 金标集是合成的，20 组；真实简历上的表现未验证；
- margin 只对 e5-small 校准；换模型必须重跑 `scripts/retrieval-gold.ts`；
- 长文档切段策略简单，表格与项目符号布局未专门处理；
- 未做 rerank；
- campaign 只有 5 案例 × 3 轮，且没有测出差异（§12.2）；中文案例在混合模式下的劣化未定因；
- 工作台尚未展示语义分数与 passage 定位；
- campaign 报告的 `runtimeRevision` 记录的是运行时 HEAD（`00d855c`），而 RA-018 代码当时尚未提交；
  真实代码状态是随后提交的 13479eb / b7b3490 / ac3aed2。下次运行前先提交。

## 12. 校准与 campaign 结果（2026-09-23）

### 12.1 金标集（零 token，`scripts/retrieval-gold.ts`）

20 组合成案例：9 英文、5 中文、3 中英混排、3 陷阱（不应有证据）。下表为通过完整混合流水线
（词法优先、只补缺口、top-k 3）得到的 micro 指标；`trapFPs` 恒为 1 是词法裁判自带的
`Go` 子串误报（"go-to-market"），语义部分没有新增陷阱误报。

| 匹配器 | 接受规则 | P | R | F1 | exact | en / zh / mixed 召回 |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| 词法（现状） | — | 0.50 | 0.056 | 0.10 | 3/20 | 0.1 / 0 / 0 |
| hash n-gram | margin 0.10 | 0.75 | 0.17 | 0.27 | 5/20 | 0.3 / 0 / 0 |
| e5-small | absolute 0.80 | 0.58 | 0.83 | 0.68 | 8/20 | 0.7 / 1.0 / 1.0 |
| e5-small | absolute 0.85 | 0.73 | 0.44 | 0.55 | 8/20 | 0.1 / 1.0 / 0.67 |
| e5-small | absolute 0.88 | 0.75 | 0.17 | 0.27 | 5/20 | 0.1 / 0.2 / 0.33 |
| e5-small | margin 0.06 | 0.54 | 0.83 | 0.65 | 7/20 | 0.8 / 1.0 / 0.67 |
| e5-small | margin 0.08 | 0.76 | 0.72 | 0.74 | 11/20 | 0.6 / 1.0 / 0.67 |
| **e5-small** | **margin 0.10（默认）** | **0.82** | **0.50** | **0.62** | **10/20** | **0.4 / 0.6 / 0.67** |
| e5-small | margin 0.12 | 0.83 | 0.28 | 0.42 | 7/20 | 0.1 / 0.4 / 0.67 |

结论：固定阈值把语言当成了变量（同一阈值下英文和中文的召回相差一个数量级）；按查询自身
的背景相似度取差值后，两种语言回到同一量级。§7.1 门槛（P ≥ 0.8、R ≥ 词法 + 0.3、语义陷阱
零误报）只有 margin ≥ 0.10 满足。

### 12.2 固定裁判下的 DeepSeek campaign（`scripts/campaign.ts`）

配置：`deepseek-chat`，5 案例（3 个公开 JD 派生 + 2 个改写密集合成）× 3 轮，两种匹配器
各自顺序执行；裁判固定为词法 coverage + 金标关键词。

| 匹配器 | 通过 | 通过率 | Wilson 95% | scored | 平均需求覆盖 | 平均必备覆盖 | 平均耗时 | 失败 |
| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | --- |
| 词法 | 11/15 | 0.733 | [0.48, 0.89] | 13 | 0.602 | 0.662 | 8.7 s | 断言 2、执行 2 |
| 混合 | 11/15 | 0.733 | [0.48, 0.89] | 14 | 0.609 | 0.661 | 10.9 s | 断言 3、执行 1 |

逐案例：Grafana、Anthropic、平台改写案例两种匹配器均 3/3；Cloudflare 词法 0/3（2 次 Provider
执行失败、1 次金标关键词缺失）、混合 2/3（1 次关键词缺失）；中文 AI 应用案例词法 2/3（1 次
覆盖率不足）、混合 0/3（2 次覆盖率不足、1 次草稿违反不可变事实校验）。

**结论：没有可测差异。** 通过率相同，覆盖率差 0.007，区间完全重叠。这与 §7.2 预先登记的
备选解释一致：这些案例的证据索引只有 13 到 19 条短文本，草拟 prompt 本来就装得下全部证据，
模型自己会把 k8s 改写成 Kubernetes（冒烟运行中词法匹配器在平台改写案例上覆盖率就是 1.0）。
提示块在这个规模上没有给模型新信息。

中文案例的劣化（2/3 → 0/3）样本太小，不能定因。一个可证伪的假设：提示行标注
`partial (semantic)` 后，模型更倾向保留候选人自己的词汇（FAISS、bge），而词法裁判只认 JD
词汇（向量检索、RAG）。下一步实验：受控运行下统计有无提示时草稿中 JD 关键词的改写次数；
或只对词法命中的需求给提示。在此之前，语义匹配保持默认关闭。

检索本身的收益在两处没有被这个 campaign 度量：工作台的缺口展示（用户看到的是 MatchReport，
不是最终覆盖率），以及 prompt 装不下全部证据的大输入。这两处是下一轮验证的对象。
