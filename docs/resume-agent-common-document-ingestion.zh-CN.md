# Resume Agent 常见文档输入 Feature Brief

> Feature ID：RA-001B
> 状态：Partial implementation；RA-001B-A1 可信识别、RA-001B-B ODT、RA-001B-C RTF 与
> RA-001B-D legacy DOC 受限 extractor 已开发级实现；目前已有一个公开 Word 97 CFB fixture，但真实 Unicode corpus、隔离执行和跨平台验收仍未完成
> 最后审阅：2026-09-16
> 范围：可信文件识别，以及 ODT、RTF、旧版 DOC 的文本提取；不包含 OCR、宏执行或通用 Office 转换服务。

## 1. 用户问题与结果

求职者和招聘方不会只使用 YAML、PDF 或 DOCX。旧简历、学校模板和招聘网站附件中仍会出现
ODT、RTF 与 Word 97–2003 `.doc`。本 Feature 立项时，这些文件没有可靠支持，并且未知扩展名
会回退成 `text/plain`，声明的 `mediaType` 也会直接覆盖扩展名推断。这会产生两类错误：

- 用户上传常见文档后得到乱码或模糊的“不支持”错误；
- 攻击者可把二进制内容声明为文本，绕过预期的解析边界。

本切片的目标不是制造一个“任何文件都能读”的转换器，而是让受支持格式可识别、可限额、
可提取、可解释失败。完成后，用户可以把 ODT、RTF、旧 DOC 作为简历或 JD 输入；系统会先
核对内容特征，再调用对应 extractor，并且不会执行宏、嵌入对象或外部引用。

## 2. 实现前审计与当前差异

实现前的本地证据来自 `packages/resume-agent/src/input/artifacts.ts`、相邻测试和输入 Schema：

1. 已实现纯文本、YAML、JSON、Markdown、HTML、数字 PDF、DOCX，以及声明为
   PNG/JPEG/WebP/GIF 的图片输入；每文件限制 12 MiB，总计限制 30 MiB。
2. 二进制内容由 base64 解码；PDF 使用 `pdfjs-dist`，DOCX 使用 `mammoth`。
3. `inferMediaType` 优先信任上传方声明的 MIME；未知扩展名默认为 `text/plain`。
4. `.txt`、`.html`、`.htm`、`.gif` 等已有能力也没有完整的扩展名映射。
5. 目前没有 magic bytes、ZIP 内部 entry、ODF mimetype 或 OLE stream 核验。
6. DOCX 失败消息会拼接底层异常，尚未满足统一的数据安全错误契约。
7. 压缩文件只限制上传字节，没有限制 entry 数、解压总量、压缩比或 XML 复杂度。

因此“现有测试通过”只能证明已覆盖样例，不能证明不可信文件上传边界安全。

RA-001B-A1 已改变第 3–7 项：输入模块现在先组合扩展名、声明 MIME、内容签名和容器结构，
未知 binary 不再回退 UTF-8；DOCX/ODT 通过有界 ZIP index 区分；错误使用稳定 code 与固定
message；DOCX 底层异常不再外泄。RA-001B-B 又在同一 seam 启用了 ODT 可见正文提取；RTF
RTF 已完成有界可见正文 extractor；旧 DOC 尚无 extractor，不能把尚未完成的格式写成输入支持。

## 3. 研究证据与决策

### 3.1 主要证据

- OWASP File Upload Cheat Sheet：扩展名、上传方 `Content-Type` 与文件签名都不能单独成为
  信任依据；应组合 allowlist、类型核验、大小限制、隔离和安全失败。
- OASIS OpenDocument 1.3 Part 2 Packages：ODT 是有固定 mimetype 与 manifest 约束的
  ZIP package，不是“任意 ZIP 内找 XML”。
- Microsoft `[MS-DOC]`：`.doc` 是 Word 97–2003 的二进制格式，必须按其 OLE/Compound
  File 结构处理，不能以 DOCX 或纯文本方式读取。
- Microsoft RTF 规范：RTF 是带嵌套 group、control word、字符集和 Unicode 规则的交换
  格式；简单删除控制词会破坏文本并可能把隐藏 destination 当正文。

### 3.2 独立证据

- 当前真实 parser 与测试证明 PDF/DOCX 路径存在，但检测发生在解析之前的边界仍是缺口。
- `word-extractor@1.0.4`（MIT，npm 元数据最后更新 2022-06-29）声明可从 Buffer 读取
  OLE `.doc` 与 DOCX，并处理 Unicode；源码审阅后作为受限 adapter 采用，但不把其同步解析器
  当作生产隔离边界。
