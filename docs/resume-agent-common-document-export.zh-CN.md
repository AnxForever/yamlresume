# Resume Agent 常见文档输出 Feature Brief

> Feature ID：RA-007C
> 状态：Implemented for development；RA-007C-A（TXT）、RA-007C-B（RTF）与
> RA-007C-C（ODT）均已实现，跨应用兼容与生产下载证据仍为 Partial
> 最后审阅：2026-09-16
> 范围：新增 TXT、RTF、ODT 简历产物，并复用 RA-007B 的顺序、partial-success、编码和安全失败契约。

## 1. 用户问题与结果

本切片实施前，Resume Agent 可生成 YAML、JSON、Markdown、HTML、LaTeX、PDF 和 DOCX，但求职者还会
遇到只接受纯文本粘贴、需要传统可编辑交换格式、或主要使用 LibreOffice/OpenOffice 的场景。
“下载 DOCX”不能覆盖这些需求：

- 招聘网站的纯文本框需要无 Markdown/HTML 控制符的可复制内容；
- RTF 仍用于部分 ATS、老旧办公软件和跨系统交换；
- ODT 是开放文档生态中的原生可编辑格式。

当前调用方已经可以在同一 `formats` 请求中选择 `txt`、`rtf` 和 `odt`。
成功产物遵守统一 metadata/size/encoding 契约，现有每格式隔离边界继续生效。此状态不承诺
三种格式与 PDF/DOCX 像素级一致，也不把“扩展名正确”当成有效文档证据。

## 2. 当前实现与可复用边界

本地证据来自 `contracts.ts`、`rendering/artifacts.ts`、相邻测试及 RA-007B：

1. `OutputFormatSchema` 当前固定十种格式，`formats` 上限也是 10；API capability 与 OpenAPI 同步。
2. `OutputArtifact` 已统一 `format/style/filename/mediaType/encoding/content/sizeBytes`。
3. 文本产物使用 UTF-8 string，PDF/DOCX 使用 base64 包装的 Buffer。
4. 请求顺序和 first-seen 去重已验证；每格式独立捕获失败并返回安全摘要。
5. YAML/JSON/Markdown/HTML/LaTeX 还存在 legacy 顶层字段；`artifacts` 才是可扩展的权威集合。
6. TXT/RTF/ODT 共用内部 `ResumeDocument`，覆盖 YAMLResume 的所有业务字段，忽略 `computed` 派生字段；新格式没有增加 legacy 顶层字段。
7. RTF 是 ASCII-only source，用户文本统一转义，Unicode 以 `\uN?` UTF-16 code unit 输出。
8. LibreOffice Writer 24.2.7.2 已把对抗 fixture 转成 UTF-8 文本和一页 PDF；DOCX/preset 跨阅读器视觉保真仍未证明。
9. ODT 由固定五 entry 的确定性 STORE-only ZIP32 writer 生成；ODF Toolkit 0.13.0 按 ODF 1.3 schema 验证无错误/警告，Info-ZIP CRC 检查与 LibreOffice TXT/PDF round-trip 通过。

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
| 在 `renderResumeVariant` 中逐个增加 exporter | Adapt | 复用排序、去重、partial-success 与错误隔离；三种格式均在同一公开 seam 交付 |
| TXT 专用语义 renderer | Adopt | 从 Markdown 删除标记会误伤正文和 URL |
| RTF 有界 writer，所有用户文本统一 escape | Adopt | 格式有限，避免调用不透明转换进程 |
| ODT 最小合规 package writer | Adopt | 固定 entry、STORE-only ZIP32 比引入通用压缩接口更有界；结构由 OASIS schema 和独立 reader 验证 |
| 直接使用 `docx` 的传递 `jszip` | Reject | 传递依赖不是本模块契约；固定 entry writer 无需新增依赖或争用共享 lockfile |
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

当前已经完成三种格式的 enum、metadata、内容顺序、Unicode、安全转义、输入不可变、
partial-success 和独立 reader 验证。RA-007C 可记为开发级实现；跨应用矩阵、浏览器下载、
大型简历性能与真实用户反馈仍不完整，因此不能写成 `Operational`。

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

TXT/RTF/ODT 只出现在 `artifacts` 与每个 variant 的 `artifacts` 中。现有 YAML/JSON/Markdown/
HTML/LaTeX legacy 顶层字段保持兼容但不扩展。消费者必须
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

公开 `renderResumeVariant` 仍是唯一入口。TXT/RTF 是该深模块内的纯函数 writer；ODT 的
ZIP/XML 复杂度封装在内部 `renderOdtDocument` 模块，三者共享 metadata/encoding、语义模型和
错误隔离。上面的 `ResumeExporter` 仍只是设计词汇而非已发布类型；已有 PDF compiler seam
保持独立，不把所有格式抽象成外部 converter。

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

