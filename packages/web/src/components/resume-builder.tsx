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

'use client'

import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Briefcase,
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  Download,
  Eye,
  FileCode2,
  FileText,
  FolderGit2,
  GraduationCap,
  Link2,
  Minus,
  MoreHorizontal,
  Plus,
  Printer,
  RotateCcw,
  Trash2,
  Upload,
  User,
} from 'lucide-react'
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import {
  buildHtmlResume,
  buildResume,
  createEducationItem,
  createProfileItem,
  createProjectItem,
  createSkillItem,
  createWorkItem,
  DEFAULT_FORM_RESUME,
  type FormBasics,
  type FormEducation,
  type FormLocation,
  type FormProfile,
  type FormProject,
  type FormResume,
  type FormSkill,
  type FormWork,
  LATEX_TEMPLATE_LABELS,
  LATEX_TEMPLATES,
  parseYamlToFormResume,
  renderResumeToHtml,
  renderResumeToLatex,
  serializeResumeToYaml,
} from '@/lib/resume'

const STORAGE_KEY = 'yamlresume:web:form-resume:v3'
const STORAGE_BACKUP_KEY = 'yamlresume:web:form-resume-backup:v3'
const STORAGE_VERSION = 3
const PREVIEW_DEBOUNCE_MS = 220
const PDF_DEBOUNCE_MS = 900
const A4_PREVIEW_HEIGHT = 1120

type PdfStatus = 'idle' | 'compiling' | 'ready' | 'error' | 'unavailable'

type SectionKey =
  | 'basics'
  | 'profiles'
  | 'education'
  | 'work'
  | 'projects'
  | 'skills'
type CompileState = 'idle' | 'compiling' | 'success' | 'error'
type MobileView = 'form' | 'preview'

interface SelectOption {
  value: string
  label: string
}

interface PersistedResumeState {
  version: typeof STORAGE_VERSION
  formResume: FormResume
}

interface PersistedResumeBackup extends PersistedResumeState {
  createdAt: string
}

interface ConfirmDialogState {
  title: string
  description: string
  confirmLabel: string
  danger?: boolean
  onConfirm: () => void
}

interface PendingImportState {
  filename: string
  formResume: FormResume
}

interface ValidationIssue {
  section: SectionKey
  field: string
  message: string
}

type FieldTone = 'default' | 'invalid' | 'valid'

const SECTIONS: {
  key: SectionKey
  label: string
  icon: typeof User
}[] = [
  { key: 'basics', label: '基本信息', icon: User },
  { key: 'profiles', label: '链接', icon: Link2 },
  { key: 'education', label: '教育经历', icon: GraduationCap },
  { key: 'work', label: '实习经历', icon: Briefcase },
  { key: 'projects', label: '项目经历', icon: FolderGit2 },
  { key: 'skills', label: '技能', icon: FileText },
]

const SECTION_KEYS = SECTIONS.map((section) => section.key)

const NETWORK_OPTIONS: SelectOption[] = [
  { value: 'GitHub', label: 'GitHub' },
  { value: 'LinkedIn', label: 'LinkedIn' },
  { value: 'Zhihu', label: '知乎' },
  { value: 'WeChat', label: '微信' },
]

const DEGREE_OPTIONS: SelectOption[] = [
  { value: 'Diploma', label: '专科' },
  { value: 'Associate', label: '高职' },
  { value: 'Bachelor', label: '本科' },
  { value: 'Master', label: '硕士' },
  { value: 'Doctor', label: '博士' },
]

const LEVEL_OPTIONS: SelectOption[] = [
  { value: 'Novice', label: '了解' },
  { value: 'Beginner', label: '入门' },
  { value: 'Intermediate', label: '熟悉' },
  { value: 'Advanced', label: '熟练' },
  { value: 'Expert', label: '精通' },
  { value: 'Master', label: '专家' },
]

const TEMPLATE_DETAILS: Record<
  FormResume['template'],
  { description: string; fit: string }
> = {
  jake: {
    description: '信息密度高，适合技术岗、项目经历多的校招简历。',
    fit: '更利于压缩到一页',
  },
  'moderncv-banking': {
    description: '结构更清晰，适合需要稳重观感和阅读舒适度的投递。',
    fit: '更适合正式 PDF',
  },
  'moderncv-casual': {
    description: '视觉更轻松，适合非传统岗位或作品集导向简历。',
    fit: '更强调个人风格',
  },
  'moderncv-classic': {
    description: '传统履历样式，适合学术、科研、竞赛经历较多的场景。',
    fit: '更强调履历完整',
  },
  deedy: {
    description: '紧凑双栏布局，适合技能与项目经历都较丰富的技术岗。',
    fit: '更适合高信息密度简历',
  },
}

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function moveItem<T extends { id: string }>(
  items: T[],
  id: string,
  direction: -1 | 1
): T[] {
  const index = items.findIndex((item) => item.id === id)
  const nextIndex = index + direction

  if (index < 0 || nextIndex < 0 || nextIndex >= items.length) {
    return items
  }

  const nextItems = [...items]
  const [item] = nextItems.splice(index, 1)
  nextItems.splice(nextIndex, 0, item)

  return nextItems
}

function readStoredFormResume(): FormResume {
  if (typeof window === 'undefined') {
    return DEFAULT_FORM_RESUME
  }

  const rawValue = window.localStorage.getItem(STORAGE_KEY)
  if (!rawValue) {
    return DEFAULT_FORM_RESUME
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<PersistedResumeState>
    if (parsed.version !== STORAGE_VERSION || !parsed.formResume) {
      return DEFAULT_FORM_RESUME
    }

    return {
      ...DEFAULT_FORM_RESUME,
      ...parsed.formResume,
      basics: { ...DEFAULT_FORM_RESUME.basics, ...parsed.formResume.basics },
      location: {
        ...DEFAULT_FORM_RESUME.location,
        ...parsed.formResume.location,
      },
      profiles: parsed.formResume.profiles ?? DEFAULT_FORM_RESUME.profiles,
      education: parsed.formResume.education ?? DEFAULT_FORM_RESUME.education,
      work: parsed.formResume.work ?? DEFAULT_FORM_RESUME.work,
      projects: parsed.formResume.projects ?? DEFAULT_FORM_RESUME.projects,
      skills: parsed.formResume.skills ?? DEFAULT_FORM_RESUME.skills,
    }
  } catch (_error) {
    return DEFAULT_FORM_RESUME
  }
}

function readBackupFormResume(): FormResume | null {
  if (typeof window === 'undefined') {
    return null
  }

  const rawValue = window.localStorage.getItem(STORAGE_BACKUP_KEY)
  if (!rawValue) {
    return null
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<PersistedResumeBackup>
    if (parsed.version !== STORAGE_VERSION || !parsed.formResume) {
      return null
    }

    return parsed.formResume
  } catch (_error) {
    return null
  }
}

function backupFormResume(formResume: FormResume): void {
  if (typeof window === 'undefined') {
    return
  }

  const payload: PersistedResumeBackup = {
    version: STORAGE_VERSION,
    formResume,
    createdAt: new Date().toISOString(),
  }
  window.localStorage.setItem(STORAGE_BACKUP_KEY, JSON.stringify(payload))
}

function downloadTextFile(
  filename: string,
  content: string,
  mimeType: string
): void {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')

  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')

  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

class CompileError extends Error {
  code?: string

  constructor(message: string, code?: string) {
    super(message)
    this.name = 'CompileError'
    this.code = code
  }
}

async function readCompilePdfBlob(response: Response): Promise<Blob> {
  const contentType = response.headers.get('Content-Type') ?? ''

  if (!response.ok || contentType.includes('application/json')) {
    const payload = (await response.json().catch(() => null)) as {
      error?: string
      code?: string
    } | null

    throw new CompileError(payload?.error ?? 'PDF 编译失败', payload?.code)
  }

  return response.blob()
}

function printHtmlDocument(html: string): void {
  const printWindow = window.open('', '_blank')

  if (!printWindow) {
    window.print()
    return
  }

  printWindow.document.open()
  printWindow.document.write(html)
  printWindow.document.close()
  printWindow.focus()
  printWindow.print()
}

function dateRange(startDate: string, endDate: string): string {
  const start = startDate.trim()
  const end = endDate.trim()

  if (start && end) {
    return `${start} – ${end}`
  }
  if (start) {
    return `${start} – 至今`
  }
  return end
}

function hasText(value: string): boolean {
  return value.trim().length > 0
}

function validateEmail(value: string): string | undefined {
  const trimmed = value.trim()
  if (!trimmed) {
    return undefined
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)
    ? undefined
    : '邮箱格式不正确'
}

function validatePhone(value: string): string | undefined {
  const trimmed = value.trim()
  if (!trimmed) {
    return undefined
  }

  return /^[+\d][\d\s()-]{5,24}$/.test(trimmed) ? undefined : '手机号格式不正确'
}

function validateUrl(value: string): string | undefined {
  const trimmed = value.trim()
  if (!trimmed) {
    return undefined
  }

  try {
    const url = new URL(trimmed)
    return ['http:', 'https:'].includes(url.protocol)
      ? undefined
      : '链接需以 http:// 或 https:// 开头'
  } catch (_error) {
    return '链接格式不正确'
  }
}

function validateDate(value: string, required = false): string | undefined {
  const trimmed = value.trim()
  if (!trimmed) {
    return required ? '请填写开始时间' : undefined
  }

  return Number.isNaN(new Date(trimmed).getTime())
    ? '日期格式不正确，建议 2025-09'
    : undefined
}

function itemHasContent(...values: string[]): boolean {
  return values.some(hasText)
}

function collectValidationIssues(form: FormResume): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const addIssue = (
    section: SectionKey,
    field: string,
    message: string | undefined
  ) => {
    if (message) {
      issues.push({ section, field, message })
    }
  }

  addIssue('basics', '邮箱', validateEmail(form.basics.email))
  addIssue('basics', '手机', validatePhone(form.basics.phone))
  addIssue('basics', '作品链接', validateUrl(form.basics.url))

  for (const [index, item] of form.profiles.entries()) {
    addIssue('profiles', `链接 ${index + 1}`, validateUrl(item.url))
  }

  for (const [index, item] of form.education.entries()) {
    addIssue('education', `教育 ${index + 1} 学校链接`, validateUrl(item.url))
    addIssue(
      'education',
      `教育 ${index + 1} 入学时间`,
      validateDate(
        item.startDate,
        itemHasContent(
          item.institution,
          item.area,
          item.url,
          item.endDate,
          item.score,
          item.courses,
          item.summary
        )
      )
    )
    addIssue(
      'education',
      `教育 ${index + 1} 毕业时间`,
      validateDate(item.endDate)
    )
  }

  for (const [index, item] of form.work.entries()) {
    addIssue(
      'work',
      `实习 ${index + 1} 开始时间`,
      validateDate(
        item.startDate,
        itemHasContent(item.name, item.position, item.endDate, item.summary)
      )
    )
    addIssue('work', `实习 ${index + 1} 结束时间`, validateDate(item.endDate))
  }

  for (const [index, item] of form.projects.entries()) {
    addIssue('projects', `项目 ${index + 1} 链接`, validateUrl(item.url))
    addIssue(
      'projects',
      `项目 ${index + 1} 开始时间`,
      validateDate(
        item.startDate,
        itemHasContent(
          item.name,
          item.description,
          item.url,
          item.endDate,
          item.keywords,
          item.summary
        )
      )
    )
    addIssue(
      'projects',
      `项目 ${index + 1} 结束时间`,
      validateDate(item.endDate)
    )
  }

  return issues
}