- 本机存在 LibreOffice，可用于开发期兼容性对照；它不是 runtime 隐式依赖，不能因此
  把部署环境标记为支持 DOC/ODT。

### 3.3 Adopt / Adapt / Reject

| 候选 | 决策 | 原因 |
| --- | --- | --- |
| 多信号识别：内容特征 + package 结构 + 扩展名/MIME 一致性 | Adopt | 直接修复当前信任边界 |
| ODT 的受限 ZIP + streaming XML 提取 | Adopt | 格式结构明确，可设置 entry 与解压上限 |
| RTF 的有界 reader/tokenizer | Adapt | 只提取可见文本；忽略格式但必须保留 Unicode 与段落 |
| `word-extractor` 直接进主进程 | Spike only | 维护活跃度、资源上限、损坏样本和错误泄漏尚未验证 |
| `LegacyDocExtractor` adapter + 隔离执行 | Adopt | 将复杂二进制解析与 Agent 工作流隔开 |
| 按 MIME 或扩展名直接选 parser | Reject | 上传方可控，冲突时可能选错解析器 |
| LibreOffice 作为静默必需依赖 | Reject | 部署不可移植，进程/临时文件/宏策略不透明 |
| “所有 Office 文件”总开关 | Reject | XLSX/PPTX/Pages 与简历/JD 核心用例不同 |

## 4. 产品范围与优先级

### Must have

- 对现有 PDF、DOCX、图片和新增 ODT、RTF、DOC 建立统一可信识别。
- ODT、RTF、DOC 可从 `contentBase64` 提取可见正文。
- 扩展名、声明 MIME 与内容不一致时稳定失败，不静默猜测。
- 压缩、XML、RTF nesting、DOC parser 输出和最终文本都有硬上限。
- 错误只返回稳定 code/message，不包含文档正文、底层 parser message 或本地路径。
- 每种格式有正常、Unicode、损坏、伪装、超限和空正文 fixture。

### Should have

- UTF-8 BOM、UTF-16 LE/BE 纯文本识别；不确定 legacy code page 时明确失败或警告。
- 对 ODT/DOCX 加密 package、外部实体、嵌入对象与宏给出稳定不支持结果。
- 记录安全的格式、上传字节数、提取字符数、耗时和 warning code；不记录正文。

### Won't have in RA-001B

- 扫描 PDF/图片 OCR、手写识别和版面重建；
- 宏、OLE object、脚本、远程链接或嵌入文件执行；
- XLS/XLSX、PPT/PPTX、Apple Pages；
- 密码破解、损坏文件修复和通用格式转换；
- 仅凭“LibreOffice 能打开”宣称 production operational。

## 5. 识别契约

识别先于解析，并返回内部的、不可由调用方直接指定的结论：

```ts
type SupportedInputFormat =
  | 'plain-text'
  | 'html'
  | 'yaml'
  | 'json'
  | 'markdown'
  | 'pdf'
  | 'docx'
  | 'odt'
  | 'rtf'
  | 'doc'
  | 'png'
  | 'jpeg'
  | 'webp'
  | 'gif'

interface DetectedInputFormat {
  format: SupportedInputFormat
  canonicalMediaType: string
  confidence: 'signature-and-container' | 'signature' | 'validated-text'
}
```

### 5.1 信号规则

| 格式 | 必要内容证据 | 辅助证据 |
| --- | --- | --- |
| PDF | PDF header，并交由 PDF parser 二次确认 | `.pdf`、`application/pdf` |
| DOCX | ZIP 且包含合法 OOXML content types 与 `word/document.xml` | `.docx`、OOXML MIME |
| ODT | ZIP、ODF `mimetype` 值、manifest 与 `content.xml` | `.odt`、ODT MIME |
| DOC | CFB header 且存在 Word document streams | `.doc`、`application/msword` |
| RTF | 可接受 BOM/空白后的 RTF control header，reader 完整消费结构 | `.rtf`、RTF MIME |
| 图片 | 对应 magic bytes | 扩展名、image MIME |
| 文本 | 无已知 binary signature、编码有效、无 NUL/binary 启发式冲突 | 文本 MIME、allowlist 扩展名 |

声明 MIME、扩展名和内容结论冲突时返回 `file_type_mismatch`。未知 binary 返回
`unsupported_file_type`，不得回退到 UTF-8。`InputFile.text` 表示调用方已提供解码后的文本，
仍受字符上限约束，但不伪装成已验证的 DOC/ODT/RTF binary。

## 6. 提取器边界

