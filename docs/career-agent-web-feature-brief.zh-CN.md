# Career Agent Web 前端 Feature Brief

> 功能 ID：RA-013 / Unit 9A
> 状态：Designed，未实现（本文只走完路线图第 6 节门禁的第 1–5 步）
> 基线：2026-09-16，`f8b7468`
> 依赖：RA-008（HTTP API，已实现）、RA-009（异步 Run，开发级）、
> RA-011（HITL，契约与状态机已落地，回答端点进行中）
>
> 注意：RA-011 正由并行工作推进。本文引用的 `InteractionRequest` 形状以
> `packages/resume-agent/src/contracts.ts` 为准，若与本文不一致，以代码为准。

## 1. 用户问题与成功结果

现在要验证一次简历定制，必须手写 JSON 请求体、把文件转成 Base64、`curl` 打
`POST /v1/tailor-resume`，然后在几十 KB 的 JSON 里翻 `matchReport`、`diff` 和
Base64 产物。后端已经生产出 6 类结构化分析（`JobSpec`、`MatchReport`、
`ResumeDiff`、`QualityReport`、`variants`、`trace`），但没有任何人能舒服地读它们。

可观察的改善结果：

1. 粘贴 JD、拖入简历，30 秒内看到 Run 开始并逐阶段推进；
2. 需求→证据匹配、源→草稿 diff、质量报告可读，而不是 JSON dump；
3. Agent 提问时能用匹配类型的控件回答，而不是重跑整个请求；
4. 5 种样式 × 7 种格式的产物可预览、可单个下载，某个格式失败不影响其它；
5. 每个阶段的耗时、模型调用次数、Repair 次数、token 用量可见，便于调 Prompt。

## 2. 范围与非目标

### 范围

- 新增 `packages/agent-web`（`@yamlresume/agent-web`），Next.js App Router；
- 输入台：JD 文本/文件、候选人 YAML/文件、样式与格式偏好、语言与页数；
- 运行工作台：阶段时间线、结构化提问卡片、产物面板、遥测抽屉；
- `RunEventStream` seam：一个前端内部接口，两个 adapter（轮询 / SSE）；
- `needs_input` 的结构化提问卡片，按后端 `InteractionRequest` 契约渲染；
- 运行时能力协商：启动先读 `GET /v1/capabilities`，不硬编码样式与限制；
- 本地运行历史（localStorage），明确标注"服务重启即失效"。

### 非目标

- 不做鉴权、多用户、云端运行历史（后端还没有）；
- 不做真正的对话式聊天输入框（当前后端没有 message 语义）；
- 不在前端做任何 Agent 决策：不选证据、不改 Prompt、不判断事实真伪；
- 不替换 `packages/web` 的表单编辑器，两者是不同产品面；
- 不定义 HITL 协议本身——那是 RA-011 的范围，前端只消费它。

## 3. 为什么需要专门前端

后端产出的是**关系型证据**，不是文本：`MatchReport` 是 12 项需求对 N 条证据的
多对多映射，`ResumeDiff` 是带路径的结构化变更，`variants` 是样式 × 格式矩阵。
这些在终端里不可读，在聊天气泡里也不可读——它们需要并置、对照和可展开层级。
这是"工作台"而不是"聊天框"的唯一理由。

同时，路线图 3.1 节要求 Agent 用结构化控件提问，3.4 节要求 `needs_input` 可暂停
恢复。这两条都必须有 UI 承载才能验收，否则 RA-011 永远只能测到 API 层。

## 4. 确定性边界

前端**不拥有**任何领域决策，全部由后端代码控制：

| 决策 | 归属 |
| --- | --- |
| Schema 校验、事实不可变约束 | `@yamlresume/resume-agent` |
| 证据选择、需求匹配 | 后端确定性匹配器 |
| 样式 → LaTeX 模板映射 | `STYLE_PRESETS` |
| 渲染与 PDF 编译 | `@yamlresume/core` + 后端 |
| 提问时机、控件类型、必填性、隐私等级 | 后端 `InteractionRequest` |
| 回答的字段路径校验与原型污染防护 | `workflow/interaction.ts` |
| 模型密钥 | 只在服务端环境变量 |

