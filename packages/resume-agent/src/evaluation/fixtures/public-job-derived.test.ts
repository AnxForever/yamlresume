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

import { parseCandidateResume, publicJobDerivedDevelopmentCases } from '@/index'

describe('publicJobDerivedDevelopmentCases', () => {
  it('provides a traceable and diverse public-job-derived corpus with synthetic candidates', () => {
    expect(publicJobDerivedDevelopmentCases).toHaveLength(3)
    expect(
      publicJobDerivedDevelopmentCases.map((evalCase) => evalCase.id)
    ).toEqual([
      'public-grafana-platform-metal-2026-09',
      'public-cloudflare-senior-data-analyst-2026-09',
      'public-anthropic-data-engineer-2026-09',
    ])
    expect(
      new Set(
        publicJobDerivedDevelopmentCases.map(
          (evalCase) => evalCase.provenance?.jobDescription.publisher
        )
      ).size
    ).toBe(3)

    for (const evalCase of publicJobDerivedDevelopmentCases) {
      expect(evalCase.provenance).toMatchObject({
        split: 'development',
        jobDescription: {
          kind: 'public_job_posting_derived',
          handling: 'paraphrased_requirements_only',
          observedAt: '2026-09-16',
        },
        candidate: {
          kind: 'synthetic',
          containsRealPersonalData: false,
        },
      })
      expect(evalCase.provenance?.jobDescription.sourceUrl).toMatch(
        /^https:\/\//
      )
      expect(evalCase.provenance?.jobDescription.sourceUpdatedAt).toMatch(
        /^2026-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-\d{2}:\d{2}$/
      )
      expect(evalCase.request.jobDescription).not.toMatch(/<[^>]+>/)
      expect(JSON.stringify(evalCase.request.candidate)).toMatch(
        /@example\.invalid/
      )
    }
  })

  it('contains candidates accepted by the production resume parser', () => {
    for (const evalCase of publicJobDerivedDevelopmentCases) {
      expect(() =>
        parseCandidateResume(evalCase.request.candidate)
      ).not.toThrow()
    }
  })
})
