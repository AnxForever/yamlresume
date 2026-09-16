# Resume Agent 常见文档输出 Feature Brief

> Feature ID：RA-007C
> 状态：Planned；研究与契约已就绪，尚未实现
> 最后审阅：2026-09-16
> 范围：新增 TXT、RTF、ODT 简历产物，并复用 RA-007B 的顺序、partial-success、编码和安全失败契约。

## 1. 用户问题与结果

现有 Resume Agent 可生成 YAML、JSON、Markdown、HTML、LaTeX、PDF 和 DOCX，但求职者还会
遇到只接受纯文本粘贴、需要传统可编辑交换格式、或主要使用 LibreOffice/OpenOffice 的场景。
“下载 DOCX”不能覆盖这些需求：

- 招聘网站的纯文本框需要无 Markdown/HTML 控制符的可复制内容；
- RTF 仍用于部分 ATS、老旧办公软件和跨系统交换；
- ODT 是开放文档生态中的原生可编辑格式。

RA-007C 完成后，调用方可以在同一 `formats` 请求中选择 `txt`、`rtf`、`odt`。成功产物
遵守统一 metadata/size/encoding 契约；单个 exporter 失败不会破坏其他格式。它不承诺三种
格式与 PDF/DOCX 像素级一致，也不把“扩展名正确”当成有效文档证据。

## 2. 当前实现与可复用边界

本地证据来自 `contracts.ts`、`rendering/artifacts.ts` 及 RA-007B 测试：

1. `OutputFormatSchema` 当前固定七种格式，`formats` 上限也是 7。
2. `OutputArtifact` 已统一 `format/style/filename/mediaType/encoding/content/sizeBytes`。
3. 文本产物使用 UTF-8 string，PDF/DOCX 使用 base64 包装的 Buffer。
4. 请求顺序和 first-seen 去重已验证；每格式独立捕获失败并返回安全摘要。
5. YAML/JSON/Markdown/HTML/LaTeX 还存在 legacy 顶层字段；`artifacts` 才是可扩展的权威集合。
6. DOCX exporter 已证明 package 基础结构，但尚未证明跨阅读器和 preset 视觉保真。

因此新增 exporter 应进入现有深模块，不新建第二套 delivery API，也不继续无限扩展 legacy
顶层字段。

## 3. 研究证据与决策

### 3.1 主要证据

- IANA media type registry 与 RFC 8118 提供 RTF 的 `application/rtf` 注册类型。
- OASIS OpenDocument 1.3 定义 ODT package、mimetype、manifest 与正文 XML 结构。
- Microsoft RTF 规范定义 group/control word、字符集、Unicode 和 paragraph 语义。
- Node.js Buffer 契约可区分 UTF-8 文本字节数和 binary package 原始字节数。

### 3.2 独立证据

- RA-007B 的真实 renderer/DOCX package 和 fake PDF adapter 测试已验证统一 artifact seam。
- 本机 LibreOffice 可作为开发期独立阅读器检查 RTF/ODT，但不是 runtime 依赖。
- 当前 `docx@9.7.1` 已间接带入 ZIP 工具，不代表本模块可以依赖传递依赖；若 ODT exporter
  采用 ZIP 库，必须作为 direct dependency 固定版本并完成许可检查。

### 3.3 Adopt / Adapt / Reject

| 候选 | 决策 | 理由 |
| --- | --- | --- |
| 在 `renderResumeVariant` 中增加三个 exporter | Adapt | 复用排序、去重、partial-success 与错误隔离 |
| TXT 专用语义 renderer | Adopt | 从 Markdown 删除标记会误伤正文和 URL |
| RTF 有界 writer，所有用户文本统一 escape | Adopt | 格式有限，避免调用不透明转换进程 |
| ODT 最小合规 package writer | Adopt | 结构可由 OASIS 规范和独立 reader 验证 |
| 新格式增加 legacy 顶层字段 | Reject | `artifacts` 已是权威扩展点，避免 API 持续膨胀 |
| 经 LaTeX/PDF 反向转换到 RTF/ODT | Reject | 引入额外 binary、临时文件与不可控格式损失 |
| 声称五种 preset 跨格式视觉等价 | Reject | 当前连 DOCX 都缺少该证据；先承诺内容和语义结构 |

