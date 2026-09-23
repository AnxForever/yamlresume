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
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 */

import { describe, expect, it } from 'vitest'

import { retrievalParaphraseCases } from '@/evaluation/fixtures/retrieval-paraphrase'
import {
  evaluateRetrieval,
  hybridRetrievalMatcher,
  lexicalRetrievalMatcher,
  type RetrievalCase,
  RetrievalCaseSchema,
} from '@/evaluation/retrieval'
import { createHashEmbeddingClient } from '@/retrieval/embeddings'

const base: RetrievalCase = {
  version: 1,
  id: 'sample',
  language: 'en',
  requirement: { text: 'Author Terraform modules', keywords: ['Terraform'] },
  evidence: [
    { id: 'a', text: 'Built Terraform modules for networking.' },
    { id: 'b', text: 'Designed print brochures.' },
  ],
  relevantEvidenceIds: ['a'],
}

describe('RetrievalCaseSchema', () => {
  it('rejects a relevant id outside the pool and duplicate evidence ids', () => {
    expect(() =>
      RetrievalCaseSchema.parse({ ...base, relevantEvidenceIds: ['zzz'] })
    ).toThrow(/not in the evidence pool/)
    expect(() =>
      RetrievalCaseSchema.parse({
        ...base,
        evidence: [base.evidence[0], base.evidence[0]],
      })
    ).toThrow(/unique/)
  })

  it('accepts the shipped paraphrase dataset and keeps ids unique', () => {
    const ids = retrievalParaphraseCases.map((item) => item.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.length).toBeGreaterThanOrEqual(20)
    expect(
      retrievalParaphraseCases.filter(
        (item) => item.relevantEvidenceIds.length === 0
      )
    ).toHaveLength(3)
  })
})

describe('evaluateRetrieval', () => {
  it('scores a perfect matcher 1/1/1 and a trap case correctly', async () => {
    const perfect = {
      id: 'oracle',
      async match(requirement: { id: string }) {
        const item = retrievalParaphraseCases.find(
          (entry) => entry.id === requirement.id
        )
        return item?.relevantEvidenceIds ?? []
      },
    }
    const report = await evaluateRetrieval(retrievalParaphraseCases, perfect)
    expect(report.macro).toEqual({ precision: 1, recall: 1, f1: 1 })
    expect(report.micro).toEqual({ precision: 1, recall: 1, f1: 1 })
    expect(report.exactCases).toBe(retrievalParaphraseCases.length)
  })

  it('charges false positives and false negatives per case and pools them', async () => {
    const greedy = {
      id: 'everything',
      async match(_r: unknown, evidence: { id: string }[]) {
        return evidence.map((item) => item.id)
      },
    }
    const report = await evaluateRetrieval([base], greedy)
    expect(report.cases[0]).toMatchObject({
      truePositives: 1,
      falsePositives: 1,
      falseNegatives: 0,
      precision: 0.5,
      recall: 1,
      exact: false,
    })
    const silent = {
      id: 'nothing',
      async match() {
        return []
      },
    }
    const empty = await evaluateRetrieval([base], silent)
    expect(empty.cases[0]).toMatchObject({
      precision: 1,
      recall: 0,
      exact: false,
    })
    expect(empty.micro.f1).toBe(0)
  })

  it('records the lexical baseline on paraphrase: almost no recall, one substring false positive', async () => {
    const report = await evaluateRetrieval(
      retrievalParaphraseCases,
      lexicalRetrievalMatcher()
    )
    expect(report.matcher).toBe('lexical')
    // The gold set is paraphrase by design; the only literal case is Terraform.
    expect(report.micro.recall).toBeLessThanOrEqual(0.1)
    // A two-letter keyword matches as a substring: "Go" inside "go-to-market".
    // Kept as-is on purpose: the lexical matcher is the fixed judge (RA-018
    // section 4.1), so this weakness is recorded here rather than patched.
    const goTrap = report.cases.find(
      (result) => result.caseId === 'trap-go-language'
    )
    expect(goTrap?.falsePositives).toBe(1)
    const otherTraps = report.cases.filter(
      (result) =>
        result.expected.length === 0 && result.caseId !== 'trap-go-language'
    )
    expect(otherTraps.every((result) => result.exact)).toBe(true)
  })

  it('runs the hybrid matcher with the hash embedding and reports its model id', async () => {
    const report = await evaluateRetrieval(
      retrievalParaphraseCases,
      hybridRetrievalMatcher({
        embeddings: createHashEmbeddingClient(),
        acceptance: { kind: 'absolute', threshold: 0.2 },
      })
    )
    expect(report.matcher).toBe('hybrid:hash-ngram-v1/512:absolute=0.2')
    expect(
      report.byLanguage.en.cases +
        report.byLanguage.zh.cases +
        report.byLanguage.mixed.cases
    ).toBe(retrievalParaphraseCases.length)
    expect(report.micro.recall).toBeGreaterThanOrEqual(0)
  })
})