前端只拥有：布局、控件选择（由 `control` 字段驱动）、本地草稿、下载行为、
`X-Request-Id` 生成、轮询退避。

## 5. 输入、输出和数据来源

### 5.1 数据来源

唯一数据源是 `@yamlresume/resume-agent-api`（默认 `http://localhost:8787`）。
契约来自 `docs/api/resume-agent.openapi.yaml`，前端类型应由该文件生成，不手写。

| 来源 | 用途 | 时效 | 隐私级别 |
| --- | --- | --- | --- |
| `GET /v1/capabilities` | 构建表单的样式/格式/限制 | 启动时拉一次，会话内缓存 | 公开 |
| `POST /v1/runs` | 创建异步 Run | 一次 | 含 JD + 简历全文，高敏感 |
| `GET /v1/runs/{id}` | 轮询阶段与结果 | 退避轮询 | 含结果全文，高敏感 |
| `POST /v1/tailor-resume` | 开发期同步调试 | 一次 | 高敏感 |

### 5.2 隐私约束

- 简历与 JD 原文只在内存和 localStorage 草稿中，不发给除后端外的任何端点；
- 不接第三方分析、不上报错误到外部 SaaS；
- localStorage 只存输入草稿与 runId 列表，不存结果全文（体积 + 敏感度）；
- 提供"清除本地数据"入口，一键删除草稿与历史；
- 不在浏览器保存任何模型 API Key（`docs/api/README.zh-CN.md` 第 7 条）。

### 5.3 产物下载

`OutputArtifact` 的 `encoding` 为 `base64` 时（PDF/DOCX），前端用
`mediaType` + `filename` 组 Blob 下载；`utf8` 时直接下载文本。
当前所有产物都在 JSON 响应里，单次响应可能达数 MB——这是已知的后端限制
（输入输出文档第 3.2 节已记录未来改对象存储），前端需要对大响应做流式解析或
至少显示体积告警，不能假装它很轻。

## 6. 状态与恢复

前端状态机是后端 `AgentRunStatus` 的**投影**，不新增业务状态：

```text
draft (仅前端，未提交)
  ↓ POST /v1/runs → 202
queued → ingesting_inputs → normalizing_candidate → analyzing_jd
  → matching_evidence → drafting → validating → rendering → completed
                                        ↓
                                      failed
```

`needs_input` 正在由 RA-011 / Unit 7B 实现（本文写作时 `AgentRunStatus`、
`InteractionRequest` 和 `run.ts` 的状态转换已落地，回答端点尚未出现在
`server.ts`）。它在 `normalizing_candidate` 之后，可自环多次，问题答完后进
`analyzing_jd`：

```text
normalizing_candidate → needs_input → needs_input → analyzing_jd
```

前端因此**不需要 feature flag**，直接按契约实现；但要处理"后端还没有回答端点"
的中间态：`run.interactions` 有值而回答端点 404 时，只读展示问题并说明
"回答通道尚未开放"。

### 6.1 恢复语义（当前诚实版本）

| 场景 | 行为 |
| --- | --- |
| 刷新页面 | 从 localStorage 恢复 runId，重新轮询；输入草稿保留 |
| 后端进程重启 | Run 丢失，`GET` 返回 404 → UI 明确显示"服务已重启，运行记录丢失"，不假装还在跑 |
| 轮询失败 | 指数退避重试；连续失败超阈值后转为手动"重试"按钮 |
| 关掉浏览器 | 后端仍在跑（同进程内），重开可继续轮询；但不承诺，UI 措辞用"可能仍在运行" |

`docs/api/README.zh-CN.md` 第 9 条明确要求：持久化 RunStore 完成前，不向用户
承诺刷新服务后仍能恢复运行。UI 文案必须遵守。

### 6.2 幂等性

