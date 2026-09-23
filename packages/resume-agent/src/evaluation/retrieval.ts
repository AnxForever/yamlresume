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

import { z } from 'zod'

import type { Evidence, JobRequirement, JobSpec } from '@/contracts'
import { buildMatchReport } from '@/matching/match'
import {
  buildHybridMatchReport,
  DEFAULT_SEMANTIC_ACCEPTANCE,
  type HybridMatchOptions,
} from '@/retrieval/hybrid'

/**
 * A retrieval gold case: one requirement, a small pool of evidence, and the
 * ids a careful reader would accept as support. `relevantEvidenceIds` may be
 * empty: those cases exist to catch matchers that see support everywhere.
 */
export const RetrievalCaseSchema = z
  .object({
    version: z.literal(1),
    id: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/),
    language: z.enum(['en', 'zh', 'mixed']),
    requirement: z.object({
      text: z.string().trim().min(1).max(300),
      keywords: z.array(z.string().trim().min(1).max(64)).max(5).default([]),
    }),
    evidence: z
      .array(
        z.object({
          id: z.string().trim().min(1).max(128),
          text: z.string().trim().min(1).max(2_000),
        })
      )
      .min(1)
      .max(12),
    relevantEvidenceIds: z.array(z.string().trim().min(1).max(128)).max(12),
  })
  .strict()
  .superRefine((value, context) => {
    const ids = new Set(value.evidence.map((item) => item.id))
    if (ids.size !== value.evidence.length) {
      context.addIssue({
        code: 'custom',
        message: 'Evidence ids must be unique',
        path: ['evidence'],
      })
    }
    for (const id of value.relevantEvidenceIds) {
      if (!ids.has(id)) {
        context.addIssue({
          code: 'custom',
          message: `Relevant id ${id} is not in the evidence pool`,
          path: ['relevantEvidenceIds'],
        })
      }
    }
  })

export const RetrievalDatasetSchema = z
  .array(RetrievalCaseSchema)
  .superRefine((cases, context) => {
    const seen = new Set<string>()
    cases.forEach((item, index) => {
      if (seen.has(item.id)) {
        context.addIssue({
          code: 'custom',
          message: 'Retrieval case ids must be unique',
          path: [index, 'id'],
        })
      }
      seen.add(item.id)
    })
  })

export type RetrievalCase = z.input<typeof RetrievalCaseSchema>
export type RetrievalCaseData = z.output<typeof RetrievalCaseSchema>

/** Returns the evidence ids a matcher treats as support for the requirement. */
export interface RetrievalMatcher {
  id: string
  match(requirement: JobRequirement, evidence: Evidence[]): Promise<string[]>
}

export interface RetrievalCaseResult {
  caseId: string
  language: RetrievalCaseData['language']
  expected: string[]
  actual: string[]
  truePositives: number
  falsePositives: number
  falseNegatives: number
  precision: number
  recall: number
  exact: boolean
}

export interface RetrievalMetrics {
  precision: number
  recall: number
  f1: number
}

export interface RetrievalReport {
  version: 1
  matcher: string
  cases: RetrievalCaseResult[]
  /** Averaged per case; a case with nothing expected and nothing found scores 1. */
  macro: RetrievalMetrics
  /** Pooled over all cases; the number that answers "how many labels did it get". */
  micro: RetrievalMetrics
  exactCases: number
  byLanguage: Record<
    RetrievalCaseData['language'],
    RetrievalMetrics & { cases: number }
  >
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

function metrics(tp: number, fp: number, fn: number): RetrievalMetrics {
  const precision = tp + fp === 0 ? 1 : tp / (tp + fp)
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn)
  const f1 =
    precision + recall === 0
      ? 0
      : (2 * precision * recall) / (precision + recall)
  return { precision: round(precision), recall: round(recall), f1: round(f1) }
}

function toSpec(requirement: JobRequirement): JobSpec {
  return {
    targetTitle: 'Retrieval gold case',
    seniority: 'unknown',
    summary: requirement.text,
    requirements: [requirement],
    keywords: requirement.keywords,
  }
}

