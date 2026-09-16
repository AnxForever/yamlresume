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
