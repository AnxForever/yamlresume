# Career Agent Web 交互设计

> 配套文档：[`career-agent-web-feature-brief.zh-CN.md`](./career-agent-web-feature-brief.zh-CN.md)
> 状态：Designed，未实现
> 基线：2026-09-16，`f8b7468`

## 1. 设计原则

参考 Codex 和 WorkBuddy 这类 Agent 工作台的核心思想，不复制它们的具体外观。

1. **Run 是第一公民，不是消息。** 主界面的中心对象是一次运行及其阶段，
   不是一串对话气泡。用户来这里是看"它做了什么、凭什么这么做"。
2. **产物与推理并置。** 左看进度，中看这一阶段的结构化内容，右看简历本身。
   任何时候都不需要为了对照两块信息而来回切页。
3. **提问是插入工作流的卡片，不是弹窗。** Agent 需要信息时，在时间线当前位置
   插入一张控件卡片，保留上下文，可回看历史提问与回答。
4. **一次只问一个最重要的问题。** 遵循产品路线图 3.1 节；只有多字段互相依赖时
   才组合成短表单。
5. **不确定就说不确定。** 内存 RunStore 会丢运行，UI 就得写"服务已重启，
   记录丢失"，不能转圈假装还在跑。
6. **降级优先于报错。** 一个格式失败不影响其它格式；SSE 不可用就轮询；
   富控件缺失就退回 textarea。

## 2. 信息架构

```text
/                      新建运行（输入台）
/runs                  运行历史列表（本地 localStorage）
/runs/[id]             运行工作台（主界面）
/runs/[id]/artifacts   产物全屏（深链，可直接分享给自己）
设置                    对话框，不占路由：后端地址、语言、清除本地数据
```

只有 3 个真实页面。运行历史是本地数据，明确标注"仅本机、非云端"。

## 3. 输入台（`/`）

单列居中，最长路径两步：给 JD、给简历。