function countIssuesBySection(
  issues: ValidationIssue[]
): Record<SectionKey, number> {
  const counts = Object.fromEntries(
    SECTION_KEYS.map((key) => [key, 0])
  ) as Record<SectionKey, number>

  for (const issue of issues) {
    counts[issue.section] += 1
  }

  return counts
}

function countCompleteSections(form: FormResume): number {
  const basicsComplete = [
    form.basics.name,
    form.basics.email,
    form.basics.phone,
    form.basics.summary,
  ].every(hasText)

  const completeSections: boolean[] = [
    basicsComplete,
    form.profiles.some((item) => itemHasContent(item.username, item.url)),
    form.education.some((item) =>
      itemHasContent(item.institution, item.area, item.startDate)
    ),
    form.work.some((item) =>
      itemHasContent(item.name, item.position, item.summary)
    ),
    form.projects.some((item) =>
      itemHasContent(item.name, item.description, item.summary)
    ),
    form.skills.some((item) => itemHasContent(item.name, item.keywords)),
  ]

  return completeSections.filter(Boolean).length
}

function summarizeFormResume(form: FormResume): {
  name: string
  sections: Array<{ label: string; value: number | string }>
} {
  return {
    name: form.basics.name.trim() || '未命名简历',
    sections: [
      { label: '链接', value: form.profiles.length },
      { label: '教育', value: form.education.length },
      { label: '实习', value: form.work.length },
      { label: '项目', value: form.projects.length },
      { label: '技能', value: form.skills.length },
      {
        label: '模板',
        value: LATEX_TEMPLATE_LABELS[form.template] ?? form.template,
      },
    ],
  }
}

function getPageQuality(frameHeight: number): {
  pageCount: number
  overagePercent: number
  status: 'ok' | 'warn'
  message: string
} {
  const pageCount = Math.max(1, Math.ceil(frameHeight / A4_PREVIEW_HEIGHT))
  const overagePercent = Math.max(
    0,
    Math.round(((frameHeight - A4_PREVIEW_HEIGHT) / A4_PREVIEW_HEIGHT) * 100)
  )

  if (pageCount <= 1) {
    return {
      pageCount,
      overagePercent,
      status: 'ok',
      message: '适合一页投递',
    }
  }

  return {
    pageCount,
    overagePercent,
    status: 'warn',
    message: `约 ${pageCount} 页，超出一页 ${overagePercent}%`,
  }
}

function getQualitySuggestions(
  form: FormResume,
  pageQuality: ReturnType<typeof getPageQuality>
): Array<{ section: SectionKey; title: string; detail: string }> {
  const suggestions: Array<{
    section: SectionKey
    title: string
    detail: string
  }> = []

  if (pageQuality.status === 'warn') {
    suggestions.push({
      section: 'projects',
      title: '压缩项目亮点',
      detail: '保留最强 2-3 个项目，每个项目控制 2-3 条结果。',
    })
    suggestions.push({
      section: 'skills',
      title: '合并技能分类',
      detail: '删除重复关键词，把弱相关技能合并到同一分类。',
    })
  }

  if (!form.work.length) {
    suggestions.push({
      section: 'projects',
      title: '用项目补足经历',
      detail: '没有实习时，把项目成果写得更像真实交付记录。',
    })
  }

  if (form.basics.summary.split('\n').filter(hasText).length > 5) {
    suggestions.push({
      section: 'basics',
      title: '精简个人简介',
      detail: '个人简介建议 3-5 条，避免和项目经历重复。',
    })
  }

  return suggestions.slice(0, 3)
}

function friendlyErrorMessage(message: string): string {
  const lower = message.toLowerCase()

  if (lower.includes('yaml') || lower.includes('parse')) {
    return 'YAML 格式有问题，请检查缩进、冒号和引号后再导入。'
  }
  if (lower.includes('startdate') || lower.includes('enddate')) {
    return '日期无法识别。建议使用 YYYY-MM，例如 2025-09；结束时间留空表示至今。'
  }
  if (lower.includes('url')) {
    return '链接格式有问题，请确认以 https:// 或 http:// 开头。'
  }
  if (lower.includes('email')) {
    return '邮箱格式有问题，请检查 @ 和域名。'
  }
  if (lower.includes('latex')) {
    return '当前环境缺少 LaTeX 编译能力，已保留 HTML 近似预览。'
  }
  if (lower.includes('failed to fetch') || lower.includes('network')) {
    return '编译服务暂时不可用，请稍后重试，或先导出 TeX/YAML。'
  }

  return message || '操作失败，请检查表单内容后重试。'
}

function friendlyCompileError(message: string): string {
  const lower = message.toLowerCase()

  if (lower.includes('failed to fetch') || lower.includes('network')) {
    return '编译服务暂时不可用，请稍后重试，或先导出 TeX/YAML。'
  }

  return message
    ? `PDF 编译失败：${message}`
    : 'PDF 编译失败，请检查内容后重试。'
}

function useDismiss<T extends HTMLElement>(
  active: boolean,
  onClose: () => void
) {
  const ref = useRef<T>(null)

  useEffect(() => {
    if (!active) {
      return undefined
    }

    const onPointer = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose()
      }
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)

    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [active, onClose])

  return ref
}

function Field({
  error,
  help,
  label,
  onChange,
  placeholder,
  required = false,
  type = 'text',
  value,
  wide = false,
}: {
  error?: string
  help?: string
  label: string
  onChange: (value: string) => void
  placeholder?: string
  required?: boolean
  type?: 'email' | 'tel' | 'text' | 'url'
  value: string
  wide?: boolean
}) {
  const [touched, setTouched] = useState(false)
  const [wasInvalid, setWasInvalid] = useState(false)

  useEffect(() => {
    if (error) {
      setWasInvalid(true)
    }
  }, [error])

  const showSuccess = touched && wasInvalid && !error && value.trim()
  const tone: FieldTone = error ? 'invalid' : showSuccess ? 'valid' : 'default'

  return (
    <label className={cx('field', wide && 'wide')}>
      <span className="field-label">
        {label}
        {required ? <span className="field-req"> *</span> : null}
      </span>
      <div className="input-wrapper">
        <input
          className={cx(
            'input',
            tone === 'invalid' && 'is-invalid',
            tone === 'valid' && 'is-valid'
          )}
          aria-invalid={tone === 'invalid'}
          type={type}
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          onBlur={() => setTouched(true)}
        />
        {showSuccess && <Check className="input-check" size={14} />}
      </div>
      {error ? (
        <span className="field-message is-error">{error}</span>
      ) : help ? (
        <span className="field-message">{help}</span>
      ) : null}
    </label>
  )
}

function TextArea({
  error,
  label,
  onChange,
  placeholder,
  rows = 4,
  value,
}: {
  error?: string
  label: string
  onChange: (value: string) => void
  placeholder?: string
  rows?: number
  value: string
}) {
  const tone: FieldTone = error ? 'invalid' : 'default'
  const lineCount = value
    .split('\n')
    .filter((line) => line.trim().length > 0).length

  const taRef = useRef<HTMLTextAreaElement>(null)
  const pendingCursor = useRef<{ start: number; end: number } | null>(null)

  const [modKey, setModKey] = useState('Ctrl+')
  useEffect(() => {
    if (/Macintosh|iPhone|iPad|iPod/.test(navigator.userAgent)) {
      setModKey('⌘')
    }
  }, [])
  const mdHint = `${modKey}B 加粗 · ${modKey}I 斜体 · ${modKey}K 链接 · - 列表`

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure textarea height whenever the value changes
  useEffect(() => {
    const el = taRef.current
    if (!el) {
      return
    }
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
    if (pendingCursor.current !== null) {
      el.selectionStart = pendingCursor.current.start
      el.selectionEnd = pendingCursor.current.end
      pendingCursor.current = null
    }
  }, [value])

  const wrapSelection = (
    el: HTMLTextAreaElement,
    marker: string,
    placeholderText: string
  ) => {
    const start = el.selectionStart
    const end = el.selectionEnd
    const selected = value.slice(start, end) || placeholderText
    const next =
      value.slice(0, start) + marker + selected + marker + value.slice(end)
    const innerStart = start + marker.length
    pendingCursor.current = {
      start: innerStart,
      end: innerStart + selected.length,
    }
    onChange(next)
  }

  const insertLink = (el: HTMLTextAreaElement) => {
    const start = el.selectionStart
    const end = el.selectionEnd
    const text = value.slice(start, end)
    const url = 'https://'
    const next = `${value.slice(0, start)}[${text}](${url})${value.slice(end)}`
    const caret =
      end > start ? start + 1 + text.length + 2 + url.length : start + 1
    pendingCursor.current = { start: caret, end: caret }
    onChange(next)
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.metaKey || event.ctrlKey) {
      const key = event.key.toLowerCase()
      if (key === 'b') {
        event.preventDefault()
        wrapSelection(event.currentTarget, '**', '加粗文字')
      } else if (key === 'i') {
        event.preventDefault()
        wrapSelection(event.currentTarget, '*', '斜体文字')
      } else if (key === 'k') {
        event.preventDefault()
        insertLink(event.currentTarget)
      }
      return
    }

    // Continue "- " / "* " bullets on Enter; exit the list on an empty bullet.
    if (event.key !== 'Enter' || event.shiftKey) {
      return
    }
    const el = event.currentTarget
    const start = el.selectionStart
    if (start !== el.selectionEnd) {
      return
    }
    const lineStart = value.lastIndexOf('\n', start - 1) + 1
    const match = value.slice(lineStart, start).match(/^(\s*)([-*]) (.*)$/)
    if (!match) {
      return
    }
    event.preventDefault()
    const [, indent, marker, content] = match
    if (content.trim() === '') {
      pendingCursor.current = { start: lineStart, end: lineStart }
      onChange(value.slice(0, lineStart) + value.slice(start))
      return
    }
    const insert = `\n${indent}${marker} `
    const caret = start + insert.length
    pendingCursor.current = { start: caret, end: caret }
    onChange(value.slice(0, start) + insert + value.slice(start))
  }

  return (
    <label className="field wide">
      <span className="field-label">{label}</span>
      <textarea
        ref={taRef}
        className={cx('textarea', tone === 'invalid' && 'is-invalid')}
        aria-invalid={tone === 'invalid'}
        value={value}
        placeholder={placeholder}
        rows={rows}
        onKeyDown={handleKeyDown}
        onChange={(event) => onChange(event.target.value)}
      />
      <span className="field-foot">
        {error ? (
          <span className="field-message is-error">{error}</span>
        ) : (
          <span className="field-message field-hint-md">{mdHint}</span>
        )}
        {lineCount > 0 ? (
          <span className="field-count">{lineCount} 行</span>
        ) : null}
      </span>
    </label>
  )
}