## 4. 范围与优先级

### Must have

- `OutputFormatSchema` 支持 `txt`、`rtf`、`odt`，并调整数组上限。
- TXT 是真正的纯文本，保留内容顺序、段落、列表、URL 和 Unicode。
- RTF 可被独立 reader 打开，正确 escape 用户文本并保留 Unicode。
- ODT 是可识别 package，具备正确 mimetype、manifest、正文和基础样式结构。
- 三种格式都有准确 media type、filename、encoding 和 `sizeBytes`。
- exporter 失败产生安全 `artifact_render_failed`，其他请求格式继续成功。
- exporter 不修改源 Resume；相同输入与 style 产生稳定内容。

### Should have

- RTF/ODT 使用 heading、paragraph、list、link 等语义，而不只是一个超长段落。
- 以 WordPad/Word、LibreOffice 和 Google Docs 的代表性导入结果建立手工兼容矩阵。
- 对大简历测量产物大小与耗时，设置有证据的输出上限。

### Won't have in RA-007C

- 与 PDF、DOCX 像素级或分页级一致；
- ODT 宏、嵌入对象、外部图片、远程字体或动态字段；
- RTF 图片、OLE object、track changes 或复杂表格；
- Apple Pages、PPT、XLS 或通用文档转换 API；
- 下载鉴权、对象存储、病毒扫描和保留策略。

## 5. 公开产物契约

| format | filename | media type | API encoding | `sizeBytes` |
| --- | --- | --- | --- | --- |
| `txt` | `resume-{style}.txt` | `text/plain` | `utf8` | UTF-8 实际字节数 |
| `rtf` | `resume-{style}.rtf` | `application/rtf` | `utf8` | RTF source 的 UTF-8/ASCII 字节数 |
| `odt` | `resume-{style}.odt` | `application/vnd.oasis.opendocument.text` | `base64` | 解码后 ZIP package 字节数 |

新增格式只出现在 `artifacts` 与每个 variant 的 `artifacts` 中。现有 YAML/JSON/Markdown/
HTML/LaTeX legacy 顶层字段保持兼容但不扩展。消费者必须以 `encoding` 决定是直接写 UTF-8
还是先 base64 decode，不能从扩展名自行猜测。

## 6. 模块设计

```ts
interface ResumeExporter {
  readonly format: 'txt' | 'rtf' | 'odt'
  export(resume: Resume, style: StylePresetID): Promise<ExportedContent>
}

type ExportedContent =
  | { encoding: 'utf8'; content: string }
  | { encoding: 'base64'; content: Uint8Array }
```

公开 `renderResumeVariant` 仍是唯一入口；format registry 负责将 enum 映射到 exporter、
media type 与 encoding。单个 exporter 隐藏转义、XML、ZIP、样式和 package 细节。已有 PDF
compiler seam 保持独立，不把所有格式抽象成外部 converter。

为了避免同一份简历在三个 writer 中各自遍历且逐渐分叉，先构建内部的展示模型：

```ts
interface ResumeDocument {
  title: string
  contactLines: string[]
  sections: Array<{
    heading: string
    blocks: Array<
      | { type: 'paragraph'; text: string }
      | { type: 'list'; items: string[] }
      | { type: 'entry'; title: string; meta?: string; details: string[] }
    >
  }>
}
```

该模型只表达内容顺序和基础语义，不承担 YAMLResume schema、页面布局或模型生成职责。
TXT、RTF、ODT 共享它；现有 DOCX 是否迁移必须由 characterization tests 证明无回归后另做
重构，不能夹带在第一个 GREEN 中。

## 7. 格式策略

### 7.1 TXT

