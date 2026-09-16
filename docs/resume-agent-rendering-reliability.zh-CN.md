# Resume Agent 渲染可靠性 Feature Brief（RA-007B）

## 1. 状态与范围

- Feature ID：`RA-007B`
- 父能力：`RA-007` YAMLResume 多格式、多样式渲染
- 当前交付状态：**Implemented for development**（2026-09-16）
- 当前证据覆盖：**covered for the application-side contracts in this slice**；真实编译器、
  跨阅读器兼容和常见格式扩展仍为 partial/gap
- 历史研究缺口：**backfilled**；渲染代码自首版后没有相邻系统测试，工作流虽然返回
  多样式结果，但没有证明 metadata 与实际渲染 preset 一致
- 用户结果：每个样式变体都能返回与实际样式一致的 metadata 和可验证产物；某个格式
  失败时，其余格式仍可交付，公开失败信息不泄露底层异常或候选人内容

本切片只覆盖应用侧的确定性渲染契约。真实 LaTeX binary、容器沙箱、页面数、跨阅读器
DOCX/PDF 验证和生产观测不在本切片内；没有这些证据时不得标记为 `Operational`。

## 2. 已观察到的问题与根因

2026-09-16 对 `a4567cc` 的本地源码、历史和路线图检查发现：

1. `workflow/agent.ts` 把 `RenderedVariant.label` 直接设置为 style ID，没有使用 preset
   的用户可读 label；
2. 所有 `RenderedVariant.template` 都从 `primaryResume` 读取，多样式请求因此会把第一种
   template 错报为所有变体的 template；
3. `rendering/artifacts.ts` 在进入逐格式 `try/catch` 之前一次性渲染 YAML、JSON、
   Markdown、HTML 和 LaTeX，任一 renderer 抛错都会使整个 variant 失败；
4. `ArtifactFailure.message` 直接公开捕获异常的 message，可能包含临时目录、编译器
   输出、源内容或第三方实现细节；工作流还会把这些 message 复制到公开 warnings；
5. 模块没有相邻测试，现有工作流测试只证明默认 YAML/HTML/LaTeX 包含姓名，没有证明
   顺序、去重、编码、字节数、DOCX 包结构、PDF adapter、失败隔离或输入不可变性；
6. 生成代码会计算未请求的文本格式，扩大了不必要的失败面和执行成本。

根因不是缺少渲染框架，而是渲染模块的接口契约没有被系统测试约束，且样式 metadata
在工作流调用方被二次推断。删除该模块会迫使调用方分别理解格式选择、renderer 查找、
二进制编码、命名、失败隔离和脱敏，因此应把这些复杂度继续收进现有深模块，而不是
增加新的公开抽象。

## 3. 研究证据与决策

### 3.1 本地实现和依赖

- `@yamlresume/core` 的 `getResumeRenderer(resume, layoutIndex)` 是 HTML、Markdown 和
  LaTeX 的既有渲染入口；`applyStylePreset` 总是建立对应的三个 layout。
- `docx@9.7.1` 的 `Packer.toBuffer` 返回 OOXML package Buffer；当前 Resume Agent 只需
  把 binary Buffer 编码为 base64，不需要暴露 `docx` 内部对象。
- `PdfCompiler` 已有生产 adapter 与测试 adapter 两个实现理由：生产 adapter 调用本地
  binary，测试 adapter 返回确定性 Buffer。该 seam 保留；不再为每个内部 text renderer
  增加可注入接口。
- `RenderedVariant` 的 metadata 是公开结果，必须描述实际交付的 preset，而不是输入
  Resume 原先携带的 layout 或第一个变体。

### 3.2 格式和字节契约

2026-09-16 查阅的主要证据：

- RFC 9512 / IANA 把 YAML 注册为 `application/yaml`；
- IANA registry 包含 `application/json`、`application/pdf`、`text/html`、
  `text/markdown` 和
  `application/vnd.openxmlformats-officedocument.wordprocessingml.document`；
- `application/x-latex` 未在 IANA registry 注册，但它是本项目已经公开的兼容值；本切片
  不做破坏性 media type 迁移，只把该限制记录下来；
- Node.js 22 `Buffer.byteLength(string, 'utf8')` 返回字符串的 UTF-8 字节数，不能用
  JavaScript 字符长度代替；binary 的 `Buffer.byteLength` 是原始字节数；
- PKWARE APPNOTE 6.3.10 定义 local file header signature 为 `0x04034b50`，按文件字节
  顺序表现为 `PK\x03\x04`；
- Microsoft 的 WordprocessingML 文档说明 `.docx` 是可作为 ZIP 检查的 package，主文档
  part 位于 `word/document.xml`。因此测试同时验证 ZIP 签名和 OOXML 关键 entry，而不把
  “base64 可解码”误当成有效 DOCX 证据。