export function lexicalRetrievalMatcher(): RetrievalMatcher {
  return {
    id: 'lexical',
    async match(requirement, evidence) {
      const report = buildMatchReport(toSpec(requirement), evidence)
      return report.matchedRequirements[0]?.evidenceIds ?? []
    },
  }
}

function describeAcceptance(options: HybridMatchOptions): string {
  const acceptance = options.acceptance ?? DEFAULT_SEMANTIC_ACCEPTANCE
  return acceptance.kind === 'absolute'
    ? `absolute=${acceptance.threshold}`
    : `margin=${acceptance.margin}`
}

export function hybridRetrievalMatcher(
  options: HybridMatchOptions
): RetrievalMatcher {
  return {
    id: `hybrid:${options.embeddings.id}:${describeAcceptance(options)}`,
    async match(requirement, evidence) {
      const report = await buildHybridMatchReport(
        toSpec(requirement),
        evidence,
        options
      )
      return report.matchedRequirements[0]?.evidenceIds ?? []
    },
  }
}

export async function evaluateRetrieval(
  cases: readonly RetrievalCase[],
  matcher: RetrievalMatcher
): Promise<RetrievalReport> {
  const dataset = RetrievalDatasetSchema.parse(cases)
  const results: RetrievalCaseResult[] = []
  const pooled = { tp: 0, fp: 0, fn: 0 }
  const perLanguage: Record<
    string,
    { tp: number; fp: number; fn: number; cases: number }
  > = {}
  for (const item of dataset) {
    const requirement: JobRequirement = {
      id: item.id,
      text: item.requirement.text,
      keywords: item.requirement.keywords,
      importance: 'must-have',
      category: 'technical',
    }
    const evidence: Evidence[] = item.evidence.map((entry) => ({
      id: entry.id,
      path: entry.id,
      section: 'work',
      text: entry.text,
    }))
    const actual = [
      ...new Set(await matcher.match(requirement, evidence)),
    ].sort()
    const expected = [...item.relevantEvidenceIds].sort()
    const expectedSet = new Set(expected)
    const actualSet = new Set(actual)
    const tp = actual.filter((id) => expectedSet.has(id)).length
    const fp = actual.length - tp
    const fn = expected.filter((id) => !actualSet.has(id)).length
    const { precision, recall } = metrics(tp, fp, fn)
    results.push({
      caseId: item.id,
      language: item.language,
      expected,
      actual,
      truePositives: tp,
      falsePositives: fp,
      falseNegatives: fn,
      precision,
      recall,
      exact: fp === 0 && fn === 0,
    })
    pooled.tp += tp
    pooled.fp += fp
    pooled.fn += fn
    const bucket = perLanguage[item.language] ?? {
      tp: 0,
      fp: 0,
      fn: 0,
      cases: 0,
    }
    perLanguage[item.language] = bucket
    bucket.tp += tp
    bucket.fp += fp
    bucket.fn += fn
    bucket.cases += 1
  }
  const macro = {
    precision: round(
      results.reduce((total, result) => total + result.precision, 0) /
        Math.max(results.length, 1)
    ),
    recall: round(
      results.reduce((total, result) => total + result.recall, 0) /
        Math.max(results.length, 1)
    ),
    f1: 0,
  }
  macro.f1 =
    macro.precision + macro.recall === 0
      ? 0
      : round(
          (2 * macro.precision * macro.recall) /
            (macro.precision + macro.recall)
        )
  const byLanguage = Object.fromEntries(
    (['en', 'zh', 'mixed'] as const).map((language) => {
      const bucket = perLanguage[language] ?? { tp: 0, fp: 0, fn: 0, cases: 0 }
      return [
        language,
        { ...metrics(bucket.tp, bucket.fp, bucket.fn), cases: bucket.cases },
      ]
    })
  ) as RetrievalReport['byLanguage']
  return {
    version: 1,
    matcher: matcher.id,
    cases: results,
    macro,
    micro: metrics(pooled.tp, pooled.fp, pooled.fn),
    exactCases: results.filter((result) => result.exact).length,
    byLanguage,
  }
}
