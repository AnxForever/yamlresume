# Resume Agent 常见文档输出 Feature Brief

> Feature ID：RA-007C
> 状态：Partial；RA-007C-A（TXT）与 RA-007C-B（RTF）已在开发环境实现，
> RA-007C-C（ODT）仍为 Planned
> 最后审阅：2026-09-16
> 范围：新增 TXT、RTF、ODT 简历产物，并复用 RA-007B 的顺序、partial-success、编码和安全失败契约；本次只完成 TXT/RTF。

## 1. 用户问题与结果

本切片实施前，Resume Agent 可生成 YAML、JSON、Markdown、HTML、LaTeX、PDF 和 DOCX，但求职者还会
遇到只接受纯文本粘贴、需要传统可编辑交换格式、或主要使用 LibreOffice/OpenOffice 的场景。
“下载 DOCX”不能覆盖这些需求：

- 招聘网站的纯文本框需要无 Markdown/HTML 控制符的可复制内容；
- RTF 仍用于部分 ATS、老旧办公软件和跨系统交换；
- ODT 是开放文档生态中的原生可编辑格式。

当前调用方已经可以在同一 `formats` 请求中选择 `txt` 和 `rtf`；`odt` 仍不能请求。
成功产物遵守统一 metadata/size/encoding 契约，现有每格式隔离边界继续生效。此状态不承诺
TXT/RTF 与 PDF/DOCX 像素级一致，也不把“扩展名正确”当成有效文档证据。

## 2. 当前实现与可复用边界

本地证据来自 `contracts.ts`、`rendering/artifacts.ts`、相邻测试及 RA-007B：

1. `OutputFormatSchema` 当前固定九种格式，`formats` 上限也是 9；ODT 尚未进入 enum。
2. `OutputArtifact` 已统一 `format/style/filename/mediaType/encoding/content/sizeBytes`。
3. 文本产物使用 UTF-8 string，PDF/DOCX 使用 base64 包装的 Buffer。
4. 请求顺序和 first-seen 去重已验证；每格式独立捕获失败并返回安全摘要。
5. YAML/JSON/Markdown/HTML/LaTeX 还存在 legacy 顶层字段；`artifacts` 才是可扩展的权威集合。
6. TXT/RTF 共用内部 `ResumeDocument`，覆盖 YAMLResume 的所有业务字段，忽略 `computed` 派生字段；新格式没有增加 legacy 顶层字段。
7. RTF 是 ASCII-only source，用户文本统一转义，Unicode 以 `\uN?` UTF-16 code unit 输出。
8. LibreOffice Writer 24.2.7.2 已把对抗 fixture 转成 UTF-8 文本和一页 PDF；DOCX/preset 跨阅读器视觉保真仍未证明。

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
| 在 `renderResumeVariant` 中逐个增加 exporter | Adapt | 复用排序、去重、partial-success 与错误隔离；TXT/RTF 已完成，ODT 不夹带 |
| TXT 专用语义 renderer | Adopt | 从 Markdown 删除标记会误伤正文和 URL |
| RTF 有界 writer，所有用户文本统一 escape | Adopt | 格式有限，避免调用不透明转换进程 |
| ODT 最小合规 package writer | Adopt | 结构可由 OASIS 规范和独立 reader 验证 |
| 新格式增加 legacy 顶层字段 | Reject | `artifacts` 已是权威扩展点；RED→GREEN 已验证结果不存在 `txt`/`rtf` 顶层字段 |
| 经 LaTeX/PDF 反向转换到 RTF/ODT | Reject | 引入额外 binary、临时文件与不可控格式损失 |
| 声称五种 preset 跨格式视觉等价 | Reject | 当前连 DOCX 都缺少该证据；先承诺内容和语义结构 |

## 4. 范围与优先级

### RA-007C 总体 Must have

- `OutputFormatSchema` 支持 `txt`、`rtf`、`odt`，并调整数组上限。
- TXT 是真正的纯文本，保留内容顺序、段落、列表、URL 和 Unicode。
- RTF 可被独立 reader 打开，正确 escape 用户文本并保留 Unicode。
- ODT 是可识别 package，具备正确 mimetype、manifest、正文和基础样式结构。
- 三种格式都有准确 media type、filename、encoding 和 `sizeBytes`。
- exporter 失败产生安全 `artifact_render_failed`，其他请求格式继续成功。
- exporter 不修改源 Resume；相同输入与 style 产生稳定内容。

