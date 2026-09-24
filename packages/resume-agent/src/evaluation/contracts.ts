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

import { z } from 'zod'

import { TailorResumeRequestSchema } from '@/contracts'
import type { DraftValidationErrorCode } from '@/validation/resume'

const StableCodeSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/)

const WarningCodesSchema = z
  .array(StableCodeSchema)
  .max(50)
  .refine((codes) => new Set(codes).size === codes.length, {
    message: 'Warning codes must be unique',
  })

const CoverageSchema = z.number().finite().min(0).max(1)

const JobKeywordsSchema = z
  .array(z.string().trim().min(1).max(128))
  .max(100)
  .refine(
    (keywords) =>
      new Set(keywords.map((keyword) => keyword.toLocaleLowerCase())).size ===
      keywords.length,
    { message: 'Job keywords must be unique ignoring case' }
  )

const ISODateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`)
    return (
      !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
    )
  }, 'Date must be a real calendar date')

const HttpsUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2_048)
  .url()
  .refine((value) => new URL(value).protocol === 'https:', {
    message: 'Source URL must use HTTPS',
  })

const ExecutionWarningsSchema = z
  .array(z.object({ code: StableCodeSchema }))
  .max(50)
  .refine(
    (warnings) =>
      new Set(warnings.map((warning) => warning.code)).size === warnings.length,
    { message: 'Execution warning codes must be unique' }
  )

export const EvalExpectationsSchema = z
  .object({
    targetTitle: z.string().trim().min(1).max(200).optional(),
    minimumRequirementCoverage: CoverageSchema.optional(),
    minimumMustHaveCoverage: CoverageSchema.optional(),
    requiredJobKeywords: JobKeywordsSchema.max(25).optional(),
    requiredWarningCodes: WarningCodesSchema.optional(),
    forbiddenWarningCodes: WarningCodesSchema.optional(),
  })
  .strict()
  .superRefine((expectations, context) => {
    const forbidden = new Set(expectations.forbiddenWarningCodes)
    for (const code of expectations.requiredWarningCodes ?? []) {
      if (forbidden.has(code)) {
        context.addIssue({
          code: 'custom',
          message: 'A warning code cannot be both required and forbidden',
          path: ['requiredWarningCodes'],
        })
      }
    }
  })

export const EvalCaseProvenanceSchema = z
  .object({
    split: z.enum(['development', 'held-out']),
    jobDescription: z
      .object({
        kind: z.literal('public_job_posting_derived'),
        publisher: z.string().trim().min(1).max(200),
        sourceUrl: HttpsUrlSchema,
        sourcePostingId: StableCodeSchema,
        observedAt: ISODateSchema,
        sourceUpdatedAt: z.string().datetime({ offset: true }),
        handling: z.literal('paraphrased_requirements_only'),
      })
      .strict(),
    candidate: z
      .object({
        kind: z.literal('synthetic'),
        containsRealPersonalData: z.literal(false),
      })
      .strict(),
  })
  .strict()

export const EvalCaseSchema = z
  .object({
    version: z.literal(1),
    id: StableCodeSchema,
    request: TailorResumeRequestSchema,
    expectations: EvalExpectationsSchema.optional(),
    provenance: EvalCaseProvenanceSchema.optional(),
  })
  .strict()

export const EvalDatasetSchema = z
  .array(EvalCaseSchema)
  .superRefine((cases, context) => {
    const seenIds = new Set<string>()
    cases.forEach((evalCase, index) => {
      if (seenIds.has(evalCase.id)) {
        context.addIssue({
          code: 'custom',
          message: 'Evaluation case ids must be unique',
          path: [index, 'id'],
        })
      }
      seenIds.add(evalCase.id)
    })
  })

export type EvalCase = z.input<typeof EvalCaseSchema>
export type EvalCaseData = z.output<typeof EvalCaseSchema>
export type EvalCaseProvenance = z.output<typeof EvalCaseProvenanceSchema>
export type EvalDataset = z.input<typeof EvalDatasetSchema>
export type EvalExpectations = z.output<typeof EvalExpectationsSchema>

export const EvalExecutionResultSchema = z.object({
  jobSpec: z.object({
    targetTitle: z.string().trim().min(1).max(200),
    keywords: JobKeywordsSchema.optional(),
  }),
  quality: z.object({
    requirementCoverage: CoverageSchema,
    mustHaveCoverage: CoverageSchema,
    warnings: ExecutionWarningsSchema,
  }),
})

export type EvalExecutionResult = z.output<typeof EvalExecutionResultSchema>

export type EvalExecute = (
  request: EvalCaseData['request']
) => Promise<EvalExecutionResult>

export type EvalAssertionCode =
  | 'target_title'
  | 'required_job_keyword'
  | 'minimum_requirement_coverage'
  | 'minimum_must_have_coverage'
  | 'required_warning_code'
  | 'forbidden_warning_code'

export interface EvalAssertionResult {
  code: EvalAssertionCode
  subject?: string
  passed: boolean
}

export type EvalFailureCode =
  | 'assertion_failed'
  | 'execution_failed'
  | 'invalid_execution_result'

export interface EvalExecutionDiagnostic {
  stage: 'draft_validation'
  code: DraftValidationErrorCode
  path?: string
}

export interface EvalCaseResult {
  caseId: string
  passed: boolean
  assertions: EvalAssertionResult[]
  durationMs: number
  failureCode: EvalFailureCode | null
  diagnostic?: EvalExecutionDiagnostic
}

export interface EvalReport {
  version: 1
  total: number
  passed: number
  failed: number
  passRate: number
  scored: number
  averageRequirementCoverage: number
  averageMustHaveCoverage: number
  failureCodeCounts: Record<EvalFailureCode, number>
  results: EvalCaseResult[]
}