`POST /v1/runs` 目前没有幂等键。前端用提交按钮禁用 + 单飞（in-flight）锁避免
重复创建，并在成功后立刻跳转到 `/runs/{id}`。这是权宜之计，真正的
`Idempotency-Key` 属于后端生产硬化范围，本 Brief 记为剩余缺口。

回答交互则**已有**幂等键：后端要求前端提供 `idempotencyKey`，同键同值重试返回
当前 Run，同键不同值稳定失败。前端必须把 key 与该次回答一起持久化，重试时复用，
不能每次提交重新生成。

## 7. 失败模式

| # | 类型 | 场景 | 前端行为 |
| --- | --- | --- | --- |
| 1 | 正常失败 | `400 invalid_request` | 按 `error.details[].path` 定位到具体字段并标红，不弹通用 toast |
| 2 | 正常失败 | `502 structured_output_validation_failed` | 显示"模型输出不符合契约"+ Schema 名 + `requestId`，提供重试；不展示模型原始响应 |
| 3 | 正常失败 | `503 llm_not_configured` | 显示"后端未配置模型"，指向 README 的环境变量说明 |
| 4 | 部分失败 | `variants[].failures` 非空 | 该格式标记失败并给原因，其它格式照常可下载（README 第 5 条） |
| 5 | 边界输入 | JD < 20 字符、无候选人材料 | 提交前本地校验，与后端 Zod 约束保持一致 |
| 6 | 边界输入 | 文件超 12 MiB / 总量超 30 MiB / 超数量上限 | 选择文件时即时拒绝，限制值来自 `capabilities` 而非硬编码 |
| 7 | 对抗输入 | 简历/JD 里含 HTML、脚本或提示注入 | HTML 预览一律放进 `sandbox` 且不加 `allow-scripts` 的 iframe；渲染前不执行任何内容 |
| 8 | 对抗输入 | 极长单词、超宽表格破坏布局 | 所有用户文本容器强制 `overflow-wrap` + 最大高度折叠 |
| 9 | 外部依赖失败 | 后端未启动 / CORS 失败 | 启动自检 `GET /healthz`，失败时显示可复制的启动命令 |
| 10 | 外部依赖失败 | PDF 编译环境缺失 | 该格式进 `failures`，UI 提示可改用 HTML 预览 |
| 11 | 恢复失败 | 轮询到 404（进程重启） | 转为终态"记录丢失"，停止轮询，保留输入草稿以便重跑 |
| 12 | 恢复失败 | 响应超大导致解析卡顿 | 先渲染骨架 + 状态，产物面板懒加载 |

## 8. 决策记录

调研于 2026-09-16 完成。结论分两层：**协议层**与**组件层**分开选，不绑定同一
个厂商，满足路线图第 5 节"框架必须能够被替换"的要求。

### 8.1 候选方案对比

| 方案 | 版本 / 许可 | 形态 | 与本项目的契合点 | 冲突 |
| --- | --- | --- | --- | --- |
| AG-UI 协议 | `@ag-ui/core` 0.0.59，MIT | 事件协议（SSE）+ TS SDK | 生命周期事件、`STATE_DELTA`（JSON Patch）、canonical interrupt/resume 与本项目阶段机 + `needs_input` 几乎同构 | 要求 SSE，后端当前是轮询；`@ag-ui/core` 依赖 zod ^3，本仓库是 ^4.3.6 |
| CopilotKit | `@copilotkit/react-core` 1.72.0，MIT | React 全栈框架（AG-UI 作者） | headless hooks 可用；`renderAndWaitForResponse` 正好是 HITL 卡片 | 默认是聊天侧边栏形态；依赖树很重（lit、katex、radix、tanstack-virtual 等），为一个工作台引入过多 |
| assistant-ui | `@assistant-ui/react` 0.15.20，MIT | React 聊天运行时 + tool-ui | tool-ui 的 approvals / forms / tables 卡片模式可借鉴 | 核心是 thread/message/composer 运行时，本后端没有 message 语义，一半能力用不上 |
| Vercel AI Elements | shadcn registry | 组件注册表（源码进仓库） | 无运行时锁定 | 以 message / conversation 为中心，偏聊天 |
| 21st-dev/agent-elements | MIT，registry | 组件注册表（源码进仓库） | `PlanTool`、`TodoTool`、`QuestionTool`（单选/多选/自由填）、`EditTool`（diff + 审批）、`ThinkingTool`、`ToolGroup` 正好是 Codex 式卡片；`toolRenderers` 映射表机制可直接接我们的阶段 | 要 React 19 + Tailwind v4；打包好的 `AgentChat` 仍是聊天壳；registry 较新，成熟度风险 |