function DateField({
  label,
  onChange,
  required = false,
  value,
}: {
  label: string
  onChange: (value: string) => void
  required?: boolean
  value: string
}) {
  return (
    <Field
      label={label}
      value={value}
      placeholder="2025-09"
      help="建议 YYYY-MM；结束时间留空表示至今"
      required={required}
      error={validateDate(value, required)}
      onChange={onChange}
    />
  )
}

function Select({
  ariaLabel,
  onChange,
  options,
  size,
  value,
}: {
  ariaLabel: string
  onChange: (value: string) => void
  options: SelectOption[]
  size?: 'sm'
  value: string
}) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false))
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const current = options.find((option) => option.value === value)
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value)
  )

  useEffect(() => {
    if (!open) {
      return
    }

    optionRefs.current[activeIndex]?.focus()
  }, [activeIndex, open])

  const selectOption = (option: SelectOption) => {
    onChange(option.value)
    setOpen(false)
  }

  const moveActive = (direction: 1 | -1) => {
    setActiveIndex((currentIndex) => {
      const nextIndex = currentIndex + direction
      if (nextIndex < 0) {
        return options.length - 1
      }
      if (nextIndex >= options.length) {
        return 0
      }
      return nextIndex
    })
  }

  const handleTriggerKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>
  ) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex(selectedIndex)
      setOpen(true)
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      setActiveIndex(selectedIndex)
      setOpen((previous) => !previous)
    }
  }

  const handleOptionKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    option: SelectOption
  ) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        moveActive(1)
        break
      case 'ArrowUp':
        event.preventDefault()
        moveActive(-1)
        break
      case 'Home':
        event.preventDefault()
        setActiveIndex(0)
        break
      case 'End':
        event.preventDefault()
        setActiveIndex(options.length - 1)
        break
      case 'Enter':
      case ' ':
        event.preventDefault()
        selectOption(option)
        break
      case 'Tab':
        setOpen(false)
        break
    }
  }

  return (
    <div
      ref={ref}
      className={cx('select', size === 'sm' && 'select-sm', open && 'is-open')}
    >
      <button
        type="button"
        className="select-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          setActiveIndex(selectedIndex)
          setOpen((previous) => !previous)
        }}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className="select-value">{current?.label ?? value}</span>
        <ChevronDown className="chev" size={15} />
      </button>
      {open ? (
        // biome-ignore lint/a11y/useSemanticElements: custom-styled listbox; native <select> cannot be styled to match the design system
        <div className="select-pop" role="listbox">
          {options.map((option, index) => (
            // biome-ignore lint/a11y/useSemanticElements: custom-styled option inside the listbox above
            <button
              key={option.value}
              ref={(element) => {
                optionRefs.current[index] = element
              }}
              type="button"
              role="option"
              aria-selected={option.value === value}
              className={cx(
                'select-opt',
                option.value === value && 'is-selected'
              )}
              onClick={() => {
                selectOption(option)
              }}
              onFocus={() => setActiveIndex(index)}
              onKeyDown={(event) => handleOptionKeyDown(event, option)}
            >
              <span>{option.label}</span>
              {option.value === value ? (
                <Check className="check" size={15} />
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function SelectField({
  ariaLabel,
  label,
  onChange,
  options,
  value,
}: {
  ariaLabel: string
  label: string
  onChange: (value: string) => void
  options: SelectOption[]
  value: string
}) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <Select
        ariaLabel={ariaLabel}
        value={value}
        options={options}
        onChange={onChange}
      />
    </div>
  )
}

function TemplatePicker({
  onChange,
  value,
}: {
  onChange: (value: FormResume['template']) => void
  value: FormResume['template']
}) {
  const [open, setOpen] = useState(false)
  const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false))
  const current = LATEX_TEMPLATE_LABELS[value] ?? value

  return (
    <div ref={ref} className={cx('template-picker', open && 'is-open')}>
      <button
        type="button"
        className="template-trigger"
        aria-label="选择 PDF 模板"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((previous) => !previous)}
      >
        <FileText size={14} />
        <span>{current}</span>
        <ChevronDown className="chev" size={14} />
      </button>
      {open ? (
        <div className="template-pop" role="dialog" aria-label="PDF 模板选择">
          <div className="template-pop-head">
            <span>PDF 模板</span>
            <strong>{current}</strong>
          </div>
          <div className="template-list">
            {LATEX_TEMPLATES.map((template) => {
              const active = template === value
              const details = TEMPLATE_DETAILS[template]

              return (
                <button
                  key={template}
                  type="button"
                  className={cx('template-card', active && 'is-active')}
                  aria-pressed={active}
                  onClick={() => {
                    onChange(template)
                    setOpen(false)
                  }}
                >
                  <span className="template-thumb" data-template={template}>
                    <span />
                    <span />
                    <span />
                  </span>
                  <span className="template-card-copy">
                    <span className="template-card-title">
                      {LATEX_TEMPLATE_LABELS[template]}
                    </span>
                    <span className="template-card-desc">
                      {details.description}
                    </span>
                    <span className="template-card-fit">{details.fit}</span>
                  </span>
                  {active ? <Check size={15} /> : null}
                </button>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}

type MenuEntry =
  | { kind: 'sep'; key: string }
  | {
      kind: 'item'
      key: string
      label: string
      icon: ReactNode
      danger?: boolean
      onClick: () => void
    }

function Menu({ entries }: { entries: MenuEntry[] }) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false))
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const actionableEntries = entries.filter((entry) => entry.kind === 'item')

  useEffect(() => {
    if (!open) {
      return
    }

    itemRefs.current[activeIndex]?.focus()
  }, [activeIndex, open])

  const moveActive = (direction: 1 | -1) => {
    setActiveIndex((currentIndex) => {
      const nextIndex = currentIndex + direction
      if (nextIndex < 0) {
        return actionableEntries.length - 1
      }
      if (nextIndex >= actionableEntries.length) {
        return 0
      }
      return nextIndex
    })
  }

  const handleTriggerKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>
  ) => {
    if (
      event.key === 'ArrowDown' ||
      event.key === 'Enter' ||
      event.key === ' '
    ) {
      event.preventDefault()
      setActiveIndex(0)
      setOpen(true)
    }
  }

  const handleItemKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    index: number
  ) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        moveActive(1)
        break
      case 'ArrowUp':
        event.preventDefault()
        moveActive(-1)
        break
      case 'Home':
        event.preventDefault()
        setActiveIndex(0)
        break
      case 'End':
        event.preventDefault()
        setActiveIndex(actionableEntries.length - 1)
        break
      case 'Tab':
        setOpen(false)
        break
      default:
        setActiveIndex(index)
    }
  }

  return (
    <div ref={ref} className="menu">
      <button
        type="button"
        className="icon-btn"
        aria-label="更多操作"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setActiveIndex(0)
          setOpen((previous) => !previous)
        }}
        onKeyDown={handleTriggerKeyDown}
      >
        <MoreHorizontal size={18} />
      </button>
      {open ? (
        <div className="menu-pop" role="menu">
          {entries.map((entry) => {
            if (entry.kind === 'sep') {
              return <div key={entry.key} className="menu-sep" />
            }

            const itemIndex = actionableEntries.findIndex(
              (item) => item.key === entry.key
            )

            return (
              <button
                key={entry.key}
                ref={(element) => {
                  itemRefs.current[itemIndex] = element
                }}
                type="button"
                role="menuitem"
                className={cx('menu-item', entry.danger && 'is-danger')}
                onClick={() => {
                  setOpen(false)
                  entry.onClick()
                }}
                onFocus={() => setActiveIndex(itemIndex)}
                onKeyDown={(event) => handleItemKeyDown(event, itemIndex)}
              >
                {entry.icon}
                <span>{entry.label}</span>
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

function CollapsibleCard({
  children,
  index,
  isOpen,
  moveDownDisabled = false,
  moveUpDisabled = false,
  onMoveDown,
  onMoveUp,
  onRemove,
  onToggle,
  moveDownLabel,
  moveUpLabel,
  removeLabel,
  subtitle,
  title,
}: {
  children: ReactNode
  index?: number
  isOpen: boolean
  moveDownDisabled?: boolean
  moveUpDisabled?: boolean
  onMoveDown?: () => void
  onMoveUp?: () => void
  moveDownLabel?: string
  moveUpLabel?: string
  onRemove: () => void
  onToggle: () => void
  removeLabel: string
  subtitle?: string
  title: string
}) {
  return (
    <article className={cx('card', isOpen && 'is-open')}>
      <div className="card-head">
        <button
          type="button"
          className="card-toggle"
          aria-expanded={isOpen}
          onClick={onToggle}
        >
          <ChevronRight className="card-chev" size={16} />
          {typeof index === 'number' ? (
            <span className="card-index">{index}</span>
          ) : null}
          <span className="card-titles">
            <span className={cx('card-title', !title && 'is-empty')}>
              {title || '未填写'}
            </span>
            {subtitle ? <span className="card-sub">{subtitle}</span> : null}
          </span>
        </button>
        <div className="card-actions">
          {onMoveUp ? (
            <button
              type="button"
              className="icon-btn"
              aria-label={moveUpLabel}
              title={moveUpLabel}
              disabled={moveUpDisabled}
              onClick={onMoveUp}
            >
              <ArrowUp size={14} />
            </button>
          ) : null}
          {onMoveDown ? (
            <button
              type="button"
              className="icon-btn"
              aria-label={moveDownLabel}
              title={moveDownLabel}
              disabled={moveDownDisabled}
              onClick={onMoveDown}
            >
              <ArrowDown size={14} />
            </button>
          ) : null}
          <button
            type="button"
            className="icon-btn is-danger"
            aria-label={removeLabel}
            title={removeLabel}
            onClick={onRemove}
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>
      {isOpen ? <div className="card-body">{children}</div> : null}
    </article>
  )
}

function FormSkeleton() {
  return (
    <div className="form-body">
      <div className="skeleton-fields">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="skeleton-field">
            <div className="skeleton-label" />
            <div className="skeleton-input" />
          </div>
        ))}
      </div>
    </div>
  )
}

function EmptySection({
  actionLabel,
  description,
  icon: Icon,
  onAction,
  title,
}: {
  actionLabel: string
  description: string
  icon?: typeof Plus
  onAction: () => void
  title: string
}) {
  return (
    <div className="empty-state">
      {Icon && (
        <div className="empty-icon">
          <Icon size={32} />
        </div>
      )}
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      <button type="button" className="btn btn-solid" onClick={onAction}>
        <Plus size={15} />
        {actionLabel}
      </button>
    </div>
  )
}

function ConfirmDialog({
  state,
  onCancel,
}: {
  state: ConfirmDialogState
  onCancel: () => void
}) {
  const cancelButtonRef = useRef<HTMLButtonElement>(null)
  const confirmButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    cancelButtonRef.current?.focus()
  }, [])

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onCancel()
      return
    }

    if (event.key !== 'Tab') {
      return
    }

    const focusable = [
      cancelButtonRef.current,
      confirmButtonRef.current,
    ].filter(Boolean) as HTMLButtonElement[]
    const currentIndex = focusable.findIndex(
      (element) => element === document.activeElement
    )

    if (event.shiftKey && currentIndex <= 0) {
      event.preventDefault()
      focusable.at(-1)?.focus()
      return
    }
    if (!event.shiftKey && currentIndex === focusable.length - 1) {
      event.preventDefault()
      focusable[0]?.focus()
    }
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop needs click/Escape handling while the alertdialog keeps semantic focus.
    <div
      className="dialog-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onCancel()
        }
      }}
      onKeyDown={handleKeyDown}
    >
      <div
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-description"
      >
        <div className="dialog-icon">
          <AlertTriangle size={18} />
        </div>
        <div className="dialog-copy">
          <h2 id="confirm-title">{state.title}</h2>
          <p id="confirm-description">{state.description}</p>
        </div>
        <div className="dialog-actions">
          <button
            ref={cancelButtonRef}
            type="button"
            className="btn"
            onClick={onCancel}
          >
            取消
          </button>
          <button
            ref={confirmButtonRef}
            type="button"
            className={cx('btn', state.danger ? 'btn-danger' : 'btn-solid')}
            onClick={() => {
              state.onConfirm()
              onCancel()
            }}
          >
            {state.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

function ImportPreviewDialog({
  pendingImport,
  onApply,
  onCancel,
}: {
  pendingImport: PendingImportState
  onApply: () => void
  onCancel: () => void
}) {
  const summary = summarizeFormResume(pendingImport.formResume)
  const issues = collectValidationIssues(pendingImport.formResume)
  const completeCount = countCompleteSections(pendingImport.formResume)
  const completePercent = Math.round((completeCount / SECTIONS.length) * 100)

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop click only dismisses the modal; the dialog itself is semantic.
    <div
      className="dialog-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onCancel()
        }
      }}
    >
      <div
        className="dialog import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-title"
        aria-describedby="import-description"
      >
        <div className="dialog-icon">
          <Upload size={18} />
        </div>
        <div className="dialog-copy">
          <h2 id="import-title">确认导入 YAML？</h2>
          <p id="import-description">
            已解析 {pendingImport.filename}
            。确认后会覆盖当前表单，并自动保存覆盖前备份。
          </p>
        </div>
        <div className="import-summary">
          <div className="import-name">
            <span>简历</span>
            <strong>{summary.name}</strong>
          </div>
          <div className="import-stats">
            {summary.sections.map((item) => (
              <span key={item.label}>
                <strong>{item.value}</strong>
                {item.label}
              </span>
            ))}
          </div>
          <div className="import-health">
            <span>完整度 {completePercent}%</span>
            <span className={cx(issues.length > 0 && 'is-issue')}>
              {issues.length > 0
                ? `${issues.length} 项需检查`
                : '无明显格式问题'}
            </span>
          </div>
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onCancel}>
            取消
          </button>
          <button type="button" className="btn btn-solid" onClick={onApply}>
            应用导入
          </button>
        </div>
      </div>
    </div>
  )
}

