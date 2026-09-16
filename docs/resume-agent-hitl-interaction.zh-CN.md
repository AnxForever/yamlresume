# Resume Agent 结构化 Human-in-the-loop 设计与学习记录

状态：RA-011 / Unit 7B 已实现（development-only，不具备进程重启恢复能力）

最后复核：2026-09-16，前置基线提交 `c1f595c`

## 1. 用户结果

当候选人资料缺少会影响简历可信度的重要事实时，Resume Agent 不应猜测，也不应在最终结果里埋下一串无人处理的问题。它应该：

1. 暂停当前 Run；
2. 用稳定、可渲染的协议只提出一个最重要的问题；
3. 支持选项、自定义输入、普通输入框、长文本、数字、日期、URL、文件和确认等控件；
4. 验证用户回答并写回候选人事实；
5. 从必要阶段继续，不重复文件提取和候选人归一化；
6. 保留足够的状态与审计元数据，同时不在公开 Run 或日志中泄露私密原文。

这个切片是简历能力的一部分，也是未来 Career Agent 询问偏好、确认高风险动作、制定学习计划和核实岗位信息时可以复用的交互协议。

## 2. 本单元范围

本单元交付：

- `needs_input` Run 状态；
- 类型化 `InteractionRequest` 与 `InteractionAnswer`；
- 候选人归一化之后的 checkpoint；
- `POST /v1/runs/{id}/answers`；
- 必填、类型、选项与自定义值验证；
- 安全的 `content.*` 字段写回；
- stale answer 与幂等键处理；
- 恢复后从 JD 分析继续；
- 包测试、HTTP 测试、OpenAPI 和学习记录。

本单元不承诺：

- 进程重启后的恢复；
- 多实例共享状态；
- 数据库事务、并发版本锁和长期保留策略；
- 二进制文件回答的上传闭环；
- 草拟、验证等所有阶段的中断场景；
- 顶层 Career Agent 路由、浏览器工具、招聘网站采集或学习计划能力；
- 身份认证、租户隔离、加密和删除策略。

内存 checkpoint 只用于证明协议与恢复语义，因此交付状态最多是 `Implemented for development`，证据覆盖最多是 `Partial`。

## 3. 研究证据与决策

### 3.1 实施前本地证据

- `ResumeTailoringAgent.run()` 原先按“提取 → 归一化 → JD 分析 → 匹配 → 草拟 → 校验 → 渲染”顺序一次执行到底。
- `FollowUpQuestion` 原先只有字段、问题、原因和严重程度；问题只出现在最终结果中，不会暂停。
- RA-009 已有 `RunStore`、异步 Run 和显式阶段状态，但 Store 当时只保存公开 Run，没有内部 checkpoint。
- 公开 Run 与内部可信状态当时还没有分离；增加 checkpoint 后必须避免把请求、候选人资料和回答值直接返回。
- `@yamlresume/core` 的 `ResumeSchema` 可以作为回答写回后的最终领域校验。

### 3.2 外部主要证据

LangGraph interrupts 官方文档（2026-09-16 复核）：

<https://docs.langchain.com/oss/javascript/langgraph/interrupts>

采用的原则：

- 暂停必须与 checkpoint 关联；
- 恢复必须使用同一 Run 标识；
- interrupt payload 必须可序列化；
- 人类回答必须验证后才能继续；
- 恢复节点可能重新执行，副作用与幂等性必须显式设计；
- 生产环境需要 durable checkpointer。

### 3.3 方案选择

| 候选方案 | 决策 | 原因 |
| --- | --- | --- |
| 在最终结果中继续返回自然语言问题 | Decline | 没有暂停、回答、验证和恢复语义 |
| 把整个流程改造成无界 ReAct | Decline | 当前简历流程阶段稳定；循环会扩大成本、测试和安全面 |
| 立即引入 Agent 框架 | Decline for now | 领域状态、交互协议和验收场景尚未稳定，框架不应成为产品模型 |
| 显式状态机 + 深模块 + checkpoint | Adopt | 与现有代码相容，能先证明最小真实恢复闭环，未来可替换运行时 |
| 内存 checkpoint | Adapt for development | 足以测试协议；必须明确不是持久化生产实现 |

可能推翻当前决定的证据：出现多个真正动态、需要循环选工具的能力；手写状态机已无法安全表达并行、长时任务和 durable recovery；或候选框架在同一验收集上显著降低复杂度且不污染领域模型。

## 4. 状态与恢复模型

```text
queued
  -> ingesting_inputs
  -> normalizing_candidate
  -> needs_input
       -> needs_input       （还有下一个重要问题）
       -> analyzing_jd      （所有重要问题已回答）
  -> matching_evidence
  -> drafting
  -> validating
  -> rendering
  -> completed

任意非终态 -> failed
```

