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
  CandidateValidationError,
  DraftValidationError,
  parseCandidateResume,
  prepareDraftResume,
} from '@/validation/resume'

const candidate = {
  content: {
    basics: { name: 'Ada Lovelace', email: 'ada@example.com' },
    education: [],
    projects: [
      { name: 'Compiler', startDate: '2024', endDate: '', summary: 'Built it' },
    ],
  },
  layouts: [
    { engine: 'latex', template: 'jake' },
    { engine: 'html', template: 'calm' },
  ],
}

describe('parseCandidateResume', () => {
  it('rejects malformed candidate input', () => {
    expect(() => parseCandidateResume({ resume: {} })).toThrow(
      CandidateValidationError
    )
  })

  it('rejects ambiguous candidate input', () => {
    expect(() =>
      parseCandidateResume({
        yaml: 'content: {}',
        resume: {},
      })
    ).toThrow('not both')
  })
})

describe('prepareDraftResume', () => {
  it('rejects generated entries that have no candidate source', () => {
    expect(() =>
      prepareDraftResume(
        {
          ...candidate,
          content: {
            ...candidate.content,
            projects: [
              ...candidate.content.projects,
              {
                name: 'Invented project',
                startDate: '2025',
                endDate: '',
                summary: 'No evidence',
              },
            ],
          },
        },
        candidate
      )
    ).toThrow(DraftValidationError)
  })
})
