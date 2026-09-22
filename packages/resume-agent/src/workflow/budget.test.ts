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

import { describe, expect, it } from 'vitest'

import type {
  JsonCompletionRequest,
  LlmCallMetadata,
  LlmClient,
} from '@/contracts'
import {
  budgetedLlmClient,
  DEFAULT_RUN_BUDGET_LIMITS,
  RunBudget,
  RunBudgetError,
  toRunBudget,
} from '@/workflow/budget'

function metadata(usage?: { inputTokens: number; outputTokens: number }) {
  return {
    provider: 'fake',
    model: 'fake',
    durationMs: 1,
    attempt: 1,
    ...(usage ? { usage } : {}),
  } satisfies LlmCallMetadata
}

function countingClient(
  calls: number,
  usage?: { inputTokens: number; outputTokens: number }
): LlmClient {
  let remaining = calls
  return {
    async completeJson<T>(request: JsonCompletionRequest) {
      if (remaining <= 0) throw new Error('client called more than expected')
      remaining -= 1
      return {
        data: { schemaName: request.schemaName } as T,
        metadata: metadata(usage),
      }
    },
  }
}

describe('RunBudget limits', () => {
  it('falls back to the documented defaults', () => {
    const budget = new RunBudget()

    expect(budget.maxModelCalls).toBe(DEFAULT_RUN_BUDGET_LIMITS.maxModelCalls)
    expect(budget.maxTotalTokens).toBe(DEFAULT_RUN_BUDGET_LIMITS.maxTotalTokens)
  })

  it('rejects non-positive and non-integer limits', () => {
    for (const limits of [
      { maxModelCalls: 0 },
      { maxModelCalls: -1 },
      { maxModelCalls: 1.5 },
      { maxTotalTokens: 0 },
    ]) {
      expect(() => new RunBudget(limits)).toThrowError(RunBudgetError)
    }
  })

  it('reports an invalid-budget code so callers can tell it from exhaustion', () => {
    try {
      new RunBudget({ maxModelCalls: 0 })
      throw new Error('expected a throw')
    } catch (error) {
      expect(error).toBeInstanceOf(RunBudgetError)
      expect((error as RunBudgetError).code).toBe('invalid_budget_limits')
    }
  })
})

describe('RunBudget accounting', () => {
  it('counts calls and accumulates tokens', () => {
    const budget = new RunBudget()
    budget.record(metadata({ inputTokens: 10, outputTokens: 5 }))
    budget.record(metadata({ inputTokens: 20, outputTokens: 7 }))

    expect(budget.snapshot()).toMatchObject({
      modelCalls: 2,
      inputTokens: 30,
      outputTokens: 12,
      totalTokens: 42,
    })
  })

  it('counts a call whose usage the provider omitted', () => {
    const budget = new RunBudget()
    budget.record(metadata())

    expect(budget.snapshot()).toMatchObject({ modelCalls: 1, totalTokens: 0 })
  })

  it('allows exactly maxModelCalls calls and refuses the next one', () => {
    const budget = new RunBudget({ maxModelCalls: 2 })

    budget.assertCanCall()
    budget.record(metadata())
    budget.assertCanCall()
    budget.record(metadata())

    expect(() => budget.assertCanCall()).toThrowError(RunBudgetError)
  })

  it('throws a token overrun from record, so an over-budget call is not delivered', () => {
    const budget = new RunBudget({ maxTotalTokens: 100 })

    expect(() =>
      budget.record(metadata({ inputTokens: 80, outputTokens: 40 }))
    ).toThrowError(RunBudgetError)

    // The overrun is still visible in the snapshot the error carries.
    try {
      budget.record(metadata({ inputTokens: 1 }))
      throw new Error('expected a throw')
    } catch (error) {
      expect((error as RunBudgetError).code).toBe('token_limit_exceeded')
      expect((error as RunBudgetError).snapshot.totalTokens).toBe(121)
    }
  })

  it('refuses to start a call once the token ceiling is reached', () => {
    const budget = new RunBudget({ maxTotalTokens: 100 })
    budget.record(metadata({ inputTokens: 100 }))

    expect(() => budget.assertCanCall()).toThrowError(RunBudgetError)
  })
})

describe('budgetedLlmClient', () => {
  it('meters every call, including retries performed above it', async () => {
    const budget = new RunBudget({ maxModelCalls: 2 })
    const client = budgetedLlmClient(countingClient(3), budget)

    await client.completeJson({ schemaName: 'A' })
    await client.completeJson({ schemaName: 'B' })

    await expect(client.completeJson({ schemaName: 'C' })).rejects.toThrowError(
      RunBudgetError
    )
    expect(budget.snapshot().modelCalls).toBe(2)
  })

  it('propagates provider failures without recording a phantom token cost', async () => {
    const budget = new RunBudget()
    const client = budgetedLlmClient(
      {
        async completeJson() {
          throw new Error('provider exploded')
        },
      },
      budget
    )

    await expect(client.completeJson({ schemaName: 'A' })).rejects.toThrowError(
      'provider exploded'
    )
    expect(budget.snapshot()).toMatchObject({ modelCalls: 0, totalTokens: 0 })
  })
})

describe('toRunBudget', () => {
  it('creates a tracker from limits', () => {
    expect(toRunBudget({ maxModelCalls: 3 }).maxModelCalls).toBe(3)
  })

  it('defaults when nothing is supplied', () => {
    expect(toRunBudget(undefined).maxModelCalls).toBe(
      DEFAULT_RUN_BUDGET_LIMITS.maxModelCalls
    )
  })

  it('reuses an existing tracker so run phases share one allowance', () => {
    const existing = new RunBudget({ maxModelCalls: 5 })

    expect(toRunBudget(existing)).toBe(existing)
  })
})
