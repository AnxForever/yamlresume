# 职业档案中心（个人主页）Feature Brief

> 功能 ID：RA-017-S（承接 RA-017 会话式聊天的安全后续）
> 状态：Implemented for development；尚未 Operational
> 最后复核：2026-09-17
> 依赖：RA-008（HTTP API）、RA-016（认证与按用户加密存储）、RA-013（agent-web 工作台）、
> RA-011（HITL）
> 配套：[`resume-agent-conversational-chat.zh-CN.md`](./resume-agent-conversational-chat.zh-CN.md)、
> [`career-agent-web-interaction-design.zh-CN.md`](./career-agent-web-interaction-design.zh-CN.md)

## 1. 用户问题与成功结果

路线图 §5 把「职业档案、事实、证据、来源和确认状态」列为共享领域模块的第一条。在此之前，
这个页面上只有一个 textarea，内容写进 `localStorage`。它有三个可观察的问题：

1. **它不是证据源。** `profileResume` 只作为 `POST /v1/chat` 的 context 传出去；
   真正提交 Run 的 `submitRun` 用的是 `payload.candidateYaml`，而该 state 从未被档案
   填充过，提交时恒为 `''`。**用户在档案页写的简历，定制简历时一次都没用上。**
2. **它没有结构。** 一份 YAMLResume 文档在界面上就是一坨文本：看不出 Agent 拿到了
   什么、缺什么、哪一段没有起止时间。
3. **它不是机密存储。** 浏览器 `localStorage` 不加密、退出登录不清除、同一浏览器上
   任何账号都能读到。

可观察的改善结果：

1. 档案是每次 Run 的默认候选人输入，且界面上**明说**这次会用档案、允许当场换成不用；
2. 用户能看到 Agent 视角的档案就绪度：哪些字段有、哪些缺、为什么缺了会影响匹配；
3. 档案加密存在服务器上，按账号隔离，有独立的删除入口；
4. 输出偏好（样式/格式/语言/页数/目标岗位）只设一次，新 Run 默认沿用。

## 2. 范围

- 新增 `GET|PUT|DELETE /v1/profile`，契约进 `docs/api/resume-agent.openapi.yaml`；
- `AuthService` 增加按用户加密的档案存储（`resume_agent_profiles` 表）；
- `packages/agent-web` 新增 `components/profile/*`：身份条 + 锚点分区导航 +
  档案/偏好/材料/账户四个分区；
- `@yamlresume/core` 增加 `./schema` 子路径导出，供浏览器端做 Schema 校验；
- 把档案接进输入台：`candidateYaml` 默认取档案简历，`preferences` 默认取档案偏好；
- 一次性迁移：把 `localStorage` 里的旧简历搬进账户，成功后清除本地副本。

## 3. 非目标

- **不做删除账户。** 后端没有这个能力，界面上也不会出现一个做不到的按钮。
  「删除档案」是数据删除，不是注销。
- **不持久化材料文件。** 只有文本与链接进档案；PDF/DOCX 每次运行时单独上传。
  SQLite 单行存二进制不是这个阶段该做的事（对象存储属于后续工作）。
- **不做后台重加密。** 密钥轮换在下次保存时生效，没有离线重加密任务。
- **不在前端做领域决策。** 样式、格式、限制一律来自 `GET /v1/capabilities`；
  前端不硬编码任何选项。

## 4. 决策记录

### 4.1 采用：把档案做成「加密的按用户 JSON 文档」

复用 RA-016 已经为 provider 凭据建好的那套：`aes-256-gcm` + `setAAD` 绑定
`{schema, userId, keyId}` + `RESUME_AGENT_CREDENTIAL_KEYS` 密钥轮换。
新表 `resume_agent_profiles` 与 `resume_agent_provider_credentials` 同构。

**理由**：同一份威胁模型（用户私有数据、按账号隔离、需要轮换密钥），
第二套实现没有意义。

### 4.2 采用：`@yamlresume/core/schema` 子路径导出 + 动态 import

`@yamlresume/core` 原本只有 `.` 一个 export，`index.ts` 是 barrel。
实测（esbuild，`--platform=browser`，minify）：

| 入口 | 体积 | gzip |
| --- | --- | --- |
| `@yamlresume/core`（全量） | 708.0 KB | — |
| `@yamlresume/core/schema`（新增） | 335.8 KB | 74.2 KB |

砍掉 372 KB。但再拆一层发现：**schema 子图本身只占 24 KB（7.2%）**，
其余 310 KB 是 zod v4 的运行时和它 40 多个语言包——一个都用不上。

因此前端**不静态 import**：概览态只用 `yaml` 解析（30.2 KB gzip），
Schema 校验只在用户切到「编辑」时才 `import('@yamlresume/core/schema')`。

生产构建实测（Next 16 standalone，真实首屏 HTML）：

- 首屏 8 个 chunk 合计 **1107.2 KB**；
- schema chunk **298.1 KB，不在首屏**（否则 +27%）；
- 首屏与 schema chunk 中 `usepackage` 命中数均为 0，**渲染层没有进浏览器包**。