实现采用五个固定 entry：`mimetype`、`META-INF/manifest.xml`、`content.xml`、`styles.xml`、
`meta.xml`。所有 entry 都使用 STORE，DOS 时间固定为 1980-01-01，文件名和顺序不可由用户
控制；这避免路径穿越、动态附件、压缩 bomb 和时间戳漂移。正文只允许固定的 heading、paragraph、
list 与 `http(s)` hyperlink 元素，用户文本统一经过 XML 1.0 字符过滤与 text/attribute escape。

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
- ODT package 不包含本地路径、临时目录、外部嵌入资源、脚本或未请求附件；用户可见的
  `http(s)` 链接只作为文本超链接保留，不在打开文档时自动加载；
- 所有成功产物必须非空；当前尚无独立的 exporter 输出字节上限，大型 Resume 性能与上限仍是
  已登记缺口，不能把输入 Schema 的大小限制当成等价保护；
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
   `ResumeDocument`，由 TXT/RTF/ODT 三个 writer 复用。
4. **前端能力契约：** 先让 `/v1/capabilities` 的 `txt`/`rtf` 断言失败，再同步 API 与 OpenAPI enum。
5. **拒绝浅接口膨胀：** 先断言结果没有 `txt`/`rtf` legacy 顶层字段，再把新格式只保留在
   `artifacts`；既有五个 legacy 文本字段保持兼容。
6. **内容完整性回填：** 全 section fixture 暴露 work URL、education score、language keywords
   丢失，再扩展共享 section definition；测试覆盖其余 URL、日期、课程、联系方式和摘要。
7. **复用核心展示语义：** locale/alias/order 测试先暴露英文硬编码和固定顺序，再复用
   YAMLResume 的 section translation、alias 与 `mergeArrayWithOrder` 契约。
8. **ODT artifact 契约：** 先让 `OutputFormatSchema.parse('odt')` 失败，再加入 enum、十格式上限、
   `application/vnd.oasis.opendocument.text`、base64 和原始 package 字节数 metadata。
9. **ODT package：** 初始 tracer 只返回占位二进制；独立 test reader 因缺少 local header、central
   directory 与 EOCD 失败，再实现 CRC32、固定 entry 顺序、STORE method、首个无 extra 的 mimetype
   和 manifest/content/styles/meta 文件。
10. **语义与 XML 安全：** package 首版只有标题；对抗 fixture 缺 headline、contact、section、list、
    link 和 locale/order，并暴露 XML 注入要求，再实现统一 XML 1.0 字符过滤、text/attribute escape
    与固定 ODF 元素 writer。
11. **确定性与失败隔离：** 相同输入两次 byte-for-byte 一致且不修改 Resume；注入含私密 marker 的
    ODT writer failure，只返回固定 `artifact_render_failed`，同请求 TXT/JSON 继续成功。
12. **API 契约：** capability test 先因不含 `odt` 失败，再同步 API 与 OpenAPI enum/maxItems；
    HTTP 端到端测试进一步请求 ODT 并校验 base64、decoded size、ZIP signature 和关键 entry。
13. **独立兼容：** Info-ZIP CRC、ODF Toolkit 0.13.0 ODF 1.3 schema、LibreOffice Writer
    TXT/PDF/FODT round-trip 均通过；这些工具不进入 runtime 或单元测试依赖。

这些测试通过公开 `renderResumeVariant` seam 验证行为，没有 mock 成功 writer，也没有把
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

三种格式的自动测试和开发期独立验证通过后只标记
`Implemented for development`。跨应用兼容矩阵、真实下载、大型简历性能和用户反馈
仍缺失时，RA-007C 不得标记为 `Operational`。

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

### 11.2 ODT 兼容性与 schema 实验（2026-09-16）

- 真实 artifact 被 `file` 识别为 `OpenDocument Text`；`zipinfo` 显示固定五个 entry 全部
  `Stored`、时间均为 1980-01-01，`mimetype` 首位且 39 bytes；`unzip -t` 的五个 CRC 全部通过。
- Maven Central 的 `odfvalidator-0.13.0-jar-with-dependencies.jar` 经发布 SHA-256 校验后，
  按 ODF 1.3 manifest/schema 验证 `manifest.xml`、mimetype、meta、styles、content：
  `no errors, no warnings`，退出码 0。