```ts
interface ArtifactExtractor {
  readonly format: SupportedInputFormat
  extract(buffer: Uint8Array, limits: ExtractionLimits): Promise<ExtractedText>
}

interface ExtractionLimits {
  maxInputBytes: number
  maxEntries: number
  maxExpandedBytes: number
  maxExtractedCharacters: number
  maxNestingDepth: number
}

interface ExtractedText {
  text: string
  warningCodes: string[]
}
```

深模块只公开识别与提取结果；ZIP entry、XML namespace、RTF state stack、OLE streams、
parser 选择和错误清洗都封装在输入模块内。下游 evidence/prompt 继续只消费规范化文本和安全
warning，不接触原始 parser 对象。

初始开发阈值应集中为单一配置并由 fixture 校准，建议起点：每文件上传 12 MiB、archive
entry 128 个、展开数据 32 MiB、提取文本 1,000,000 字符、单个 XML 100,000 个元素、
XML/RTF nesting 128 层。
这些是拒绝服务防线，不是产品承诺；变更必须有大文件基准证据。

## 7. 格式策略

### 7.1 ODT

- 只读取 `mimetype`、`META-INF/manifest.xml` 和 `content.xml` 所需内容；
- 禁止 path traversal，拒绝重复关键 entry、加密正文、外部实体和超限 package；
- 以单遍、namespace-aware 的严格 XML scanner 提取 heading、paragraph、列表、tab 与 line-break；
- 保持文档顺序，忽略样式、图片和脚本；缺失正文或提取为空给出明确结果。

### 7.2 RTF

- reader 必须维护 group state、destination skip、Unicode fallback count、hex escape、paragraph/tab；
- 忽略图片、对象、font/color/style tables 等非正文 destination；
- 限制 group depth、control word 数、hex payload 与输出长度；
- malformed braces、截断 escape 和不支持的 code page 不得产生“看似成功”的乱码。

### 7.3 旧 DOC

- 先确认 CFB/Word streams，再进入 `LegacyDocExtractor`；
- parser 在 worker/subprocess 或等价资源隔离边界运行，并有 timeout/内存约束；
- 只返回 body text 与稳定 warning；不提取/执行宏、对象、链接和附件；
- `word-extractor` 只有在真实 fixture、损坏 corpus、超限、Unicode、许可和错误脱敏全部通过
  后才可提升为 operational；当前只采用 Buffer adapter、5 秒超时和 1,000,000 字符上限，保留开发级状态。

## 8. 错误与隐私契约

建议稳定 code：

- `unsupported_file_type`
- `file_type_mismatch`
- `invalid_file_encoding`
- `corrupt_document`
- `encrypted_document`
- `document_limit_exceeded`
- `document_extraction_failed`
- `empty_extracted_text`

公开 message 由 code 和可信格式枚举生成。不得拼接 filename 之外的路径、原始 XML/RTF、
简历/JD 正文、parser stack、临时目录或底层异常。日志也只记录安全 metadata；真实输入 fixture
必须授权和匿名化，默认测试使用合成身份。

## 9. 单行为 RED → GREEN 顺序

1. 已有格式识别 characterization；补齐 TXT/HTML/GIF 扩展名回归。
2. 伪装 binary 不再回退纯文本；扩展名/MIME/内容冲突返回稳定错误。
3. DOCX/ODT 同为 ZIP 时按内部结构区分，未知 ZIP 拒绝。
4. ODT 最小 package 提取标题、段落、列表和 Unicode。
5. ODT path traversal、重复 entry、展开超限、加密和损坏 XML 安全失败。
6. RTF 最小正文、段落、转义和 Unicode 提取。
7. RTF hidden destination、嵌入 object、深层 group、截断输入安全失败。
8. 真实 Word 97 CFB fixture 经 adapter 提取；非 Word CFB 与损坏 DOC 拒绝。
9. extractor timeout/超限/底层私密异常只暴露稳定错误。
10. 同一 fixture 分别作为 candidate file 与 job file 走完整输入归一化路径。

2026-09-16 legacy DOC spike 已完成 RED → GREEN 的检测与安全失败 seam：CFB magic header
现在识别为 `application/msword`，Buffer adapter 调用固定版本 `word-extractor@1.0.4`，并设置
5 秒超时与 1,000,000 字符上限；伪 CFB 输入返回稳定 `document_extraction_failed`，不泄露
parser 异常。随后使用 Apache POI 公开的 `test.doc`（SHA-256 已记录）验证真实 CFB 文本提取，
并通过 API multipart candidate/job 文件路径；该样本不包含 Unicode corpus，隔离执行和跨平台验收
仍未完成，因此这一切片继续保持 Partial implementation，不能标记 Operational。

