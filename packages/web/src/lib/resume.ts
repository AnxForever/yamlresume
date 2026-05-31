/**
 * MIT License
 *
 * Copyright (c) 2023–Present PPResume (https://ppresume.com)
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to
 * deal in the Software without restriction, including without limitation the
 * rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
 * sell copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 * IN THE SOFTWARE.
 */

import {
  type Country,
  type Degree,
  getResumeRenderer,
  type HtmlTemplate,
  type LatexFontSize,
  type LatexTemplate,
  type Level,
  type Network,
  type Resume,
  ResumeSchema,
} from '@yamlresume/core'
import { parse, stringify } from 'yaml'

export const LATEX_TEMPLATE_LABELS: Record<LatexTemplate, string> = {
  jake: '经典学术',
  'moderncv-banking': '现代简约',
  'moderncv-casual': 'ModernCV Casual',
  'moderncv-classic': 'ModernCV Classic',
}

export const LATEX_TEMPLATES: LatexTemplate[] = ['jake', 'moderncv-banking']

export const HTML_TEMPLATES: HtmlTemplate[] = ['calm', 'vscode']

const DEFAULT_TEMPLATE: LatexTemplate = 'moderncv-banking'
const DEFAULT_HTML_TEMPLATE: HtmlTemplate = 'calm'
const DEFAULT_FONT_SIZE: LatexFontSize = '10pt'
const DEFAULT_DEGREE: Degree = 'Bachelor'
const DEFAULT_LEVEL: Level = 'Intermediate'
const DEFAULT_NETWORK: Network = 'GitHub'

const DEFAULT_LATEX_LAYOUT = {
  engine: 'latex',
  template: DEFAULT_TEMPLATE,
  page: {
    margins: {
      top: '1.5cm',
      bottom: '1.5cm',
      left: '1.2cm',
      right: '1.2cm',
    },
    paperSize: 'a4',
    showPageNumbers: false,
  },
  typography: {
    fontSize: DEFAULT_FONT_SIZE,
  },
} as const

export interface FormBasics {
  name: string
  headline: string
  email: string
  phone: string
  url: string
  summary: string
}

export interface FormLocation {
  city: string
  region: string
  country: Country | ''
}

export interface FormProfile {
  id: string
  network: Network
  url: string
  username: string
}

export interface FormEducation {
  id: string
  institution: string
  url: string
  degree: Degree
  area: string
  startDate: string
  endDate: string
  score: string
  courses: string
  summary: string
}

export interface FormWork {
  id: string
  name: string
  position: string
  startDate: string
  endDate: string
  summary: string
}

export interface FormProject {
  id: string
  name: string
  description: string
  url: string
  startDate: string
  endDate: string
  keywords: string
  summary: string
}

export interface FormSkill {
  id: string
  name: string
  level: Level
  keywords: string
}

export interface FormExtra {
  latexLayout?: Record<string, unknown>
  content?: Record<string, unknown>
}

export interface FormResume {
  template: LatexTemplate
  htmlTemplate: HtmlTemplate
  fontSize: LatexFontSize
  basics: FormBasics
  location: FormLocation
  profiles: FormProfile[]
  education: FormEducation[]
  work: FormWork[]
  projects: FormProject[]
  skills: FormSkill[]
  extra?: FormExtra
}

export const EMPTY_PROFILE: FormProfile = {
  id: 'profile-empty',
  network: DEFAULT_NETWORK,
  url: '',
  username: '',
}

export const EMPTY_EDUCATION: FormEducation = {
  id: 'education-empty',
  institution: '',
  url: '',
  degree: DEFAULT_DEGREE,
  area: '',
  startDate: '',
  endDate: '',
  score: '',
  courses: '',
  summary: '',
}

export const EMPTY_WORK: FormWork = {
  id: 'work-empty',
  name: '',
  position: '',
  startDate: '',
  endDate: '',
  summary: '',
}

export const EMPTY_PROJECT: FormProject = {
  id: 'project-empty',
  name: '',
  description: '',
  url: '',
  startDate: '',
  endDate: '',
  keywords: '',
  summary: '',
}

export const EMPTY_SKILL: FormSkill = {
  id: 'skill-empty',
  name: '',
  level: DEFAULT_LEVEL,
  keywords: '',
}

