# Resume Agent 确定性评估框架 Feature Brief

> 功能 ID：RA-010 / 第一个纵向切片
>
> 状态：Implemented（development-only；非 Enabled / Operational）
>
> 证据覆盖：Partial
>
> 调研基线：2026-09-16，`7a723fa`

## 1. 用户问题与成功结果

Resume Agent 目前有确定性单元测试和安全 telemetry，但没有一套可复用的案例契约来比较 prompt、模型或 Agent Runtime。一次 fake 成功也无法回答“真实模型在同一批任务上是否更可靠”。

本切片的成功结果是：维护者可以用同一批经过验证的匿名 `TailorResumeRequest` 案例调用任意 `execute(request)` 实现，得到不保存输入或生成内容的逐案例断言与汇总指标。首期只建立离线、确定性评分机制；不调用真实模型，不使用 LLM-as-a-judge。

## 2. 范围与非目标

范围：

- 版本为 `1`、有稳定 case ID 的 `EvalCase` Schema；
- 可选断言：目标职位、最低 requirement coverage、最低 must-have coverage、必须出现和禁止出现的 quality warning code；
- 仅依赖函数注入的执行 seam；
- 安全的逐案例结果和多案例聚合；
- 一份完全虚构的开发 fixture；
- 通过 fake 验证 runner 的确定性行为与脱敏边界。

非目标：

- 调用真实 Provider 或读取 Provider 凭证；
- 判断措辞质量、事实忠实度或整体简历质量；
- LLM-as-a-judge、人工标注工具或生产数据导入；
- 重复采样、方差/置信区间、token 与费用统计；
- CI 回归门禁、结果持久化或可视化 dashboard。

## 3. 调研证据与决策

### 3.1 本地证据

- `TailorResumeRequestSchema` 已经是输入真相源，重复定义 request 会造成漂移；因此 `EvalCase` 组合现有 Schema。
- `TailorResumeResult` 已经稳定提供 `jobSpec.targetTitle`、coverage 和结构化 quality warning；runner 只需要这些字段，不需要认识具体 Agent 类。
- 现有 workflow 测试中的 fake `LlmClient` 证明依赖注入可使单元测试稳定，但它只验证预编排响应下的代码路径，不代表模型能力。
- 现有结构化输出设计禁止在 trace、错误和 Eval 汇总中保留 prompt、简历、原始 completion 或异常正文；本框架继承这一安全约束。

### 3.2 外部一手证据

OpenAI《Evaluation best practices》（2026-09-16 查阅）建议采用任务特定、可自动评分、持续扩充的数据集，并明确指出生成式 AI 具有随机性，传统软件测试不足以证明模型表现；自动指标还需要人工反馈校准。该指南同时列出 LLM judge 的位置偏差和冗长偏差，并要求在扩大使用前先验证其与人工标签的一致性。

这改变了两项设计：

1. **采用**小型任务特定 deterministic assertions，先建立可重复的比较底座；不把通用文本指标塞进首期。
2. **暂缓** LLM-as-a-judge。当前没有人工 gold labels、明确 rubric 或一致性证据，直接加入 judge 只会引入第二个未校准的随机模型。

当前 OpenAI 文档还说明其托管 Evals 平台正在弃用。RA-010 的持久需求是可移植案例和结果契约，因此不绑定某个托管评估产品。

## 4. 契约与深模块 seam

模块只有一个调用接口：

```ts
runEvaluation(cases, execute) -> EvalReport
```

`execute(request)` 返回 runner 实际需要的最小观察面：目标职位、两项 coverage 和 quality warning code。完整的 `TailorResumeResult` 结构兼容该观察面，因此真实 Agent 可直接注入；其他 runtime 也只需返回相同观察结果。

复杂性留在 runner 内：case 的运行时校验、顺序执行、断言生成、异常归一化、计时和聚合都不泄漏给调用方。删除该模块会迫使每个 prompt/model/runtime 比较者重复这些规则，因而这个 seam 具有足够深度。

确定性含义有明确边界：相同的已验证 case 和相同 execute 输出会产生相同断言、failure code 与聚合数值；`durationMs` 是观测值，本身不承诺逐次相等；真实模型输出也不属于本切片的确定性保证。

## 5. 状态转换与评分语义