- UTF-8、统一换行、文件末尾单个换行；
- 标题与 section heading 使用可读文本，不输出 Markdown heading marker；
- 列表采用稳定的纯文本 bullet 或缩进，正文中的符号和 URL 原样保留；
- 不用正则从 HTML/Markdown 剥离格式，直接从 `ResumeDocument` 渲染。

### 7.2 RTF

- 输出最小 document header、font table、Unicode 配置和正文 groups；
- braces、control separator 与 backslash 等语法字符统一由一个 escape 函数处理；
- 非 ASCII 使用规范 Unicode control word 和 fallback，非 BMP 字符按 UTF-16 code unit 处理；
- heading、paragraph、list 与 link text 可表达，拒绝图片、对象和外部 destination；
- 任何 Resume 字段都只能作为 escaped text，不能拼进 control word 或 font table 标识。

### 7.3 ODT

- `mimetype` 为首个未压缩 entry，值为 ODT media type；
- 至少生成 `META-INF/manifest.xml`、`content.xml`、`styles.xml` 和必要 metadata；
- XML text/attribute 使用统一 escape，禁止 DTD、external entity、宏和外部资源；
- 用 heading、paragraph、list、link 等 ODF 元素表达 `ResumeDocument`；
- package writer 必须确定 entry 顺序和时间 metadata，避免相同输入产生不必要的二进制漂移。

## 8. 样式与可访问性承诺

`style` 仍表示用户选择的 preset，并写入 artifact metadata，但本切片只保证：

- 内容完整、阅读顺序稳定；
- heading/list/link 等基础语义存在；
- contact、经历、项目、教育等 section 不因格式丢失；
- 每种格式至少有可辨识的基础 typography/spacing（TXT 除外）。

它不保证和 PDF 的换行、分页、列布局或字体一致。两栏 preset 在 TXT/RTF/ODT 中优先转为
单栏逻辑顺序，以可访问性和 ATS 读取为先。只有跨阅读器视觉基准建立后，才能把样式保真
从 `partial` 升级。

## 9. 错误、安全与资源边界

- 用户正文不得进入 exporter error、warning 或日志；
- RTF/XML 必须对控制字符和语法字符做 allow/escape，不能允许字段注入结构；
- ODT package 不包含本地路径、临时目录、外部 relationship、脚本或未请求附件；
- 所有成功产物必须非空并低于配置的最大输出字节数；
- ZIP writer、RTF writer 或兼容性工具的原始错误统一转为固定摘要；
- LibreOffice 只用于显式兼容性测试，不在单元测试或 runtime 中隐式 spawn。

## 10. 单行为 RED → GREEN 顺序

1. `txt` enum/API 契约接受请求，返回 metadata 正确的非空 artifact。
2. TXT fixture 保留姓名、Unicode、section 顺序、列表和 URL，且不含 Markdown/HTML 结构符。
3. TXT 与已有格式一起请求时保持 first-seen 顺序、去重和 partial-success。
4. `rtf` artifact 具有合法 header、media type、UTF-8 size 和安全 escape。
5. 独立 RTF reader/LibreOffice 对照能还原 fixture 正文与 Unicode。
6. RTF 中的 brace/control-like 用户文本不能注入 group 或 object。
7. `odt` artifact 是 base64 package，mimetype 与关键 entries 可独立验证。
8. ODT XML reader按顺序还原 heading、paragraph、list、URL 和 Unicode。
9. ODT package 不含外部资源；XML 特殊字符和私密 exporter error 安全处理。
10. 三个 exporter 的强制失败各自不影响同请求中的其他格式。
11. 多 style 连续渲染不修改源 Resume，相同输入的语义内容稳定。

每个行为单独 RED → GREEN。不得先把三个 enum 和依赖全部接入，再一次性补 snapshots。

## 11. 测试与验收门禁