export const DEFAULT_FORM_RESUME: FormResume = {
  template: DEFAULT_TEMPLATE,
  htmlTemplate: DEFAULT_HTML_TEMPLATE,
  fontSize: DEFAULT_FONT_SIZE,
  basics: {
    name: '包安心',
    headline: 'AI 应用开发工程师',
    email: '3475872056@qq.com',
    phone: '15189096519',
    url: 'https://anxforever.cn',
    summary: [
      '- 长期使用 Claude Code、Cursor、OpenAI Codex 等 AI 编程工具进行日常开发，熟悉提示词工程与 AI 辅助开发流程',
      '- 具备 Next.js + React + TypeScript 全栈开发能力，独立完成多个项目从零到部署上线',
      '- 主导开源项目 StyleKit（GitHub 100+ Stars），涵盖 AI 友好设计体系与 IDE 规则导出',
      '- 注重代码质量与工程规范，善于将需求拆解为可落地的任务并推进交付',
    ].join('\n'),
  },
  location: {
    city: '西安',
    region: '陕西',
    country: 'China',
  },
  profiles: [
    {
      id: 'profile-github',
      network: 'GitHub',
      url: 'https://github.com/AnxForever',
      username: 'AnxForever',
    },
  ],
  education: [
    {
      id: 'education-xust',
      institution: '西安科技大学',
      url: 'https://www.xust.edu.cn/',
      degree: 'Bachelor',
      area: '数据科学与大数据技术（人工智能与计算机学院）',
      startDate: '2022-09',
      endDate: '2026-07',
      score: '',
      courses: '深度学习, 机器学习, 大数据分析',
      summary: ['- 全国大学生数字建模大赛省二等奖', '- CET-4'].join('\n'),
    },
  ],
  work: [],
  projects: [
    {
      id: 'project-stylekit',
      name: 'StyleKit - AI 友好的 Web 设计风格库平台',
      description: '开源设计风格工具集，GitHub 100+ Stars',
      url: 'https://stylekit.top',
      startDate: '2025-01',
      endDate: '',
      keywords: 'Next.js, React, TypeScript, Supabase, AI Rules',
      summary: [
        '- 基于 Next.js 16 + React 19 + TypeScript + Tailwind CSS 4 构建全栈应用，收录 130+ 种设计风格，已开源部署上线',
        '- 实现 Prompt Builder、IDE 规则导出（.cursorrules / claude-rules）、风格验证 Linter 等 AI-Native 能力',
        '- 设计风格分类体系，支持风格变体、标签筛选，实现 Louvain 社区算法驱动的风格推荐',
      ].join('\n'),
    },
    {
      id: 'project-stylekit-agent',
      name: 'StyleKit Agent - 对话式 AI 页面规划助手',
      description: '将页面需求转化为可粘贴 AI 编码 Prompt 的 Planning Agent',
      url: 'https://stylekit.top/agent',
      startDate: '2026-02',
      endDate: '',
      keywords: 'Agent, LLM, Planning, Next.js',
      summary: [
        '- 基于多槽位规划器架构，通过结构化对话逐步填充页面目的、受众、风格、布局、组件与约束等字段',
        '- 对接 StyleKit 130+ 风格库与场景映射规则，自动推荐兼容风格并生成含 Tailwind tokens 与硬约束的可粘贴 AI 编码 Prompt',
        '- 基于 Next.js App Router 实现会话持久化，可与 Cursor / v0 / Claude 等 AI 编码工具协作',
      ].join('\n'),
    },
    {
      id: 'project-ai-detector',
      name: '中文 AI 生成文本检测系统（本科毕业设计）',
      description: '基于 BERT 微调的中文 AI 文本检测与边界定位',
      url: 'https://huggingface.co/AnxForever/chinese-ai-detector-bert',
      startDate: '2026-01',
      endDate: '2026-03',
      keywords: 'PyTorch, BERT, Hugging Face, FastAPI',
      summary: [
        '- 基于 BERT 微调构建中文 AI 生成文本检测系统，验证集准确率 98.75%，独立评估集 98.57%，三集平均 98.56%',
        '- 提出 [SEP] 边界标记机制 + 双层检测架构（分类器 + Token 级边界检测器），边界定位准确率 96.69%，实际误差 <10 字符',
        '- 应用 Temperature Scaling 置信度校准（ECE=0.0034），独立评估集较 V10 基线提升 0.88pp，误报率降低 38%',
        '- 基于 FastAPI + Next.js 构建端到端 Demo，模型与 70K 中文数据集已发布至 Hugging Face',
      ].join('\n'),
    },
    {
      id: 'project-blog',
      name: '个人博客',
      description: '基于 Next.js 的技术博客站点',
      url: 'https://anxforever.cn',
      startDate: '2024-09',
      endDate: '',
      keywords: 'Next.js, React, Vercel',
      summary: [
        '- 基于开源项目二次开发，Next.js + React + TypeScript 技术栈，自定义设计系统，支持深色模式与响应式布局',
      ].join('\n'),
    },
  ],
  skills: [
    {
      id: 'skill-frontend',
      name: '前端开发',
      level: 'Intermediate',
      keywords: 'Next.js, React, TypeScript, Tailwind CSS, Framer Motion',
    },
    {
      id: 'skill-ai',
      name: 'AI 工具与工程',
      level: 'Intermediate',
      keywords: 'Claude Code, Cursor, OpenAI Codex, Prompt Engineering',
    },
    {
      id: 'skill-backend',
      name: '后端与部署',
      level: 'Beginner',
      keywords: 'FastAPI, Supabase, PostgreSQL, Vercel, Git',
    },
    {
      id: 'skill-testing',
      name: '测试',
      level: 'Beginner',
      keywords: 'Jest, Playwright',
    },
  ],
}

