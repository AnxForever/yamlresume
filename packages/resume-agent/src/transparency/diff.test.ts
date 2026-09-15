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

import { buildResumeDiff } from './diff'

const source: Resume = {
  content: {
    basics: { name: 'Ada', summary: 'General engineer' },
    education: [],
    projects: [
      { name: 'Alpha', summary: '- Original alpha' },
      { name: 'Beta', summary: '- Original beta' },
    ],
  },
}

describe('buildResumeDiff', () => {
  it('reports changed, removed, and reordered resume content', () => {
    const draft: Resume = {
      content: {
        basics: { name: 'Ada', summary: 'Targeted engineer' },
        education: [],
        projects: [
          { name: 'Beta', summary: '- Original beta' },
          { name: 'Alpha', summary: '- Targeted alpha' },
        ],
      },
    }

    const result = buildResumeDiff(source, draft)

    expect(result.counts.changed).toBe(2)
    expect(result.counts.reordered).toBe(1)
    expect(result.changes).toContainEqual(
      expect.objectContaining({
        type: 'changed',
        path: 'content.basics.summary',
      })
    )
  })

  it('reports an omitted source entry', () => {
    const draft: Resume = {
      content: {
        basics: source.content.basics,
        education: [],
        projects: [{ name: 'Alpha', summary: '- Original alpha' }],
      },
    }

    const result = buildResumeDiff(source, draft)

    expect(result.counts.removed).toBe(1)
    expect(result.changes).toContainEqual(
      expect.objectContaining({
        type: 'removed',
        path: 'content.projects[Beta]',
      })
    )
  })
})