归一化成功后保存 checkpoint：

- 已提取的候选人与 JD artifacts；
- 归一化候选人；
- JD 文本与偏好；
- warnings、trace、可选问题与待回答交互；
- checkpoint 版本。

恢复时从 checkpoint 重建 evidence，然后进入 `analyzing_jd`。文件提取和候选人归一化不得再次执行。

## 5. 交互协议

交互请求由服务端定义稳定 ID、目标字段、问题、原因、严重程度、隐私等级、是否必填和控件。控件是判别联合：

- `single_choice`
- `multi_choice`
- `text`
- `textarea`
- `number`
- `date`
- `date_range`
- `url`
- `file`
- `confirm`

选择控件提供 2–5 个建议项，并显式声明是否允许自定义输入。前端按协议渲染，不解析问题文本来猜控件。

首期精度边界是刻意收窄的：`date` 和 `date_range` 只接受真实存在的
`YYYY-MM-DD`，从而使范围比较和校验确定。YAMLResume 本身还能表示年份、月份
或其他可解析日期，但本协议尚未定义精度字段；只有年份/月度证据时应使用文本
控件，不能为满足日期选择器而虚构日。`file` 当前只接受外部系统已经上传好的
`fileId + mediaType` 引用；回答端点不接收二进制，也不会在收到文件引用后重新
运行候选人归一化。

回答包含：

```json
{
  "interactionId": "candidate-normalization:1",
  "idempotencyKey": "client-generated-stable-key",
  "value": "Ada Lovelace"
}
```

同一幂等键和同一 payload 重试返回当前 Run；同一键对应不同 payload 稳定失败。过期 interaction ID、错误 Run 状态和无效值使用可区分的领域错误。

## 6. 安全与隐私边界

- 只允许写入 `content.*`；拒绝 `__proto__`、`prototype` 和 `constructor`。
- 数组索引必须已存在；本切片不允许回答任意创建对象结构。
- 回答写入候选人 clone 后必须再次通过 `ResumeSchema`。
- 暂停中的公开 Run 只显示当前交互和安全状态，不显示原始请求、checkpoint、
  回答原文或原始模型 completion。完成后的公开 `result` 会按既有异步协议包含
  定制简历与渲染产物，这是客户端取回用户产物的通道，不应误写成“正文永不
  公开”。
- 幂等记录保存 interaction ID、值指纹和时间，不保存回答原文。
- 当前内存 adapter 的“读取 → 校验 → 保存”不是原子事务；并发回答仍可能重复
  调度，生产 adapter 必须加入版本号或 compare-and-set。
- 本地 fake 测试使用虚构资料；文档不得加入真实简历或个人信息。

## 7. 模块与 interface

`workflow/interaction.ts` 是一个深模块。调用者只需知道：

- 如何把归一化问题转成结构化交互；
- 如何验证并应用一条回答。

字段路径解析、控件值校验、选项/自定义规则、原型污染防护、clone 与 `ResumeSchema` 复验都隐藏在该模块内部。

`ResumeTailoringAgent` 拆分为：

```text
prepare(request) -> ResumeTailoringCheckpoint
complete(checkpoint) -> TailorResumeResult
run(request) -> prepare + complete
```

同步 `run()` 保持兼容；异步 Run 使用 `prepare/complete` 获得真实暂停点。

`RunStore` 保存可信内部 record，`ResumeAgentRunService.get()` 只返回公开 snapshot。HTTP 层只翻译协议与错误，不拥有工作流状态。

## 8. TDD 学习记录

按纵向 tracer bullet 推进，每次只增加一个可观察行为：

1. 归一化问题转换成默认 `text` 交互；
2. Run 遇到重要问题进入 `needs_input`，且只显示一个问题；
3. 回答写入候选人并从 JD 分析继续，提取和归一化各执行一次；
4. 必填文本、选项与自定义值、数字、日期、URL、确认等验证；
5. 非法字段路径、stale answer 和幂等冲突；
6. HTTP 回答端点和安全错误；
7. 选项统一限制为 2–5 个，Repair 提示展开完整控件联合；
8. 空必填回答保持暂停，已有数组索引可安全更新；
9. 优先级改变回答顺序时，按当前交互内容移除问题，避免把已回答问题重新带入
   最终结果；
10. 提交前审查发现日期字段的自动 fallback 会强迫未知精度的事实补齐“日”，
    因此改为安全文本 fallback；只有模型明确提供 `date` 控件时才要求日精度；
11. 同一轮审查修复了控件默认值解析结果未被采用、OpenAPI 日期说明错位，并
    增加真实日历日期、默认值和 answer receipt 指纹回归断言；
12. OpenAPI、全量测试、构建、静态检查与 diff 检查。

## 9. RA-011 证据台账

