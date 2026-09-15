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
  buildHtmlResume,
  buildResume,
  DEFAULT_FORM_RESUME,
  parseYamlToFormResume,
  renderResumeToHtml,
  renderResumeToLatex,
  serializeResumeToYaml,
} from './resume'

describe('resume form mapping', () => {
  it('builds a valid LaTeX resume from default form data', () => {
    const resume = buildResume(DEFAULT_FORM_RESUME)

    expect(resume.content.basics.name).toBe(DEFAULT_FORM_RESUME.basics.name)
    expect(resume.content.education).toHaveLength(1)
    expect(resume.content.projects).toHaveLength(
      DEFAULT_FORM_RESUME.projects.length
    )
    expect(resume.content.skills).toHaveLength(
      DEFAULT_FORM_RESUME.skills.length
    )
    expect(resume.layouts?.[0]?.engine).toBe('latex')
    expect(
      resume.layouts?.[0]?.engine === 'latex'
        ? resume.layouts[0].template
        : undefined
    ).toBe('moderncv-banking')
  })

  it('keeps rendering safe when optional form sections are empty', () => {
    const resume = buildResume({
      ...DEFAULT_FORM_RESUME,
      basics: {
        ...DEFAULT_FORM_RESUME.basics,
        name: '',
      },
      location: {
        city: '',
        country: '',
        region: '',
      },
      education: [],
      profiles: [],
      work: [],
      projects: [],
      skills: [],
    })

    expect(resume.content.basics.name).toBe('未命名简历')
    expect(resume.content.education).toEqual([])
    expect(resume.content.work).toBeUndefined()
    expect(resume.content.projects).toBeUndefined()
    expect(resume.content.skills).toBeUndefined()
    expect(() => renderResumeToLatex(resume)).not.toThrow()
  })

  it('renders default data to LaTeX and HTML documents', () => {
    const latex = renderResumeToLatex(buildResume(DEFAULT_FORM_RESUME))
    const html = renderResumeToHtml(buildHtmlResume(DEFAULT_FORM_RESUME))

    expect(latex).toContain('\\documentclass')
    expect(latex).toContain('包安心')
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain(DEFAULT_FORM_RESUME.basics.name)
  })

  it('serializes and imports YAML without losing surfaced fields', () => {
    const yaml = serializeResumeToYaml(buildResume(DEFAULT_FORM_RESUME))
    const form = parseYamlToFormResume(yaml)

    expect(yaml).toContain('content:')
    expect(yaml).toContain(`name: ${DEFAULT_FORM_RESUME.basics.name}`)
    expect(yaml).toContain('template: moderncv-banking')
    expect(form.basics.name).toBe(DEFAULT_FORM_RESUME.basics.name)
    expect(form.projects).toHaveLength(DEFAULT_FORM_RESUME.projects.length)
  })
})
