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

import { describe, expect, it, vi } from 'vitest'

import type { EvalExecutionResult } from '@/evaluation/contracts'
import { EvalCaseSchema, runEvaluationCampaign } from '@/index'

const campaignCase = EvalCaseSchema.parse({
  version: 1,
  id: 'campaign-case',
  request: {
    jobDescription: 'A sample employer needs a platform engineer.',
    candidate: {
      resume: {
        content: {
          basics: { name: 'Example Candidate' },
          education: [],
        },
      },
    },
  },
  expectations: {
    targetTitle: 'Platform Engineer',
  },
})

const secondCampaignCase = EvalCaseSchema.parse({
  version: 1,
  id: 'second-campaign-case',
  request: {
    jobDescription: 'A sample employer needs a data engineer.',
    candidate: {
      resume: {
        content: {
          basics: { name: 'Second Example Candidate' },
          education: [],
        },
      },
    },
  },
  expectations: {
    targetTitle: 'Data Engineer',
  },
})

function unvalidatedExecutionResult(value: unknown): EvalExecutionResult {
  return value as EvalExecutionResult
}

describe('runEvaluationCampaign', () => {
  it('repeats a dataset sequentially and aggregates safe reports', async () => {
    let calls = 0
    const report = await runEvaluationCampaign(
      [campaignCase],
      async () => {
        calls += 1
        return {
          jobSpec: {
            targetTitle:
              calls === 1 ? 'Platform Engineer' : 'Unrelated Engineer',
          },
          quality: {
            requirementCoverage: calls === 1 ? 0.8 : 0.4,
            mustHaveCoverage: calls === 1 ? 1 : 0.5,
            warnings: [],
          },
        }
      },
      {
        campaignId: 'ra-010c-test',
        provider: 'example-provider',
        model: 'example/model-v1',
        promptRevision: 'prompt-v1',
        runtimeRevision: 'runtime-v1',
        repetitions: 2,
      }
    )

    expect(calls).toBe(2)
    expect(report).toMatchObject({
      version: 1,
      configuration: {
        campaignId: 'ra-010c-test',
        provider: 'example-provider',
        model: 'example/model-v1',
        promptRevision: 'prompt-v1',
        runtimeRevision: 'runtime-v1',
        repetitions: 2,
      },
      aggregate: {
        totalRuns: 2,
        totalCaseExecutions: 2,
        passed: 1,
        failed: 1,
        passRate: 0.5,
        scored: 2,
        averageRequirementCoverage: 0.6,
        averageMustHaveCoverage: 0.75,
        failureCodeCounts: {
          assertion_failed: 1,
          execution_failed: 0,
          invalid_execution_result: 0,
        },
      },
    })
    expect(report.runs).toHaveLength(2)
  })

  it('reports repeated outcome stability for each case', async () => {
    let calls = 0
    const report = await runEvaluationCampaign(
      [campaignCase],
      async () => {
        calls += 1
        return {
          jobSpec: {
            targetTitle:
              calls === 1 ? 'Platform Engineer' : 'Unrelated Engineer',
          },
          quality: {
            requirementCoverage: 0.8,
            mustHaveCoverage: 1,
            warnings: [],
          },
        }
      },
      {
        campaignId: 'ra-010c-case-stability',
        provider: 'example-provider',
        model: 'example-model',
        promptRevision: 'prompt-v1',
        runtimeRevision: 'runtime-v1',
        repetitions: 2,
      }
    )

    expect(report.caseAggregates).toMatchObject([
      {
        caseId: 'campaign-case',
        executions: 2,
        passed: 1,
        failed: 1,
        passRate: 0.5,
        scored: 2,
        failureCodeCounts: {
          assertion_failed: 1,
          execution_failed: 0,
          invalid_execution_result: 0,
        },
      },
    ])
  })

  it('reports Wilson uncertainty for repeated pass rates', async () => {
    let calls = 0
    const report = await runEvaluationCampaign(
      [campaignCase],
      async () => {
        calls += 1
        return {
          jobSpec: {
            targetTitle:
              calls === 1 ? 'Platform Engineer' : 'Unrelated Engineer',
          },
          quality: {
            requirementCoverage: 0.8,
            mustHaveCoverage: 1,
            warnings: [],
          },
        }
      },
      {
        campaignId: 'ra-010c-wilson',
        provider: 'example-provider',
        model: 'example-model',
        promptRevision: 'prompt-v1',
        runtimeRevision: 'runtime-v1',
        repetitions: 2,
      }
    )

    const expectedInterval = {
      confidenceLevel: 0.95,
      lower: 0.0945,
      upper: 0.9055,
      method: 'wilson',
    }
    expect(report.aggregate.passRateConfidenceInterval).toEqual(
      expectedInterval
    )
    expect(report.caseAggregates[0]?.passRateConfidenceInterval).toEqual(
      expectedInterval
    )
  })

  it('keeps single-observation Wilson bounds valid at extreme rates', async () => {
    let calls = 0
    const report = await runEvaluationCampaign(
      [campaignCase, secondCampaignCase],
      async () => {
        calls += 1
        return {
          jobSpec: {
            targetTitle:
              calls === 1 ? 'Platform Engineer' : 'Unrelated Engineer',
          },
          quality: {
            requirementCoverage: 0.8,
            mustHaveCoverage: 1,
            warnings: [],
          },
        }
      },
      {
        campaignId: 'ra-010c-wilson-extremes',
        provider: 'example-provider',
        model: 'example-model',
        promptRevision: 'prompt-v1',
        runtimeRevision: 'runtime-v1',
        repetitions: 1,
      }
    )

    expect(report.caseAggregates.map((aggregate) => aggregate.caseId)).toEqual([
      'campaign-case',
      'second-campaign-case',
    ])
    expect(report.caseAggregates[0]?.passRateConfidenceInterval).toEqual({
      confidenceLevel: 0.95,
      lower: 0.2065,
      upper: 1,
      method: 'wilson',
    })
    expect(report.caseAggregates[1]?.passRateConfidenceInterval).toEqual({
      confidenceLevel: 0.95,
      lower: 0,
      upper: 0.7935,
      method: 'wilson',
    })
  })

  it('reports average and R7 p95 latency for all executions', async () => {
    const now = vi
      .spyOn(performance, 'now')
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(110)
      .mockReturnValueOnce(200)
      .mockReturnValueOnce(230)

    const report = await (async () => {
      try {
        return await runEvaluationCampaign(
          [campaignCase],
          async () => ({
            jobSpec: { targetTitle: 'Platform Engineer' },
            quality: {
              requirementCoverage: 0.8,
              mustHaveCoverage: 1,
              warnings: [],
            },
          }),
          {
            campaignId: 'ra-010c-latency',
            provider: 'example-provider',
            model: 'example-model',
            promptRevision: 'prompt-v1',
            runtimeRevision: 'runtime-v1',
            repetitions: 2,
          }
        )
      } finally {
        now.mockRestore()
      }
    })()

    expect(report.aggregate).toMatchObject({
      averageDurationMs: 20,
      p95DurationMs: 29,
    })
    expect(report.caseAggregates[0]).toMatchObject({
      averageDurationMs: 20,
      p95DurationMs: 29,
    })
  })

  it('represents an empty campaign without fabricated observations', async () => {
    const report = await runEvaluationCampaign(
      [],
      async () => {
        throw new Error('empty campaigns must not execute a case')
      },
      {
        campaignId: 'ra-010c-empty',
        provider: 'example-provider',
        model: 'example-model',
        promptRevision: 'prompt-v1',
        runtimeRevision: 'runtime-v1',
        repetitions: 2,
      }
    )

    expect(report.aggregate).toMatchObject({
      totalRuns: 2,
      totalCaseExecutions: 0,
      passRate: 0,
      passRateConfidenceInterval: null,
      averageDurationMs: null,
      p95DurationMs: null,
    })
    expect(report.caseAggregates).toEqual([])
    expect(JSON.stringify(report)).not.toMatch(/NaN|Infinity/)
  })

  it('keeps scored and failure counts honest across mixed outcomes', async () => {
    const invalidCase = EvalCaseSchema.parse({
      ...campaignCase,
      id: 'invalid-campaign-case',
      request: {
        ...campaignCase.request,
        jobDescription: 'INVALID_RESULT_MARKER',
      },
    })
    const executionFailureCase = EvalCaseSchema.parse({
      ...campaignCase,
      id: 'execution-failure-campaign-case',
      request: {
        ...campaignCase.request,
        jobDescription: 'EXECUTION_FAILURE_MARKER',
      },
    })

    const report = await runEvaluationCampaign(
      [campaignCase, secondCampaignCase, invalidCase, executionFailureCase],
      async (request) => {
        if (request.jobDescription === 'EXECUTION_FAILURE_MARKER') {
          throw new Error('provider failure')
        }
        if (request.jobDescription === 'INVALID_RESULT_MARKER') {
          return unvalidatedExecutionResult({
            jobSpec: { targetTitle: 'Platform Engineer' },
            quality: {
              requirementCoverage: Number.NaN,
              mustHaveCoverage: 1,
              warnings: [],
            },
          })
        }
        return {
          jobSpec: {
            targetTitle:
              request.jobDescription === campaignCase.request.jobDescription
                ? 'Platform Engineer'
                : 'Unrelated Engineer',
          },
          quality: {
            requirementCoverage: 0.8,
            mustHaveCoverage: 1,
            warnings: [],
          },
        }
      },
      {
        campaignId: 'ra-010c-mixed-outcomes',
        provider: 'example-provider',
        model: 'example-model',
        promptRevision: 'prompt-v1',
        runtimeRevision: 'runtime-v1',
        repetitions: 1,
      }
    )

    expect(report.aggregate).toMatchObject({
      totalCaseExecutions: 4,
      passed: 1,
      failed: 3,
      passRate: 0.25,
      scored: 2,
      failureCodeCounts: {
        assertion_failed: 1,
        execution_failed: 1,
        invalid_execution_result: 1,
      },
    })
    expect(report.caseAggregates).toMatchObject([
      { caseId: 'campaign-case', scored: 1 },
      {
        caseId: 'second-campaign-case',
        scored: 1,
        failureCodeCounts: { assertion_failed: 1 },
      },
      {
        caseId: 'invalid-campaign-case',
        scored: 0,
        failureCodeCounts: { invalid_execution_result: 1 },
      },
      {
        caseId: 'execution-failure-campaign-case',
        scored: 0,
        failureCodeCounts: { execution_failed: 1 },
      },
    ])
  })

  it('does not widen the safe report with sensitive execution data', async () => {
    const sensitiveRequest = 'PRIVATE_CAMPAIGN_REQUEST_48152'
    const sensitiveException = 'PRIVATE_CAMPAIGN_EXCEPTION_73904'
    const sensitiveCase = EvalCaseSchema.parse({
      ...campaignCase,
      id: 'sensitive-campaign-case',
      request: {
        ...campaignCase.request,
        jobDescription: sensitiveRequest,
      },
    })

    const report = await runEvaluationCampaign(
      [sensitiveCase],
      async () => {
        throw new Error(sensitiveException)
      },
      {
        campaignId: 'ra-010c-safe-statistics',
        provider: 'example-provider',
        model: 'example-model',
        promptRevision: 'prompt-v1',
        runtimeRevision: 'runtime-v1',
        repetitions: 1,
      }
    )

    const serializedReport = JSON.stringify(report)
    expect(serializedReport).not.toContain(sensitiveRequest)
    expect(serializedReport).not.toContain(sensitiveException)
    expect(serializedReport).not.toContain('Example Candidate')
  })

  it.each([
    [
      'secret-bearing configuration',
      {
        campaignId: 'ra-010c-test',
        provider: 'example-provider',
        model: 'example-model',
        promptRevision: 'prompt-v1',
        runtimeRevision: 'runtime-v1',
        repetitions: 1,
        apiKey: 'PRIVATE_KEY_MUST_NOT_ENTER_REPORTS',
      },
    ],
    [
      'an unbounded repetition count',
      {
        campaignId: 'ra-010c-test',
        provider: 'example-provider',
        model: 'example-model',
        promptRevision: 'prompt-v1',
        runtimeRevision: 'runtime-v1',
        repetitions: 21,
      },
    ],
  ])(
    'rejects %s before executing cases',
    async (_description, configuration) => {
      let executed = false

      await expect(
        runEvaluationCampaign(
          [campaignCase],
          async () => {
            executed = true
            throw new Error('execute must not run')
          },
          configuration
        )
      ).rejects.toThrow()
      expect(executed).toBe(false)
    }
  )
})
