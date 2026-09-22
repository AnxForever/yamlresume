# YAMLResume · Career Agent

**简体中文** · [English](README.en.md)

> [!IMPORTANT]
> **这是一个 fork。** 简历排版引擎——`packages/core`、CLI、模板与 LaTeX 流水线——来自
> [yamlresume/yamlresume](https://github.com/yamlresume/yamlresume)（[PPResume](https://ppresume.com)），
> 在此按 MIT 协议使用（见 [LICENSE](./LICENSE)）。那部分工作的功劳属于上游。
>
> 「这个 fork 加了什么」一节描述的全部内容，都是在本仓库中构建的。

## 这个 fork 加了什么

**Career Agent** —— 一个多阶段 LLM Agent，把「岗位描述 + 候选人原始材料」变成一份定制且有证据支撑的简历。

它要解决的问题是：模型写出的简历条目很流畅，而**流畅但错误的条目，在面试官追问之前和正确的看起来一模一样**。所以这套设计把模型生成的每一条结论都当作**待验证的假设**——必须能指回源文档；同时把模型当作**不可信的组件**，而不是权威。

| 包 | 是什么 |
| --- | --- |
| `packages/resume-agent` | Agent 本体：阶段工作流、证据绑定、评估框架 |
| `packages/resume-agent-api` | HTTP API —— Run、产物、认证、human-in-the-loop 提问 |
| `packages/agent-web` | Codex 风格工作台 —— Run 阶段、证据与产物并置可见 |
| `packages/web` | 浏览器编辑器 —— YAML 输入、实时 HTML 预览、按需生成真实 PDF |

### 设计取舍

- **要证据，不要感觉。** Agent 产出的每一条都带着它的来源。指不回候选人材料的结论会被丢弃，而不是发出去。
- **不信任模型输出。** 结构化输出做运行时校验与重试；任务中途中断可从持久化存储恢复，而不是重复执行副作用；Run 级别有模型调用与 token 的预算上限。
- **不拿 LLM 当裁判。** 正确性由确定性框架度量——覆盖率断言加盲化人评——这样改动一个 Prompt、一个模型或一个 Runtime，比较的是**可靠性**，不是印象。

### 项目状态（2026-09-22）

**当前交付范围只有一条线：RP-001，「岗位描述 + 候选人材料 → 有证据依据的定制简历」。** 路线图里的其余产品线（顶层 Career Agent Runtime、求职材料、差距分析与学习计划、资料研究、岗位知识库、公司健康度）只是记录下来的方向，没有开始实现，也不会在这条线通过验收前开始。

这条线现在处于 `Implemented for development`：完整工作流、HTTP API、工作台、durable Run Store 和确定性 Eval 都已实现并有测试；真实模型 campaign 已经打通并留下可评分基线，但质量与稳定性还没到项目定义的 `Operational` 门槛。每个功能都用 `Idea / Planned / Implemented / Enabled / Operational` 严格标注，见[证据台账](docs/resume-agent-product-roadmap.zh-CN.md#22-产品能力证据台账)。

| 数字 | 值 | 来源 |
| --- | ---: | --- |
| Agent 三包源码（不含许可头） | 23.8K 行 / 80 个文件 | `node scripts/project-metrics.mjs` |
| 测试 | 673 个用例 / 48 个文件 / 18.1K 行 | `pnpm test` 与同上脚本 |
| 设计与证据文档 | 28 篇 / 7.4K 行 | 同上脚本 |
| 真实 DeepSeek campaign | 通过 0/3 → 1/3 → 4/6，需求覆盖率 0.37 → 0.57 | [公开岗位评估 §9](docs/resume-agent-public-job-evaluation.zh-CN.md#9-2026-09-16-真实运行证据) |

campaign 的样本只有 3 个合成案例、至多 2 轮重复（Wilson 95% 区间 [0.30, 0.90]），它是诊断用的基线，不是效果宣称。

从哪里读起：[产品路线图](docs/resume-agent-product-roadmap.zh-CN.md) → [后端设计与证据台账](docs/resume-agent-backend.md) → [结构化输出可靠性](docs/resume-agent-structured-output-reliability.zh-CN.md) → [评估框架](docs/resume-agent-evaluation-harness.zh-CN.md)。想按学习路径读，看[工程学习指南](docs/career-agent-learning-guide.zh-CN.md)。想看「问题 → 根因 → 修法 → 证据」的开发叙事，包括做错的部分，读[开发叙事与问题记录](docs/career-agent-interview-narrative.zh-CN.md)。

---

## 上游：YAMLResume

排版引擎本身的用法——写 YAML、校验、编译 PDF、生态工具——见下。这部分来自上游
[yamlresume/yamlresume](https://github.com/yamlresume/yamlresume)，中文版由上游维护。

> 📢 **新闻：** [YAMLResume GitHub
> Action](https://github.com/marketplace/actions/yamlresume) 现已发布！
> 您现在可以直接在 CI/CD 流水线中自动生成简历 PDF。前往查看
> [使用文档](https://yamlresume.dev/docs/ecosystem/action) 以及
> [发布文章](https://yamlresume.dev/blog/yamlresume-action)。

撰写简历或许不难，但往往枯燥乏味且容易出错。

[YAMLResume](https://yamlresume.dev/zh-cn) 让你以 [YAML](https://yaml.org/) 管理并版本化你的简历，并一键生成专业的 PDF，拥有优雅的排版。

![YAMLResume YAML and PDF](docs/static/images/yamlresume-yaml-and-pdf.webp)

## 设计理念

本项目最初是 [PPResume](https://ppresume.com/?ref=yamlresume) 的核心排版引擎。经过慎重考虑，我们决定将其开源，让每个人都能对厂商锁定说不。

YAMLResume 的核心设计理念是[关注点分离](https://zh.wikipedia.org/wiki/%E5%85%B3%E6%B3%A8%E7%82%B9%E5%88%86%E7%A6%BB)。就像 HTML 与 CSS —— HTML 负责结构化内容，CSS 定义内容的呈现样式。

遵循该原则，YAMLResume 满足以下要求：

- 内容以纯文本撰写
- 使用 YAML 组织结构（相较 JSON 更易读易写）
- 将 YAML 渲染为 PDF，排版引擎可插拔
- 布局可通过字体大小、页边距等选项自由调整

## 快速开始

若已安装 Docker，可直接体验已打包好依赖的镜像：

[![YAMLResume Docker Demo](https://asciinema.org/a/722057.svg)](https://asciinema.org/a/722057)

或使用你偏好的包管理器安装 `yamlresume`：

```
# using npm
$ npm install -g yamlresume

# using yarn
$ yarn global add yamlresume

# using pnpm
$ pnpm add -g yamlresume

# using bun
$ bun add -g yamlresume
```

验证安装：

```
$ yamlresume help
Usage: yamlresume [options] [command]

YAMLResume — Resume as Code in YAML

 __   __ _    __  __ _     ____
 \ \ / // \  |  \/  | |   |  _ \ ___  ___ _   _ ___  ___   ___
  \ V // _ \ | |\/| | |   | |_) / _ \/ __| | | / _ \/ _ \ / _ \
   | |/ ___ \| |  | | |___|  _ <  __/\__ \ |_| | | | | | |  __/
   |_/_/   \_\_|  |_|_____|_| \_\___||___/\____|_| |_| |_|\___|


Options:
  -V, --version                  output the version number
  -v, --verbose                  verbose output
  -h, --help                     display help for command

Commands:
  new [filename]                 create a new resume
  build [options] <resume-path>  build a resume to LaTeX and PDF
  dev [options] <resume-path>    build a resume on file changes (watch mode)
  languages                      i18n and l10n support
  templates                      manage resume templates
  validate <resume-path>         validate a resume against the YAMLResume schema
  help [command]                 display help for command
```

你需要安装排版引擎以生成 PDF：推荐 [XeTeX](https://yamlresume.dev/zh-cn/docs#install-typesetting-engine) 或 [Tectonic](https://yamlresume.dev/zh-cn/docs#install-typesetting-engine)。

建议安装 [Linux Libertine](https://yamlresume.dev/zh-cn/docs#linux-libertine-font) 字体以获得最佳视觉效果。

更多细节见[安装指南](https://yamlresume.dev/zh-cn/docs/installation)。

## 创建一份新简历

你可以从我们的[示例简历](packages/cli/src/commands/fixtures/software-engineer.yml)开始：

```
$ yamlresume new my-resume.yml
✔ Created my-resume.yml successfully.

$ yamlresume build my-resume.yml
✔ Generated resume tex file successfully: my-resume.tex
◐ Generating resume pdf file with command: xelatex -halt-on-error my-resume.tex...
✔ Generated resume pdf file successfully: my-resume.pdf
✔ Generated resume markdown file successfully: my-resume.md
✔ Generated resume html file successfully: my-resume.html
```

或使用 [`dev` 命令](https://yamlresume.dev/zh-cn/docs/cli#dev)监听变更并自动构建：

```
$ yamlresume dev my-resume.yml
✔ Generated resume tex file successfully: my-resume.tex
◐ Generating resume pdf file with command: xelatex -halt-on-error my-resume.tex...
◐ Watching file changes: my-resume.yml...
✔ Generated resume pdf file successfully: my-resume.pdf
✔ Generated resume markdown file successfully: my-resume.md
```

生成的 PDF 示例：[点此查看](docs/static/images/resume.pdf)。

## 校验简历

YAMLResume 提供了[内置 Schema](https://yamlresume.dev/zh-cn/docs/compiler/schema)，用于在构建前校验简历，避免低级错误。

## 排版

YAMLResume 采用 [LaTeX](https://www.latex-project.org/) 作为默认排版引擎，并遵循[简历排版最佳实践](https://docs.ppresume.com/guide?ref=yamlresume)，确保像素级精致的呈现。

它还支持 [HTML/CSS 布局引擎](https://yamlresume.dev/docs/layouts/html)，让你可以生成对 Web 友好的简历。

## 生态

- [@yamlresume/playground](https://www.npmjs.com/package/@yamlresume/playground) 是一个用于构建你自己的简历编辑器的 React 组件。它驱动了官方的 [Playground](https://yamlresume.dev/playground)。

- [create-yamlresume](https://yamlresume.dev/zh-cn/docs/ecosystem/create-yamlresume)：一条命令初始化项目并生成示例
- [json2yamlresume](https://yamlresume.dev/zh-cn/docs/ecosystem/json2yamlresume)：将 JSON Resume 转换为 YAMLResume

## 参与贡献

项目仍在积极开发中，公共 API 尚未完全稳定，欢迎耐心等候并参与改进。

任何形式的贡献都非常欢迎！在提交 PR 之前，请阅读[贡献指南](CONTRIBUTING.md)。

### Star 历史

[![YAMLResume Star History Chart](https://api.star-history.com/svg?repos=yamlresume/yamlresume&type=Date)](https://www.star-history.com/#yamlresume/yamlresume&Date)

## 路线图

- [ ] 增加更多简历模板
- [ ] 更多布局引擎 (typst, docx)

## 支持本项目

如果 YAMLResume 对你有帮助，欢迎支持我们：

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/xiaohanyu)

---

## 本项目许可

MIT —— 见 [LICENSE](./LICENSE)。上游代码同样以 MIT 协议提供。
