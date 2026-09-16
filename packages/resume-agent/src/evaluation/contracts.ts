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

export const EvalCaseSchema = z
  .object({
    version: z.literal(1),
    id: StableCodeSchema,
    request: TailorResumeRequestSchema,
    expectations: EvalExpectationsSchema.optional(),
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
export type EvalDataset = z.input<typeof EvalDatasetSchema>
export type EvalExpectations = z.output<typeof EvalExpectationsSchema>

export const EvalExecutionResultSchema = z.object({
  jobSpec: z.object({
    targetTitle: z.string().trim().min(1).max(200),
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

export interface EvalCaseResult {
  caseId: string
  passed: boolean
  assertions: EvalAssertionResult[]
  durationMs: number
  failureCode: EvalFailureCode | null
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
