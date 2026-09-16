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

import {
  type EvalAssertionResult,
  type EvalCase,
  type EvalCaseData,
  type EvalCaseResult,
  EvalDatasetSchema,
  type EvalExecute,
  type EvalExecutionResult,
  EvalExecutionResultSchema,
  type EvalReport,
} from '@/evaluation/contracts'

function roundMetric(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

function parseExecutionResult(value: unknown): EvalExecutionResult | null {
  try {
    const result = EvalExecutionResultSchema.safeParse(value)
    return result.success ? result.data : null
  } catch {
    return null
  }
}

function evaluateAssertions(
  evalCase: EvalCaseData,
  execution: EvalExecutionResult
): EvalAssertionResult[] {
  const expectations = evalCase.expectations
  if (!expectations) {
    return []
  }

  const assertions: EvalAssertionResult[] = []
  const warningCodes = new Set(
    execution.quality.warnings.map((warning) => warning.code)
  )

  if (expectations.targetTitle !== undefined) {
    assertions.push({
      code: 'target_title',
      passed: execution.jobSpec.targetTitle === expectations.targetTitle,
    })
  }
  if (expectations.minimumRequirementCoverage !== undefined) {
    assertions.push({
      code: 'minimum_requirement_coverage',
      passed:
        execution.quality.requirementCoverage >=
        expectations.minimumRequirementCoverage,
    })
  }
  if (expectations.minimumMustHaveCoverage !== undefined) {
    assertions.push({
      code: 'minimum_must_have_coverage',
      passed:
        execution.quality.mustHaveCoverage >=
        expectations.minimumMustHaveCoverage,
    })
  }
  for (const code of expectations.requiredWarningCodes ?? []) {
    assertions.push({
      code: 'required_warning_code',
      subject: code,
      passed: warningCodes.has(code),
    })
  }
  for (const code of expectations.forbiddenWarningCodes ?? []) {
    assertions.push({
      code: 'forbidden_warning_code',
      subject: code,
      passed: !warningCodes.has(code),
    })
  }

  return assertions
}

export async function runEvaluation(
  cases: readonly EvalCase[],
  execute: EvalExecute
): Promise<EvalReport> {
  const parsedCases = EvalDatasetSchema.parse(cases)
  const results: EvalCaseResult[] = []
  let totalRequirementCoverage = 0
  let totalMustHaveCoverage = 0
  let scored = 0

  for (const evalCase of parsedCases) {
    const startedAt = performance.now()
    let rawExecution: unknown
    try {
      rawExecution = await execute(evalCase.request)
    } catch {
      results.push({
        caseId: evalCase.id,
        passed: false,
        assertions: [],
        durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
        failureCode: 'execution_failed',
      })
      continue
    }

    const execution = parseExecutionResult(rawExecution)
    if (!execution) {
      results.push({
        caseId: evalCase.id,
        passed: false,
        assertions: [],
        durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
        failureCode: 'invalid_execution_result',
      })
      continue
    }

    const assertions = evaluateAssertions(evalCase, execution)
    const passed = assertions.every((assertion) => assertion.passed)

    totalRequirementCoverage += execution.quality.requirementCoverage
    totalMustHaveCoverage += execution.quality.mustHaveCoverage
    scored += 1
    results.push({
      caseId: evalCase.id,
      passed,
      assertions,
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      failureCode: passed ? null : 'assertion_failed',
    })
  }

  const total = results.length
  const passed = results.filter((result) => result.passed).length
  const failed = total - passed

  return {
    version: 1,
    total,
    passed,
    failed,
    passRate: total === 0 ? 0 : roundMetric(passed / total),
    scored,
    averageRequirementCoverage:
      scored === 0 ? 0 : roundMetric(totalRequirementCoverage / scored),
    averageMustHaveCoverage:
      scored === 0 ? 0 : roundMetric(totalMustHaveCoverage / scored),
    failureCodeCounts: {
      assertion_failed: results.filter(
        (result) => result.failureCode === 'assertion_failed'
      ).length,
      execution_failed: results.filter(
        (result) => result.failureCode === 'execution_failed'
      ).length,
      invalid_execution_result: results.filter(
        (result) => result.failureCode === 'invalid_execution_result'
      ).length,
    },
    results,
  }
}
