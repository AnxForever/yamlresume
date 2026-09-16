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

import type {
  EvalCase,
  EvalExecute,
  EvalFailureCode,
  EvalReport,
} from '@/evaluation/contracts'
import { runEvaluation } from '@/evaluation/runner'

const CampaignIdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9]+(?:[._:/-][A-Za-z0-9]+)*$/)

export const EvalCampaignConfigurationSchema = z
  .object({
    campaignId: CampaignIdentifierSchema,
    provider: CampaignIdentifierSchema,
    model: CampaignIdentifierSchema,
    promptRevision: CampaignIdentifierSchema,
    runtimeRevision: CampaignIdentifierSchema,
    repetitions: z.number().int().min(1).max(20).default(1),
  })
  .strict()

export type EvalCampaignConfiguration = z.input<
  typeof EvalCampaignConfigurationSchema
>
export type EvalCampaignConfigurationData = z.output<
  typeof EvalCampaignConfigurationSchema
>

export interface EvalCampaignAggregate {
  totalRuns: number
  totalCaseExecutions: number
  passed: number
  failed: number
  passRate: number
  scored: number
  averageRequirementCoverage: number
  averageMustHaveCoverage: number
  failureCodeCounts: Record<EvalFailureCode, number>
}

export interface EvalCampaignReport {
  version: 1
  configuration: EvalCampaignConfigurationData
  aggregate: EvalCampaignAggregate
  runs: EvalReport[]
}

function roundMetric(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

function aggregateRuns(runs: EvalReport[]): EvalCampaignAggregate {
  const totalCaseExecutions = runs.reduce(
    (total, report) => total + report.total,
    0
  )
  const passed = runs.reduce((total, report) => total + report.passed, 0)
  const scored = runs.reduce((total, report) => total + report.scored, 0)
  const requirementCoverageTotal = runs.reduce(
    (total, report) =>
      total + report.averageRequirementCoverage * report.scored,
    0
  )
  const mustHaveCoverageTotal = runs.reduce(
    (total, report) => total + report.averageMustHaveCoverage * report.scored,
    0
  )

  return {
    totalRuns: runs.length,
    totalCaseExecutions,
    passed,
    failed: totalCaseExecutions - passed,
    passRate:
      totalCaseExecutions === 0 ? 0 : roundMetric(passed / totalCaseExecutions),
    scored,
    averageRequirementCoverage:
      scored === 0 ? 0 : roundMetric(requirementCoverageTotal / scored),
    averageMustHaveCoverage:
      scored === 0 ? 0 : roundMetric(mustHaveCoverageTotal / scored),
    failureCodeCounts: {
      assertion_failed: runs.reduce(
        (total, report) => total + report.failureCodeCounts.assertion_failed,
        0
      ),
      execution_failed: runs.reduce(
        (total, report) => total + report.failureCodeCounts.execution_failed,
        0
      ),
      invalid_execution_result: runs.reduce(
        (total, report) =>
          total + report.failureCodeCounts.invalid_execution_result,
        0
      ),
    },
  }
}

export async function runEvaluationCampaign(
  cases: readonly EvalCase[],
  execute: EvalExecute,
  configuration: EvalCampaignConfiguration
): Promise<EvalCampaignReport> {
  const parsedConfiguration =
    EvalCampaignConfigurationSchema.parse(configuration)
  const runs: EvalReport[] = []

  for (
    let repetition = 0;
    repetition < parsedConfiguration.repetitions;
    repetition += 1
  ) {
    runs.push(await runEvaluation(cases, execute))
  }

  return {
    version: 1,
    configuration: parsedConfiguration,
    aggregate: aggregateRuns(runs),
    runs,
  }
}
