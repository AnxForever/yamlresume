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

import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'

import { LlmRequestError, OpenAICompatibleClient } from './openai-compatible'

function responseBody(content: string, status = 200): string {
  return JSON.stringify({
    id: 'resp_test',
    model: 'gpt-test',
    choices: [{ message: { content } }],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 6,
      completion_tokens_details: { reasoning_tokens: 2 },
    },
    ...(status >= 400 ? { error: { message: content } } : {}),
  })
}

async function withServer(
  handler: (requestCount: number) => { status: number; body: string }
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  let requestCount = 0
  const server = createServer((_request, response) => {
    requestCount += 1
    const result = handler(requestCount)
    response.statusCode = result.status
    response.setHeader('Content-Type', 'application/json')
    response.end(result.body)
  })
  await new Promise<void>((resolve) => server.listen(0, resolve))
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('server did not start')
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      ),
  }
}

describe('OpenAICompatibleClient', () => {
  it('returns structured data and usage metadata', async () => {
    const server = await withServer(() => ({
      status: 200,
      body: responseBody('{"ok":true}'),
    }))
    try {
      const client = new OpenAICompatibleClient({
        apiKey: 'test-key',
        baseUrl: server.baseUrl,
        model: 'configured-model',
        maxRetries: 0,
      })
      const result = await client.completeJson<{ ok: boolean }>({
        system: 'JSON only',
        user: 'Return an object',
        schemaName: 'Test',
      })

      expect(result.data).toEqual({ ok: true })
      expect(result.metadata.model).toBe('gpt-test')
      expect(result.metadata.usage).toEqual({
        inputTokens: 10,
        outputTokens: 6,
        reasoningTokens: 2,
      })
    } finally {
      await server.close()
    }
  })

  it('retries transient provider failures but not client errors', async () => {
    const transient = await withServer((requestCount) =>
      requestCount === 1
        ? { status: 503, body: responseBody('temporary', 503) }
        : { status: 200, body: responseBody('{"ok":true}') }
    )
    try {
      const client = new OpenAICompatibleClient({
        apiKey: 'test-key',
        baseUrl: transient.baseUrl,
        model: 'test',
        maxRetries: 1,
        retryDelayMs: 0,
      })
      await expect(
        client.completeJson({ system: '', user: '', schemaName: 'Test' })
      ).resolves.toMatchObject({ data: { ok: true }, metadata: { attempt: 2 } })
    } finally {
      await transient.close()
    }

    const clientError = await withServer(() => ({
      status: 400,
      body: responseBody('bad request', 400),
    }))
    try {
      const client = new OpenAICompatibleClient({
        apiKey: 'test-key',
        baseUrl: clientError.baseUrl,
        model: 'test',
        maxRetries: 2,
        retryDelayMs: 0,
      })
      await expect(
        client.completeJson({ system: '', user: '', schemaName: 'Test' })
      ).rejects.toBeInstanceOf(LlmRequestError)
    } finally {
      await clientError.close()
    }
  })
})