### 3.3 可推翻问题

问题：当输入 Resume 自带 `layout.template` 时，variant metadata 应描述原始 layout，
还是 `applyStylePreset` 后实际用于渲染的 template？

本地数据流证明 preset 会覆盖 LaTeX template，产物文件名和 style 字段也描述 preset；
若 metadata 继续描述原始输入或 primary variant，用户将无法把下载产物与样式选择对应。
因此本切片采用 preset 作为 `style`、`label` 和 `template` 的单一事实来源。若未来允许
用户自定义非 preset layout，应新增明确的 custom-style 契约，而不是悄悄复用本字段。

## 4. 接口与契约

公开入口保持不变：

```ts
renderResumeVariant(
  source: Resume,
  style: StylePresetID,
  options: RenderOptions,
  pdfCompiler?: PdfCompiler
): Promise<RenderedResume>
```

模块隐藏以下实现：稳定去重、按请求顺序执行、文本 renderer 选择、DOCX package、PDF
adapter、UTF-8/base64 编码、filename/media type、每格式失败隔离和公开错误脱敏。

### 4.1 样式 metadata

| style | label | LaTeX template |
| --- | --- | --- |
| `ats-compact` | `ATS Compact` | `jake` |
| `modern-professional` | `Modern Professional` | `moderncv-banking` |
| `modern-classic` | `Modern Classic` | `moderncv-classic` |
| `modern-casual` | `Modern Casual` | `moderncv-casual` |
| `developer-two-column` | `Developer Two Column` | `deedy` |

工作流必须通过 `getStylePreset(style)` 读取 label/template。`primaryResume` 只表示第一个
样式的完整 Resume，不能作为其他 variant metadata 的来源。

### 4.2 产物 metadata

| format | filename 后缀 | media type | encoding | `sizeBytes` |
| --- | --- | --- | --- | --- |
| yaml | `.yaml` | `application/yaml` | `utf8` | UTF-8 字节数 |
| json | `.json` | `application/json` | `utf8` | UTF-8 字节数 |
| markdown | `.markdown` | `text/markdown` | `utf8` | UTF-8 字节数 |
| html | `.html` | `text/html` | `utf8` | UTF-8 字节数 |
| latex | `.latex` | `application/x-latex` | `utf8` | UTF-8 字节数 |
| pdf | `.pdf` | `application/pdf` | `base64` | 解码前 Buffer 字节数 |
| docx | `.docx` | OOXML document media type | `base64` | 解码前 Buffer 字节数 |

filename 保持现有兼容形式 `resume-${style}.${format}`。重复 format 只执行一次，并保持
第一次出现的请求顺序。成功的 text format 同时进入 legacy 顶层字段和 `artifacts`；失败
格式只能进入 `failures`，不得留下空成功产物。

### 4.3 失败契约

- PDF adapter 失败使用 `pdf_render_failed`；其他格式使用
  `artifact_render_failed`；
- message 是由可信 format enum 生成的稳定摘要，不拼接捕获异常；
- 原始异常只能存在于当前调用栈，不进入返回值、warning、trace 或文档示例；
- 格式级失败不会删除此前成功产物，也不会阻止后续独立格式；
- preset 应用等公共准备阶段的程序错误仍使调用失败，不能用逐格式 catch 掩盖不变量
  破坏。

## 5. 边缘案例

1. `formats` 含重复项：只返回第一次出现的位置，不排序；
2. 只请求 YAML：不得因为未请求的 LaTeX/PDF 路径失败；
3. 同时请求 LaTeX 和 PDF：PDF compiler 收到与 LaTeX artifact 相同的实际源码；
4. 只请求 PDF：模块仍在 PDF 的格式级保护中生成所需 LaTeX；
5. PDF adapter 抛出包含临时路径和私密内容的异常：公开 failure/warning 不含原文；
6. DOCX base64 可解码但不是 OOXML：ZIP signature 与关键 entry 测试必须失败；
7. 非 ASCII 内容：`sizeBytes` 按 UTF-8 字节而非字符数计算；
8. 连续渲染多个 style：源 Resume、前一个结果和全局 preset 不互相污染；
9. text renderer 返回空字符串：不能声明空 artifact 成功；
10. fake PDF compiler 指定 timeout：默认 60 秒和显式 override 都必须准确传递。

## 6. 单行为 RED → GREEN 记录

1. **variant metadata RED → GREEN：** 新 workflow 测试收到 style ID 作为 label，且三种
   template 全部为主样式 `jake`；改为每个 variant 从 `getStylePreset(style)` 读取
   label/template 后通过。