每一步只写一个公开行为测试，再补最小实现；不得先加入三种 parser 后统一补测试。

## 10. 验收与兼容性门禁

- 单元：detector 与每个 extractor 的正常/失败语义；
- corpus：每种格式至少包含 ASCII、中日韩文、emoji、列表、URL、损坏、伪装、超限样本；
- 独立验证：ODT 用独立 ZIP/XML reader 核对，RTF 与 DOC 用 LibreOffice 打开/转文本作为
  开发期对照，但不能让测试静默依赖系统 binary；
- 回归：现有 PDF、DOCX、图片、文本及总大小限制全部通过；
- 安全：ZIP/XML/RTF/DOC 对抗样本不泄密、不挂死、不越过上限；
- 包门禁：focused tests、完整 resume-agent tests、TypeScript、build、Biome、license、
  `git diff --check`。

完成这些只可标记 `Implemented for development`。跨 OS、生产隔离、恶意样本持续更新、真实
上传观测和事故 runbook 通过前，不得标记 `Operational`。

## 11. 证据台账

| Feature ID | 生命周期 / 用户结果 | 交付 | 证据覆盖 | 历史缺口 | 剩余缺口 |
| --- | --- | --- | --- | --- | --- |
| RA-001B-A | upload → trusted detection；伪装文件不能选错 parser | Partial implementation：A1 已开发级实现 | Partial：OWASP、内容签名、fatal 解码、有界 ZIP index、mismatch/对抗 tests | backfilled | CFB Word stream、真实跨来源 corpus 与 fuzz |
| RA-001B-B | ODT package → visible text | Implemented for development | Partial：OASIS package/schema、OWASP XML、对抗 tests、candidate/JD/API/Run、四个真实本地 package 与独立 reader 对照 | none | 跨 OS/异构 corpus、fuzz、样式派生隐藏语义、生产隔离与 telemetry |
| RA-001B-C | RTF stream → Unicode visible text | Implemented for development | Partial：Microsoft/IANA RTF 规范、两个独立 reader 源码、本机 LibreOffice、bounded scanner 与对抗 tests | none | candidate/JD/API/Run/restart 纵向验收、跨 OS corpus、font-table charset、fuzz、隔离与 telemetry |
| RA-001B-D | legacy DOC → visible text | Partial implementation | MS-DOC CFB signature detection、MIT `word-extractor@1.0.4` 源码/许可审阅、Buffer adapter、5 秒超时、1,000,000 字符上限、伪 CFB 稳定错误测试；加入 Apache POI `test.doc` 的真实 Word 97 CFB fixture（仅保留公开测试样本，来源与 SHA-256 已记录） | backfilled | 真实 Unicode/异构 corpus、真正可中止的 worker 隔离、跨 OS、API capabilities 与生产观测 |
| RA-001B-E | parser failure → safe user error | In development：检测/PDF/DOCX/ODT/RTF/API/Run 已统一 | Partial：固定错误、RTF/同步 HTTP 与异步 Run 脱敏 tests | backfilled | DOC extractor 与生产日志 |

### 11.1 当前实施切片：RA-001B-A

本轮实现检测 seam，不同时宣称 ODT、RTF 或 DOC 已可提取。研究复核确认：OWASP 要求把
调用方 `Content-Type` 视为不可信信号，并将 allowlist、内容签名、扩展名和解压后大小限制
组合使用；当前 `inferMediaType` 恰好违反这一前提。Node 22 的 fatal `TextDecoder` 可用于
拒绝无效 UTF-8/UTF-16，`zlib` 的输出上限可作为后续 archive reader 的第二道防线，但不能
替代 ZIP central/local header、entry 数和声明展开大小的显式校验。

实际 tracer 顺序与结果：

1. **扩展名 characterization RED → GREEN：** `.htm` 与 `.gif` 被误归为纯文本；补齐
   TXT/HTML/GIF 等映射，并让直接 `text` 与 base64 HTML 使用相同正文归一化。
2. **内容证据 RED → GREEN：** 无扩展名 PDF/PNG 会落入文本；加入 PDF、PNG、JPEG、GIF、
   WebP 和 RTF signature，声明 MIME/扩展名降为一致性信号。
3. **伪装与编码 RED → GREEN：** PDF 冒充 TXT、文本冒充 PNG、冲突 MIME/扩展名和未知
   binary 均曾静默选错 parser；现在返回固定 `file_type_mismatch`、`invalid_file_encoding` 或
   `unsupported_file_type`。UTF-8 与 BOM UTF-16 使用 fatal decoder，空正文单独失败。
