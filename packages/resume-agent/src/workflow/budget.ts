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

import type {
  JsonCompletionRequest,
  LlmCallMetadata,
  LlmClient,
  LlmCompletion,
} from '@/contracts'

/**
 * Ceilings for a single run.
 *
 * The agent is phase based rather than an open ReAct loop, but each phase can
 * still call the provider more than once: `completeStructuredOutput` retries
 * a malformed response, and the transport retries 408/409/429/5xx. Without a
 * ceiling a single request can therefore issue an unbounded number of billable
 * calls. These limits are the stop condition.
 */
export const DEFAULT_RUN_BUDGET_LIMITS = Object.freeze({
  maxModelCalls: 8,
  maxTotalTokens: 200_000,
})

export interface RunBudgetLimits {
  /** Provider calls allowed per run, retries included. Defaults to 8. */
  maxModelCalls?: number
  /** Input + output tokens allowed per run. Defaults to 200000. */
  maxTotalTokens?: number
}

export type RunBudgetErrorCode =
  | 'model_call_limit_exceeded'
  | 'token_limit_exceeded'
  | 'invalid_budget_limits'

export interface RunBudgetSnapshot {
  modelCalls: number
  maxModelCalls: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  maxTotalTokens: number
}

function runBudgetErrorMessage(
  code: RunBudgetErrorCode,
  snapshot: RunBudgetSnapshot
): string {
  if (code === 'model_call_limit_exceeded') {
    return `Run exceeded its model call budget (${snapshot.modelCalls}/${snapshot.maxModelCalls}).`
  }
  if (code === 'token_limit_exceeded') {
    return `Run exceeded its token budget (${snapshot.totalTokens}/${snapshot.maxTotalTokens}).`
  }
  return 'Run budget limits must be positive integers or omitted.'
}

export class RunBudgetError extends Error {
  constructor(
    readonly code: RunBudgetErrorCode,
    readonly snapshot: RunBudgetSnapshot
  ) {
    super(runBudgetErrorMessage(code, snapshot))
    this.name = 'RunBudgetError'
  }
}

function resolveLimit(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RunBudgetError('invalid_budget_limits', {
      modelCalls: 0,
      maxModelCalls: fallback,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      maxTotalTokens: fallback,
    })
  }
  return value
}

/**
 * Meters the provider calls made during one run.
 *
 * Limits are enforced on both sides of a call: before it is issued (so a run
 * that is already at its ceiling stops) and after its usage is recorded (so a
 * single call that overshoots the token ceiling stops too). The second check
 * throws *after* a successful call, which discards an already-paid-for result.
 * That is deliberate: a budget that only takes effect on the next call is not
 * a ceiling, it is a warning.
 */
export class RunBudget {
  private modelCalls = 0
  private inputTokens = 0
  private outputTokens = 0

  readonly maxModelCalls: number
  readonly maxTotalTokens: number

  constructor(limits: RunBudgetLimits = {}) {
    this.maxModelCalls = resolveLimit(
      limits.maxModelCalls,
      DEFAULT_RUN_BUDGET_LIMITS.maxModelCalls
    )
    this.maxTotalTokens = resolveLimit(
      limits.maxTotalTokens,
      DEFAULT_RUN_BUDGET_LIMITS.maxTotalTokens
    )
  }

  get totalTokens(): number {
    return this.inputTokens + this.outputTokens
  }

  snapshot(): RunBudgetSnapshot {
    return {
      modelCalls: this.modelCalls,
      maxModelCalls: this.maxModelCalls,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      totalTokens: this.totalTokens,
      maxTotalTokens: this.maxTotalTokens,
    }
  }

  /** Throws when the run has already used up its allowance. */
  assertCanCall(): void {
    if (this.modelCalls >= this.maxModelCalls) {
      throw new RunBudgetError('model_call_limit_exceeded', this.snapshot())
    }
    if (this.totalTokens >= this.maxTotalTokens) {
      throw new RunBudgetError('token_limit_exceeded', this.snapshot())
    }
  }

  /**
   * Records a completed call.
   *
   * A call whose usage the provider did not report still counts against the
   * call ceiling — the request was made and may have been billed. Only the
   * token counters stay untouched, because there is nothing to add.
   */
  record(metadata: LlmCallMetadata): void {
    this.modelCalls += 1
    this.inputTokens += metadata.usage?.inputTokens ?? 0
    this.outputTokens += metadata.usage?.outputTokens ?? 0

    if (this.totalTokens > this.maxTotalTokens) {
      throw new RunBudgetError('token_limit_exceeded', this.snapshot())
    }
  }
}

/**
 * Wraps a client so that every call is metered, retries included.
 *
 * The wrapper sits below `completeStructuredOutput`, which means the repair
 * and transport retries it performs are counted individually rather than as
 * one logical request. That is the honest accounting: each attempt is a
 * separate provider round trip.
 */
export function budgetedLlmClient(
  llm: LlmClient,
  budget: RunBudget
): LlmClient {
  return {
    async completeJson<T>(
      request: JsonCompletionRequest
    ): Promise<LlmCompletion<T>> {
      budget.assertCanCall()
      const completion = await llm.completeJson<T>(request)
      // A call that failed below this point never recorded its metadata, so it
      // is counted once, here, on the success path and not twice.
      budget.record(completion.metadata)
      return completion
    },
  }
}

/** Accepts either fresh limits or an existing tracker, so `run` can share one. */
export function toRunBudget(
  value: RunBudget | RunBudgetLimits | undefined
): RunBudget {
  return value instanceof RunBudget ? value : new RunBudget(value ?? {})
}