当前完成其中 TXT、RTF 的 enum、metadata、内容顺序、Unicode、安全转义、输入不可变和
独立 reader 验证。ODT package 与 ODT 专属 failure/package tests 未完成，因此 RA-007C
整体仍是 Partial，不能写成已完成。

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
| `txt` | `resume-{style}.txt` | `text/plain; charset=utf-8` | `utf8` | UTF-8 实际字节数 |
| `rtf` | `resume-{style}.rtf` | `application/rtf` | `utf8` | RTF source 的 UTF-8/ASCII 字节数 |
| `odt` | `resume-{style}.odt` | `application/vnd.oasis.opendocument.text` | `base64` | 解码后 ZIP package 字节数 |

TXT/RTF 只出现在 `artifacts` 与每个 variant 的 `artifacts` 中。现有 YAML/JSON/Markdown/
HTML/LaTeX legacy 顶层字段保持兼容但不扩展；ODT 实现后也必须遵守这一规则。消费者必须
以 `encoding` 决定是直接写 UTF-8 还是先 base64 decode，不能从扩展名自行猜测。

## 6. 模块设计

```ts
interface ResumeExporter { // RA-007C 的目标 seam；尚未作为公开接口实现
  readonly format: 'txt' | 'rtf' | 'odt'
  export(resume: Resume, style: StylePresetID): Promise<ExportedContent>
}

type ExportedContent =
  | { encoding: 'utf8'; content: string }
  | { encoding: 'base64'; content: Uint8Array }
```

公开 `renderResumeVariant` 仍是唯一入口。当前 TXT/RTF 是该深模块内的纯函数 writer，
共享 metadata/encoding 和错误隔离；上面的 `ResumeExporter` 是 ODT 接入后可能采用的内部目标
接口，并非当前已发布类型。已有 PDF compiler seam 保持独立，不把所有格式抽象成外部 converter。

为了避免同一份简历在三个 writer 中各自遍历且逐渐分叉，先构建内部的展示模型：