- LibreOffice Writer 24.2.7.2 成功转为 UTF-8 BOM TXT、PDF 1.7 和 FODT；中文、emoji、URL、
  XML 特殊字符、heading、列表与顺序可读取。MuPDF `mutool info` 确认 PDF 为一页。
- 未验证 Microsoft Word、WPS、Google Docs 导入，也未做视觉 baseline 和大文件性能测试。

### 11.3 自动门禁记录（2026-09-16）

- `pnpm agent test src/rendering/artifacts.test.ts`：17/17 通过；
- `pnpm agent-api test`：16/16 通过；API 测试需要绑定 localhost，受限沙箱内会返回
  `listen EPERM`，在获准的本地执行环境中通过；
- `pnpm agent build`、`pnpm agent-api build`：通过；
- 两个 package 的 `tsc --noEmit`：通过；
- 六个目标 TypeScript 文件的 Biome：通过；`git diff --check`：通过；
- `pnpm license:check` 退出码 0，但环境缺少 `addlicense` binary，实际扫描被脚本跳过；修改的
  TypeScript 文件（含新增 ODT module）均保留完整 MIT header；
- `pnpm test`：9 个 workspace package、132 files、1361 tests 全部通过，exit 0；
- 历史运行曾出现完整 Vitest 在断言结束后不退出，以及更早受限环境中本地 LLM HTTP 测试超时；
  当前 unrestricted 环境使用相同 Node 22.21.1/Vitest 4.0.16 复核：原始完整命令连续 5 次、
  LLM 单文件 5 次、LLM + 两个 workflow 文件组合 3 次均自然退出。ODT 完成后
  `timeout 15s pnpm agent test` 为 15 files / 184 tests、exit 0、约 4.9s。没有旧句柄快照，
  因此只记录历史环境故障已不复现，不虚构产品代码根因或回归修复。

## 12. 证据台账

| Feature ID | 生命周期 / 用户结果 | 交付 | 证据覆盖 | 历史缺口 | 剩余缺口 |
| --- | --- | --- | --- | --- | --- |
| RA-007C-A | Resume → copyable TXT | Implemented for development | Covered：公开 seam、全 section fixture、UTF-8/metadata/末尾换行测试 | none | 浏览器真实下载、ATS 粘贴和大文件性能 |
| RA-007C-B | Resume → interoperable RTF | Implemented for development | Partial：规范、escape/Unicode tests、LibreOffice 24.2.7.2 TXT/PDF round-trip | none | Word/WPS/Google Docs 矩阵、视觉与大文件性能 |
| RA-007C-C | Resume → valid editable ODT | Implemented for development | Partial：OASIS/PKWARE、确定性 package tests、ODF Toolkit 1.3 零错误/警告、Info-ZIP 与 LibreOffice round-trip | none | Word/WPS/Google Docs、浏览器下载、视觉和大文件性能 |
| RA-007C-D | one exporter fails → other artifacts survive | Implemented at shared seam | Covered for application seam：既有 generic text/binary failure isolation + ODT 私密错误注入，其他格式继续成功 | none | 生产日志/下载层仍未接入 |
| RA-007C-E | selected style → accessible semantic document | Implemented for TXT/RTF/ODT logical order | Partial：全 section fixture、ODT heading/list/link、LibreOffice 一栏读取结果 | none | preset 视觉差异不承诺；跨阅读器可访问性矩阵 |

## 13. 实施顺序与依赖门禁

1. RA-015C 已完成；TXT 与 RTF 在同一小切片实现，是因为二者共用语义模型且不增加依赖。
2. TXT 已验证共享 `ResumeDocument`、全 section 字段、顺序、URL 与 UTF-8 metadata。
3. RTF 已验证 escape/Unicode、ASCII source、LibreOffice 读取与 PDF 转换。
4. ODT 已以固定五 entry、STORE-only ZIP32 完成；不借用 `docx` 的传递 ZIP 依赖，也没有新增
   package 或 lockfile 变更。自有 writer 只覆盖本功能需要的生成路径，不是通用 ZIP 接口。
5. 三格式组合、ODF 1.3 schema 与 LibreOffice 已验证；更广兼容矩阵仍作为独立后续证据。

未来若用通用库替换有界 writer，必须直接写入 `packages/resume-agent/package.json`，固定版本，
核对 license/维护状态/传递依赖，并单独更新 lockfile。不得依赖 `docx` 偶然带入的 transitive package。

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
- PKWARE ZIP APPNOTE：<https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT>
- ODF Toolkit Validator 0.13.0：
  <https://repo1.maven.org/maven2/org/odftoolkit/odfvalidator/0.13.0/>
- Node.js v22 Buffer：<https://nodejs.org/docs/latest-v22.x/api/buffer.html>
