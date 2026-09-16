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

import { EvalCaseSchema } from '@/evaluation/contracts'
import { fictionalPlatformEngineerCase } from '@/evaluation/fixtures/fictional-platform-engineer'
import { runEvaluation } from '@/evaluation/runner'

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

describe('EvalCaseSchema', () => {
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

describe('runEvaluation', () => {
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
  })

  it('aggregates passed, assertion-failed, and execution-failed cases', async () => {
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

    const report = await runEvaluation(
      [
        fictionalPlatformEngineerCase,
        assertionFailureCase,
        executionFailureCase,
      ],
      async (request) => {
        if (request.preferences?.targetTitle === 'Execution Failure Input') {
          throw new Error('A raw provider error that must not be reported')
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
      total: 3,
      passed: 1,
      failed: 2,
      passRate: 0.3333,
      scored: 2,
      averageRequirementCoverage: 0.6,
      averageMustHaveCoverage: 0.75,
      failureCodeCounts: {
        assertion_failed: 1,
        execution_failed: 1,
      },
    })
    expect(report.results.map((result) => result.failureCode)).toEqual([
      null,
      'assertion_failed',
      'execution_failed',
    ])
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