```text
dataset
  -> validate every case
  -> execute sequentially
     -> returned -> evaluate all configured assertions
        -> all pass -> passed
        -> any fail -> assertion_failed
     -> throws/rejects -> execution_failed
  -> aggregate
```

- `targetTitle` 使用精确匹配；
- 最低 coverage 使用包含阈值的 `>=`；
- warning 断言读取 `quality.warnings[].code`，不读取 message；
- 未配置期望时，只要 execute 成功且返回观察结果，该 case 即通过；
- execute 失败时没有 coverage 观察值；平均 coverage 只对成功返回的 case 计算，若没有可评分 case 则为 `0`；
- pass rate 与 coverage 平均值统一保留四位小数，避免把浮点噪声写入比较报告；
- 空数据集固定返回全零计数和全零比率，不产生 `NaN`；
- failure code 只允许稳定枚举，报告不包含捕获到的异常正文。

## 6. 隐私与匿名化要求

仓库 fixture 必须完全虚构，并使用明显的示例身份与 `.invalid` 联系地址。不得提交真实简历、真实候选人联系方式、客户/雇主机密、API key、访问令牌、原始模型 completion 或生产日志摘录。

未来从真实运行构造数据集时，“删除姓名”不等于完成匿名化。进入版本库或共享评估存储前至少需要：确认使用授权；删除直接标识符；泛化组织、项目、地点和精确时间等准标识符；只保留目标行为需要的最少字段；人工复核重识别风险；定义访问控制、加密、保留与删除期限。无法可靠去标识的案例不得进入共享数据集，可以改写成保留失败机制的合成案例。

报告采用数据最小化：只保存 case ID、布尔断言、耗时、稳定 failure code 和聚合数值；不保存 request、resume 正文、artifact content、模型 completion 或异常原文。

## 7. 为什么 fake/unit test 不是真实模型 Eval

内存 fake 的输出由测试作者预先安排，因此它能证明 Schema、seam、断言、聚合和脱敏按契约工作，却不能证明：

- prompt 是否能让真实模型正确理解 JD；
- 不同模型或 Provider 的输出分布；
- 同一模型重复运行的波动和长尾失败；
- 生成简历是否事实忠实、自然且对人有用；
- 真实延迟、token、费用、限流与 Provider 故障率。

所以本切片是 Eval infrastructure 的开发证据，不是 Resume Agent 质量达标证据。

## 8. 失败模式与边缘案例

1. case version、ID、request 或 coverage 阈值非法：Schema 在执行前拒绝；
2. required 与 forbidden warning code 冲突：Schema 拒绝自相矛盾的 case；
3. 一个 case 多个断言失败：保留每个布尔断言，case failure code 归一为 `assertion_failed`；
4. execute 抛出包含简历、密钥或 completion 的异常：只返回 `execution_failed`；
5. 部分 case 执行失败：pass rate 仍以全部 case 为分母，coverage 平均值不伪造失败 case 的分数；
6. 空集合：返回定义好的零值，不除零；
7. case ID 重复：数据集校验拒绝，避免结果归属含糊；
8. warning message 含敏感文本：runner 只观察 code，报告不复制 message。

## 9. 验收与 TDD 记录

按以下单一行为依次完成 RED -> GREEN：

1. **Schema 拒绝非法 case**：RED 为契约模块不存在；GREEN 组合现有 `TailorResumeRequestSchema`，并拒绝错误 version、不稳定 ID、非法 request、越界 coverage 和冲突 warning 期望。
2. **满足所有期望的 case 通过**：RED 为 runner 模块不存在；GREEN 建立 `runEvaluation(cases, execute)` 和虚构 fixture，证明所有五类断言通过。
3. **断言失败**：RED 暴露了 false assertions 仍被算作通过；GREEN 以全部断言的合取决定 case 状态，并归一为 `assertion_failed`。
4. **异常脱敏**：RED 时带敏感字符串的异常直接冒泡；GREEN 捕获异常，只保留空 assertions 和 `execution_failed`，序列化报告不含 request、简历内容或异常正文。
5. **多案例聚合**：RED 暴露 `0.6000000000000001` 等浮点噪声；GREEN 聚合通过、断言失败和执行失败，并将 rate/average 稳定舍入到四位小数。
6. **空数据集**：RED 得到 `passRate: NaN`；GREEN 固定返回全零报告且不调用 execute。
7. **重复 case ID**：RED 时同名 case 被执行两次；GREEN 增加数据集级唯一性校验，在执行前拒绝重复 ID。