2. **style mapping / source immutability（characterization GREEN）：** 五个 preset 的
   label/template、稳定去重、legacy template 解析和两个连续 style 渲染均符合预期；
   没有伪造 RED。
3. **五种文本产物（characterization GREEN）：** 真实 core renderer 输出非空内容，
   format/style/filename/media type/UTF-8 size 与 legacy 顶层字段一致。
4. **format 去重（characterization GREEN）：** `Set` 已保持 first-seen 顺序；新增回归
   测试固定该契约。
5. **DOCX（characterization GREEN）：** 真实 `Packer.toBuffer` 输出可解码 base64，具有
   `PK\x03\x04`、`[Content_Types].xml`、`word/document.xml` 和正确原始字节数。
6. **PDF adapter（characterization GREEN）：** fake compiler 证明收到实际 LaTeX、默认
   60 秒或显式 timeout，并返回正确 binary metadata；没有调用系统 binary。
7. **PDF 脱敏 RED → GREEN：** 注入私密 marker 和临时路径后，RED 证明原始异常进入
   `ArtifactFailure.message`；改为 format 派生的固定摘要后通过，且前后文本产物保留。
8. **text renderer 隔离 RED → GREEN：** 注入 HTML renderer 失败时，RED 从逐格式循环
   之前直接抛错；将文本生成移动到格式级保护内并增加内部缓存后，YAML/JSON/LaTeX
   继续成功，HTML 只产生安全 failure，失败格式不再出现在 legacy 顶层字段。

测试均通过公开 `renderResumeVariant` 或 `ResumeTailoringAgent.run` 观察结果，不测试私有
helper。fake 仅用于 `PdfCompiler` 外部 seam 和受控的 core renderer 故障注入；成功路径
仍使用真实 `@yamlresume/core` renderer 与真实 `docx` Packer。

## 7. 验收门禁

- 新增相邻 rendering tests，且不调用真实 LaTeX binary；
- workflow 测试证明五个 preset 中至少多个异构 template 的 metadata 正确；
- Resume Agent 定向和全包测试通过；
- Resume Agent TypeScript、目标文件 Biome 和 `git diff --check` 通过；
- 新 TypeScript 文件有完整 MIT Header；
- 只显式暂存本切片文件，提交不包含前端或 RA-015A 的共享工作树改动。

2026-09-16 验证记录：

```bash
pnpm agent test src/rendering/artifacts.test.ts src/rendering/styles.test.ts src/workflow/agent.test.ts
pnpm agent test
pnpm --filter @yamlresume/resume-agent exec tsc --noEmit
pnpm exec biome check packages/resume-agent/src/rendering/artifacts.ts packages/resume-agent/src/rendering/artifacts.test.ts packages/resume-agent/src/rendering/styles.ts packages/resume-agent/src/rendering/styles.test.ts packages/resume-agent/src/workflow/agent.ts packages/resume-agent/src/workflow/agent.test.ts
pnpm agent build
git diff --check
pnpm license:check
```

- 定向测试：3 个文件、18 个测试通过；
- Resume Agent 全包：12 个文件、129 个测试通过，其中包含 RA-015A 合入后的并发测试；
- TypeScript、六个目标文件 Biome、package build 和 `git diff --check` 通过；
- `license:check` 退出码为 0，但机器缺少 `addlicense` binary，实际扫描被脚本跳过；两个
  新增 TypeScript 测试文件已人工核对完整 MIT Header；
- PDF 测试全部使用 fake compiler，没有执行真实 LaTeX binary，也没有读取凭证或访问
  真实 Provider。

## 8. 明确延期

- 真实 xelatex/tectonic 执行、资源限制、进程隔离和恶意 LaTeX 威胁测试；
- PDF 实际页面数、字体嵌入、视觉回归和跨 PDF 阅读器测试；
- DOCX 在 Microsoft Word、LibreOffice 和 Google Docs 的兼容矩阵；
- 大型简历的耗时、内存、artifact 大小限制和流式下载；
- `application/x-latex` 的版本化迁移；
- 生产 telemetry、下载鉴权、保留/删除策略和对象存储。

### 8.1 常见文档格式不是被拒绝，而是后续独立切片

用户在 2026-09-16 补充要求：文件能力不能止于当前七种输出，求职场景中的常见文档
都应有明确支持策略。该要求同时影响输入解析和输出交付，不能只在 `OutputFormatSchema`
追加扩展名：

| 生命周期 | 当前已实现 | 下一优先级 | 需要单独解决的问题 |
| --- | --- | --- | --- |
| 输入解析 | TXT/Markdown/HTML/JSON/YAML、数字 PDF、DOCX、PNG/JPEG/WebP/GIF media type | ODT、RTF、旧版 DOC；补齐扩展名/MIME 映射 | 内容签名、编码、加密/损坏文件、宏、ZIP/XML bomb、OCR、解析器沙箱 |
| 输出交付 | YAML、JSON、Markdown、HTML、LaTeX、PDF、DOCX | TXT、RTF、ODT | 样式保真、可访问性、跨阅读器兼容、binary package 验证、转换资源限制 |

