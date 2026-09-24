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
  EvalCaseSchema,
  type EvalExecutionResult,
  EvalExecutionResultSchema,
} from '@/evaluation/contracts'
import { fictionalPlatformEngineerCase } from '@/evaluation/fixtures/fictional-platform-engineer'
import { runEvaluation } from '@/evaluation/runner'
import { DraftValidationError } from '@/validation/resume'

const validCase = {
  version: 1,
  id: 'fictional-platform-engineer',
  request: {
    jobDescription:
      'A fictional team needs a platform engineer for typed service tooling.',
    candidate: {
      resume: {
        content: {
          basics: { name: 'Example Candidate' },
          education: [],
        },
      },
    },
  },
}

function unvalidatedExecutionResult(value: unknown): EvalExecutionResult {
  return value as EvalExecutionResult
}

describe('EvalCaseSchema', () => {
  it('accepts only safe provenance for a public-job-derived case', () => {
    const provenance = {
      split: 'development',
      jobDescription: {
        kind: 'public_job_posting_derived',
        publisher: 'Example Employer',
        sourceUrl: 'https://example.com/jobs/123',
        sourcePostingId: '123',
        observedAt: '2026-09-16',
        sourceUpdatedAt: '2026-09-14T04:21:56-04:00',
        handling: 'paraphrased_requirements_only',
      },
      candidate: {
        kind: 'synthetic',
        containsRealPersonalData: false,
      },
    }

    expect(EvalCaseSchema.safeParse({ ...validCase, provenance }).success).toBe(
      true
    )
    expect(
      EvalCaseSchema.safeParse({
        ...validCase,
        provenance: {
          ...provenance,
          jobDescription: {
            ...provenance.jobDescription,
            sourceUrl: 'http://example.com/jobs/123',
          },
        },
      }).success
    ).toBe(false)
    expect(
      EvalCaseSchema.safeParse({
        ...validCase,
        provenance: {
          ...provenance,
          candidate: {
            ...provenance.candidate,
            containsRealPersonalData: true,
          },
        },
      }).success
    ).toBe(false)
  })

  it.each([
    ['an unsupported version', { ...validCase, version: 2 }],
    ['an unstable id', { ...validCase, id: 'Candidate Name' }],
    [
      'an invalid tailoring request',
      {
        ...validCase,
        request: {
          jobDescription: validCase.request.jobDescription,
          candidate: {},
        },
      },
    ],
    [
      'an out-of-range coverage threshold',
      {
        ...validCase,
        expectations: { minimumRequirementCoverage: 1.01 },
      },
    ],
    [
      'a conflicting warning expectation',
      {
        ...validCase,
        expectations: {
          requiredWarningCodes: ['missing_job_keywords'],
          forbiddenWarningCodes: ['missing_job_keywords'],
        },
      },
    ],
  ])('rejects %s', (_description, input) => {
    expect(EvalCaseSchema.safeParse(input).success).toBe(false)
  })
})

describe('EvalExecutionResultSchema', () => {
  it('parses a valid result into the minimal safe observation shape', () => {
    const parsed: EvalExecutionResult = EvalExecutionResultSchema.parse({
      jobSpec: {
        targetTitle: 'Platform Engineer',
        company: 'PRIVATE_COMPANY_VALUE',
      },
      quality: {
        requirementCoverage: 0.8,
        mustHaveCoverage: 1,
        warnings: [
          {
            code: 'missing_job_keywords',
            message: 'PRIVATE_WARNING_MESSAGE',
          },
        ],
        missingKeywords: ['PRIVATE_KEYWORD'],
      },
      resume: 'PRIVATE_RESUME_VALUE',
    })

    expect(parsed).toEqual({
      jobSpec: { targetTitle: 'Platform Engineer' },
      quality: {
        requirementCoverage: 0.8,
        mustHaveCoverage: 1,
        warnings: [{ code: 'missing_job_keywords' }],
      },
    })
  })

  it.each(['', '   ', 'x'.repeat(201)])(
    'rejects an empty or oversized target title',
    (targetTitle) => {
      const result = EvalExecutionResultSchema.safeParse({
        jobSpec: { targetTitle },
        quality: {
          requirementCoverage: 1,
          mustHaveCoverage: 1,
          warnings: [],
        },
      })

      expect(result.success).toBe(false)
    }
  )

  it.each([
    ['requirementCoverage', Number.NaN],
    ['requirementCoverage', Number.POSITIVE_INFINITY],
    ['requirementCoverage', -0.1],
    ['requirementCoverage', 1.1],
    ['mustHaveCoverage', Number.NaN],
    ['mustHaveCoverage', Number.POSITIVE_INFINITY],
    ['mustHaveCoverage', -0.1],
    ['mustHaveCoverage', 1.1],
  ] as const)('rejects invalid %s value %s', (field, value) => {
    const result = EvalExecutionResultSchema.safeParse({
      jobSpec: { targetTitle: 'Platform Engineer' },
      quality: {
        requirementCoverage: 1,
        mustHaveCoverage: 1,
        warnings: [],
        [field]: value,
      },
    })

    expect(result.success).toBe(false)
  })

  it.each([
    ['an unstable code', [{ code: 'Invalid Warning Code' }]],
    [
      'duplicate codes',
      [{ code: 'missing_job_keywords' }, { code: 'missing_job_keywords' }],
    ],
    [
      'too many warnings',
      Array.from({ length: 51 }, (_value, index) => ({
        code: `warning_${index}`,
      })),
    ],
  ])('rejects warnings with %s', (_description, warnings) => {
    const result = EvalExecutionResultSchema.safeParse({
      jobSpec: { targetTitle: 'Platform Engineer' },
      quality: {
        requirementCoverage: 1,
        mustHaveCoverage: 1,
        warnings,
      },
    })

    expect(result.success).toBe(false)
  })
})