```text
┌─────────────────────────────────────────────────────┐
│  Career Agent                            ⚙ 设置     │
├─────────────────────────────────────────────────────┤
│                                                     │
│   目标岗位                                          │
│  ┌───────────────────────────────────────────────┐  │
│  │ 粘贴 JD 文本…                                 │  │
│  │                                               │  │
│  │                                    1 240 字符 │  │
│  └───────────────────────────────────────────────┘  │
│   或拖入文件  · PDF DOCX MD HTML 截图 · 最多 8 个    │
│                                                     │
│   你的材料                                          │
│  ┌───────────────────────────────────────────────┐  │
│  │ ✓ baoanxin-resume.yml      YAMLResume · 已校验│  │
│  │ + 补充项目说明 / 作品集 / 证书    最多 12 个   │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│   ▸ 输出偏好          ats-compact · yaml html pdf    │
│                                                     │
│                          ┌──────────────────────┐   │
│                          │   开始定制            │   │
│                          └──────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

关键交互：

- **YAMLResume 即时校验。** 粘贴或拖入 YAML 后立刻用 `@yamlresume/core` 的
  `ResumeSchema` 在浏览器里校验，把 clang 风格的行列错误直接标在文本域里。
  这是唯一允许在前端做的"领域校验"，因为它是纯函数、无 I/O、与后端同一份 Schema。
- **输出偏好默认折叠。** 默认 `ats-compact` + `yaml/html/pdf`；展开后样式与格式
  选项全部来自 `GET /v1/capabilities`，附每个样式的 `description`。
- **限制来自后端。** 文件数量与体积上限读 `capabilities.input.limits`，
  超限在选择时就拒绝并说明。
- **提交按钮的禁用理由要写出来。** 不是灰掉了就完事：写"还需要 JD（至少 20 字符）"。

## 4. 运行工作台（`/runs/[id]`）

三栏。左窄（阶段）、中宽（当前阶段内容）、右中（简历产物）。

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ ← Career Agent   run_8f3a…  ● drafting  00:42   ⋯ 导出 trace   ⚙          │
├───────────────┬──────────────────────────────────┬───────────────────────┤
│ ✓ 读取输入 0.3s│  证据匹配                  ▲ 收起 │  简历预览             │
│ ✓ 归一化档案 2.1│                                  │ ┌───────────────────┐ │
│ ✓ 分析 JD  3.4s│  覆盖 9/12 必须项  关键词 71%     │ │                   │ │
│ ✓ 证据匹配 0.1s│                                  │ │   包安心           │ │
│ ● 生成草稿 …    │  ✓ Python 3+ 年                  │ │   Agent 应用开发   │ │
│ ○ 校验         │    └ projects[0].summary          │ │                   │ │
│ ○ 渲染         │      "用 FastAPI 实现…"           │ │   ——————————      │ │
│                │  ◐ Kubernetes                    │ │                   │ │
│ ─────────────  │    └ 仅间接证据：work[1]…         │ │                   │ │
│ 模型调用 3      │  ✗ 团队管理经验                   │ │                   │ │
│ Repair  1      │    └ 无证据，已生成提问            │ └───────────────────┘ │
│ token  8.2k    │                                  │  ats-compact ▾        │
│ 展开遥测 ▾      │  ─────────────────────────────   │  yaml json md html    │
│                │  需要你确认                       │  latex  pdf  docx     │
│                │  ┌────────────────────────────┐  │  ⬇ 下载  ⧉ 源码       │
│                │  │ 简历里"在校"没有明确起止时间 │  │                       │
│                │  │ JD 要求 3 年以上经验，需要   │  │  ⚠ docx 渲染失败      │
│                │  │ 一个可核实的时间范围。       │  │    unsupported_style  │
│                │  │                            │  │                       │
│                │  │ ○ 2022-09 至今              │  │                       │
│                │  │ ○ 自己填写 ┌──────────────┐ │  │                       │
│                │  │           └──────────────┘ │  │                       │
│                │  │            [ 跳过 ] [ 确认 ]│  │                       │
│                │  └────────────────────────────┘  │                       │
└───────────────┴──────────────────────────────────┴───────────────────────┘
```

### 4.1 左栏：阶段时间线

- 8 个常规阶段固定列出（`AgentRunStatus` 去掉 `needs_input` 与两个终态），
  已完成的显示耗时，当前的显示脉冲，未开始的置灰。
  **不隐藏未来阶段**——用户要知道总共几步。
- `needs_input` 不是固定阶段，而是插在 `normalizing_candidate` 之后的临时节点，
  可出现多次；每次回答后折叠成一行摘要，保留在时间线上。
- 状态用图标 + 文字 + 颜色三重编码，不只靠颜色。
- 阶段变化通过 `aria-live="polite"` 播报"正在生成草稿"。
- 底部是遥测摘要：模型调用次数、Repair 次数、传输重试、token。数据来自
  `trace[].metadata`，这是 RA-012 已经埋好的安全遥测，不含任何私密内容。
- 点击某个已完成阶段，中栏切到该阶段的内容（时间线即导航）。

### 4.2 中栏：当前阶段内容

每个阶段一张卡片，内容形状不同：

| 阶段 | 卡片内容 |
| --- | --- |
| `ingesting_inputs` | 每个文件的解析结果：类型、提取字符数、警告（如"扫描 PDF 无文本"） |
| `normalizing_candidate` | 归一化后的候选人档案摘要 + `sourceArtifactIds` 溯源 + **醒目的"待你审核，非既成事实"标记** |
| `analyzing_jd` | `JobSpec`：岗位、级别、公司、摘要，需求按 must-have / nice-to-have 分组，关键词 chip |
| `matching_evidence` | 需求 → 证据映射，三态（matched / partial / missing）；每条证据可展开看原文并显示 evidence ID |
| `drafting` | 被选中的证据 ID 列表 + 模型 notes；进行中显示骨架 |
| `validating` | Schema 校验结果 + 不可变事实检查通过项；失败时显示被拒绝的条目 |
| `rendering` | 每个样式 × 格式的产出状态矩阵 |
| 完成后 | 汇总：`QualityReport` + `ResumeDiff` |