范围决策：

- **adopt：** 把 TXT、RTF、ODT 和旧版 DOC 纳入已登记的产品范围；
- **adapt：** 旧版 DOC 是复杂的二进制 Office 格式，后续优先评估受限转换 adapter，
  不把不可信 binary parser 直接塞入 Agent 工作流；
- **decline for now：** XLSX、PPTX、Apple Pages 不是简历/JD 的核心文档交换格式；没有
  用户样本和验收标准前不宣称支持，但保留上传后给出明确转换建议；
- **split：** 输入扩展作为 `RA-001B`，输出扩展作为 `RA-007C`。每种格式分别执行
  research → Feature Brief → fixture corpus → RED/GREEN → fuzz/损坏样本 → 兼容性验证，
  不建立一个吞掉所有异常的“万能转换器”。

OWASP 明确指出上传方提供的 Content-Type 可伪造，扩展名、MIME 和文件签名任一种检查
都不足以单独作为安全结论，并且解压后的大小也必须受限。因此后续实现不能继续只靠
filename 或声明的 media type 推断 binary 格式。OASIS ODF、Microsoft DOC/RTF 规范和
真实匿名 fixture 将是对应切片的主要证据。

RA-007B 仍先完成现有格式的可靠性基线，因为 RA-007C 的每个新 exporter 都应复用同一
套顺序、编码、partial-success 和安全失败契约。当前 DOCX 是内容可编辑导出，并未证明
五种 preset 在 Word 中具有等价视觉样式；这一点必须作为 RA-007C 的样式保真缺口，
不能因 artifact 上带有 style ID 就宣称完成。

## 9. 实施后证据台账

| Feature ID | 生命周期 | 用户结果 | 交付 | 主要/独立证据 | 决策 | 覆盖 | 历史缺口 | 剩余缺口 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RA-007B-A | style selection → metadata | 每个变体可被正确识别 | Implemented | 本地源码/历史；preset 表；workflow RED/GREEN | adapt：preset 单一事实源 | covered | backfilled | custom style 尚未设计 |
| RA-007B-B | text render → deliver | 文本产物非空且 metadata 可验证 | Implemented | core renderer 源码；IANA/RFC；真实 renderer 系统测试 | adapt：按格式惰性执行并缓存 | covered | backfilled | 大型输入性能未验证 |
| RA-007B-C | DOCX render → deliver | 下载内容是可识别 OOXML package | Implemented | docx 依赖；PKWARE；Microsoft WordprocessingML；真实 package 测试 | adapt：真实 Packer + package 检查 | partial | backfilled | 跨阅读器与 preset 视觉保真 |
| RA-007B-D | PDF source → compile → deliver | compiler 收到正确源码和 timeout | Implemented for development | `PdfCompiler` 双 adapter seam；fake compiler 测试 | adopt：保留双 adapter seam | partial | backfilled | 无真实 compiler、页面数或生产沙箱 |
| RA-007B-E | per-format failure → partial delivery | 单格式失败不破坏其他产物且不泄密 | Implemented | PDF/text renderer 对抗测试；workflow warning 数据流检查 | adapt：格式级保护 + 固定摘要 | covered | backfilled | 生产日志/下载层不在本切片 |
| RA-007B-F | source → repeated variants | 渲染不修改用户 Resume | Implemented | 连续两 style 的深度相等测试 | adapt：保持 preset 应用为复制操作 | covered | backfilled | 并发压力未验证 |

## 10. 参考资料

- RFC 9512, YAML Media Type：<https://www.rfc-editor.org/rfc/rfc9512>
- IANA Media Types：<https://www.iana.org/assignments/media-types/>
- Node.js v22 Buffer：<https://nodejs.org/docs/latest-v22.x/api/buffer.html>
- PKWARE APPNOTE 6.3.10：
  <https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT>
- Microsoft, Structure of a WordprocessingML document：
  <https://learn.microsoft.com/en-us/office/open-xml/word/structure-of-a-wordprocessingml-document>
- OWASP File Upload Cheat Sheet：
  <https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html>
- OASIS OpenDocument 1.3 Part 2 Packages：
  <https://docs.oasis-open.org/office/OpenDocument/v1.3/os/part2-packages/>
- Microsoft Word Binary File Format：
  <https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/>
- Microsoft Rich Text Format specification：
  <https://learn.microsoft.com/en-us/previous-versions/office/developer/office2000/aa140277(v=office.10)>