4. **容器识别 RED → GREEN：** 无扩展名 DOCX 原先被当文本；新增 `bounded-zip` 深模块，
   核对 EOCD、central/local header、entry 路径/唯一性、加密、ZIP64、压缩方法、CRC、entry 数、
   声明和实际展开量，并以 content types 或 ODF mimetype/manifest 区分 DOCX/ODT。
5. **真实缺陷 RED → GREEN：** 初版只读取 DOCX `[Content_Types].xml`，损坏的
   `word/document.xml` 会先进入 Mammoth，错误分类为 `document_extraction_failed`。新增损坏
   entry 回归后，识别阶段会有界展开并校验 package 的全部 entry，提前返回 `corrupt_document`。
6. **错误交付 RED → GREEN：** 固定 code 最初仍被同步 API 降级成 `500 agent_failed`、异步
   Run 降级成 `agent_run_failed`；现在同步请求按 413/415/422 返回原稳定 code，异步 Run 保存
   同一安全 failure，正文和底层异常不进入响应或 snapshot。

实现采用 `detectInputFormat` 这一小接口；调用方不需要知道 ZIP、XML、签名、编码或一致性算法。
`bounded-zip` 是内部 adapter，不写临时文件、不把用户路径交给文件系统，也没有借用 `docx`/
`mammoth` 的传递 `jszip`。相同检测 seam 同时服务 candidate 与 JD 文件。

当前只把已存在 extractor 的格式列入 capabilities；ODT 与 RTF 已加入，DOC 仍必须等提取、
对抗测试和兼容性门禁完成后才能加入。

### 11.2 当前验证证据

- focused 输入测试：27/27；覆盖正常格式、签名优先、MIME/扩展名冲突、UTF-16、空正文、
  未知 binary、DOCX/ODT 区分、路径穿越、重复 entry、加密、展开超限和损坏压缩数据；
- 异步 Run 定向测试：19/19；同步 HTTP server 定向测试：13/13；
- 完整 Agent：15 files / 204 tests；完整 API：2 files / 17 tests；排除共享工作树中尚未提交的
  `agent-web` 后，全仓稳定范围为 123 files / 1282 tests；包含该并行前端切片的当前工作树
  `pnpm test` 也以 133 files / 1391 tests 通过；Agent/API TypeScript 和 build、目标 Biome、
  `git diff --check` 均通过；
- `license:check` 退出码为 0，但环境缺少 `addlicense` binary，实际扫描被脚本跳过；本切片
  新增的三个 TypeScript 文件均手工核对保留完整 MIT header；
- 当前证据只支持开发级应用边界，不包含 CFB/DOC、跨 OS、生产 worker 隔离、持续 fuzz 或
  恶意样本运营，因此 RA-001B 和 RA-001B-A 均不能标记为 Operational/Complete。

### 11.3 RA-001B-B ODT 证据、契约与实现

2026-09-16 以 Node 22.21.1、ODF 1.3 和当前 `db6c595` 为基线重新审阅。问题不是“从 ZIP
找一段 XML”，而是只从可信 ODT package 提取当前可见正文，同时让恶意 XML 无法读本地/
远程资源、无限展开或把批注和删除历史送入模型。

| 问题 | 证据 | 决策 / 可证伪约束 | 验收 |
| --- | --- | --- | --- |
| package 如何成立 | ODF 1.3 Part 2 要求 manifest；`mimetype` 应为首个、STORE 且无 local extra field；root manifest media type 应与其一致 | 复用 `bounded-zip`，再次验证 root entry；有 `manifest:encryption-data` 即稳定拒绝 | 合法/加密/缺失/不一致 package tests |
| 正文如何保真 | ODF 1.3 Part 3 定义 `office:text`、`text:p`/`text:h`、list、`text:s`、tab、line-break | 保持文档顺序与 Unicode；段落/标题分行、list 保留层级 bullet、显式空白保留 | 最小正文、list/Unicode、tab/line-break tests |
| XML 如何安全处理 | OWASP XML 指出 DTD、外部实体与实体展开的机密性/可用性风险；Node 没有内建 ODF parser | 不使用未声明的传递依赖；实现 namespace-aware、fatal UTF-8、严格良构、拒绝 DTD/ENTITY、有限深度/元素数/输出的内部 scanner，且不解析 URI | malformed、DTD/XXE、未绑定 namespace、depth/element/output limit tests |
| 什么是“当前可见” | 真实 LibreOffice package 含 hidden section；ODF 另有 tracked changes、annotation、scripts/object；真实字体 ODT 的正文也可位于 `draw:frame` 文本框 | 跳过 tracked-change store、annotation、hidden section/field、script、image/object；保留 frame 内真实 `text:p`/`text:h`，避免误删文本框正文 | hidden/deletion/annotation/object fixture 与真实 package 对照 |
| 哪条接口承担复杂度 | 下游 candidate/JD 已统一经过 `extractArtifact(file)`；公开 detector contract 不应暴露 ZIP/XML parser 对象 | 将 manifest 与 XML 状态机封装在内部 ODT 深模块，调用方仍只依赖 `extractArtifact` 与稳定错误 | candidate、JD、同步 HTTP、异步 Run tests |