- 真实 writer：测试不可把 RTF/ODT exporter 全部 mock 掉；
- 独立结构检查：RTF 用独立 parser 或显式 LibreOffice 对照，ODT 用独立 ZIP/XML reader；
- fixtures：ASCII、中日韩文、emoji、braces、XML 字符、长 URL、多 section、空可选字段；
- package：ODT mimetype、manifest、content、styles、entry 顺序、压缩方式和 decoded size；
- 兼容：LibreOffice 必测，Word/Google Docs 在可用环境做记录式手工矩阵；
- 回归：现有七格式、style、workflow warning 和输入不可变性测试全部通过；
- 门禁：focused tests、完整 resume-agent tests、TypeScript、build、Biome、license、
  `git diff --check`。

全部自动测试通过后只可标记 `Implemented for development`。跨应用兼容矩阵、真实下载、
大型简历性能和用户反馈仍缺失时，不得标记 `Operational`。

## 12. 证据台账

| Feature ID | 生命周期 / 用户结果 | 交付 | 证据覆盖 | 历史缺口 | 剩余缺口 |
| --- | --- | --- | --- | --- | --- |
| RA-007C-A | Resume → copyable TXT | Planned | Partial：本地模型与 artifact seam | none | dedicated renderer 与 fixtures |
| RA-007C-B | Resume → interoperable RTF | Planned | Partial：Microsoft 规范、IANA/RFC | none | writer、Unicode/escape、reader matrix |
| RA-007C-C | Resume → valid editable ODT | Planned | Partial：OASIS package 规范 | none | deterministic package 与 reader matrix |
| RA-007C-D | one exporter fails → other artifacts survive | Planned | Covered design：RA-007B；新格式未验证 | none | 每格式 failure injection |
| RA-007C-E | selected style → accessible semantic document | Planned | Gap | none | content completeness 与跨阅读器证据 |

## 13. 实施顺序与依赖门禁

1. RA-015C 验收完成后再进入格式实现，避免跨阶段同时修改核心 workflow。
2. 先实现 TXT，验证共享 `ResumeDocument` 是否足够深而不丢内容。
3. 再实现 RTF，解决 escape/Unicode 后独立提交。
4. 最后实现 ODT，先完成 ZIP/XML 技术 spike、许可检查与 package fixtures。
5. 三个提交完成后再跑跨格式组合和兼容矩阵，不把“能生成”当成总验收。

若引入 ZIP/XML/RTF 依赖，必须直接写入 `packages/resume-agent/package.json`，固定版本，核对
license/维护状态/传递依赖，并在没有共享前端变更时单独更新 lockfile。不得依赖 `docx` 偶然
带入的 transitive package。

## 14. 会推翻方案的证据

- 若用户实际只需要粘贴文本，TXT 优先级可提高，但不能据此删除已登记的 ODT/RTF 需求。
- 若成熟 RTF/ODT writer 通过维护、许可、资源和对抗审查，可复用其底层实现；公开 artifact
  契约与独立验证仍保持不变。
- 若 `ResumeDocument` 无法表达必要的链接、日期或多语言结构，应扩展语义模型；不能让三个
  writer 各自读取任意 Resume path。
- 若兼容矩阵显示某 reader 不支持规范允许的 Unicode 写法，应在不破坏其他 reader 的前提
  下调整 writer，并把差异固定为 fixture，而不是只针对一个手工文件打补丁。

## 15. 参考资料

- IANA Media Types：<https://www.iana.org/assignments/media-types/>
- RFC 8118, The `application/rtf` Media Type：
  <https://www.rfc-editor.org/rfc/rfc8118>
- Microsoft Rich Text Format specification：
  <https://learn.microsoft.com/en-us/previous-versions/office/developer/office2000/aa140277(v=office.10)>
- OASIS OpenDocument 1.3 Part 2 Packages：
  <https://docs.oasis-open.org/office/OpenDocument/v1.3/os/part2-packages/>
- OASIS OpenDocument 1.3 Part 3 Schema：
  <https://docs.oasis-open.org/office/OpenDocument/v1.3/os/part3-schema/>
- Node.js v22 Buffer：<https://nodejs.org/docs/latest-v22.x/api/buffer.html>