function PreviewQuality({
  completePercent,
  issueCount,
  onSelectSuggestion,
  pageQuality,
  suggestions,
}: {
  completePercent: number
  issueCount: number
  onSelectSuggestion: (section: SectionKey) => void
  pageQuality: ReturnType<typeof getPageQuality>
  suggestions: Array<{ section: SectionKey; title: string; detail: string }>
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className={cx('quality-panel', expanded && 'is-expanded')}>
      <button
        type="button"
        className="quality-toggle"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
      >
        <span className="quality-summary">
          <span>投递检查</span>
          <strong className={cx(pageQuality.status === 'warn' && 'is-warn')}>
            完成度 {completePercent}%
            {issueCount > 0 && ` · ${issueCount} 项问题`}
          </strong>
        </span>
        <ChevronDown
          className={cx('quality-chevron', expanded && 'is-open')}
          size={16}
        />
      </button>
      {expanded && (
        <div className="quality-body">
          <div className="quality-grid">
            <div>
              <span>页数</span>
              <strong>{pageQuality.pageCount}</strong>
            </div>
            <div>
              <span>完整度</span>
              <strong>{completePercent}%</strong>
            </div>
            <div>
              <span>格式问题</span>
              <strong className={cx(issueCount > 0 && 'is-danger')}>
                {issueCount}
              </strong>
            </div>
          </div>
          {pageQuality.status === 'warn' ? (
            <p>
              校招简历通常优先控制在一页。建议压缩项目亮点、合并重复技能，或暂时隐藏弱相关经历。
            </p>
          ) : null}
          {suggestions.length > 0 ? (
            <div className="quality-actions">
              {suggestions.map((suggestion) => (
                <button
                  key={`${suggestion.section}-${suggestion.title}`}
                  type="button"
                  onClick={() => onSelectSuggestion(suggestion.section)}
                >
                  <span>{suggestion.title}</span>
                  <small>{suggestion.detail}</small>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}

function FieldGroup({
  title,
  children,
}: {
  title?: string
  children: ReactNode
}) {
  return (
    <div className="field-group">
      {title ? <span className="field-group-title">{title}</span> : null}
      <div className="fields">{children}</div>
    </div>
  )
}

function BasicsForm({
  basics,
  location,
  onBasicsChange,
  onLocationChange,
}: {
  basics: FormBasics
  location: FormLocation
  onBasicsChange: (basics: FormBasics) => void
  onLocationChange: (location: FormLocation) => void
}) {
  const updateBasics = (key: keyof FormBasics, value: string) =>
    onBasicsChange({ ...basics, [key]: value })
  const updateLocation = (key: keyof FormLocation, value: string) =>
    onLocationChange({ ...location, [key]: value } as FormLocation)

  return (
    <div className="field-groups">
      <FieldGroup title="基本信息">
        <Field
          label="姓名"
          value={basics.name}
          placeholder="张三"
          onChange={(value) => updateBasics('name', value)}
        />
        <Field
          label="求职方向"
          value={basics.headline}
          placeholder="AI 应用开发工程师"
          onChange={(value) => updateBasics('headline', value)}
        />
      </FieldGroup>
      <FieldGroup title="联系方式">
        <Field
          label="邮箱"
          type="email"
          value={basics.email}
          placeholder="name@example.com"
          error={validateEmail(basics.email)}
          onChange={(value) => updateBasics('email', value)}
        />
        <Field
          label="手机"
          type="tel"
          value={basics.phone}
          placeholder="13800000000"
          error={validatePhone(basics.phone)}
          onChange={(value) => updateBasics('phone', value)}
        />
        <Field
          label="作品 / 主页链接"
          type="url"
          value={basics.url}
          placeholder="https://example.com"
          wide
          error={validateUrl(basics.url)}
          onChange={(value) => updateBasics('url', value)}
        />
      </FieldGroup>
      <FieldGroup title="所在地">
        <Field
          label="城市"
          value={location.city}
          placeholder="西安"
          onChange={(value) => updateLocation('city', value)}
        />
        <Field
          label="省份"
          value={location.region}
          placeholder="陕西"
          onChange={(value) => updateLocation('region', value)}
        />
      </FieldGroup>
      <FieldGroup title="个人简介">
        <TextArea
          label="个人简介"
          value={basics.summary}
          rows={6}
          placeholder={
            '建议 3-5 条，每行以 - 开头：\n- 主导支付系统重构，QPS 提升 *3 倍*\n- 负责 **核心 API** 设计与落地'
          }
          onChange={(value) => updateBasics('summary', value)}
        />
      </FieldGroup>
    </div>
  )
}

function ProfilesForm({
  items,
  onChange,
  openCard,
  onToggle,
}: {
  items: FormProfile[]
  onChange: (items: FormProfile[]) => void
  openCard: string | null
  onToggle: (id: string) => void
}) {
  const updateItem = (
    id: string,
    updater: (item: FormProfile) => FormProfile
  ) => onChange(items.map((item) => (item.id === id ? updater(item) : item)))

  return (
    <div className="cards">
      {items.length === 0 ? (
        <div className="empty-state">
          <p>还没有添加社交链接</p>
          <p className="empty-hint">点击右上角「新增」按钮添加第一条</p>
        </div>
      ) : null}
      {items.map((item, index) => (
        <CollapsibleCard
          key={item.id}
          index={index + 1}
          title={item.username || item.network}
          subtitle={item.network}
          isOpen={openCard === item.id}
          onToggle={() => onToggle(item.id)}
          moveUpLabel="上移链接"
          moveDownLabel="下移链接"
          moveUpDisabled={index === 0}
          moveDownDisabled={index === items.length - 1}
          onMoveUp={() => onChange(moveItem(items, item.id, -1))}
          onMoveDown={() => onChange(moveItem(items, item.id, 1))}
          removeLabel="删除链接"
          onRemove={() =>
            onChange(items.filter((current) => current.id !== item.id))
          }
        >
          <div className="fields">
            <SelectField
              label="平台"
              ariaLabel="平台"
              value={item.network}
              options={NETWORK_OPTIONS}
              onChange={(value) =>
                updateItem(item.id, (current) => ({
                  ...current,
                  network: value as FormProfile['network'],
                }))
              }
            />
            <Field
              label="用户名"
              value={item.username}
              placeholder="example"
              onChange={(value) =>
                updateItem(item.id, (current) => ({
                  ...current,
                  username: value,
                }))
              }
            />
            <Field
              label="链接"
              type="url"
              value={item.url}
              placeholder="https://github.com/example"
              wide
              error={validateUrl(item.url)}
              onChange={(value) =>
                updateItem(item.id, (current) => ({ ...current, url: value }))
              }
            />
          </div>
        </CollapsibleCard>
      ))}
    </div>
  )
}

function EducationForm({
  items,
  onChange,
  openCard,
  onToggle,
}: {
  items: FormEducation[]
  onChange: (items: FormEducation[]) => void
  openCard: string | null
  onToggle: (id: string) => void
}) {
  const updateItem = (
    id: string,
    updater: (item: FormEducation) => FormEducation
  ) => onChange(items.map((item) => (item.id === id ? updater(item) : item)))

  return (
    <div className="cards">
      {items.length === 0 ? (
        <div className="empty-state">
          <p>还没有添加教育经历</p>
          <p className="empty-hint">点击右上角「新增」按钮添加第一条</p>
        </div>
      ) : null}
      {items.map((item, index) => (
        <CollapsibleCard
          key={item.id}
          index={index + 1}
          title={item.institution}
          subtitle={item.area || dateRange(item.startDate, item.endDate)}
          isOpen={openCard === item.id}
          onToggle={() => onToggle(item.id)}
          moveUpLabel="上移教育经历"
          moveDownLabel="下移教育经历"
          moveUpDisabled={index === 0}
          moveDownDisabled={index === items.length - 1}
          onMoveUp={() => onChange(moveItem(items, item.id, -1))}
          onMoveDown={() => onChange(moveItem(items, item.id, 1))}
          removeLabel="删除教育经历"
          onRemove={() =>
            onChange(items.filter((current) => current.id !== item.id))
          }
        >
          <div className="fields">
            <Field
              label="学校"
              value={item.institution}
              placeholder="西安电子科技大学"
              onChange={(value) =>
                updateItem(item.id, (current) => ({
                  ...current,
                  institution: value,
                }))
              }
            />
            <Field
              label="专业"
              value={item.area}
              placeholder="计算机科学与技术"
              onChange={(value) =>
                updateItem(item.id, (current) => ({ ...current, area: value }))
              }
            />
            <SelectField
              label="学历"
              ariaLabel="学历"
              value={item.degree}
              options={DEGREE_OPTIONS}
              onChange={(value) =>
                updateItem(item.id, (current) => ({
                  ...current,
                  degree: value as FormEducation['degree'],
                }))
              }
            />
            <Field
              label="学校链接"
              type="url"
              value={item.url}
              placeholder="https://www.xidian.edu.cn"
              error={validateUrl(item.url)}
              onChange={(value) =>
                updateItem(item.id, (current) => ({ ...current, url: value }))
              }
            />
            <DateField
              label="入学时间"
              value={item.startDate}
              required={itemHasContent(
                item.institution,
                item.area,
                item.url,
                item.endDate,
                item.score,
                item.courses,
                item.summary
              )}
              onChange={(value) =>
                updateItem(item.id, (current) => ({
                  ...current,
                  startDate: value,
                }))
              }
            />
            <DateField
              label="毕业时间"
              value={item.endDate}
              onChange={(value) =>
                updateItem(item.id, (current) => ({
                  ...current,
                  endDate: value,
                }))
              }
            />
            <Field
              label="课程（逗号分隔）"
              value={item.courses}
              placeholder="深度学习, 机器学习"
              onChange={(value) =>
                updateItem(item.id, (current) => ({
                  ...current,
                  courses: value,
                }))
              }
            />
            <Field
              label="成绩"
              value={item.score}
              placeholder="3.8 / 4.0"
              onChange={(value) =>
                updateItem(item.id, (current) => ({ ...current, score: value }))
              }
            />
            <TextArea
              label="补充说明"
              value={item.summary}
              rows={3}
              placeholder={'- 获校级一等奖学金\n- ACM 区域赛银奖'}
              onChange={(value) =>
                updateItem(item.id, (current) => ({
                  ...current,
                  summary: value,
                }))
              }
            />
          </div>
        </CollapsibleCard>
      ))}
    </div>
  )
}

function WorkForm({
  items,
  onChange,
  openCard,
  onToggle,
}: {
  items: FormWork[]
  onChange: (items: FormWork[]) => void
  openCard: string | null
  onToggle: (id: string) => void
}) {
  const updateItem = (id: string, updater: (item: FormWork) => FormWork) =>
    onChange(items.map((item) => (item.id === id ? updater(item) : item)))

  return (
    <div className="cards">
      {items.length === 0 ? (
        <div className="empty-state">
          <p>还没有添加实习经历</p>
          <p className="empty-hint">点击右上角「新增」按钮添加第一条</p>
        </div>
      ) : null}
      {items.map((item, index) => (
        <CollapsibleCard
          key={item.id}
          index={index + 1}
          title={item.name}
          subtitle={item.position}
          isOpen={openCard === item.id}
          onToggle={() => onToggle(item.id)}
          moveUpLabel="上移经历"
          moveDownLabel="下移经历"
          moveUpDisabled={index === 0}
          moveDownDisabled={index === items.length - 1}
          onMoveUp={() => onChange(moveItem(items, item.id, -1))}
          onMoveDown={() => onChange(moveItem(items, item.id, 1))}
          removeLabel="删除经历"
          onRemove={() =>
            onChange(items.filter((current) => current.id !== item.id))
          }
        >
          <div className="fields">
            <Field
              label="单位"
              value={item.name}
              placeholder="字节跳动"
              onChange={(value) =>
                updateItem(item.id, (current) => ({ ...current, name: value }))
              }
            />
            <Field
              label="岗位 / 角色"
              value={item.position}
              placeholder="后端开发工程师"
              onChange={(value) =>
                updateItem(item.id, (current) => ({
                  ...current,
                  position: value,
                }))
              }
            />
            <DateField
              label="开始时间"
              value={item.startDate}
              required={itemHasContent(
                item.name,
                item.position,
                item.endDate,
                item.summary
              )}
              onChange={(value) =>
                updateItem(item.id, (current) => ({
                  ...current,
                  startDate: value,
                }))
              }
            />
            <DateField
              label="结束时间"
              value={item.endDate}
              onChange={(value) =>
                updateItem(item.id, (current) => ({
                  ...current,
                  endDate: value,
                }))
              }
            />
            <TextArea
              label="职责与成果"
              value={item.summary}
              rows={5}
              placeholder={
                '- 主导 **支付系统** 重构，QPS 提升 *3 倍*\n- 负责核心 API 设计与团队 code review'
              }
              onChange={(value) =>
                updateItem(item.id, (current) => ({
                  ...current,
                  summary: value,
                }))
              }
            />
          </div>
        </CollapsibleCard>
      ))}
    </div>
  )
}

function ProjectForm({
  items,
  onChange,
  openCard,
  onToggle,
}: {
  items: FormProject[]
  onChange: (items: FormProject[]) => void
  openCard: string | null
  onToggle: (id: string) => void
}) {
  const updateItem = (
    id: string,
    updater: (item: FormProject) => FormProject
  ) => onChange(items.map((item) => (item.id === id ? updater(item) : item)))

  return (
    <div className="cards">
      {items.length === 0 ? (
        <div className="empty-state">
          <p>还没有添加项目经历</p>
          <p className="empty-hint">点击右上角「新增」按钮添加第一条</p>
        </div>
      ) : null}
      {items.map((item, index) => (
        <CollapsibleCard
          key={item.id}
          index={index + 1}
          title={item.name}
          subtitle={item.description}
          isOpen={openCard === item.id}
          onToggle={() => onToggle(item.id)}
          moveUpLabel="上移项目"
          moveDownLabel="下移项目"
          moveUpDisabled={index === 0}
          moveDownDisabled={index === items.length - 1}
          onMoveUp={() => onChange(moveItem(items, item.id, -1))}
          onMoveDown={() => onChange(moveItem(items, item.id, 1))}
          removeLabel="删除项目"
          onRemove={() =>
            onChange(items.filter((current) => current.id !== item.id))
          }
        >
          <div className="fields">
            <Field
              label="项目名称"
              value={item.name}
              placeholder="智能简历生成器"
              wide
              onChange={(value) =>
                updateItem(item.id, (current) => ({ ...current, name: value }))
              }
            />
            <Field
              label="一句话描述"
              value={item.description}
              placeholder="基于 LLM 的简历自动优化工具"
              wide
              onChange={(value) =>
                updateItem(item.id, (current) => ({
                  ...current,
                  description: value,
                }))
              }
            />
            <DateField
              label="开始时间"
              value={item.startDate}
              required={itemHasContent(
                item.name,
                item.description,
                item.url,
                item.endDate,
                item.keywords,
                item.summary
              )}
              onChange={(value) =>
                updateItem(item.id, (current) => ({
                  ...current,
                  startDate: value,
                }))
              }
            />
            <DateField
              label="结束时间"
              value={item.endDate}
              onChange={(value) =>
                updateItem(item.id, (current) => ({
                  ...current,
                  endDate: value,
                }))
              }
            />
            <Field
              label="项目链接"
              type="url"
              value={item.url}
              placeholder="https://github.com/example/project"
              wide
              error={validateUrl(item.url)}
              onChange={(value) =>
                updateItem(item.id, (current) => ({ ...current, url: value }))
              }
            />
            <Field
              label="技术栈（逗号分隔）"
              value={item.keywords}
              placeholder="React, TypeScript, Node.js"
              wide
              onChange={(value) =>
                updateItem(item.id, (current) => ({
                  ...current,
                  keywords: value,
                }))
              }
            />
            <TextArea
              label="项目亮点"
              value={item.summary}
              rows={5}
              placeholder={
                '- 实现简历 AST 编译流水线，**日活** 提升 *40%*\n- 开源至 GitHub，获 1k+ star'
              }
              onChange={(value) =>
                updateItem(item.id, (current) => ({
                  ...current,
                  summary: value,
                }))
              }
            />
          </div>
        </CollapsibleCard>
      ))}
    </div>
  )
}

function SkillsForm({
  items,
  onChange,
  openCard,
  onToggle,
}: {
  items: FormSkill[]
  onChange: (items: FormSkill[]) => void
  openCard: string | null
  onToggle: (id: string) => void
}) {
  const updateItem = (id: string, updater: (item: FormSkill) => FormSkill) =>
    onChange(items.map((item) => (item.id === id ? updater(item) : item)))

  return (
    <div className="cards">
      {items.map((item, index) => (
        <CollapsibleCard
          key={item.id}
          index={index + 1}
          title={item.name}
          isOpen={openCard === item.id}
          onToggle={() => onToggle(item.id)}
          moveUpLabel="上移技能"
          moveDownLabel="下移技能"
          moveUpDisabled={index === 0}
          moveDownDisabled={index === items.length - 1}
          onMoveUp={() => onChange(moveItem(items, item.id, -1))}
          onMoveDown={() => onChange(moveItem(items, item.id, 1))}
          removeLabel="删除技能"
          onRemove={() =>
            onChange(items.filter((current) => current.id !== item.id))
          }
        >
          <div className="fields">
            <Field
              label="技能分类"
              value={item.name}
              placeholder="编程语言"
              onChange={(value) =>
                updateItem(item.id, (current) => ({ ...current, name: value }))
              }
            />
            <SelectField
              label="熟练度"
              ariaLabel="熟练度"
              value={item.level}
              options={LEVEL_OPTIONS}
              onChange={(value) =>
                updateItem(item.id, (current) => ({
                  ...current,
                  level: value as FormSkill['level'],
                }))
              }
            />
            <Field
              label="关键词（逗号分隔）"
              value={item.keywords}
              placeholder="React, TypeScript, Git"
              wide
              onChange={(value) =>
                updateItem(item.id, (current) => ({
                  ...current,
                  keywords: value,
                }))
              }
            />
          </div>
        </CollapsibleCard>
      ))}
    </div>
  )
}

export function ResumeBuilder() {
  const importInputRef = useRef<HTMLInputElement>(null)
  const frameRef = useRef<HTMLIFrameElement>(null)

  const [formResume, setFormResume] = useState<FormResume>(DEFAULT_FORM_RESUME)
  const [hasLoadedStorage, setHasLoadedStorage] = useState(false)
  const [saveIndicator, setSaveIndicator] = useState<
    'idle' | 'saving' | 'saved'
  >('idle')
  const [activeSection, setActiveSection] = useState<SectionKey>('basics')
  const [openCard, setOpenCard] = useState<string | null>(null)
  const [compileState, setCompileState] = useState<CompileState>('idle')
  const [compileMessage, setCompileMessage] = useState('')
  const [mobileView, setMobileView] = useState<MobileView>('form')
  const [showSource, setShowSource] = useState(false)
  const [previewZoom, setPreviewZoom] = useState(100)
  const [frameHeight, setFrameHeight] = useState(1040)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [pdfStatus, setPdfStatus] = useState<PdfStatus>('idle')
  const [pdfError, setPdfError] = useState('')
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(
    null
  )
  const [pendingImport, setPendingImport] = useState<PendingImportState | null>(
    null
  )
  const [hasBackup, setHasBackup] = useState(false)

  useEffect(() => {
    setFormResume(readStoredFormResume())
    setHasBackup(Boolean(readBackupFormResume()))
    setHasLoadedStorage(true)
  }, [])

  useEffect(() => {
    if (!hasLoadedStorage) {
      return undefined
    }

    setSaveIndicator('saving')
    const timer = setTimeout(() => {
      const payload: PersistedResumeState = {
        version: STORAGE_VERSION,
        formResume,
      }
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
      setSaveIndicator('saved')

      setTimeout(() => setSaveIndicator('idle'), 1200)
    }, 600)

    return () => clearTimeout(timer)
  }, [formResume, hasLoadedStorage])

  const latexResume = useMemo(() => buildResume(formResume), [formResume])
  const htmlResume = useMemo(() => buildHtmlResume(formResume), [formResume])

  const latex = useMemo(() => {
    try {
      return renderResumeToLatex(latexResume)
    } catch (error) {
      return `% 渲染失败：${error instanceof Error ? error.message : String(error)}`
    }
  }, [latexResume])

  const html = useMemo(() => {
    try {
      return renderResumeToHtml(htmlResume)
    } catch (error) {
      return `<p>渲染失败：${error instanceof Error ? error.message : String(error)}</p>`
    }
  }, [htmlResume])

  const yaml = useMemo(() => serializeResumeToYaml(latexResume), [latexResume])
  const validationIssues = useMemo(
    () => collectValidationIssues(formResume),
    [formResume]
  )
  const validationIssueCount = validationIssues.length
  const issueCountsBySection = useMemo(
    () => countIssuesBySection(validationIssues),
    [validationIssues]
  )
  const activeSectionIssues = validationIssues.filter(
    (issue) => issue.section === activeSection
  )
  const completeSectionCount = useMemo(
    () => countCompleteSections(formResume),
    [formResume]
  )
  const resumeHealthPercent = Math.round(
    (completeSectionCount / SECTIONS.length) * 100
  )
  const pageQuality = useMemo(() => getPageQuality(frameHeight), [frameHeight])
  const qualitySuggestions = useMemo(
    () => getQualitySuggestions(formResume, pageQuality),
    [formResume, pageQuality]
  )

  const [previewHtml, setPreviewHtml] = useState(html)

  useEffect(() => {
    const timer = setTimeout(() => setPreviewHtml(html), PREVIEW_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [html])

  const syncFrameHeight = useCallback(() => {
    const doc = frameRef.current?.contentDocument
    if (!doc) {
      return
    }

    const height = Math.max(
      doc.documentElement?.scrollHeight ?? 0,
      doc.body?.scrollHeight ?? 0
    )
    if (height > 0) {
      setFrameHeight(height)
    }
  }, [])

  useEffect(() => {
    syncFrameHeight()
    window.addEventListener('resize', syncFrameHeight)
    return () => window.removeEventListener('resize', syncFrameHeight)
  }, [syncFrameHeight])

  useEffect(() => {
    if (showSource || validationIssueCount > 0) {
      if (validationIssueCount > 0) {
        setPdfStatus('idle')
        setPdfError('')
      }
      return undefined
    }

    const controller = new AbortController()
    let active = true

    const timer = setTimeout(async () => {
      setPdfStatus('compiling')
      try {
        const response = await fetch('/api/compile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ latex, filename: 'resume' }),
          signal: controller.signal,
        })

        const blob = await readCompilePdfBlob(response)
        if (!active) {
          return
        }
        const nextUrl = URL.createObjectURL(blob)
        setPdfUrl((previous) => {
          if (previous) {
            URL.revokeObjectURL(previous)
          }
          return nextUrl
        })
        setPdfStatus('ready')
      } catch (error) {
        if (!active || controller.signal.aborted) {
          return
        }
        if (
          error instanceof CompileError &&
          error.code === 'compiler-unavailable'
        ) {
          setPdfStatus('unavailable')
          setPdfError('')
          return
        }
        const message = error instanceof Error ? error.message : String(error)
        setPdfStatus('error')
        setPdfError(friendlyCompileError(message))
      }
    }, PDF_DEBOUNCE_MS)

    return () => {
      active = false
      controller.abort()
      clearTimeout(timer)
    }
  }, [latex, showSource, validationIssueCount])

  const updateFormResume = (updater: (current: FormResume) => FormResume) => {
    setCompileState('idle')
    setCompileMessage('')
    setFormResume(updater)
  }

  const goSection = useCallback(
    (key: SectionKey) => {
      setActiveSection(key)
      setMobileView('form')
      if (key === 'basics') {
        setOpenCard(null)
        return
      }
      const list = formResume[key]
      setOpenCard(Array.isArray(list) && list.length ? list[0].id : null)
    },
    [formResume]
  )

  const toggleCard = (id: string) =>
    setOpenCard((current) => (current === id ? null : id))

  const addItem = () => {
    const id = createId(activeSection)

    updateFormResume((current) => {
      switch (activeSection) {
        case 'profiles':
          return {
            ...current,
            profiles: [...current.profiles, createProfileItem(id)],
          }
        case 'education':
          return {
            ...current,
            education: [...current.education, createEducationItem(id)],
          }
        case 'work':
          return { ...current, work: [...current.work, createWorkItem(id)] }
        case 'projects':
          return {
            ...current,
            projects: [...current.projects, createProjectItem(id)],
          }
        case 'skills':
          return {
            ...current,
            skills: [...current.skills, createSkillItem(id)],
          }
        default:
          return current
      }
    })
    setOpenCard(id)
  }

  const filenameStem =
    formResume.basics.name
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-') || 'resume'

  const saveBackup = () => {
    backupFormResume(formResume)
    setHasBackup(true)
  }

  const handleImportYaml = async (file: File | undefined) => {
    if (!file) {
      return
    }

    try {
      const text = await file.text()
      setPendingImport({
        filename: file.name,
        formResume: parseYamlToFormResume(text),
      })
      setCompileState('success')
      setCompileMessage('YAML 已解析')
    } catch (error) {
      setCompileState('error')
      setCompileMessage(
        friendlyErrorMessage(
          error instanceof Error ? error.message : String(error)
        )
      )
    } finally {
      if (importInputRef.current) {
        importInputRef.current.value = ''
      }
    }
  }

  const applyPendingImport = () => {
    if (!pendingImport) {
      return
    }

    saveBackup()
    setFormResume(pendingImport.formResume)
    setPendingImport(null)
    setActiveSection('basics')
    setOpenCard(null)
    setCompileState('success')
    setCompileMessage('YAML 已导入')
  }

  const handleCompilePdf = useCallback(async () => {
    if (validationIssueCount > 0) {
      setCompileState('error')
      setCompileMessage(`还有 ${validationIssueCount} 项需要检查`)
      return
    }

    // Reuse the already-compiled preview PDF when it is current.
    if (pdfStatus === 'ready' && pdfUrl) {
      const anchor = document.createElement('a')
      anchor.href = pdfUrl
      anchor.download = `${filenameStem}.pdf`
      anchor.click()
      setCompileState('success')
      setCompileMessage('PDF 已下载')
      return
    }

    setCompileState('compiling')
    setCompileMessage('正在编译 PDF')

    try {
      const response = await fetch('/api/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ latex, filename: filenameStem }),
      })

      const blob = await readCompilePdfBlob(response)
      downloadBlob(`${filenameStem}.pdf`, blob)
      setCompileState('success')
      setCompileMessage('PDF 已生成')
    } catch (error) {
      setCompileState('error')
      if (
        error instanceof CompileError &&
        error.code === 'compiler-unavailable'
      ) {
        setCompileMessage('当前环境未安装 LaTeX 编译器，无法生成 PDF。')
        return
      }
      setCompileMessage(
        friendlyCompileError(
          error instanceof Error ? error.message : String(error)
        )
      )
    }
  }, [validationIssueCount, pdfStatus, pdfUrl, filenameStem, latex])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Cmd/Ctrl + S: 下载 PDF
      if ((event.metaKey || event.ctrlKey) && event.key === 's') {
        event.preventDefault()
        handleCompilePdf()
      }

      // Cmd/Ctrl + E: 导出 YAML
      if ((event.metaKey || event.ctrlKey) && event.key === 'e') {
        event.preventDefault()
        downloadTextFile(
          `${filenameStem}.yml`,
          yaml,
          'application/yaml;charset=utf-8'
        )
      }

      // Cmd/Ctrl + [1-6]: 切换分区
      if ((event.metaKey || event.ctrlKey) && /^[1-6]$/.test(event.key)) {
        event.preventDefault()
        const index = Number.parseInt(event.key, 10) - 1
        goSection(SECTIONS[index].key)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleCompilePdf, yaml, filenameStem, goSection])

  const handleReset = () => {
    setConfirmDialog({
      title: '重置为示例简历？',
      description: '当前编辑内容会被示例内容覆盖，本地自动保存也会同步更新。',
      confirmLabel: '重置',
      danger: true,
      onConfirm: () => {
        saveBackup()
        setFormResume(DEFAULT_FORM_RESUME)
        setActiveSection('basics')
        setOpenCard(null)
        setCompileState('idle')
        setCompileMessage('')
      },
    })
  }

  const handleRequestImport = () => {
    importInputRef.current?.click()
  }

  const handleRestoreBackup = () => {
    setConfirmDialog({
      title: '恢复覆盖前备份？',
      description: '当前表单会被最近一次导入或重置前的内容替换。',
      confirmLabel: '恢复备份',
      onConfirm: () => {
        const backup = readBackupFormResume()
        if (!backup) {
          setHasBackup(false)
          setCompileState('error')
          setCompileMessage('没有可恢复的备份')
          return
        }

        setFormResume(backup)
        setActiveSection('basics')
        setOpenCard(null)
        setCompileState('success')
        setCompileMessage('已恢复备份')
      },
    })
  }

  const activeIndex = SECTIONS.findIndex(
    (section) => section.key === activeSection
  )
  const activeLabel = SECTIONS[activeIndex]?.label ?? ''
  const activeSectionValue = formResume[activeSection]
  const activeItemCount = Array.isArray(activeSectionValue)
    ? activeSectionValue.length
    : 0

  const chipClass =
    validationIssueCount > 0
      ? 'is-err'
      : compileState === 'compiling'
        ? 'is-busy'
        : compileState === 'error'
          ? 'is-err'
          : compileState === 'success'
            ? 'is-ok'
            : ''
  const chipText =
    validationIssueCount > 0
      ? `${validationIssueCount} 项需检查`
      : compileState === 'idle'
        ? hasLoadedStorage
          ? '已自动保存'
          : '加载中'
        : compileMessage

  const previewChipClass =
    saveIndicator === 'saving'
      ? 'is-saving'
      : saveIndicator === 'saved'
        ? 'is-saved'
        : validationIssueCount > 0
          ? 'is-err'
          : pdfStatus === 'compiling'
            ? 'is-busy'
            : pdfStatus === 'error'
              ? 'is-err'
              : pdfStatus === 'ready'
                ? 'is-ok'
                : ''
  const previewChipText =
    saveIndicator === 'saving'
      ? '保存中…'
      : saveIndicator === 'saved'
        ? '已自动保存'
        : validationIssueCount > 0
          ? '需先检查表单'
          : pdfStatus === 'compiling'
            ? '编译中…'
            : pdfStatus === 'ready'
              ? '真·PDF · 1:1'
              : pdfStatus === 'unavailable'
                ? '近似预览 · 本地无 LaTeX'
                : pdfStatus === 'error'
                  ? '编译失败'
                  : '准备中…'

  const menuEntries: MenuEntry[] = [
    {
      kind: 'item',
      key: 'import',
      label: '导入 YAML',
      icon: <Upload size={16} />,
      onClick: handleRequestImport,
    },
    ...(hasBackup
      ? ([
          {
            kind: 'item',
            key: 'restore-backup',
            label: '恢复覆盖前备份',
            icon: <RotateCcw size={16} />,
            onClick: handleRestoreBackup,
          },
        ] satisfies MenuEntry[])
      : []),
    {
      kind: 'item',
      key: 'export-yaml',
      label: '导出 YAML',
      icon: <Download size={16} />,
      onClick: () =>
        downloadTextFile(
          `${filenameStem}.yml`,
          yaml,
          'application/yaml;charset=utf-8'
        ),
    },
    {
      kind: 'item',
      key: 'export-tex',
      label: '导出 TeX',
      icon: <FileCode2 size={16} />,
      onClick: () =>
        downloadTextFile(
          `${filenameStem}.tex`,
          latex,
          'application/x-tex;charset=utf-8'
        ),
    },
    {
      kind: 'item',
      key: 'print',
      label: '打印预览',
      icon: <Printer size={16} />,
      onClick: () => printHtmlDocument(previewHtml),
    },
    { kind: 'sep', key: 'sep-1' },
    {
      kind: 'item',
      key: 'reset',
      label: '重置为示例',
      icon: <RotateCcw size={16} />,
      danger: true,
      onClick: handleReset,
    },
  ]

  const renderSection = () => {
    switch (activeSection) {
      case 'basics':
        return (
          <BasicsForm
            basics={formResume.basics}
            location={formResume.location}
            onBasicsChange={(basics) =>
              updateFormResume((current) => ({ ...current, basics }))
            }
            onLocationChange={(location) =>
              updateFormResume((current) => ({ ...current, location }))
            }
          />
        )
      case 'profiles':
        if (formResume.profiles.length === 0) {
          return (
            <EmptySection
              icon={Link2}
              title="还没有链接"
              description="添加 GitHub、作品集或 LinkedIn，让招聘方能快速看到你的作品。"
              actionLabel="添加链接"
              onAction={addItem}
            />
          )
        }
        return (
          <ProfilesForm
            items={formResume.profiles}
            openCard={openCard}
            onToggle={toggleCard}
            onChange={(profiles) =>
              updateFormResume((current) => ({ ...current, profiles }))
            }
          />
        )
      case 'education':
        if (formResume.education.length === 0) {
          return (
            <EmptySection
              icon={GraduationCap}
              title="还没有教育经历"
              description="先添加学校、专业和入学时间，预览会自动生成对应版式。"
              actionLabel="添加教育经历"
              onAction={addItem}
            />
          )
        }
        return (
          <EducationForm
            items={formResume.education}
            openCard={openCard}
            onToggle={toggleCard}
            onChange={(education) =>
              updateFormResume((current) => ({ ...current, education }))
            }
          />
        )
      case 'work':
        if (formResume.work.length === 0) {
          return (
            <EmptySection
              icon={Briefcase}
              title="还没有实习经历"
              description="没有实习也可以保留为空；如果有经历，建议写职责和量化结果。"
              actionLabel="添加实习经历"
              onAction={addItem}
            />
          )
        }
        return (
          <WorkForm
            items={formResume.work}
            openCard={openCard}
            onToggle={toggleCard}
            onChange={(work) =>
              updateFormResume((current) => ({ ...current, work }))
            }
          />
        )
      case 'projects':
        if (formResume.projects.length === 0) {
          return (
            <EmptySection
              icon={FolderGit2}
              title="还没有项目"
              description="项目是学生简历的核心，优先填写最能证明能力的 2-4 个项目。"
              actionLabel="添加项目"
              onAction={addItem}
            />
          )
        }
        return (
          <ProjectForm
            items={formResume.projects}
            openCard={openCard}
            onToggle={toggleCard}
            onChange={(projects) =>
              updateFormResume((current) => ({ ...current, projects }))
            }
          />
        )
      case 'skills':
        if (formResume.skills.length === 0) {
          return (
            <EmptySection
              icon={FileText}
              title="还没有技能"
              description="按前端、后端、AI 工具、部署等分类填写，关键词用逗号分隔。"
              actionLabel="添加技能"
              onAction={addItem}
            />
          )
        }
        return (
          <SkillsForm
            items={formResume.skills}
            openCard={openCard}
            onToggle={toggleCard}
            onChange={(skills) =>
              updateFormResume((current) => ({ ...current, skills }))
            }
          />
        )
      default:
        return null
    }
  }

  const renderPreview = () => {
    if (showSource) {
      const lines = latex.split('\n')
      return (
        <div className="source-wrapper">
          <div className="source-header">
            <span className="source-title">LaTeX 源码</span>
            <button
              type="button"
              className="btn"
              onClick={() => {
                navigator.clipboard.writeText(latex)
                setCompileState('success')
                setCompileMessage('源码已复制')
              }}
              title="复制源码"
            >
              <FileCode2 size={15} />
              复制
            </button>
          </div>
          <div className="source-block">
            <div className="source-lines">
              {lines.map((_, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: line numbers are static and never reorder
                <div key={index} className="source-line-number">
                  {index + 1}
                </div>
              ))}
            </div>
            <pre className="source-code">
              <code>{latex}</code>
            </pre>
          </div>
        </div>
      )
    }
    if (validationIssueCount > 0) {
      return (
        <div
          className="preview-stack"
          style={{
            transform: `scale(${previewZoom / 100})`,
            transformOrigin: 'top center',
          }}
        >
          <div className="paper">
            <iframe
              ref={frameRef}
              className="paper-frame"
              title="简历近似预览"
              srcDoc={previewHtml}
              style={{ height: frameHeight }}
              onLoad={syncFrameHeight}
            />
          </div>
        </div>
      )
    }
    if (pdfStatus === 'unavailable') {
      return (
        <div
          className="preview-stack"
          style={{
            transform: `scale(${previewZoom / 100})`,
            transformOrigin: 'top center',
          }}
        >
          <p className="preview-note">
            当前环境未安装 LaTeX，下方为 HTML 近似预览。真·moderncv
            排版请在容器内（已配 xelatex + 字体）查看。
          </p>
          <div className="paper">
            <iframe
              ref={frameRef}
              className="paper-frame"
              title="简历近似预览"
              srcDoc={previewHtml}
              style={{ height: frameHeight }}
              onLoad={syncFrameHeight}
            />
          </div>
        </div>
      )
    }
    if (pdfUrl) {
      return (
        <div
          className="preview-stack"
          style={{
            transform: `scale(${previewZoom / 100})`,
            transformOrigin: 'top center',
          }}
        >
          <div className="paper is-pdf">
            <iframe
              className="paper-frame is-pdf"
              title="简历 PDF 预览"
              src={`${pdfUrl}#toolbar=0&navpanes=0&view=FitH`}
            />
          </div>
        </div>
      )
    }
    if (pdfStatus === 'error') {
      return (
        <div className="preview-state is-error">
          <p>PDF 编译失败</p>
          <code>{pdfError}</code>
        </div>
      )
    }
    return (
      <div className="preview-state">
        <span className="spinner" />
        <p>正在编译真·PDF 预览…</p>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <FileText size={16} />
          </span>
          <span className="brand-name">简历工作台</span>
        </div>
        <div className="topbar-spacer" />
        <span className={cx('chip', chipClass)}>
          <span className="dot" />
          {chipText}
        </span>
        <div className="topbar-actions">
          <button
            type="button"
            className="btn btn-solid"
            disabled={compileState === 'compiling' || validationIssueCount > 0}
            title={
              validationIssueCount > 0
                ? `还有 ${validationIssueCount} 项需要检查`
                : '快捷键: Cmd/Ctrl + S'
            }
            onClick={handleCompilePdf}
          >
            <Download size={16} />
            {compileState === 'compiling' ? '编译中…' : '下载 PDF'}
          </button>
          <Menu entries={menuEntries} />
        </div>
        <input
          ref={importInputRef}
          type="file"
          accept=".yaml,.yml"
          hidden
          onChange={(event) => handleImportYaml(event.target.files?.[0])}
        />
      </header>

      <nav className="mobile-tabs" aria-label="视图切换">
        <button
          type="button"
          className={cx(mobileView === 'form' && 'is-active')}
          onClick={() => setMobileView('form')}
        >
          编辑
        </button>
        <button
          type="button"
          className={cx(mobileView === 'preview' && 'is-active')}
          onClick={() => setMobileView('preview')}
        >
          预览
        </button>
      </nav>

      <nav className="mobile-section-nav" aria-label="简历分区">
        {SECTIONS.map(({ key, label, icon: Icon }) => {
          const active = key === activeSection
          const value = formResume[key]
          const count = Array.isArray(value) ? value.length : 0
          const issueCount = issueCountsBySection[key]
          const filled = Boolean(
            formResume.basics.name.trim() || formResume.basics.summary.trim()
          )

          return (
            <button
              key={key}
              type="button"
              className={cx(
                'mobile-section-item',
                active && 'is-active',
                issueCount > 0 && 'has-issue'
              )}
              aria-current={active ? 'page' : undefined}
              onClick={() => goSection(key)}
            >
              <Icon size={14} />
              <span>{label}</span>
              {key === 'basics' ? (
                <span className={cx('mini-dot', filled && 'is-filled')} />
              ) : (
                <span className="mini-count">
                  {issueCount > 0 ? issueCount : count}
                </span>
              )}
            </button>
          )
        })}
      </nav>

      <div className="workspace">
        <aside className="rail">
          <div className="rail-eyebrow">简历分区</div>
          <nav className="rail-nav" aria-label="简历分区">
            {SECTIONS.map(({ key, label, icon: Icon }) => {
              const active = key === activeSection
              const value = formResume[key]
              const count = Array.isArray(value) ? value.length : 0
              const issueCount = issueCountsBySection[key]
              const filled = Boolean(
                formResume.basics.name.trim() ||
                  formResume.basics.summary.trim()
              )

              return (
                <button
                  key={key}
                  type="button"
                  className={cx('nav-item', active && 'is-active')}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => goSection(key)}
                >
                  <Icon className="nav-ico" size={16} />
                  <span className="nav-label">{label}</span>
                  {key === 'basics' ? (
                    <span
                      className={cx(
                        'nav-dot',
                        filled && 'is-filled',
                        issueCount > 0 && 'is-issue'
                      )}
                    />
                  ) : (
                    <span
                      className={cx('nav-count', issueCount > 0 && 'is-issue')}
                    >
                      {issueCount > 0 ? issueCount : count}
                    </span>
                  )}
                </button>
              )
            })}
          </nav>
          <div className="rail-foot">
            <div className="health-row">
              <span>完整度</span>
              <strong>{resumeHealthPercent}%</strong>
            </div>
            <div className="health-bar" aria-hidden="true">
              <span style={{ width: `${resumeHealthPercent}%` }} />
            </div>
            <div
              className={cx(
                'health-note',
                validationIssueCount > 0 && 'is-issue'
              )}
            >
              <span className="dot" />
              {validationIssueCount > 0
                ? `${validationIssueCount} 项需检查`
                : '本地自动保存'}
            </div>
            <PreviewQuality
              completePercent={resumeHealthPercent}
              issueCount={validationIssueCount}
              onSelectSuggestion={goSection}
              pageQuality={pageQuality}
              suggestions={qualitySuggestions}
            />
          </div>
        </aside>

        <section
          className={cx(
            'form-pane',
            mobileView === 'form' && 'is-mobile-active'
          )}
        >
          <div className="form-head">
            <div className="form-head-titles">
              <span className="eyebrow">
                {activeIndex + 1} / {SECTIONS.length}
              </span>
              <h2>
                {activeLabel}
                {activeSection !== 'basics' && activeItemCount > 0 ? (
                  <span className="form-head-count">{activeItemCount} 条</span>
                ) : null}
              </h2>
            </div>
            {activeSection === 'basics' ? null : (
              <button type="button" className="btn" onClick={addItem}>
                <Plus size={15} />
                新增
              </button>
            )}
          </div>
          <div className="form-body">
            {activeSectionIssues.length > 0 ? (
              <div className="section-alert">
                <span className="section-alert-title">本区有需检查项</span>
                <ul>
                  {activeSectionIssues.slice(0, 3).map((issue) => (
                    <li key={`${issue.field}-${issue.message}`}>
                      <strong>{issue.field}</strong>
                      <span>{issue.message}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {!hasLoadedStorage ? <FormSkeleton /> : renderSection()}
          </div>
        </section>

        <section
          className={cx(
            'preview-pane',
            mobileView === 'preview' && 'is-mobile-active'
          )}
        >
          <div className="preview-head">
            <div className="preview-title">
              <h2>{formResume.basics.name || '未命名简历'}</h2>
              <span className={cx('chip', previewChipClass)}>
                <span className="dot" />
                {previewChipText}
              </span>
            </div>
            <div className="preview-actions">
              <div className="zoom-control">
                <button
                  type="button"
                  className="zoom-btn"
                  onClick={() => setPreviewZoom(Math.max(50, previewZoom - 25))}
                  disabled={previewZoom <= 50}
                  title="缩小"
                  aria-label="缩小预览"
                >
                  <Minus size={14} />
                </button>
                <span className="zoom-value">{previewZoom}%</span>
                <button
                  type="button"
                  className="zoom-btn"
                  onClick={() =>
                    setPreviewZoom(Math.min(125, previewZoom + 25))
                  }
                  disabled={previewZoom >= 125}
                  title="放大"
                  aria-label="放大预览"
                >
                  <Plus size={14} />
                </button>
              </div>
              <TemplatePicker
                value={formResume.template}
                onChange={(value) =>
                  updateFormResume((current) => ({
                    ...current,
                    template: value,
                  }))
                }
              />
              <div className="view-toggle">
                <button
                  type="button"
                  className={cx('toggle-btn', !showSource && 'is-active')}
                  onClick={() => setShowSource(false)}
                  title="预览简历"
                >
                  <Eye size={15} />
                  预览
                </button>
                <button
                  type="button"
                  className={cx('toggle-btn', showSource && 'is-active')}
                  onClick={() => setShowSource(true)}
                  title="查看 LaTeX 源码"
                >
                  <Code2 size={15} />
                  源码
                </button>
              </div>
            </div>
          </div>
          <div className="preview-scroll">{renderPreview()}</div>
        </section>
      </div>
      {confirmDialog ? (
        <ConfirmDialog
          state={confirmDialog}
          onCancel={() => setConfirmDialog(null)}
        />
      ) : null}
      {pendingImport ? (
        <ImportPreviewDialog
          pendingImport={pendingImport}
          onApply={applyPendingImport}
          onCancel={() => setPendingImport(null)}
        />
      ) : null}
    </div>
  )
}