实现将 package/manifest/XML 状态机封装在 `odt.ts`，复用 `bounded-zip`，公开接口仍只有
`extractArtifact(file)`。正文只接受 `office:document-content → office:body → office:text`，保留
标题、段落、嵌套列表、Unicode、`text:s`、tab、line-break 和文本框正文；批注、修订存储、
隐藏 section/field、脚本、图片和嵌入对象不会进入模型上下文。DTD/ENTITY 不会被解析，输入采用
fatal UTF-8，XML 深度、元素数与输出字符数分别限制为 128、100,000 和 1,000,000。

逐行为 RED → GREEN 留下了可复验的设计证据：

1. 最小 ODT 最初返回 `unsupported_file_type`，加入 extractor 后标题与段落可见；
2. 等价 namespace prefix 最初被基于字符串的 manifest 检测拒绝，改为 expanded-name scanner；
3. 任意 foreign root 最初可夹带 `office:text`，现在强制正文根路径和唯一 body/text；
4. annotation 字符数据最初绕过 skip 状态，现由 text event 同样遵守 skip depth；
5. `mimetype` local extra field 最初被接受，现由 ZIP entry 暴露并验证该字段；
6. 合法的 paragraph → frame → text-box → paragraph 最初与单 `currentBlock` 冲突，现用 block stack
   保持外层前缀、文本框正文和外层后缀的文档顺序；
7. 100,001 个空元素最初仍能成功提取，新增公开接口回归后在通用 XML scanner 返回
   `document_limit_exceeded`；四个真实样本的正文 XML 元素数为 19、188、343、129，给
   100,000 上限保留了充足兼容余量；
8. API 用例曾在源码已通过时返回 415；差分定位为 API 通过 package export 加载了旧
   `resume-agent/dist`，重建依赖包后通过，没有为缓存问题修改 HTTP 代码。

兼容实验包含本仓 exporter 生成包、Arphic UMing 字体比较文档、SIL Padauk type sample 和
LibreOffice `idxexample.odt`，四者分别提取 191、4443、4310、65 个字符。LibreOffice 直接转 TXT
会漏掉 page-anchored 文本框，因此不能作为唯一正文 oracle；LibreOffice → PDF → 既有 PDF
extractor 的独立路径可看到对应正文。该证据只支持 `Implemented for development`：跨 OS、
更广真实 corpus、fuzz、样式派生隐藏内容、worker 隔离和生产 telemetry 仍未完成。

### 11.4 RA-001B-B 验收证据

- `pnpm agent test src/input/artifacts.test.ts`：44/44；覆盖正文语义、namespace alias/未绑定
  prefix、根结构、隐藏/批注/对象、DTD/XXE、fatal UTF-8、XML 深度/元素/输出上限，以及
  ZIP traversal、重复、加密、ZIP64、展开量、CRC 与 `mimetype` local extra；
- candidate 与 JD 通过完整 Agent seam；同步 HTTP、同进程异步 Run、私密安全失败，以及
  SQLite 关闭/重开后的 ODT JD 恢复均通过；API 为 2 files / 19 tests；
- `pnpm agent test`：16 files / 245 tests，5 秒内自然退出；Agent/API TypeScript 与 ESM/DTS
  build、10 个目标 TypeScript 文件的 Biome、`git diff --check` 均通过；
- `pnpm test`：134 files / 1434 tests，在包含并行前端与人工评审工作树时自然退出；ODT
  四个真实样本重跑仍分别提取 191、4443、4310、65 个字符；
- `pnpm license:check` 返回 0，但环境缺少 `addlicense` binary，实际扫描被脚本跳过；新增
  `odt.ts` 已人工核对完整 MIT header。没有用 `process.exit`、延长 timeout 或关闭泄漏检测
  代替生命周期修复。

