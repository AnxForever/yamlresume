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
import { z } from 'zod'

import type { JsonCompletionRequest, LlmClient } from '@/contracts'
import {
  completeStructuredOutput,
  StructuredOutputValidationError,
} from '@/llm/structured-output'

describe('completeStructuredOutput', () => {
  it('returns a valid first response with aggregated call telemetry', async () => {
    let calls = 0
    const llm: LlmClient = {
      async completeJson() {
        calls += 1
        return {
          data: { answer: 'valid' },
          metadata: {
            provider: 'fake',
            model: 'fake-model',
            durationMs: 12,
            attempt: 2,
            usage: {
              inputTokens: 10,
              outputTokens: 4,
              reasoningTokens: 1,
            },
          },
        }
      },
    }

    const result = await completeStructuredOutput(llm, {
      request: {
        schemaName: 'Answer',
        system: 'Return an answer.',
        user: 'Question',
      },
      schema: z.object({ answer: z.string() }),
      expectedShape: '{ "answer": string }',
    })

    expect(result.data).toEqual({ answer: 'valid' })
    expect(calls).toBe(1)
    expect(result.telemetry).toEqual({
      provider: 'fake',
      model: 'fake-model',
      modelCalls: 1,
      repairAttempts: 0,
      transportAttempts: 2,
      durationMs: 12,
      normalizedOutput: false,
      inputTokens: 10,
      outputTokens: 4,
      reasoningTokens: 1,
    })
  })

  it.each(['data', 'result', 'output'])(
    'accepts a single known %s envelope',
    async (envelope) => {
      const llm: LlmClient = {
        async completeJson() {
          return {
            data: { [envelope]: { answer: 'wrapped' } },
            metadata: {
              provider: 'fake',
              model: 'fake-model',
              durationMs: 3,
              attempt: 1,
            },
          }
        },
      }

      const result = await completeStructuredOutput(llm, {
        request: {
          schemaName: 'Answer',
          system: 'Return an answer.',
          user: 'Question',
        },
        schema: z.object({ answer: z.string() }),
        expectedShape: '{ "answer": string }',
      })

      expect(result.data).toEqual({ answer: 'wrapped' })
      expect(result.telemetry.normalizedOutput).toBe(true)
    }
  )

  it('uses a deterministic normalizer before requesting a repair', async () => {
    let calls = 0
    const llm: LlmClient = {
      async completeJson() {
        calls += 1
        return {
          data: { answer_text: 'compatible' },
          metadata: {
            provider: 'fake',
            model: 'fake-model',
            durationMs: 2,
            attempt: 1,
          },
        }
      },
    }

    const result = await completeStructuredOutput(llm, {
      request: {
        schemaName: 'Answer',
        system: 'Return an answer.',
        user: 'Question',
      },
      schema: z.object({ answer: z.string() }),
      expectedShape: '{ "answer": string }',
      normalize(value) {
        if (typeof value !== 'object' || value === null) return value
        const record = value as Record<string, unknown>
        return { ...record, answer: record.answer ?? record.answer_text }
      },
    })

    expect(result.data).toEqual({ answer: 'compatible' })
    expect(result.telemetry.normalizedOutput).toBe(true)
    expect(calls).toBe(1)
  })

  it('repairs an invalid response once and aggregates safe telemetry', async () => {
    const requests: JsonCompletionRequest[] = []
    const responses = [
      {
        data: { profile: { name: 'Sensitive Person' } },
        metadata: {
          provider: 'fake-initial',
          model: 'initial-model',
          durationMs: 5,
          attempt: 1,
          usage: { inputTokens: 10, outputTokens: 2 },
        },
      },
      {
        data: { profile: { email: 'fixed@example.test' } },
        metadata: {
          provider: 'fake-repair',
          model: 'repair-model',
          durationMs: 7,
          attempt: 3,
          usage: { inputTokens: 20, outputTokens: 4, reasoningTokens: 1 },
        },
      },
    ]
    const llm: LlmClient = {
      async completeJson(request) {
        requests.push(request)
        const response = responses.shift()
        if (!response) throw new Error('Unexpected LLM call')
        return response
      },
    }

    const result = await completeStructuredOutput(llm, {
      request: {
        schemaName: 'Profile',
        system: 'Extract a profile.',
        user: 'Private source: sensitive-person@example.com',
        images: [
          {
            filename: 'private.png',
            mediaType: 'image/png',
            dataUrl: 'data:image/png;base64,private-image',
          },
        ],
      },
      schema: z.object({ profile: z.object({ email: z.string() }) }),
      expectedShape: '{ "profile": { "email": string } }',
    })

    expect(result.data).toEqual({
      profile: { email: 'fixed@example.test' },
    })
    expect(requests).toHaveLength(2)
    expect(requests[1]?.user).toContain('profile.email')
    expect(requests[1]?.images).toEqual(requests[0]?.images)
    expect(result.telemetry).toEqual({
      provider: 'fake-repair',
      model: 'repair-model',
      modelCalls: 2,
      repairAttempts: 1,
      transportAttempts: 4,
      durationMs: 12,
      normalizedOutput: false,
      inputTokens: 30,
      outputTokens: 6,
      reasoningTokens: 1,
    })
    expect(JSON.stringify(result.telemetry)).not.toContain(
      'sensitive-person@example.com'
    )
    expect(JSON.stringify(result.telemetry)).not.toContain('private-image')
  })

  it('stops at the configured repair limit and throws a data-safe error', async () => {
    let calls = 0
    const llm: LlmClient = {
      async completeJson() {
        calls += 1
        return {
          data: { privateValue: `private-${calls}@example.com` },
          metadata: {
            provider: 'fake',
            model: 'fake-model',
            durationMs: 4,
            attempt: 1,
          },
        }
      },
    }

    let thrown: unknown
    try {
      await completeStructuredOutput(llm, {
        request: {
          schemaName: 'Profile',
          system: 'Extract a profile.',
          user: 'Private source: original-person@example.com',
        },
        schema: z.object({ profile: z.object({ email: z.string() }) }),
        expectedShape: '{ "profile": { "email": string } }',
        maxRepairAttempts: 2,
      })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(StructuredOutputValidationError)
    const validationError = thrown as StructuredOutputValidationError
    expect(validationError.code).toBe('structured_output_validation_failed')
    expect(validationError.schemaName).toBe('Profile')
    expect(validationError.issues).toEqual([
      { path: 'profile', code: 'invalid_type' },
    ])
    expect(validationError.telemetry).toMatchObject({
      modelCalls: 3,
      repairAttempts: 2,
      transportAttempts: 3,
      durationMs: 12,
    })
    expect(calls).toBe(3)
    const serializedError = `${validationError.message}\n${JSON.stringify(validationError)}`
    expect(serializedError).not.toContain('original-person@example.com')
    expect(serializedError).not.toContain('private-')
  })

  it('can disable repair without making an extra model call', async () => {
    let calls = 0
    const llm: LlmClient = {
      async completeJson() {
        calls += 1
        return {
          data: { invalid: true },
          metadata: {
            provider: 'fake',
            model: 'fake-model',
            durationMs: 1,
            attempt: 1,
          },
        }
      },
    }

    await expect(
      completeStructuredOutput(llm, {
        request: {
          schemaName: 'Answer',
          system: 'Return an answer.',
          user: 'Question',
        },
        schema: z.object({ answer: z.string() }),
        expectedShape: '{ "answer": string }',
        maxRepairAttempts: 0,
      })
    ).rejects.toMatchObject({
      telemetry: { modelCalls: 1, repairAttempts: 0 },
    })
    expect(calls).toBe(1)
  })

  it('reports inner field issues when a known envelope needs repair', async () => {
    const requests: JsonCompletionRequest[] = []
    const responses = [
      { data: { profile: {} } },
      { profile: { email: 'fixed@example.test' } },
    ]
    const llm: LlmClient = {
      async completeJson(request) {
        requests.push(request)
        return {
          data: responses.shift(),
          metadata: {
            provider: 'fake',
            model: 'fake-model',
            durationMs: 1,
            attempt: 1,
          },
        }
      },
    }

    await completeStructuredOutput(llm, {
      request: {
        schemaName: 'Profile',
        system: 'Extract a profile.',
        user: 'Profile source',
      },
      schema: z.object({ profile: z.object({ email: z.string() }) }),
      expectedShape: '{ "profile": { "email": string } }',
    })

    expect(requests[1]?.user).toContain('profile.email')
  })

  it('rejects an out-of-range repair limit before calling the model', async () => {
    let calls = 0
    const llm: LlmClient = {
      async completeJson() {
        calls += 1
        return {
          data: { invalid: true },
          metadata: {
            provider: 'fake',
            model: 'fake-model',
            durationMs: 1,
            attempt: 1,
          },
        }
      },
    }

    await expect(
      completeStructuredOutput(llm, {
        request: {
          schemaName: 'Answer',
          system: 'Return an answer.',
          user: 'Question',
        },
        schema: z.object({ answer: z.string() }),
        expectedShape: '{ "answer": string }',
        maxRepairAttempts: 3 as never,
      })
    ).rejects.toThrow('maxRepairAttempts must be 0, 1, or 2')
    expect(calls).toBe(0)
  })
})