function trimValue(value: string): string {
  return value.trim()
}

function optionalValue(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined
  }

  const trimmed = trimValue(value)
  return trimmed.length > 0 ? trimmed : undefined
}

function splitKeywords(value: string): string[] | undefined {
  const keywords = value
    .split(',')
    .map((keyword) => keyword.trim())
    .filter((keyword) => keyword.length > 0)

  return keywords.length > 0 ? keywords : undefined
}

function joinKeywords(keywords: readonly string[] | undefined): string {
  return (keywords ?? []).join(', ')
}

function cloneWithId<T extends { id: string }>(item: T, id: string): T {
  return {
    ...item,
    id,
  }
}

export function createProfileItem(id: string): FormProfile {
  return cloneWithId(EMPTY_PROFILE, id)
}

export function createEducationItem(id: string): FormEducation {
  return cloneWithId(EMPTY_EDUCATION, id)
}

export function createWorkItem(id: string): FormWork {
  return cloneWithId(EMPTY_WORK, id)
}

export function createProjectItem(id: string): FormProject {
  return cloneWithId(EMPTY_PROJECT, id)
}

export function createSkillItem(id: string): FormSkill {
  return cloneWithId(EMPTY_SKILL, id)
}

function hasProfileContent(item: FormProfile): boolean {
  return [item.username, item.url].some((value) => trimValue(value).length > 0)
}

function hasEducationContent(item: FormEducation): boolean {
  return [
    item.institution,
    item.area,
    item.url,
    item.startDate,
    item.endDate,
    item.score,
    item.courses,
    item.summary,
  ].some((value) => trimValue(value).length > 0)
}

function hasWorkContent(item: FormWork): boolean {
  return [
    item.name,
    item.position,
    item.startDate,
    item.endDate,
    item.summary,
  ].some((value) => trimValue(value).length > 0)
}

function hasProjectContent(item: FormProject): boolean {
  return [
    item.name,
    item.description,
    item.url,
    item.startDate,
    item.endDate,
    item.keywords,
    item.summary,
  ].some((value) => trimValue(value).length > 0)
}

function hasSkillContent(item: FormSkill): boolean {
  return [item.name, item.keywords].some((value) => trimValue(value).length > 0)
}

