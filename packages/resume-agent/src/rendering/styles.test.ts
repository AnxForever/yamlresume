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

import type { Resume } from '@yamlresume/core'
import { describe, expect, it } from 'vitest'

import {
  applyStylePreset,
  getStylePreset,
  resolveStyleIDs,
} from '@/rendering/styles'

const source: Resume = {
  content: {
    basics: { name: 'Ada Lovelace', summary: '分析系统工程师' },
  },
  layouts: [
    {
      engine: 'latex',
      template: 'moderncv-casual',
      page: { paperSize: 'letter', showPageNumbers: true },
    },
    { engine: 'html', template: 'vscode' },
  ],
}

describe('style presets', () => {
  it('exposes stable labels and LaTeX templates for every preset', () => {
    expect(
      [
        'ats-compact',
        'modern-professional',
        'modern-classic',
        'modern-casual',
        'developer-two-column',
      ].map((style) => {
        const preset = getStylePreset(style)
        return [preset.id, preset.label, preset.template]
      })
    ).toEqual([
      ['ats-compact', 'ATS Compact', 'jake'],
      ['modern-professional', 'Modern Professional', 'moderncv-banking'],
      ['modern-classic', 'Modern Classic', 'moderncv-classic'],
      ['modern-casual', 'Modern Casual', 'moderncv-casual'],
      ['developer-two-column', 'Developer Two Column', 'deedy'],
    ])
  })

  it('deduplicates requested styles without changing their first-seen order', () => {
    expect(
      resolveStyleIDs({
        styles: ['modern-classic', 'ats-compact', 'modern-classic'],
      })
    ).toEqual(['modern-classic', 'ats-compact'])
    expect(resolveStyleIDs({ template: 'deedy' })).toEqual([
      'developer-two-column',
    ])
  })

  it('applies each preset without modifying or contaminating the source', () => {
    const before = structuredClone(source)

    const compact = applyStylePreset(source, 'ats-compact')
    const classic = applyStylePreset(source, 'modern-classic')

    expect(source).toEqual(before)
    expect(
      compact.layouts?.find((layout) => layout.engine === 'latex')
    ).toMatchObject({
      template: 'jake',
      page: { paperSize: 'letter', showPageNumbers: true },
      typography: { fontSize: '10pt', lineSpacing: 'tight' },
    })
    expect(
      classic.layouts?.find((layout) => layout.engine === 'latex')
    ).toMatchObject({
      template: 'moderncv-classic',
      typography: { fontSize: '11pt', lineSpacing: 'relaxed' },
    })
    expect(
      source.layouts?.find((layout) => layout.engine === 'latex')
    ).toMatchObject({ template: 'moderncv-casual' })
  })
})