实现后的目标测试命令：

```text
pnpm agent test src/evaluation/runner.test.ts
```

结果：1 个测试文件、11 个测试通过。测试只通过公开 Schema 和 runner seam，使用内存 fake，没有 mock 内部模块。

提交前验证：

```text
pnpm agent test src/evaluation/runner.test.ts
pnpm --filter @yamlresume/resume-agent exec tsc --noEmit
pnpm check:ci
git diff --check
```

2026-09-16 验证记录：

- `pnpm agent test src/evaluation/runner.test.ts`：通过，1 个文件、11 个测试；
- `pnpm --filter @yamlresume/resume-agent exec tsc --noEmit`：通过；
- 本任务四个 TypeScript 文件的定向 Biome 检查：通过；
- `git diff --check`：通过；
- `pnpm license:check`：命令成功，但环境没有 `addlicense` binary，脚本跳过实际扫描；四个新增 `.ts` 文件已人工确认具有完整 MIT header；
- `pnpm check:ci`：首次运行在共享工作区中其他线程尚未完成的 `packages/agent-web/**`、`packages/resume-agent/src/workflow/**`、`packages/resume-agent/src/index.ts` 与 `packages/resume-agent-api/**` 格式/类型问题处失败；这些文件不属于 RA-010 允许修改范围，未由本任务改动。

## 10. 后续真实评估路线

1. 在受控环境注入真实 execute adapter，并把 provider、model、prompt revision 和 runtime revision 作为运行元数据，而不是写入 case；
2. 建立经授权、去标识并人工复核的代表性数据集，分开 development set 与 held-out set；
3. 每个配置对同一 case 重复运行，报告均值、离散程度、失败分布和置信区间，而不是只选一次最好结果；
4. 接入 token、费用、端到端延迟、重试和 Provider 错误率，按配置汇总；
5. 为事实忠实、表达质量等非确定性维度建立清晰 rubric 和盲化人工标注；记录标注者一致性与争议处理；
6. 只有 judge 与人工 gold labels 达到预设一致性后，才将 LLM judge 用于规模化辅助评分，并持续检查位置、冗长、自偏好和模型漂移；
7. 经过真实数据、重复运行和人工校准后，才评估是否把某些阈值提升为 CI 门禁。

## 11. Feature evidence ledger

| 字段 | RA-010 记录 |
| --- | --- |
| Parent / lifecycle | Resume Agent 质量评估：案例验证 -> 执行 -> 确定性断言 -> 安全汇总 |
| Feature | 用同一批匿名案例比较 prompt、模型和 runtime 的基础设施 |
| Delivery state | Implemented（development-only；非 Enabled / Operational） |
| Current state | 版本化 EvalCase/数据集 Schema、顺序 runner、安全逐案例结果、聚合和一份虚构 fixture 已实现 |
| Primary evidence | OpenAI Evaluation best practices，2026-09-16 查阅 |
| Independent evidence | 本地 `TailorResumeRequestSchema`、`TailorResumeResult`、quality warning 与 fake workflow tests |
| Decision | Adapt 任务特定 deterministic checks；暂缓托管平台、真实模型与 LLM judge |
| Edge cases | 非法/冲突 case、断言失败、敏感异常、部分失败聚合、空集合、重复 ID、敏感 warning message |
| Acceptance | 七个纵向 TDD 行为、11 个测试和四条提交前命令 |
| Coverage | Partial |
| Historical gap | None；该行此前明确为 Planned/Partial |
| Remaining gap | 真实匿名数据、真实模型、重复采样、方差/成本、人工标注与 judge 校准均未实现 |
| Last reviewed | 2026-09-16，基线 `7a723fa`，Zod 4.3.6、Vitest 4.0.16 |

## 12. 参考资料

- OpenAI Evaluation best practices：
  <https://developers.openai.com/api/docs/guides/evaluation-best-practices>
- 本仓库结构化输出可靠性设计：
  [`resume-agent-structured-output-reliability.zh-CN.md`](./resume-agent-structured-output-reliability.zh-CN.md)
- 本仓库 Resume Agent 后端设计与现有 evidence ledger：
  [`resume-agent-backend.md`](./resume-agent-backend.md)
