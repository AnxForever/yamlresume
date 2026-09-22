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

import { parseDocument } from 'yaml'

/**
 * A problem the user can act on, with the position to act on it.
 *
 * `line`/`column` are 1-based and null when the parser could not attribute a
 * position — a duplicate-key warning names the key, not a place.
 */
export interface ResumeIssue {
  severity: 'error' | 'warning'
  line: number | null
  column: number | null
  message: string
}

export interface ResumeOverview {
  name: string
  headline: string
  email: string
  location: string
  counts: {
    work: number
    projects: number
    education: number
    skills: number
    awards: number
  }
  /** The most recent position, as `公司 · 职位`, when work history exists. */
  latest: string | null
  /** Skill and project keywords, deduplicated and in document order. */
  keywords: string[]
}

export interface ResumeReminder {
  /** The document path the reminder is about, for grouping and de-duping. */
  path: string
  message: string
}

export interface ResumeReadResult {
  issues: ResumeIssue[]
  /**
   * The `content` mapping of a YAMLResume document, or null when the text is
   * not one yet — empty, not YAML, not a mapping, or plain prose.
   *
   * This is independent of `issues`: `yaml` recovers from most mistakes and
   * still yields a usable document, and that partial document is returned
   * alongside the problems. Blanking the overview over one wrong space would
   * leave the user editing blind.
   */
  content: Record<string, unknown> | null
  /**
   * The whole parsed document (`content` plus `layouts` and `locale`), which
   * is what `ResumeSchema` validates. Null on the same terms as `content`.
   */
  document: Record<string, unknown> | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** A YAML parse error, reduced to what the editor can point at. */
interface PositionedError {
  message: string
  /** Present only for errors that carry a range. */
  linePos?: Array<{ line: number; col: number }> | undefined
  /** Character offsets into the source; the fallback when `linePos` is absent. */
  pos?: Array<number> | undefined
}

/** Turn a character offset into the 1-based line and column an editor shows. */
function offsetToPosition(
  source: string,
  offset: number
): { line: number; column: number } {
  let line = 1
  let lineStart = 0
  const limit = Math.min(offset, source.length)
  for (let index = 0; index < limit; index += 1) {
    if (source[index] === '\n') {
      line += 1
      lineStart = index + 1
    }
  }
  return { line, column: offset - lineStart + 1 }
}

/**
 * `yaml` only fills `linePos` for errors that carry a *range*. An indentation
 * error, for instance, arrives with just a `pos` offset — relying on `linePos`
 * alone would leave the most common mistakes unmarked, so the offset is
 * converted here instead.
 */
function toIssue(
  error: PositionedError,
  severity: ResumeIssue['severity'],
  source: string
): ResumeIssue {
  const start = error.linePos?.[0]
  if (start) {
    return {
      severity,
      line: start.line,
      column: start.col,
      message: error.message,
    }
  }
  const offset = error.pos?.[0]
  if (typeof offset === 'number') {
    const { line, column } = offsetToPosition(source, offset)
    return { severity, line, column, message: error.message }
  }
  return { severity, line: null, column: null, message: error.message }
}

/**
 * Read the text area's contents.
 *
 * Deliberately tolerant. This runs on every keystroke, so a half-typed
 * document must produce a list of problems rather than an exception, and plain
 * prose — which the field accepts alongside YAML — must come back as "no
 * structured content" rather than as an error the user has to clear.
 */
export function readResumeText(input: string): ResumeReadResult {
  if (input.trim().length === 0) {
    return { issues: [], content: null, document: null }
  }

  const document = parseDocument(input, { prettyErrors: false })
  const issues: ResumeIssue[] = [
    ...document.errors.map((error) => toIssue(error, 'error', input)),
    // Warnings are rarer, but they flag things that quietly change what the
    // document means — worth surfacing next to the errors rather than in a
    // console nobody reads.
    ...document.warnings.map((warning) => toIssue(warning, 'warning', input)),
  ]

  let value: unknown
  try {
    value = document.toJS({ maxAliasCount: 100 })
  } catch (error) {
    issues.push({
      severity: 'error',
      line: null,
      column: null,
      message: error instanceof Error ? error.message : '无法解析这份 YAML',
    })
    return { issues, content: null, document: null }
  }

  if (!isRecord(value)) {
    return { issues, content: null, document: null }
  }
  return {
    issues,
    content: isRecord(value.content) ? value.content : null,
    document: value,
  }
}

export function summarizeResume(
  content: Record<string, unknown>
): ResumeOverview {
  const basics = isRecord(content.basics) ? content.basics : {}
  const location = isRecord(content.location) ? content.location : {}
  const work = asArray(content.work)
  const projects = asArray(content.projects)
  const skills = asArray(content.skills)

  const latestWork = work[work.length - 1]
  const latest = latestWork
    ? [text(latestWork.name), text(latestWork.position)]
        .filter((part) => part.length > 0)
        .join(' · ')
    : null

  return {
    name: text(basics.name),
    headline: text(basics.headline),
    email: text(basics.email),
    location: [text(location.city), text(location.region)]
      .filter((part) => part.length > 0)
      .join(' · '),
    counts: {
      work: work.length,
      projects: projects.length,
      education: asArray(content.education).length,
      skills: skills.length,
      awards: asArray(content.awards).length,
    },
    latest: latest && latest.length > 0 ? latest : null,
    keywords: collectKeywords(skills, projects),
  }
}

function collectKeywords(
  skills: Array<Record<string, unknown>>,
  projects: Array<Record<string, unknown>>
): string[] {
  const seen = new Set<string>()
  const keywords: string[] = []
  const push = (value: unknown) => {
    const keyword = text(value)
    // Case-insensitive de-dupe: `Python` and `python` are one skill, and
    // showing both makes the list look padded.
    const key = keyword.toLocaleLowerCase('en-US')
    if (keyword.length === 0 || seen.has(key)) {
      return
    }
    seen.add(key)
    keywords.push(keyword)
  }
  for (const skill of skills) {
    push(skill.name)
    for (const keyword of Array.isArray(skill.keywords) ? skill.keywords : []) {
      push(keyword)
    }
  }
  for (const project of projects) {
    for (const keyword of Array.isArray(project.keywords)
      ? project.keywords
      : []) {
      push(keyword)
    }
  }
  return keywords
}

/**
 * What the Agent would be short of.
 *
 * These are presence checks on the user's own document — never a judgement
 * about whether the content is *good*, and never an invented fact. Each one
 * names the thing that is missing so the user can decide whether it is worth
 * adding.
 */
export function resumeReminders(
  content: Record<string, unknown>,
  overview: ResumeOverview
): ResumeReminder[] {
  const reminders: ResumeReminder[] = []
  const basics = isRecord(content.basics) ? content.basics : {}
  const work = asArray(content.work)

  if (overview.name.length === 0) {
    reminders.push({
      path: 'content.basics.name',
      message: '还没有姓名，生成的简历会缺一个抬头。',
    })
  }
  if (text(basics.summary).length === 0) {
    reminders.push({
      path: 'content.basics.summary',
      message: '还没有个人简介，JD 分析时会少一段可引用的概述。',
    })
  }
  if (work.length === 0 && overview.counts.projects === 0) {
    reminders.push({
      path: 'content.work',
      message: '没有工作经历也没有项目——证据匹配会无从下手。',
    })
  }
  if (overview.keywords.length === 0) {
    reminders.push({
      path: 'content.skills',
      message: '没有技能或项目关键词，JD 的关键词命中率会受影响。',
    })
  }

  for (const [index, entry] of work.entries()) {
    if (text(entry.startDate).length === 0) {
      reminders.push({
        path: `content.work.${index}.startDate`,
        message: `工作经历 ${index + 1}（${text(entry.name) || '未命名'}）缺少开始时间。`,
      })
    }
    if (text(entry.endDate).length === 0) {
      reminders.push({
        path: `content.work.${index}.endDate`,
        message: `工作经历 ${index + 1}（${text(entry.name) || '未命名'}）没有结束时间，Agent 会当作仍在职。`,
      })
    }
  }

  return reminders
}