### 8.2 采用

1. **采用 AG-UI 的事件词汇表**（仅入向）作为前端内部的 Run 事件模型：
   `RUN_STARTED` / `STEP_STARTED` / `STEP_FINISHED` / `RUN_FINISHED` / `RUN_ERROR`、
   `STATE_SNAPSHOT` / `STATE_DELTA`、以及 `RUN_FINISHED.outcome.type = "interrupt"`
   的 interrupt outcome。
   **理由**：本项目已经有 9 个状态的阶段机，自己发明一套事件名不会更好；
   用既有开放协议的名字，未来换前端或接第三方 UI 都不用重设计。
   **但只用于入向。** 回答走后端已选定的
   `{interactionId, idempotencyKey, value}`，不改成 AG-UI 的 `resume[]`——
   RA-011 已经为幂等键做了设计和测试，前端不该为协议纯洁性倒逼后端返工。
2. **采用 21st-dev/agent-elements 的卡片组件**（shadcn registry，源码复制进仓库）
   作为工作台的卡片层，配 shadcn/ui 做基础控件。
   **理由**：它是唯一提供"计划 / 待办 / 澄清提问 / 带 diff 的审批"成套卡片的 MIT
   注册表，形态就是你要的 Codex / WorkBuddy；registry 模式让源码进仓库，
   不产生运行时依赖锁定。

### 8.3 改造

1. **不引入 SSE 之前先用轮询 adapter 合成 AG-UI 事件。** 前端定义
   `RunEventStream` 接口；`PollingRunEventStream` 对比前后两次 `GET /v1/runs/{id}`
   快照，差分出 `STEP_STARTED` / `STEP_FINISHED` / `STATE_DELTA`。后端加 SSE 后
   换成 `SseRunEventStream`，工作台代码不动。
   **理由**：立刻可用的垂直切片，且不倒逼后端在协议未稳定时先改传输层。
2. **丢弃 `AgentChat` 聊天壳，只用它的卡片。** 用自己的三栏工作台布局承载
   `toolRenderers` 风格的阶段卡片映射。
3. **zod 版本隔离。** 不在服务端 import `@ag-ui/core` 的 zod schema；
   前端只用它的 TypeScript 类型，或在 `agent-web` 内自己写 zod 4 校验。
   **理由**：避免 zod 3/4 双版本在同一进程里互相污染。

### 8.4 拒绝

1. **拒绝 CopilotKit 的 `react-ui` 聊天组件**：形态是侧边栏助手，本产品的主体是
   产物对照，不是对话。
2. **拒绝 assistant-ui 的 thread 运行时**：后端没有 message / branch / 流式 token
   语义，引入它等于为不存在的能力付架构成本。
3. **拒绝现在就改后端为 AG-UI 原生服务端**：那是 RA-011 之后的事，
   现在改会让 7B 的设计被前端选型绑架。
4. **拒绝把 `packages/web` 改造成 agent 前端**：它是 React 18 + 手写 CSS + 无
   Tailwind，agent-elements 要 React 19 + Tailwind v4，混在一起必然打架；且并行
   agent 高频改动那个包（见项目记忆）。

### 8.5 证据