```ts
interface ResumeDocument {
  title: string
  headline: string
  contacts: string[]
  summaryHeading: string
  summary: string[]
  sections: Array<{
    heading: string
    entries: Array<{
      title: string
      metadata: string
      details: string[]
    }>
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

### 10.1 本次实际 RED → GREEN 记录

1. **TXT 契约：** 先让 `OutputFormatSchema.parse('txt')` 与 artifact metadata/content 断言失败，
   再加入 enum、UTF-8 metadata 和直接从 Resume 渲染的纯文本 writer。
2. **RTF 安全边界：** 先断言合法 header、ASCII-only source、中文、emoji、brace、backslash
   和伪 `\object`，再加入统一 escape 与 UTF-16 signed `\uN?` writer。
3. **共享语义模型：** 先用多 section fixture 断言顺序、URL、地址与去重，再抽取内部
   `ResumeDocument`，由 TXT/RTF 两个 writer 复用。
4. **前端能力契约：** 先让 `/v1/capabilities` 的 `txt`/`rtf` 断言失败，再同步 API 与 OpenAPI enum。
5. **拒绝浅接口膨胀：** 先断言结果没有 `txt`/`rtf` legacy 顶层字段，再把新格式只保留在
   `artifacts`；既有五个 legacy 文本字段保持兼容。
6. **内容完整性回填：** 全 section fixture 暴露 work URL、education score、language keywords
   丢失，再扩展共享 section definition；测试覆盖其余 URL、日期、课程、联系方式和摘要。
7. **复用核心展示语义：** locale/alias/order 测试先暴露英文硬编码和固定顺序，再复用
   YAMLResume 的 section translation、alias 与 `mergeArrayWithOrder` 契约。

这些测试通过公开 `renderResumeVariant` seam 验证行为，没有 mock TXT/RTF writer，也没有把
LibreOffice 变成 runtime 或单元测试依赖。

## 11. 测试与验收门禁

- 真实 writer：测试不可把 RTF/ODT exporter 全部 mock 掉；
- 独立结构检查：RTF 用独立 parser 或显式 LibreOffice 对照，ODT 用独立 ZIP/XML reader；
- fixtures：ASCII、中日韩文、emoji、braces、XML 字符、长 URL、多 section、空可选字段；
- package：ODT mimetype、manifest、content、styles、entry 顺序、压缩方式和 decoded size；
- 兼容：LibreOffice 必测，Word/Google Docs 在可用环境做记录式手工矩阵；
- 回归：原有七格式、style、workflow warning 和输入不可变性测试全部通过；
- 门禁：focused tests、完整 resume-agent tests、TypeScript、build、Biome、license、
  `git diff --check`。

TXT/RTF 的自动测试和一次 LibreOffice 开发期实验通过后只标记各自
`Implemented for development`。ODT、跨应用兼容矩阵、真实下载、大型简历性能和用户反馈
仍缺失时，RA-007C 整体不得标记完成或 `Operational`。

### 11.1 兼容性实验（2026-09-16）

- 环境：LibreOffice Writer `24.2.7.2 420(Build:2)`；Writer 起初缺失，经显式授权安装后执行。
- 输入：代码生成的 RTF，含中英文姓名、emoji、详细地址、长 URL、多个 section、brace、
  backslash 和伪 `\object-like` 用户正文。
- `--convert-to txt:Text` 成功，结果被识别为带 BOM 的 UTF-8 文本；中文、emoji、URL、section
  顺序、项目符号及对抗文本均可读取，伪 control word 仍是普通文本。
- `--convert-to pdf:writer_pdf_Export` 成功，`file` 识别为 PDF 1.7、1 页。
- 独立 `UnRTF 0.21.10` 能解析分段、项目符号和 ASCII 内容，但把 RTF Unicode control word
  显示为 `?`；因此只作为结构辅助证据，不作为 Unicode 兼容证据。
- 仍未验证 Microsoft Word、WPS、Google Docs 导入，也未做视觉 baseline 和大文件性能测试。

### 11.2 自动门禁记录（2026-09-16）

- `pnpm agent test src/rendering/artifacts.test.ts`：12/12 通过；
- `pnpm agent-api test`：15/15 通过；API 测试需要绑定 localhost，受限沙箱内会返回
  `listen EPERM`，在获准的本地执行环境中通过；
- `pnpm agent build`、`pnpm agent-api build`：通过；
- 两个 package 的 `tsc --noEmit`：通过；
- 六个目标 TypeScript 文件的 Biome：通过；`git diff --check`：通过；
- `pnpm license:check` 退出码 0，但环境缺少 `addlicense` binary，实际扫描被脚本跳过；修改的
  既有 TypeScript 文件保留完整 MIT header；
- `timeout 15s pnpm agent test` 中 14 个文件、150 个测试均显示通过，但共享工作树中的
  RA-015E heartbeat 改动使全套 Vitest 进程未退出，最终为 timeout 124；其两个相关文件单独
  运行分别为 39/39 与 18/18。此项不能记为完整套件绿色，也不把退出问题归因于 TXT/RTF。

## 12. 证据台账

| Feature ID | 生命周期 / 用户结果 | 交付 | 证据覆盖 | 历史缺口 | 剩余缺口 |
| --- | --- | --- | --- | --- | --- |
| RA-007C-A | Resume → copyable TXT | Implemented for development | Covered：公开 seam、全 section fixture、UTF-8/metadata/末尾换行测试 | none | 浏览器真实下载、ATS 粘贴和大文件性能 |
| RA-007C-B | Resume → interoperable RTF | Implemented for development | Partial：规范、escape/Unicode tests、LibreOffice 24.2.7.2 TXT/PDF round-trip | none | Word/WPS/Google Docs 矩阵、视觉与大文件性能 |
| RA-007C-C | Resume → valid editable ODT | Planned | Partial：OASIS package 规范 | none | deterministic package 与 reader matrix |
| RA-007C-D | one exporter fails → other artifacts survive | Implemented at shared seam; new pure writers partially covered | Partial：RA-007B generic text/binary failure isolation 与本次组合顺序测试 | none | ODT failure injection；TXT/RTF 无外部依赖但尚无专属 forced-failure seam |
| RA-007C-E | selected style → accessible semantic document | Implemented for TXT/RTF logical order | Partial：全 section fixture 与 LibreOffice 一栏读取结果 | none | preset 视觉差异不承诺；跨阅读器可访问性矩阵 |

## 13. 实施顺序与依赖门禁

1. RA-015C 已完成；TXT 与 RTF 在同一小切片实现，是因为二者共用语义模型且不增加依赖。
2. TXT 已验证共享 `ResumeDocument`、全 section 字段、顺序、URL 与 UTF-8 metadata。
3. RTF 已验证 escape/Unicode、ASCII source、LibreOffice 读取与 PDF 转换。
4. ODT 仍单独实施：先完成 ZIP/XML 技术 spike、许可检查与 package fixtures；在隔离切片中
   显式更新 `package.json`/lockfile，不借用 `docx` 的传递 ZIP 依赖。
5. ODT 完成后再跑三格式组合和更完整的兼容矩阵，不把 TXT/RTF 的通过写成 RA-007C 总完成。

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