### 11.5 RA-001B-C RTF 证据与契约

2026-09-16 以 Microsoft archived RTF 1.6 文档、IANA `application/rtf` 登记、RTF 1.9.1
sample reader 衍生源码、Node 22.21.1 和 LibreOffice 24.2.7.2 为基线。用户结果不是“删除反斜杠
后得到文字”，而是从常见 RTF 简历/JD 中还原可见 Unicode 正文，同时不执行 field、对象或
外部引用，也不让图片/二进制 payload、深层 group 或超长 control 消耗无界资源。

| 问题 | 证据 | 决策 / 可证伪约束 | 验收 |
| --- | --- | --- | --- |
| token/group 如何读取 | Microsoft syntax/reader conventions 定义 control word/symbol、group stack、未知 control 与 `\*` destination；sample reader 强调 skip 状态也必须处理 `\binN` | 以 Buffer 单遍 scanner 保存 group state；未知 control 忽略，未知 starred destination 整组跳过，brace/escape/截断必须完整消费 | literal/control/group/malformed/unknown destination tests |
| Unicode 与 code page 如何还原 | `\uN` 使用 signed 16-bit code unit；`\ucN` group-scoped；fallback 中任一 control 算一个字符，brace 提前结束；`\ansicpgN` 指定 byte decoder | 当前实现覆盖 signed code unit、surrogate pair、`uc` fallback、hex escape 与 ASCII/Windows-1252 常见输入；CJK code page 与多字节 fallback 仍保持缺口，不伪装成已支持 | Unicode/emoji、uc0/ucN、hex、unsupported code page tests；CJK corpus 后续补齐 |
| 哪些文字可见 | IANA 提醒 RTF 可引用外部文件/对象；规范区分 body、metadata、picture/object、field instruction/result、hidden/revision text | 保留 body、`fldrslt` 与已修订正文；跳过 metadata/generator、font/style/list table、header/footer、annotation、deleted/hidden、pict/object/file/data destinations；永不解析 URI 或执行 field | hidden/deleted/metadata/pict/object/fldinst/fldrslt/privacy tests |
| 资源如何封顶 | 上传层已有 12 MiB；参考 parser 对超长 token、binary 和 nesting 均需单独防线 | group depth 128、control count 250,000、control name 32、binary/hex payload 8 MiB、输出 1,000,000 chars；超限统一 `document_limit_exceeded` | 每类 limit 的公开接口回归 |
| 复用什么 | `rtf-toolkit@0.5.0`（MIT，commit `6af77a6`）固定跳过一个 Unicode fallback 且截断过长 control；`rtf-stream-parser`（MIT，commit `f112deb`）偏 encapsulation/stream 并依赖外部 decode | Learn from 两者的 token/fallback/binary tests，不引入依赖；adapt Microsoft state-stack/sample-reader 模型到内部 `rtf.ts` 深模块 | 无 package/lockfile 变化；调用方仍只依赖 `extractArtifact` |

开发契约接受标准 `application/rtf`、`application/x-rtf` 与 `text/rtf` 的内容签名一致输入；返回
`kind: text` 与 canonical `application/rtf`。格式/结构损坏只返回
`corrupt_document: RTF document is invalid or unsupported.`，资源超限返回固定
`document_limit_exceeded`，正文为空返回既有 `empty_extracted_text`。LibreOffice 只作为开发期
独立 reader，不进入 runtime 或自动测试依赖。旧 DOC、跨 OS corpus、font-table charset 覆盖、
fuzz、worker 隔离与生产 telemetry 仍是后续门禁。

实现结果：`packages/resume-agent/src/input/rtf.ts` 以单遍 Buffer scanner 实现该契约，未增加
运行时依赖。RTF 已从“仅能识别 header”推进为 `extractArtifact` 可用的 `kind: text` 输入；
`rtf.test.ts` 覆盖可见正文、段落、转义、负 Unicode code unit 与 surrogate pair、`uc` fallback、
metadata/pict/field/未知 starred destination、`bin` payload 和截断 group。2026-09-16 门禁为
focused 输入 48/48、完整 resume-agent 252/252、TypeScript、build、目标 Biome 与
`git diff --check` 通过。该证据仍只支持 `Implemented for development`；没有把 RTF 的跨平台
兼容性、字体表 code page、真实 Provider 成功率和生产隔离误写成已完成。

### 11.6 RA-001B-C 纵向工作流验收