### 4.3 采用：编辑态的行列错误用 `pos` 偏移量兜底

`yaml` 的 `YAMLParseError` 只在错误带**范围**时才填 `linePos`。实测缩进错误、
未闭合流、重复键都只给 `pos`（一个字符偏移量）。只依赖 `linePos` 会让最常见的
几类错误没有任何位置信息。

实现：`linePos` 优先，缺失时把 `pos[0]` 按换行符换算成 1-based 行列。

### 4.4 拒绝：为档案页引入 StyleKit 主题

StyleKit 是给 shadcn + Tailwind v4 注入整套风格 token 的 registry。本包用
`@appica/ui-react`，`globals.css` 已经有自己那套刻意约束（warm-neutral 覆盖、
radius 三档、overlay 三档、focus-ring 对比度修正）。装外部主题会与工作台、
能力广场、运行记录视觉断裂，且 PRODUCT.md 的 Anti-references 明确排除
「堆满渐变和大卡片的 SaaS 营销页」。

**借方法论不借风格**：页面用库自带的 `Toc`（自带 IntersectionObserver
滚动高亮）、`AlertDialog`（破坏性确认）、`ToggleGroup multiple`（多选）、
`Avatar`、`Alert`，不手搓已有组件。

### 4.5 拒绝：升 `AUTH_SCHEMA_VERSION`

`migrate()` 之后的 version 校验是**严格相等**：升版本号会让已有数据库直接抛
`invalid_configuration`。新表走同一个 `CREATE TABLE IF NOT EXISTS` 幂等块，
对已有库是补齐，对空库是建全。该策略已写进常量旁的注释。

## 5. 失败模式

| # | 场景 | 行为 |
| --- | --- | --- |
| 1 | 未登录访问任意 profile 路由 | 401，与其它受保护路由一致 |
| 2 | 账号从未保存过档案 | `GET` 返回 404 `profile_not_found`，与「保存了空档案」区分 |
| 3 | 服务器版本早于本功能 | capabilities 不含 `profile`；页面显示「这台服务器还没有档案功能」，不提供保存不进去的编辑器 |
| 4 | 密文被篡改或密钥缺失 | 解密失败 → `profile_unavailable`，不返回半截数据 |
| 5 | payload 超 1 MiB / 含 NUL | `invalid_profile` 400，**不写入**（测试断言拒绝后仍为 404） |
| 6 | 链接字段是 `javascript:` / `data:` | 400 且带 `materials.N.value` 路径——该值会渲染成 `href`，属于存储型 XSS 边界 |
| 7 | 保存失败 | 错误就地显示并附 `requestId`，草稿保留在页面上，不丢输入 |
| 8 | Schema chunk 加载失败 | 编辑态仍可用，只做 YAML 语法检查，并**明说**校验模块没加载 |
| 9 | YAML 解析报错但能恢复 | 同时返回错误列表与解析器恢复出的部分文档，不因一个缩进错误清空概览 |
| 10 | 旧档案结构与当前 schema 不符 | 服务端读取时宽松降级、保留时间戳，**不丢用户数据** |

## 6. 隐私与安全边界

- 档案密文落库；`localStorage` 旧键在迁移或用户拒绝后清除；
- 退出登录**不**删除档案（属于账号），删除是独立入口 + 二次确认；
- 材料链接的协议在**服务端**校验，不依赖任何客户端记得做这件事；
- 档案内容不写日志；测试用固定夹具，不含真实简历。

## 7. 验收标准与证据

| 项 | 证据 |
| --- | --- |
| 服务端加密存储 | `auth.test.ts` 6 项：往返、跨用户隔离、落库无明文、篡改检测、密钥轮换、缺失密钥、体积/字符校验 |
| HTTP 契约 | `auth-http.test.ts` 5 项：未认证拒绝、404 区分、跨账号不可见、字段级错误路径、空档案可保存 |
| payload 契约 | `profile.test.ts` 13 项：默认值、XSS 协议拒绝、链接长度、材料上限、偏好透传、宽松读取 |
| 前端解析 | `resume-overview.test.ts` 19 项：行列定位、恢复语义、关键词去重、提醒生成 |
| 前端归一化 | `profile.test.ts` 15 项：按 capabilities 收窄、材料修复、legacy 迁移与清除 |
| 客户端传输 | `client.test.ts` 23 项，含 204 空体回归 |
| 组件渲染 | `profile-resume.test.tsx` 11 项、`profile-materials.test.tsx` 8 项、`profile-preferences.test.tsx` 7 项、`profile-account.test.tsx` 7 项、`profile-view.test.tsx` 10 项 |
| 档案进入 Run | `launcher.test.tsx` 5 项，含「档案简历作为 candidate」与「当场选择不用」；`app-shell.test.tsx` 2 项，含 fresh login 拉取档案与保存后 launcher 跟随 |
| 真实浏览器验收 | 2026-09-17 完成：注册 → 建档案 → 编辑 YAML → 保存 → 刷新保持 → launcher 显示「本次会以个人主页的基础简历（122 字符）」并附「这次不用」退出开关；服务端契约同日在隔离实例逐项 curl 验证（见 §10） |
| 构建 | Next 16.3.5 生产构建通过；首屏不含 schema chunk |
| 无回归 | core 718 项、resume-agent-api 120 项（本次改动前 95 → +25）、agent-web 274 项（基线 190 → +84） |

