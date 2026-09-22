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

import { describe, expect, it } from 'vitest'

import {
  readResumeText,
  resumeReminders,
  summarizeResume,
} from '@/lib/resume-overview'

const RESUME = `---
content:
  basics:
    name: 包安心
    headline: AI 应用开发工程师
    email: anx@example.com
    summary: |
      - 独立完成多个项目从零到部署上线
  location:
    city: 西安
    region: 陕西
  work:
    - name: 某某科技
      position: Agent 开发
      startDate: Mar 2024
      endDate:
  projects:
    - name: StyleKit
      keywords: [Next.js, TypeScript]
  education:
    - institution: 西安科技大学
      degree: Bachelor
  skills:
    - name: Python
      keywords: [FastAPI, typescript]
    - name: TypeScript
  awards:
    - title: 省级二等奖
`

function content(text: string): Record<string, unknown> {
  const result = readResumeText(text)
  if (!result.content) throw new Error('Expected the fixture to parse')
  return result.content
}

describe('readResumeText', () => {
  it('reports nothing for an empty field', () => {
    const empty = { issues: [], content: null, document: null }

    expect(readResumeText('')).toEqual(empty)
    expect(readResumeText('   \n  ')).toEqual(empty)
  })

  it('keeps the whole document for schema validation, not just its content', () => {
    // `ResumeSchema` validates `layouts` and `locale` too, so the editor needs
    // the full document rather than just the `content` subtree.
    const { document: whole } = readResumeText(
      'content:\n  basics:\n    name: 包安心\nlayouts:\n  - engine: latex\n'
    )

    expect(whole).toHaveProperty('layouts')
    expect(whole).toHaveProperty('content')
  })

  it('reads the content mapping of a YAMLResume document', () => {
    const parsed = content(RESUME)

    expect(parsed.basics).toMatchObject({ name: '包安心' })
    expect(parsed.work).toHaveLength(1)
  })

  it('points at the line and column of a syntax error', () => {
    // The editor marks the position, so an error with no position would be
    // reported against the whole document and help nobody.
    const { issues } = readResumeText(
      'content:\n  basics:\n    name: 包安心\n   headline: 缩进错了\n'
    )

    const error = issues.find((issue) => issue.severity === 'error')
    expect(error?.line).toBe(4)
    expect(error?.column).toBeGreaterThan(0)
  })

  it('still returns what the parser recovered while the text is broken', () => {
    // `yaml` recovers from most mistakes. Throwing that away would blank the
    // overview over one wrong space, so both the problems and the partial
    // document come back together.
    const { issues, content: parsed } = readResumeText(
      'content:\n  basics:\n    name: 包安心\n   headline: 缩进错了\n'
    )

    expect(issues.length).toBeGreaterThan(0)
    expect(parsed).toMatchObject({ basics: { name: '包安心' } })
  })

  it('treats plain prose as "no structured content", not as a failure', () => {
    // The field accepts pasted text as well as YAML; prose is a valid thing to
    // keep there, so it must not raise an error the user has to clear.
    const result = readResumeText('我叫包安心，做 AI 应用开发。')

    expect(result.content).toBeNull()
    expect(result.issues).toEqual([])
  })

  it('treats a document without a content mapping as unreadable', () => {
    expect(readResumeText('content: 一串文字\n').content).toBeNull()
    expect(readResumeText('- 一个列表\n').content).toBeNull()
  })

  it('reports a duplicate key rather than silently keeping the last one', () => {
    const { issues } = readResumeText(
      'content:\n  basics:\n    name: 甲\n    name: 乙\n'
    )

    expect(issues).toHaveLength(1)
    expect(issues[0]?.message).toContain('unique')
    // Duplicate keys are the silent kind of data loss — the second value just
    // wins — so they arrive as an error the user has to look at.
    expect(issues[0]?.severity).toBe('error')
  })
})

describe('summarizeResume', () => {
  it('reads the identity, location and section counts', () => {
    const overview = summarizeResume(content(RESUME))

    expect(overview).toMatchObject({
      name: '包安心',
      headline: 'AI 应用开发工程师',
      email: 'anx@example.com',
      location: '西安 · 陕西',
      counts: {
        work: 1,
        projects: 1,
        education: 1,
        skills: 2,
        awards: 1,
      },
      latest: '某某科技 · Agent 开发',
    })
  })

  it('collects keywords in document order without case duplicates', () => {
    // `TypeScript` appears as a skill name and again as a `typescript`
    // keyword; showing both would make the list look padded.
    const overview = summarizeResume(content(RESUME))

    expect(overview.keywords).toEqual([
      'Python',
      'FastAPI',
      'typescript',
      'Next.js',
    ])
  })

  it('degrades to empty values rather than throwing on a sparse document', () => {
    const overview = summarizeResume({})

    expect(overview).toMatchObject({
      name: '',
      headline: '',
      location: '',
      latest: null,
      keywords: [],
      counts: { work: 0, projects: 0, education: 0, skills: 0, awards: 0 },
    })
  })

  it('ignores non-object entries in a list', () => {
    const overview = summarizeResume({
      work: ['不是对象', null, { name: '公司' }],
    })

    expect(overview.counts.work).toBe(1)
    expect(overview.latest).toBe('公司')
  })

  it('falls back to whichever half of the latest role exists', () => {
    expect(summarizeResume({ work: [{ position: '工程师' }] }).latest).toBe(
      '工程师'
    )
    expect(summarizeResume({ work: [{ name: '公司' }] }).latest).toBe('公司')
  })
})

describe('resumeReminders', () => {
  const paths = (text: string) => {
    const parsed = content(text)
    return resumeReminders(parsed, summarizeResume(parsed)).map(
      (reminder) => reminder.path
    )
  }

  it('says nothing when the document has what the Agent needs', () => {
    // This fixture still has an open-ended job, which is worth flagging.
    expect(paths(RESUME)).toEqual(['content.work.0.endDate'])
  })

  it('names each missing piece it would otherwise have to invent', () => {
    expect(paths('content:\n  basics:\n    name: 包安心\n')).toEqual([
      'content.basics.summary',
      'content.work',
      'content.skills',
    ])
  })

  it('flags a missing name separately from a missing summary', () => {
    expect(paths('content:\n  basics:\n    summary: 简介\n')).toContain(
      'content.basics.name'
    )
  })

  it('flags a work entry with no start date', () => {
    expect(
      paths('content:\n  work:\n    - name: 公司\n      endDate: Mar 2024\n')
    ).toContain('content.work.0.startDate')
  })

  it('does not ask for work when projects carry the evidence', () => {
    expect(paths('content:\n  projects:\n    - name: A\n')).not.toContain(
      'content.work'
    )
  })

  it('names the entry it is about so the user can find it', () => {
    const parsed = content(
      'content:\n  basics:\n    name: 包安心\n  work:\n    - name: 某某科技\n      startDate: Mar 2024\n'
    )
    const reminder = resumeReminders(parsed, summarizeResume(parsed)).find(
      (entry) => entry.path === 'content.work.0.endDate'
    )

    expect(reminder?.message).toContain('某某科技')
    expect(reminder?.message).toContain('仍在职')
  })
})