`ResumeDiff` 用 added / removed / changed / reordered 四色标记，按 section 分组，
`counts` 做顶部摘要。这里直接对应 agent-elements 的 `EditTool`（diff + 审批）形态。

### 4.3 右栏：产物

- 默认显示当前样式的 HTML 预览，A4 比例，放在**不带 `allow-scripts` 的 sandbox
  iframe** 里。用户材料可能含注入内容，一律当不可信数据。
- 样式下拉切换 `variants`；格式按钮点一下下载该格式。
- `failures` 里的格式显示为失败态 + `code`，其它格式照常可用。
- "源码"切到 YAML / LaTeX 文本视图，可复制。
- PDF 存在时用 `<embed>` 预览，不存在时提示 HTML 是近似预览。

## 5. 提问控件协议

协议由后端拥有，前端只负责渲染。契约见 `packages/resume-agent/src/contracts.ts`
的 `InteractionRequest` 与
[`resume-agent-hitl-interaction.zh-CN.md`](./resume-agent-hitl-interaction.zh-CN.md)。
本节只记录前端如何消费它。

后端当前形状（2026-09-16）：

```ts
interface InteractionRequest {
  id: string          // 稳定 ID，如 candidate-normalization:1
  field: string       // 目标字段路径，只允许 content.*
  prompt: string      // 问题正文
  reason: string      // 为什么问
  required: boolean
  severity: 'blocking' | 'important' | 'optional'
  privacy: 'standard' | 'personal' | 'sensitive'
  control: InteractionTextControl   // 判别联合，当前只有 text
}
```

回答提交格式（后端定义，非 AG-UI `resume[]`）：

```json
{
  "interactionId": "candidate-normalization:1",
  "idempotencyKey": "client-generated-stable-key",
  "value": "Ada Lovelace"
}
```

`idempotencyKey` 由前端生成并**在重试时保持不变**：同键同值重试返回当前 Run，
同键不同值稳定失败。因此前端必须把 key 和这次回答绑定后存起来，
不能每次点提交都重新随机。

### 5.1 控件映射

`control` 是判别联合，前端按 `control.type` 分派，**不解析 `prompt` 文本猜控件**。
后端 HITL 设计已规划 10 种类型，当前只实现 `text`：

| control.type | 状态 | 渲染 | 校验来源 |
| --- | --- | --- | --- |
| `text` | 已实现 | 单行输入 | `minLength` / `maxLength` |
| `textarea` | 规划中 | 多行 + 字数 | 同上 |
| `single_choice` | 规划中 | 单选卡片 2–5 项 + 可选自定义 | 后端声明是否允许自定义 |
| `multi_choice` | 规划中 | 复选 chip | 个数上下限 |
| `number` | 规划中 | 数字输入 | 数值范围 |
| `date` / `date_range` | 规划中 | 年月选择器，格式对齐 YAMLResume | 起 ≤ 止 |
| `url` | 规划中 | 输入 + 协议校验 | 必须 http(s) |
| `file` | 规划中 | 拖放区 | 媒体类型与体积，来自 capabilities |
| `confirm` | 规划中 | 两个显式按钮 + 被确认内容原文 | 无默认值 |

前端为每种类型写一个渲染器，用 `control.type` 做 map 分派；遇到未知类型时**不崩**：
退回只读展示 `prompt` + `reason`，并提示"该控件类型此前端版本尚不支持"。
这条降级规则是前后端可以独立演进的前提。

### 5.2 隐私等级

`privacy` 直接影响渲染：

| privacy | 前端行为 |
| --- | --- |
| `standard` | 正常渲染 |
| `personal` | 卡片加"这条会写入你的个人信息"提示 |
| `sensitive` | 同上，且输入内容不写 localStorage 草稿 |

