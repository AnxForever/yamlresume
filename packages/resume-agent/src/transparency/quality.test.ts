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

import type { JobSpec } from '@/contracts'
import { buildQualityReport } from './quality'

const jobSpec: JobSpec = {
  targetTitle: 'Backend Engineer',
  seniority: 'junior',
  summary: 'Build APIs',
  keywords: ['TypeScript', 'PostgreSQL'],
  requirements: [
    {
      id: 'typescript',
      text: 'TypeScript',
      keywords: ['TypeScript'],
      importance: 'must-have',
      category: 'technical',
    },
    {
      id: 'postgres',
      text: 'PostgreSQL',
      keywords: ['PostgreSQL'],
      importance: 'must-have',
      category: 'technical',
    },
  ],
}

describe('buildQualityReport', () => {
  it('calculates deterministic requirement and keyword coverage', () => {
    const resume: Resume = {
      content: {
        basics: { name: 'Ada', summary: 'TypeScript engineer' },
        education: [],
        skills: [{ name: 'Backend', keywords: ['TypeScript'] }],
      },
    }

    const report = buildQualityReport(jobSpec, resume)

    expect(report.requirementCoverage).toBe(0.5)
    expect(report.mustHaveCoverage).toBe(0.5)
    expect(report.keywordCoverage).toBe(0.5)
    expect(report.missingKeywords).toEqual(['PostgreSQL'])
    expect(report.missingMustHave).toEqual(['PostgreSQL'])
  })
})