组件测试需要 jsdom 缺失的 `window.matchMedia`（appica 的 `Select` 经
`useReducedMotion` 调用它），已在 `src/test/setup.ts` 补齐并在
`vitest.config.ts` 挂载；该文件只做这一件事，避免以后每个测试各自打补丁。

## 8. 剩余缺口

1. **没有完成真实浏览器从建档案到下载 PDF 的人工验收**——这是进入 Operational
   的门禁。2026-09-17 已完成「注册 → 建档案 → 保存 → 刷新保持 → launcher 默认使用」
   的浏览器验收（见 §7），但到 PDF 的下载段需要有效 Provider 配置，仍未做；
2. **测试环境的 `matchMedia` 是桩**：`matches` 恒为 `false`，所以「系统开启减少动画
   时行为如何」没有覆盖；
3. 材料文件不落库，`file` 控件闭环仍缺（RA-011 既有缺口）；
4. 密钥轮转无后台重加密；
5. 「显示名」字段未做——身份条只显示邮箱首字母，因为后端没有这个数据。

## 9. 本次实现中发现并修掉的既有问题

| 问题 | 影响 | 处理 |
| --- | --- | --- |
| `AgentApiClient.perform()` 对 204 空响应调用 `response.json()` | `logout()` 在**成功**时返回 `invalid_response` 错误；`app-shell` 忽略返回值所以界面没露馅 | 改为读 text，空体按成功且 `data: null`；加回归测试 |
| `LauncherView` 的 `jobDescription` / `candidateYaml` state | 从草稿恢复后从未被渲染，也从未进入提交 payload——纯死状态 | 删除；草稿持久化收窄为只存 `presetId`（并改为独立键，否则 `saveDraft` 会因文本为空而删掉整条记录） |
| `saveDraft` 在两条文本都为空时删除整条记录 | 若把 presetId 混存其中，只选了预设的用户刷新后会静默丢失选择 | 新增 `loadPresetId` / `savePresetId` 独立存储 |
| **档案只有访问过档案页才进入 launcher**（2026-09-17 浏览器验收发现） | `profileDraft` 只由 `ProfileView` 挂载时的 `onProfileChange` 填充；新登录直接进 launcher 会显示「档案里还没有基础简历」，提交 Run 时 `candidateYaml` 恒为 `''`——账户里明明有简历却不会被使用，正是 §1 的头号用户问题在 shell 层的残留 | `AppShell` 在 session 解析后主动 `GET /v1/profile` 并用 `normalizeProfile` 收窄后填入 `profileDraft`；用代数计数器（`profileReportGeneration`）保证在途 GET 不会覆盖档案页更新的报告；logout 清空草稿防止跨账号串数据；新增 `app-shell.test.tsx` 2 项（fresh login 显示 chip、保存后 launcher 跟随） |

## 10. 2026-09-17 真实浏览器与服务端验收记录

环境：API 以 `RESUME_AGENT_AUTH_MODE=enabled` + 一次性随机 32 字节加密密钥起在
`127.0.0.1:8788`（memory RunStore，独立于任何个人数据）；Web 以
`NEXT_PUBLIC_AGENT_API_BASE_URL=http://localhost:8788` 起在 `3101`。

服务端逐项 curl 结果：

| 检查 | 结果 |
| --- | --- |
| `GET /v1/capabilities` 声明 profile | `profile: { materials: 50 }` |
| 未认证 GET/PUT/DELETE | 全部 401 |
| 从未保存过档案 | 404 `profile_not_found`，与「保存了空档案」区分 |
| 非法 payload（样式越界 / 缺 `createdAt`） | 400 `invalid_profile` 带字段路径，**未写入**（拒绝后 GET 仍 404） |
| 往返 | 简历 YAML / 偏好 / 材料原样返回 |
| 落库加密 | SQLite 密文不含「张三」「订单系统重构」「github.com」任一明文 |
| `javascript:` 链接 | 400，路径 `materials.0.value` |
| 跨用户隔离 | 用户 2 读用户 1 档案为 404；互不覆盖 |
| 删除幂等 | DELETE 两次均 204，再 GET 404 |

浏览器（Playwright + 系统 Chrome）流程：

1. 注册 → launcher；
2. 进档案页 → 编辑 YAML → 保存 → 刷新 → 档案保持；
3. 回 launcher → 显示「本次会以个人主页的基础简历（122 字符）作为你的材料。这次不用」。

过程中发现并修掉 §9 第 4 行的 shell 层 bug：fresh login（未访问档案页）曾显示
「档案里还没有基础简历」，Run 会以空 `candidateYaml` 提交。修复后同路径复验通过。