### 5.3 提问的三条硬规则

1. `reason` 必须显示——用户有权知道为什么被问；
2. 有"跳过"入口，除非 `required`；跳过要记录，不静默丢弃；
3. 回答后卡片折叠成一行摘要留在时间线上，可展开回看，不消失。

## 6. 状态 → 界面映射

| Run 状态 | 左栏 | 中栏 | 右栏 | 可用操作 |
| --- | --- | --- | --- | --- |
| `queued` | 全部未开始 | "已排队"骨架 | 空态 | 无（不能取消，后端未支持——按钮不出现） |
| 执行中各阶段 | 当前阶段脉冲 | 该阶段卡片，进行中显骨架 | 空态 | 查看已完成阶段 |
| `needs_input` | 在 `normalizing_candidate` 后插入"等待你"节点 | `run.interactions[]` 渲染为提问卡片并聚焦 | 保持上次内容 | 回答（可选问题可跳过） |
| `completed` | 全绿 + 总耗时 | 汇总（质量 + diff） | 预览 + 下载 | 下载、导出 trace、以此为输入再跑 |
| `failed` | 失败阶段标红 | 错误码 + 安全消息 + `requestId` + 可复制 | 空态 | 重试（用同一份输入草稿） |
| 404（进程重启） | 全部灰 | "服务已重启，运行记录丢失" | 空态 | 用本地草稿重新提交 |

## 7. AG-UI 事件 → 界面区域

前端内部统一消费 AG-UI 形状的事件，无论来自轮询差分还是未来的 SSE：

| 事件 | 界面反应 |
| --- | --- |
| `RUN_STARTED` | 建立工作台，启动计时 |
| `STEP_STARTED` | 对应阶段转为进行中，中栏切到该阶段 |
| `STEP_FINISHED` | 阶段打勾并记录耗时；metadata 里的 token/Repair 累加到遥测 |
| `STATE_SNAPSHOT` | 整体替换工作台数据（首次加载、刷新恢复） |
| `STATE_DELTA` | JSON Patch 局部更新，避免整页重渲染 |
| `RUN_FINISHED`（无 interrupt） | 进终态，右栏出产物 |
| `RUN_FINISHED`（`outcome.type=interrupt`） | 渲染提问卡片（映射自 `run.interactions[]`） |
| `RUN_ERROR` | 失败态 + 安全错误信息 |

映射方向只有一个：`run.interactions` 非空且状态为 `needs_input` 时，adapter 合成一个
带 interrupt outcome 的 `RUN_FINISHED`。**回答走后端自己的
`{interactionId, idempotencyKey, value}` 格式**，不翻译成 AG-UI 的 `resume[]`——
后端已经选定了幂等键方案，前端不该为了协议纯洁性去改它。AG-UI 只用于**入向**
事件建模，出向回答用后端契约。

`PollingRunEventStream` 的差分职责：比较相邻两次快照的 `status` 与 `trace` 长度，
合成缺失的 `STEP_*` 事件；`result` 首次出现时发 `STATE_SNAPSHOT`。
这个类必须有完整单元测试——它是整个前端唯一有状态推导逻辑的地方。

## 8. 关键流程

### 8.1 首次运行

粘贴 JD → 拖入 `resume.yml`（即时校验通过）→ 开始定制 → 跳到 `/runs/{id}`
→ 阶段依次点亮，中栏跟随当前阶段 → 完成后中栏变汇总、右栏出预览 → 下载 PDF。

### 8.2 需要补信息

归一化后停在 `needs_input` → `run.interactions[0]` 渲染成提问卡片并自动聚焦
→ 用户按 `control.type` 对应控件回答 → 带 `idempotencyKey` 提交
→ 若还有重要问题，Run 自环回 `needs_input` 并给出下一个问题；答完则进
`analyzing_jd`，从 checkpoint 恢复，不重跑文件提取和归一化
→ 已回答的卡片折叠成一行摘要留在时间线上。