为定位线上真实 RTF 请求返回 `agent_validation_failed` 的边界，新增了不依赖 Provider 的公开
工作流集成测试 `ResumeTailoringAgent.run`。合成 RTF 候选人与 JD 经过同一 `extractArtifacts`、
候选归一化、岗位分析、证据匹配、草稿验证和渲染路径；fake LLM 只替代模型响应，不替代输入
提取或 Agent seam。测试确认候选归一化请求包含可见的 `Ada Lovelace` 与 `Built TypeScript
services.`，岗位分析请求包含 `Platform Engineer` 与 `Build reliable TypeScript platforms.`，
并以 `yaml` 产物完成整条流程。

验证命令：

```text
pnpm agent test src/workflow/agent.test.ts -t "ingests RTF"
```

结果：1 个测试通过（同文件其余 9 个测试按过滤条件跳过）。该证据把问题边界收窄为：RTF
提取和本地 Agent seam 已可工作；API 现在在 422 验证错误中返回稳定的 `stage` 枚举，可在不
保存原文或 completion 的前提下区分候选归一化与草稿验证失败。仍需用真实 Provider 复跑确认
阶段分布。没有因此把真实 DeepSeek
RTF 成功率标为 Operational，也没有放宽验证规则。

同步 HTTP 也新增了 `role.rtf` 的 `contentBase64` 回归：21 个 API 测试中的 RTF 用例通过，证明
RTF JD 能沿着 API 输入、提取器和 Agent seam 完成开发级请求；该 fake-provider 证据不代表真实
Provider 的生成质量或线上部署已通过。

## 12. 会推翻方案的证据

- 若授权样本显示 DOC 使用率极低且隔离成本过高，可保持 adapter 与明确转换指引，不能用
  不受限 parser 勉强“支持”。
- 若 ODT/RTF 的实际样本依赖复杂版面而非正文，纯文本 extractor 不足，应新增结构化中间
  表示，而不是不断在字符串上打补丁。
- 若 Node 主进程内无法可靠中止解析，必须将对应 parser 移到 worker/subprocess；扩大
  timeout 不是修复。
- 若格式检测库不能验证 ZIP 内部结构或 Word stream，它只能提供候选信号，不能替代本契约。

## 13. 参考资料

- OWASP File Upload Cheat Sheet：
  <https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html>
- OASIS OpenDocument 1.3 Part 2 Packages：
  <https://docs.oasis-open.org/office/OpenDocument/v1.3/os/part2-packages/>
- OASIS OpenDocument 1.3 Part 3 Schema：
  <https://docs.oasis-open.org/office/OpenDocument/v1.3/os/part3-schema/>
- OWASP XML Security Cheat Sheet：
  <https://cheatsheetseries.owasp.org/cheatsheets/XML_Security_Cheat_Sheet.html>
- PKWARE ZIP File Format Specification（APPNOTE）：
  <https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT>
- Node.js 22 `TextDecoder`：
  <https://nodejs.org/docs/latest-v22.x/api/util.html#class-utiltextdecoder>
- Node.js 22 `zlib`：
  <https://nodejs.org/docs/latest-v22.x/api/zlib.html>
- Microsoft Word Binary File Format `[MS-DOC]`：
  <https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/>
- Microsoft Rich Text Format specification：
  <https://learn.microsoft.com/en-us/previous-versions/office/developer/office2000/aa140277(v=office.10)>
- Microsoft RTF Syntax / Reader Conventions / Header and Unicode：
  <https://learn.microsoft.com/en-us/previous-versions/office/developer/office2000/aa140284(v=office.10)>
  <https://learn.microsoft.com/en-us/previous-versions/office/developer/office2000/aa140286(v=office.10)>
  <https://latex2rtf.sourceforge.net/rtfspec_6.html>
- IANA `application/rtf` media type：
  <https://www.iana.org/assignments/media-types/application/rtf>
- Microsoft sample-reader guidance mirror：
  <https://latex2rtf.sourceforge.net/rtfspec_45.html>
- `rtf-toolkit`（MIT，reviewed commit `6af77a6`）：
  <https://github.com/jschulte/rtf-toolkit>
- `rtf-stream-parser`（MIT，reviewed commit `f112deb`）：
  <https://github.com/mazira/rtf-stream-parser>
- `word-extractor` repository：
  <https://github.com/morungos/node-word-extractor>
- 真实 CFB fixture（Apache POI `test-data/document/test.doc`，Apache-2.0
  repository test data；SHA-256 `fcaa1af5e3e90a7a09d4106d2aedc7fea397dec554f2cdb1238891607a2ef21f`）：
  <https://github.com/apache/poi/blob/trunk/test-data/document/test.doc>
