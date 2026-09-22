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

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ProfileResume } from '@/components/profile/profile-resume'

/**
 * Deliberately *not* schema-valid: it omits every optional-ish section so the
 * overview has missing fields to report. The schema tests below use it for the
 * failure path on purpose.
 */
const MINIMAL = `content:
  basics:
    name: 包安心
    headline: AI 应用开发工程师
    email: anx@example.com
  location:
    city: 西安
    region: 陕西
  work:
    - name: 某某科技
      position: Agent 开发
      startDate: Mar 2024
  projects:
    - name: StyleKit
      keywords: [Next.js]
  skills:
    - name: Python
`

/** Everything `ResumeSchema` requires, so the editor's clean path can run. */
const VALID = `content:
  basics:
    name: 包安心
    headline: AI 应用开发工程师
    email: anx@example.com
    summary: |
      - 独立完成多个项目从零到部署上线
  education:
    - institution: 西安科技大学
      degree: Bachelor
      area: 数据科学与大数据技术
      startDate: Sep 1, 2022
      endDate: Jul 1, 2026
  work:
    - name: 某某科技
      position: Agent 开发
      startDate: Mar 2024
      endDate: Aug 2025
      summary: 负责 Agent 应用开发与工具链建设。
  projects:
    - name: StyleKit
      startDate: Jan 2025
      endDate: Jun 2025
      summary: 开源设计风格库，收录 130 种风格。
  skills:
    - name: Python
      level: Advanced
      keywords: [FastAPI]
`

function renderResume(resumeYaml: string) {
  const onChange = vi.fn()
  const view = render(
    <ProfileResume resumeYaml={resumeYaml} onChange={onChange} />
  )
  return { onChange, ...view }
}

describe('ProfileResume · overview', () => {
  it('shows what the document contains, not the document itself', () => {
    renderResume(MINIMAL)

    expect(screen.getByText('包安心')).toBeDefined()
    expect(screen.getByText('AI 应用开发工程师')).toBeDefined()
    expect(screen.getByText(/anx@example.com/)).toBeDefined()
    expect(screen.getByText(/西安 · 陕西/)).toBeDefined()
  })

  it('reports every section count and the most recent role', () => {
    renderResume(MINIMAL)

    // A count of 0 is information too: it says the Agent has nothing to draw
    // on from that section, which is exactly what the user needs to know.
    for (const label of ['工作经历', '项目', '教育', '技能', '获奖']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }
    expect(screen.getByText(/某某科技 · Agent 开发/)).toBeDefined()
  })

  it('lists the keywords the Agent can match a JD against', () => {
    renderResume(MINIMAL)

    expect(screen.getByText('Python')).toBeDefined()
    expect(screen.getByText('Next.js')).toBeDefined()
  })

  it('says which fields are missing and what that costs', () => {
    // The point of the overview is not to show the user their resume back, but
    // to show what the Agent has to work with.
    renderResume(MINIMAL)

    expect(screen.getByText('Agent 能用上什么')).toBeDefined()
    expect(screen.getByText(/没有个人简介/)).toBeDefined()
    expect(screen.getByText(/没有结束时间/)).toBeDefined()
  })

  it('says nothing is missing when nothing is', () => {
    renderResume(VALID)

    expect(screen.getByText('没有发现缺失的常用字段。')).toBeDefined()
  })

  it('distinguishes "no resume" from "not a YAMLResume document"', () => {
    const { unmount } = renderResume('')
    expect(screen.getByText('还没有基础简历')).toBeDefined()
    unmount()

    renderResume('我叫包安心，做 AI 应用开发。')

    // Prose is a valid thing to keep here, so this is a state, not an error.
    expect(screen.getByText('这份内容不是 YAMLResume 文档')).toBeDefined()
    expect(screen.getByText(/纯文本也能保存/)).toBeDefined()
  })
})

describe('ProfileResume · editor', () => {
  it('hands every keystroke back to the caller so nothing is held locally', () => {
    const { onChange } = renderResume(MINIMAL)

    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    fireEvent.change(screen.getByLabelText(/YAMLResume 文档/), {
      target: { value: 'content:\n  basics: {}\n' },
    })

    expect(onChange).toHaveBeenCalledWith('content:\n  basics: {}\n')
  })

  it('marks a YAML error with its line and column so it can be found', () => {
    renderResume(
      'content:\n  basics:\n    name: 包安心\n   headline: 缩进错了\n'
    )

    fireEvent.click(screen.getByRole('button', { name: '编辑' }))

    expect(screen.getByText('YAML 语法')).toBeDefined()
    expect(screen.getByText('4:1')).toBeDefined()
    expect(screen.getByText(/must start at the same column/)).toBeDefined()
  })

  it('validates against the real ResumeSchema, on demand', async () => {
    // The chunk is 298 KB, so it is fetched when the editor opens rather than
    // on arrival. Reaching the clean state at all proves the dynamic import
    // resolved and ran.
    renderResume(VALID)

    fireEvent.click(screen.getByRole('button', { name: '编辑' }))

    await waitFor(
      () => {
        expect(screen.getByText('通过 ResumeSchema 校验。')).toBeDefined()
      },
      { timeout: 5000 }
    )
  })

  it('reports a schema rejection the YAML parser was happy with, by path', async () => {
    // YAML accepts an incomplete document; the schema does not. Without this
    // the user would only find out when the backend refused the run.
    renderResume(MINIMAL)

    fireEvent.click(screen.getByRole('button', { name: '编辑' }))

    await waitFor(
      () => {
        expect(screen.getByText('不符合 ResumeSchema')).toBeDefined()
      },
      { timeout: 5000 }
    )
    expect(screen.getByText('content.education')).toBeDefined()
    expect(screen.getByText('education is required.')).toBeDefined()
  })

  it('counts the characters and offers the export', () => {
    renderResume(VALID)

    fireEvent.click(screen.getByRole('button', { name: '编辑' }))

    expect(screen.getByText(/字符$/)).toBeDefined()
    expect(screen.getByRole('button', { name: /导出 YAML/ })).toBeDefined()
  })
})