function buildLatexResume(form: FormResume): Resume {
  const name = optionalValue(form.basics.name) ?? '未命名简历'
  const city = optionalValue(form.location.city)
  const location = city
    ? {
        city,
        ...(optionalValue(form.location.region)
          ? { region: trimValue(form.location.region) }
          : {}),
        ...(form.location.country ? { country: form.location.country } : {}),
      }
    : undefined

  const profiles = form.profiles.filter(hasProfileContent).map((profile) => ({
    network: profile.network,
    username: optionalValue(profile.username) ?? profile.network,
    ...(optionalValue(profile.url) ? { url: trimValue(profile.url) } : {}),
  }))

  const education = form.education.filter(hasEducationContent).map((item) => ({
    institution: optionalValue(item.institution) ?? '未填写学校',
    ...(optionalValue(item.url) ? { url: trimValue(item.url) } : {}),
    degree: item.degree,
    area: optionalValue(item.area) ?? '未填写专业',
    startDate: optionalValue(item.startDate) ?? '至今',
    ...(optionalValue(item.endDate)
      ? { endDate: trimValue(item.endDate) }
      : {}),
    ...(splitKeywords(item.courses)
      ? { courses: splitKeywords(item.courses) }
      : {}),
    ...(optionalValue(item.score) ? { score: trimValue(item.score) } : {}),
    ...(optionalValue(item.summary) ? { summary: item.summary } : {}),
  }))

  const work = form.work.filter(hasWorkContent).map((item) => ({
    name: optionalValue(item.name) ?? '未填写单位',
    position: optionalValue(item.position) ?? '未填写岗位',
    startDate: optionalValue(item.startDate) ?? '至今',
    ...(optionalValue(item.endDate)
      ? { endDate: trimValue(item.endDate) }
      : {}),
    ...(optionalValue(item.summary) ? { summary: item.summary } : {}),
  }))

  const projects = form.projects.filter(hasProjectContent).map((item) => ({
    name: optionalValue(item.name) ?? '未填写项目',
    ...(optionalValue(item.description)
      ? { description: trimValue(item.description) }
      : {}),
    ...(optionalValue(item.url) ? { url: trimValue(item.url) } : {}),
    startDate: optionalValue(item.startDate) ?? '至今',
    ...(optionalValue(item.endDate)
      ? { endDate: trimValue(item.endDate) }
      : {}),
    ...(splitKeywords(item.keywords)
      ? { keywords: splitKeywords(item.keywords) }
      : {}),
    ...(optionalValue(item.summary) ? { summary: item.summary } : {}),
  }))

  const skills = form.skills.filter(hasSkillContent).map((item) => ({
    name: optionalValue(item.name) ?? '技能',
    level: item.level,
    ...(splitKeywords(item.keywords)
      ? { keywords: splitKeywords(item.keywords) }
      : {}),
  }))

  const baseLayout =
    (form.extra?.latexLayout as Record<string, unknown> | undefined) ??
    DEFAULT_LATEX_LAYOUT
  const baseTypography =
    (baseLayout.typography as Record<string, unknown> | undefined) ?? {}

  const layout = {
    ...baseLayout,
    engine: 'latex' as const,
    template: form.template,
    typography: {
      ...baseTypography,
      fontSize: form.fontSize,
    },
  }

  return {
    locale: {
      language: 'zh-hans',
    },
    layouts: [layout],
    content: {
      basics: {
        name,
        ...(optionalValue(form.basics.headline)
          ? { headline: trimValue(form.basics.headline) }
          : {}),
        ...(optionalValue(form.basics.email)
          ? { email: trimValue(form.basics.email) }
          : {}),
        ...(optionalValue(form.basics.phone)
          ? { phone: trimValue(form.basics.phone) }
          : {}),
        ...(optionalValue(form.basics.url)
          ? { url: trimValue(form.basics.url) }
          : {}),
        ...(optionalValue(form.basics.summary)
          ? { summary: form.basics.summary }
          : {}),
      },
      ...(location ? { location } : {}),
      ...(profiles.length ? { profiles } : {}),
      education,
      ...(work.length ? { work } : {}),
      ...(projects.length ? { projects } : {}),
      ...(skills.length ? { skills } : {}),
      ...(form.extra?.content ?? {}),
    },
  } as Resume
}

export function buildResume(form: FormResume): Resume {
  return buildLatexResume(form)
}

export function buildHtmlResume(form: FormResume): Resume {
  const resume = buildLatexResume(form)

  return {
    ...resume,
    layouts: [
      {
        engine: 'html',
        template: form.htmlTemplate,
        typography: {
          fontSize: '14px',
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif',
          lineSpacing: 'snug',
        },
        advanced: {
          showIcons: true,
          title: `${resume.content.basics.name} Resume`,
          footer: '',
        },
      },
    ],
  } as Resume
}

export function renderResumeToLatex(resume: Resume): string {
  return getResumeRenderer(resume, 0).render()
}

export function renderResumeToHtml(resume: Resume): string {
  return getResumeRenderer(resume, 0).render()
}

export function serializeResumeToYaml(resume: Resume): string {
  return stringify(resume, {
    lineWidth: 0,
    nullStr: '',
  })
}

const FORM_CONTENT_SECTIONS = new Set([
  'basics',
  'location',
  'profiles',
  'education',
  'work',
  'projects',
  'skills',
])