describe('runEvaluation', () => {
  it('checks required job keywords without case-sensitive drift', async () => {
    const keywordCase = EvalCaseSchema.parse({
      ...validCase,
      expectations: {
        requiredJobKeywords: ['Kubernetes', 'Terraform'],
      },
    })

    const report = await runEvaluation([keywordCase], async () => ({
      jobSpec: {
        targetTitle: 'Platform Engineer',
        keywords: ['kubernetes', 'Go'],
      },
      quality: {
        requirementCoverage: 1,
        mustHaveCoverage: 1,
        warnings: [],
      },
    }))

    expect(report.results[0]).toMatchObject({
      passed: false,
      assertions: [
        {
          code: 'required_job_keyword',
          subject: 'Kubernetes',
          passed: true,
        },
        {
          code: 'required_job_keyword',
          subject: 'Terraform',
          passed: false,
        },
      ],
      failureCode: 'assertion_failed',
    })
  })

  it('passes a case when the execution satisfies every expectation', async () => {
    const report = await runEvaluation(
      [fictionalPlatformEngineerCase],
      async (request) => {
        expect(request).toEqual(fictionalPlatformEngineerCase.request)

        return {
          jobSpec: { targetTitle: 'Platform Engineer' },
          quality: {
            requirementCoverage: 0.8,
            mustHaveCoverage: 1,
            warnings: [{ code: 'missing_job_keywords' }],
          },
        }
      }
    )

    expect(report).toMatchObject({
      version: 1,
      total: 1,
      passed: 1,
      failed: 0,
      passRate: 1,
      scored: 1,
      averageRequirementCoverage: 0.8,
      averageMustHaveCoverage: 1,
      failureCodeCounts: {
        assertion_failed: 0,
        execution_failed: 0,
        invalid_execution_result: 0,
      },
      results: [
        {
          caseId: 'fictional-platform-engineer',
          passed: true,
          assertions: [
            { code: 'target_title', passed: true },
            { code: 'minimum_requirement_coverage', passed: true },
            { code: 'minimum_must_have_coverage', passed: true },
            {
              code: 'required_warning_code',
              subject: 'missing_job_keywords',
              passed: true,
            },
            {
              code: 'forbidden_warning_code',
              subject: 'unsupported_claim',
              passed: true,
            },
          ],
          failureCode: null,
        },
      ],
    })
    expect(report.results[0]?.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('fails a case when its deterministic assertions are not satisfied', async () => {
    const report = await runEvaluation(
      [fictionalPlatformEngineerCase],
      async () => ({
        jobSpec: { targetTitle: 'Unrelated Title' },
        quality: {
          requirementCoverage: 0.5,
          mustHaveCoverage: 0.5,
          warnings: [{ code: 'unsupported_claim' }],
        },
      })
    )

    expect(report).toMatchObject({
      total: 1,
      passed: 0,
      failed: 1,
      passRate: 0,
      scored: 1,
      averageRequirementCoverage: 0.5,
      averageMustHaveCoverage: 0.5,
      failureCodeCounts: {
        assertion_failed: 1,
        execution_failed: 0,
        invalid_execution_result: 0,
      },
      results: [
        {
          caseId: 'fictional-platform-engineer',
          passed: false,
          assertions: [
            { code: 'target_title', passed: false },
            { code: 'minimum_requirement_coverage', passed: false },
            { code: 'minimum_must_have_coverage', passed: false },
            {
              code: 'required_warning_code',
              subject: 'missing_job_keywords',
              passed: false,
            },
            {
              code: 'forbidden_warning_code',
              subject: 'unsupported_claim',
              passed: false,
            },
          ],
          failureCode: 'assertion_failed',
        },
      ],
    })
  })

  it('does not leak a sensitive execution exception into the report', async () => {
    const sensitiveResume = 'PRIVATE_RESUME_BODY_48291'
    const sensitiveApiKey = 'FAKE_SECRET_KEY_73915'
    const sensitiveCompletion = 'RAW_MODEL_COMPLETION_16504'

    const report = await runEvaluation(
      [fictionalPlatformEngineerCase],
      async () => {
        throw new Error(
          `${sensitiveResume} ${sensitiveApiKey} ${sensitiveCompletion}`
        )
      }
    )

    expect(report).toMatchObject({
      total: 1,
      passed: 0,
      failed: 1,
      passRate: 0,
      scored: 0,
      averageRequirementCoverage: 0,
      averageMustHaveCoverage: 0,
      failureCodeCounts: {
        assertion_failed: 0,
        execution_failed: 1,
        invalid_execution_result: 0,
      },
      results: [
        {
          caseId: 'fictional-platform-engineer',
          passed: false,
          assertions: [],
          failureCode: 'execution_failed',
        },
      ],
    })

    const serializedReport = JSON.stringify(report)
    expect(serializedReport).not.toContain(sensitiveResume)
    expect(serializedReport).not.toContain(sensitiveApiKey)
    expect(serializedReport).not.toContain(sensitiveCompletion)
    expect(serializedReport).not.toContain('candidate@example.invalid')
    expect(serializedReport).not.toContain('Imaginary Queue Simulator')
    expect(report.results[0]).not.toHaveProperty('diagnostic')
  })

  it('reports only a stable code and safe path for draft validation failures', async () => {
    const sensitiveMessage = 'PRIVATE_DRAFT_AND_COMPLETION_94720'
    const report = await runEvaluation(
      [fictionalPlatformEngineerCase],
      async () => {
        throw new DraftValidationError(sensitiveMessage, {
          code: 'draft_schema_invalid',
          path: 'content.work.0.startDate',
        })
      }
    )

    expect(report.results[0]).toMatchObject({
      passed: false,
      failureCode: 'execution_failed',
      diagnostic: {
        stage: 'draft_validation',
        code: 'draft_schema_invalid',
        path: 'content.work.0.startDate',
      },
    })
    expect(JSON.stringify(report)).not.toContain(sensitiveMessage)
  })

  it('drops an unsafe draft path while retaining its stable code', async () => {
    const sensitivePath = 'content.work.0.PRIVATE_FIELD_VALUE_38410'
    const report = await runEvaluation(
      [fictionalPlatformEngineerCase],
      async () => {
        throw new DraftValidationError('safe message is not reported', {
          code: 'draft_schema_invalid',
          path: sensitivePath,
        })
      }
    )

    expect(report.results[0]?.diagnostic).toEqual({
      stage: 'draft_validation',
      code: 'draft_schema_invalid',
    })
    expect(JSON.stringify(report)).not.toContain(sensitivePath)
  })

  it('classifies a resolved invalid result without scoring or leaking it', async () => {
    const sensitiveInvalidValue = 'RAW_INVALID_RESULT_82416'
    const report = await runEvaluation(
      [fictionalPlatformEngineerCase],
      async () =>
        unvalidatedExecutionResult({
          jobSpec: { targetTitle: 'Platform Engineer' },
          providerCompletion: sensitiveInvalidValue,
        })
    )

    expect(report).toMatchObject({
      total: 1,
      passed: 0,
      failed: 1,
      passRate: 0,
      scored: 0,
      averageRequirementCoverage: 0,
      averageMustHaveCoverage: 0,
      failureCodeCounts: {
        assertion_failed: 0,
        execution_failed: 0,
        invalid_execution_result: 1,
      },
      results: [
        {
          caseId: 'fictional-platform-engineer',
          passed: false,
          assertions: [],
          failureCode: 'invalid_execution_result',
        },
      ],
    })

    const serializedReport = JSON.stringify(report)
    expect(serializedReport).not.toContain(sensitiveInvalidValue)
    expect(serializedReport).not.toContain('candidate@example.invalid')
    expect(serializedReport).not.toContain('Imaginary Queue Simulator')
  })

  it('aggregates valid, assertion-failed, invalid, and rejected executions', async () => {
    const assertionFailureCase = EvalCaseSchema.parse({
      ...fictionalPlatformEngineerCase,
      id: 'fictional-assertion-failure',
      request: {
        ...fictionalPlatformEngineerCase.request,
        preferences: {
          ...fictionalPlatformEngineerCase.request.preferences,
          targetTitle: 'Assertion Failure Input',
        },
      },
    })
    const executionFailureCase = EvalCaseSchema.parse({
      ...fictionalPlatformEngineerCase,
      id: 'fictional-execution-failure',
      request: {
        ...fictionalPlatformEngineerCase.request,
        preferences: {
          ...fictionalPlatformEngineerCase.request.preferences,
          targetTitle: 'Execution Failure Input',
        },
      },
    })
    const invalidExecutionCase = EvalCaseSchema.parse({
      ...fictionalPlatformEngineerCase,
      id: 'fictional-invalid-execution-result',
      request: {
        ...fictionalPlatformEngineerCase.request,
        preferences: {
          ...fictionalPlatformEngineerCase.request.preferences,
          targetTitle: 'Invalid Result Input',
        },
      },
    })
    const sensitiveInvalidValue = 'RAW_INVALID_AGGREGATE_RESULT_93147'
    const sensitiveException = 'PRIVATE_PROVIDER_EXCEPTION_27580'

    const report = await runEvaluation(
      [
        fictionalPlatformEngineerCase,
        assertionFailureCase,
        invalidExecutionCase,
        executionFailureCase,
      ],
      async (request) => {
        if (request.preferences?.targetTitle === 'Execution Failure Input') {
          throw new Error(sensitiveException)
        }
        if (request.preferences?.targetTitle === 'Invalid Result Input') {
          return unvalidatedExecutionResult({
            jobSpec: { targetTitle: 'Platform Engineer' },
            quality: {
              requirementCoverage: Number.NaN,
              mustHaveCoverage: 1,
              warnings: [],
            },
            rawCompletion: sensitiveInvalidValue,
          })
        }
        if (request.preferences?.targetTitle === 'Assertion Failure Input') {
          return {
            jobSpec: { targetTitle: 'Unrelated Title' },
            quality: {
              requirementCoverage: 0.4,
              mustHaveCoverage: 0.5,
              warnings: [{ code: 'unsupported_claim' }],
            },
          }
        }

        return {
          jobSpec: { targetTitle: 'Platform Engineer' },
          quality: {
            requirementCoverage: 0.8,
            mustHaveCoverage: 1,
            warnings: [{ code: 'missing_job_keywords' }],
          },
        }
      }
    )

    expect(report).toMatchObject({
      total: 4,
      passed: 1,
      failed: 3,
      passRate: 0.25,
      scored: 2,
      averageRequirementCoverage: 0.6,
      averageMustHaveCoverage: 0.75,
      failureCodeCounts: {
        assertion_failed: 1,
        execution_failed: 1,
        invalid_execution_result: 1,
      },
    })
    expect(report.results.map((result) => result.failureCode)).toEqual([
      null,
      'assertion_failed',
      'invalid_execution_result',
      'execution_failed',
    ])

    const serializedReport = JSON.stringify(report)
    expect(serializedReport).not.toContain(sensitiveInvalidValue)
    expect(serializedReport).not.toContain(sensitiveException)
    expect(serializedReport).not.toContain('candidate@example.invalid')
    expect(serializedReport).not.toContain('Imaginary Queue Simulator')
  })

  it('returns deterministic zero values for an empty dataset', async () => {
    const report = await runEvaluation([], async () => {
      throw new Error('execute must not run for an empty dataset')
    })

    expect(report).toEqual({
      version: 1,
      total: 0,
      passed: 0,
      failed: 0,
      passRate: 0,
      scored: 0,
      averageRequirementCoverage: 0,
      averageMustHaveCoverage: 0,
      failureCodeCounts: {
        assertion_failed: 0,
        execution_failed: 0,
        invalid_execution_result: 0,
      },
      results: [],
    })
  })

  it('rejects duplicate case ids before execution', async () => {
    let executed = false

    await expect(
      runEvaluation(
        [fictionalPlatformEngineerCase, fictionalPlatformEngineerCase],
        async () => {
          executed = true
          return {
            jobSpec: { targetTitle: 'Platform Engineer' },
            quality: {
              requirementCoverage: 1,
              mustHaveCoverage: 1,
              warnings: [],
            },
          }
        }
      )
    ).rejects.toThrow()
    expect(executed).toBe(false)
  })
})