| 字段 | 当前记录 |
| --- | --- |
| Feature ID | RA-011 |
| Parent / lifecycle | Resume Agent Run：归一化后暂停 → 回答 → 恢复 |
| 用户结果 | 重要事实缺失时不猜测，可被结构化回答后继续 |
| Delivery | Implemented for development；非 Enabled / Operational |
| 当前状态 | 类型化控件、`needs_input`、内存 checkpoint、回答 API、字段写回、幂等与从 JD 分析恢复均已实现 |
| Primary evidence | LangGraph interrupts 官方文档，2026-09-16 |
| Independent evidence | 现有状态机、fake LLM 测试与本地恢复实验 |
| Decision | Adapt 显式 interrupt/checkpoint 原则，不引入框架 |
| Edge cases | 空值、错误类型、自定义选项、非法路径、原型污染、数组索引、优先级乱序、stale、重复键、恢复失败、可选问题 |
| Acceptance | 包/API 行为测试；trace 证明前序阶段只执行一次；OpenAPI 与仓库门禁 |
| Coverage | Partial |
| Historical gap | None |
| Remaining gap | durable store、并发版本锁、鉴权、二进制文件回答、日期精度、自动文件冲突检测、进程重启/多实例恢复、后续阶段 interrupt |

## 10. 实现与验证证据

已经形成的可复现证据：

- `workflow/interaction.test.ts` 覆盖 10 种控件的代表性输入、2–5 选项边界、
  自定义值、字段 fallback、非法/原型污染路径、已有数组索引和 clone；
- `workflow/run.test.ts` 覆盖单问题公开、空答案保持暂停、多问题优先级、stale、
  幂等重放/冲突、可选问题不停顿，以及恢复后不重复提取/归一化；
- `resume-agent-api` 覆盖回答 `202`、无效值 `400`、未知 Run `404` 和错误状态/
  过期/幂等冲突 `409`；
- Repair 回归测试证明候选人归一化与草拟两条结构化输出链路都能看到完整控件
  联合，而不是无法执行的自然语言占位符；
- 公开快照测试证明原始候选人文件文本不进入暂停响应，回答 receipt 只保留
  SHA-256 指纹。

2026-09-16 提交前实际验证：

```text
pnpm agent test src/workflow/interaction.test.ts src/workflow/run.test.ts src/workflow/agent.test.ts
=> 3 files / 29 tests passed

pnpm agent-api test src/openapi.test.ts src/server.test.ts
=> 2 files / 15 tests passed

pnpm --filter @yamlresume/resume-agent exec tsc --noEmit
pnpm --filter @yamlresume/resume-agent-api exec tsc --noEmit
=> passed

pnpm exec biome check <13 个 RA-011 TypeScript 文件>
=> passed

pnpm test
=> 124 files / 1,260 tests passed（包含当时并行中的前端与 RA-014）

pnpm --filter @yamlresume/resume-agent build
pnpm --filter @yamlresume/resume-agent-api build
=> passed

pnpm build
=> RA-011 两包通过；全仓随后在 packages/web 的 React 18/19 ReactNode
   类型冲突处失败，该冲突来自并行前端依赖工作树，不在 RA-011 文件边界

pnpm check:ci
=> RA-011 定向 Biome/TypeScript 通过；全仓先被并行 RA-014 Provider 文件的
   两处格式阻断，单独 check:tsc 又在 packages/playground 的 React 18/19
   JSX 类型冲突处失败

pnpm license:check
=> 退出码 0；本机缺少 addlicense binary，因此脚本跳过实际扫描；新增源码的
   MIT header 已人工核对

git diff --check
=> passed
```

为排除共享工作树里并行前端依赖和 RA-014 Provider 改动的干扰，又把已暂存的
RA-011 补丁应用到基于 `c1f595c` 的临时隔离 worktree。干净安装后先构建再测试
（仓库部分测试依赖 workspace 包已经生成 `dist`），结果为：

```text
pnpm install --frozen-lockfile --offline
=> passed

pnpm build
=> 全部 8 个参与构建的 workspace 包通过

pnpm test
=> 118 files / 1,158 tests passed

pnpm check:ci
=> Biome、全仓 TypeScript 均通过；license:check 退出码 0，但仍因本机缺少
   addlicense binary 跳过实际扫描
```

因此 RA-011 补丁自身通过完整仓库门禁；共享工作树中的全仓构建/检查失败被
独立复现为并行前端依赖与 RA-014 格式状态，而不是本单元回归。

目标测试通过只证明当前内存 vertical slice 的行为，不证明真实模型会稳定提出
正确问题，也不证明进程重启、并发请求或生产隐私控制。后续 Eval 需要分别衡量
提问必要性、控件选择准确率、恢复成功率和不必要提问率。