export class YamlImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'YamlImportError'
  }
}

export function parseYamlToFormResume(yamlText: string): FormResume {
  let parsed: unknown

  try {
    parsed = parse(yamlText)
  } catch (error) {
    throw new YamlImportError(
      `YAML 解析失败：${error instanceof Error ? error.message : String(error)}`
    )
  }

  const result = ResumeSchema.safeParse(parsed)
  if (!result.success) {
    const first = result.error.issues[0]
    const where = first?.path?.length ? `（${first.path.join('.')}）` : ''

    throw new YamlImportError(
      `简历格式校验失败${where}：${first?.message ?? '未知错误'}`
    )
  }

  const resume = result.data as unknown as {
    content: Record<string, unknown>
    layouts?: Array<Record<string, unknown>>
  }
  const content = resume.content
  const layouts = resume.layouts ?? []
  const latex = layouts.find((layout) => layout?.engine === 'latex')
  const html = layouts.find((layout) => layout?.engine === 'html')
  const extraContent: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(content)) {
    if (!FORM_CONTENT_SECTIONS.has(key)) {
      extraContent[key] = value
    }
  }

  const basics = (content.basics ?? {}) as Record<string, string>
  const location = (content.location ?? {}) as Record<string, string>
  const profiles = (content.profiles ?? []) as Array<Record<string, unknown>>
  const education = (content.education ?? []) as Array<Record<string, unknown>>
  const work = (content.work ?? []) as Array<Record<string, unknown>>
  const projects = (content.projects ?? []) as Array<Record<string, unknown>>
  const skills = (content.skills ?? []) as Array<Record<string, unknown>>
  const latexTypography =
    (latex?.typography as Record<string, unknown> | undefined) ?? {}

  return {
    template: (latex?.template as LatexTemplate) ?? DEFAULT_TEMPLATE,
    htmlTemplate: (html?.template as HtmlTemplate) ?? DEFAULT_HTML_TEMPLATE,
    fontSize: (latexTypography.fontSize as LatexFontSize) ?? DEFAULT_FONT_SIZE,
    basics: {
      name: basics.name ?? '',
      headline: basics.headline ?? '',
      email: basics.email ?? '',
      phone: basics.phone ?? '',
      url: basics.url ?? '',
      summary: basics.summary ?? '',
    },
    location: {
      city: location.city ?? '',
      region: location.region ?? '',
      country: (location.country as Country) ?? '',
    },
    profiles: profiles.map((profile, index) => ({
      id: `profile-${index}`,
      network: (profile.network as Network) ?? DEFAULT_NETWORK,
      url: (profile.url as string) ?? '',
      username: (profile.username as string) ?? '',
    })),
    education: education.map((item, index) => ({
      id: `education-${index}`,
      institution: (item.institution as string) ?? '',
      url: (item.url as string) ?? '',
      degree: (item.degree as Degree) ?? DEFAULT_DEGREE,
      area: (item.area as string) ?? '',
      startDate: (item.startDate as string) ?? '',
      endDate: (item.endDate as string) ?? '',
      score: (item.score as string) ?? '',
      courses: joinKeywords(item.courses as string[] | undefined),
      summary: (item.summary as string) ?? '',
    })),
    work: work.map((item, index) => ({
      id: `work-${index}`,
      name: (item.name as string) ?? '',
      position: (item.position as string) ?? '',
      startDate: (item.startDate as string) ?? '',
      endDate: (item.endDate as string) ?? '',
      summary: (item.summary as string) ?? '',
    })),
    projects: projects.map((item, index) => ({
      id: `project-${index}`,
      name: (item.name as string) ?? '',
      description: (item.description as string) ?? '',
      url: (item.url as string) ?? '',
      startDate: (item.startDate as string) ?? '',
      endDate: (item.endDate as string) ?? '',
      keywords: joinKeywords(item.keywords as string[] | undefined),
      summary: (item.summary as string) ?? '',
    })),
    skills: skills.map((item, index) => ({
      id: `skill-${index}`,
      name: (item.name as string) ?? '',
      level: (item.level as Level) ?? DEFAULT_LEVEL,
      keywords: joinKeywords(item.keywords as string[] | undefined),
    })),
    extra: {
      ...(latex ? { latexLayout: latex } : {}),
      ...(Object.keys(extraContent).length ? { content: extraContent } : {}),
    },
  }
}