- AG-UI 事件族、`@ag-ui/core|client|encoder` 包名与 SSE 线格式：
  [CopilotKit AG-UI skill](https://github.com/CopilotKit/skills/blob/main/skills/copilotkit-agui/SKILL.md)（该仓库已归档，作为快照使用）、
  [AG-UI 协议页](https://www.copilotkit.ai/ag-ui)
- canonical interrupt / resume JSON 形状（`outcome.type=interrupt`、
  `resume[].interruptId|status|payload`、`status: "cancelled"` 语义）：
  [Human-in-the-Loop with AG-UI, Microsoft Learn](https://learn.microsoft.com/en-us/agent-framework/integrations/by-component/ui/ag-ui/human-in-the-loop)（文档日期 2026-09-15）
- 协议分层（MCP / A2A / AG-UI 各管什么）：
  [MCP vs A2A vs AG-UI](https://www.copilotkit.ai/learning/mcp-vs-a2a-vs-ag-ui)
- 组件注册表清单与依赖要求：
  [21st-dev/agent-elements](https://github.com/21st-dev/agent-elements)、
  [vercel/ai-elements](https://github.com/vercel/ai-elements/)、
  [assistant-ui tool-ui](https://github.com/assistant-ui/tool-ui)
- 版本号由本机 `npm view` 于 2026-09-16 查得：`@ag-ui/core` 0.0.59、
  `@copilotkit/react-core` 1.72.0、`@assistant-ui/react` 0.15.20、`ai` 7.0.102。

### 8.6 需要复核的假设

- agent-elements 要求 React 19 / Tailwind v4 / Next 16。落地第一步必须先建一个
  空壳验证这套组合能在本 pnpm workspace 里装起来；装不上就退回 shadcn/ui 自绘
  卡片，AG-UI 那层决策不受影响。
- `@ag-ui/core` 还是 0.0.x，协议可能变。因此只借用**事件形状**，不让领域类型
  继承它的类型。

## 9. Eval 与指标

前端不做模型 Eval（那是 RA-010），但要为它提供入口：把每次 Run 的
`trace` + `quality` 导出成一行 JSON，便于攒 Eval 数据集。

界面自身的指标：

| 指标 | 门槛 |
| --- | --- |
| 首屏可交互 | 本地 < 1.5s |
| 阶段状态延迟 | 轮询模式下 < 2s 反映后端阶段变化 |
| 大产物渲染 | 5 样式 × 7 格式响应不卡死主线程（分片/懒加载） |
| 键盘可达 | 所有交互控件可 Tab 到达并有可见焦点环 |
| 无障碍 | 阶段状态变化通过 `aria-live` 播报；仅靠颜色不传达状态 |

## 10. 测试证据（计划）

| 层 | 证明什么 |
| --- | --- |
| 单元（Vitest + Testing Library） | `PollingRunEventStream` 差分出正确事件序列；控件按 `control` 类型渲染；答案校验规则 |
| 契约 | 用 OpenAPI 生成的类型编译通过；`capabilities` 驱动表单而非硬编码 |
| 集成（fake 后端） | 完整 Run：创建 → 阶段推进 → 完成 → 下载；失败 Run；404 恢复；部分格式失败 |
| 人工验收 | 真实后端 + 真实模型跑一次，确认 diff / 匹配 / 预览可读 |

覆盖率目标与仓库一致（~100%），测试文件与源码同目录 `name.test.tsx`。

## 11. 剩余缺口

1. 回答端点尚未出现在 `server.ts`，且 `control` 只实现了 `text`；其余 9 种控件
   前端需按契约预留渲染器，暂时无法端到端验证；
2. 后端无 SSE，实时性受轮询限制；
3. 后端无鉴权，本前端只能本地跑，不可公网部署；
4. 无 `Idempotency-Key`，重复提交靠前端锁；
5. 大产物走 JSON Base64，未来改对象存储时下载逻辑要重写；
6. agent-elements 的 React 19 / Tailwind v4 组合未在本仓库验证。

下一道门禁：本文与 `career-agent-web-interaction-design.zh-CN.md` 评审通过后，
先做"空壳验证 + `RunEventStream` 单元测试"这一个最小单元，再进 UI 实现。
