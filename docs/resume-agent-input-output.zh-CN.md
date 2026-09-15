# Resume Agent 输入与输出设计

## 1. 输入总览

当前后端面向两类输入：岗位材料和候选人材料。文本可以直接提交，文件可以用 Base64 传输；未来前端将通过 multipart 上传后转换为相同的内部 `InputFile`。

### 1.1 岗位输入

- 直接粘贴 JD 文本；
- TXT / Markdown / HTML；
- JSON / YAML；
- 可提取文本的 PDF；
- DOCX；
- PNG / JPEG / WebP / GIF 岗位截图；
- 多个文件组合，例如“官网 JD + 招聘软件截图 + HR 补充说明”。

至少提供 JD 文本或一个岗位文件。

### 1.2 候选人输入

- YAMLResume 对象或 YAML 文本；
- JSON 简历；
- TXT / Markdown 个人资料；
- PDF 简历；
- DOCX 简历；
- PNG / JPEG / WebP / GIF 简历截图；
- 项目说明、证书、作品集文字、招聘沟通补充等多个文件。

结构化 YAMLResume 是最可信的来源。只有文件时，Agent 会先生成“候选人归一化档案”，并明确提示用户审核。图片不会伪装成本地 OCR 结果，而是作为视觉输入交给支持图片的模型。

### 1.3 当前安全限制

- 岗位文件最多 8 个；
- 候选人文件最多 12 个；
- 单文件解码后最多 12 MiB；
- 所有文件合计最多 30 MiB；
- JSON 请求体由 API 另行限制；
- 每个文件必须使用唯一 ID；
- 拒绝不支持的类型；
- 原始二进制不写日志；
- API Key 只能通过环境变量注入，不能写入仓库或请求正文。

### 1.4 建议请求结构

```json
{
  "jobDescription": "可选：直接粘贴的 JD",
  "jobFiles": [
    {
      "id": "job-screenshot-1",
      "filename": "jd.png",
      "mediaType": "image/png",
      "contentBase64": "..."
    }
  ],
  "candidate": {
    "yaml": "可选：YAMLResume 文本",
    "files": [
      {
        "id": "portfolio-notes",
        "filename": "projects.md",
        "text": "..."
      }
    ]
  },
  "preferences": {
    "language": "zh-CN",
    "targetTitle": "Agent 应用开发工程师",
    "maxPages": 1,
    "styles": ["ats-compact", "developer-two-column"],
    "formats": ["yaml", "json", "markdown", "html", "latex", "pdf", "docx"]
  }
}
```

## 2. 内部输入处理

```text
请求校验
  ↓
文件类型识别与大小限制
  ↓
文本 / PDF / DOCX 提取
  ├── 图片 → 视觉模型附件
  └── 扫描 PDF 无文本 → OCR/视觉处理警告
  ↓
候选人档案归一化
  ↓
事实确认或进入生成工作流
```

轻量解析器用于干净文本、PDF、DOCX，避免所有文件都先调用模型。复杂扫描、多栏版面、表格和图片可切换到独立文档解析服务。调研后建议未来为解析器定义 Port，并可选接入 Docling 一类本地、布局感知的解析服务，而不是把 Python 文档栈强行塞进 TypeScript 主进程。

## 3. 输出总览

### 3.1 内容与分析输出

- `JobSpec`：岗位名称、级别、要求、关键词；
- `MatchReport`：要求与候选人证据的对应关系；
- `ResumeDiff`：源档案与目标简历的新增、删除、修改和排序；
- `QualityReport`：必须项覆盖、关键词覆盖、缺失项和警告；
- `questions`：需要用户回答的问题；
- `trace`：阶段、状态，以及每个 LLM 边界的 model call、Repair、传输重试、耗时和模型返回的 token usage；
- 最终 YAMLResume 对象。

### 3.2 文档格式

- YAML：可继续作为 Resume as Code 编辑；
- JSON：API、版本管理和第三方系统集成；
- Markdown：便于审阅、版本 Diff 和复制；
- HTML：浏览器预览和未来网页发布；
- LaTeX：高质量排版源文件；
- PDF：正式投递；
- DOCX：便于在 Word、WPS 和企业系统中继续编辑。

文本产物使用 UTF-8；PDF 和 DOCX 在 JSON API 中使用 Base64，并记录媒体类型和原始字节数。后续生产环境应改成对象存储短期下载地址，避免把大文件长期放在 JSON 和数据库里。

LLM trace 只包含 provider/model、计数、耗时和 token 数，不包含 JD、候选人资料、Prompt、图片 Data URL 或原始模型响应。若结构化输出在一次默认 Repair 后仍不符合 Schema，同步 API 返回 `502 structured_output_validation_failed`，不会继续匹配、生成或渲染。

## 4. 样式输出

当前定义五个语义化样式预设：

| ID | 目标 | LaTeX 模板 |
| --- | --- | --- |
| `ats-compact` | 单栏、高密度、ATS 和技术岗 | Jake |
| `modern-professional` | 通用、稳重、层级清晰 | ModernCV Banking |
| `modern-classic` | 学术、科研、传统履历 | ModernCV Classic |
| `modern-casual` | 产品、创意、较有个性 | ModernCV Casual |
| `developer-two-column` | 项目和技能丰富的技术岗 | Deedy |

“样式”不是只换颜色。每个预设组合模板、边距、字号、行距、图标策略和技能等级展示策略。一个请求可同时生成多个样式，便于用户比较。

长期模板来源应分三层：

1. 原生 YAMLResume 模板：最可控；
2. 兼容层：把成熟开源模板的设计原则移植到 YAMLResume Renderer；
3. 外部导出器：对 JSON Resume、DOCX 等生态提供转换，而不是复制不兼容代码。

引入开源模板前必须确认许可证、维护状态、中文字体支持、ATS 可读性、分页行为和生成稳定性。