### 8.3 部分格式失败

`rendering` 完成但 `variants[0].failures` 含 `docx` → 右栏 docx 按钮显示失败态
和 `code` → 其它格式正常下载 → 顶部不报全局错误。这是 README 第 5 条的要求。

### 8.4 后端没起来

进入任意页面先 `GET /healthz`，失败则整页显示引导：可复制的
`pnpm agent-api dev` 命令 + 需要的环境变量名（不显示值）。

## 9. 组件清单

沿用 shadcn 的 registry 模式，源码进仓库，不产生运行时依赖：

| 组件 | 来源 | 用途 |
| --- | --- | --- |
| `Button` `Input` `Textarea` `Select` `Dialog` `Tabs` `Tooltip` `Badge` `Collapsible` `ScrollArea` | shadcn/ui | 基础控件 |
| `PlanTool` / `TodoTool` | agent-elements | 阶段时间线的卡片形态参考 |
| `QuestionTool` | agent-elements | 提问卡片（单选 / 多选 / 自由填） |
| `EditTool` | agent-elements | `ResumeDiff` 的 diff + 审批形态 |
| `ToolGroup` | agent-elements | 阶段卡片分组折叠 |
| `StageTimeline` | 自建 | 左栏，8 阶段固定 |
| `MatchMatrix` | 自建 | 需求 × 证据三态映射 |
| `ArtifactPane` | 自建 | 样式/格式切换 + sandbox 预览 + 下载 |
| `TelemetryDrawer` | 自建 | trace metadata 展开 |
| `InteractionCard` | 自建 | 包装 `QuestionTool`，实现 5.1 全部控件与降级 |

## 10. 视觉

- 沿用 `packages/web` 的取向：近白 zinc 中性色 + 单一强调色，低透明度描边，
  留白充足。**但用 Tailwind v4 的 CSS 变量实现**，不复制那 2 379 行手写 CSS。
- 状态色四种，固定语义：进行中 / 成功 / 警告（partial、部分失败）/ 失败。
- 简历预览是视觉主角，其余一律降到中性灰阶，不与纸张抢注意力。
- 等宽字体只用于 evidence ID、错误码、YAML/LaTeX 源码。
- 深色模式随系统，通过 CSS 变量切换，不写第二套组件。

## 11. 无障碍

- 三栏均可键盘导航；焦点环可见且对比度达标；
- 阶段变化与提问出现用 `aria-live` 播报；
- 状态不只靠颜色，图标 + 文字同时存在；
- 提问卡片出现时把焦点移到卡片标题，回答后焦点回到时间线；
- diff 的增删改用符号（`+` `−` `~`）而非仅背景色；
- 预览 iframe 有 `title`，并提供"以文本查看"替代路径。

按仓库约定，完整 WCAG 合规需要辅助技术实测和专家评审，本文只保证设计层面
不制造已知障碍。

## 12. 交互层验收标准

1. 输入台在无 JD 或无候选人材料时禁用提交，并写明缺什么；
2. 样式、格式、文件限制全部来自 `capabilities`，代码里搜不到硬编码列表；
3. 8 个阶段状态各有可视区分，且能通过 `aria-live` 播报；
4. `matchReport` 的三态、`diff` 的四类变更、`quality` 的覆盖率均可读；
5. 某格式失败时其它格式仍可下载，且失败原因可见；
6. Run 失败时显示错误码 + 安全消息 + `requestId`，不显示堆栈或模型原文；
7. 轮询到 404 时转终态并提示服务已重启，不无限转圈；
8. 遇到未实现的 `control.type` 时只读展示且不崩；`privacy: sensitive` 的输入
   不进 localStorage；同一回答重试复用同一 `idempotencyKey`；
9. HTML 预览 iframe 无 `allow-scripts`；
10. 清除本地数据后 localStorage 无残留简历内容。
