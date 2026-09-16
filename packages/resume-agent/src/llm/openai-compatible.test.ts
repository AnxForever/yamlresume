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
import type { Socket } from 'node:net'
import { describe, expect, it } from 'vitest'

import {
  LlmConfigurationError,
  LlmRequestError,
  OpenAICompatibleClient,
} from './openai-compatible'

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

type TestServerResponse =
  | { status: number; body: string }
  | { type: 'destroy-connection' }
  | { type: 'hang' }
  | { type: 'truncate-body'; body: string }

async function withServer(
  handler: (requestCount: number) => TestServerResponse
): Promise<{
  baseUrl: string
  requestCount: () => number
  waitForDisconnects: (expected: number) => Promise<void>
  close: () => Promise<void>
}> {
  let requestCount = 0
  let disconnectCount = 0
  const disconnectListeners = new Set<() => void>()
  const sockets = new Set<Socket>()
  const server = createServer((request, response) => {
    requestCount += 1
    response.once('close', () => {
      if (response.writableEnded) return
      disconnectCount += 1
      for (const listener of disconnectListeners) listener()
    })
    const result = handler(requestCount)
    if ('type' in result) {
      if (result.type === 'destroy-connection') request.socket.destroy()
      if (result.type === 'truncate-body') {
        response.statusCode = 200
        response.setHeader('Content-Type', 'application/json')
        response.write(result.body)
        setImmediate(() => response.destroy())
      }
      return
    }
    response.statusCode = result.status
    response.setHeader('Content-Type', 'application/json')
    response.end(result.body)
  })
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('server did not start')
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requestCount: () => requestCount,
    waitForDisconnects: (expected) => {
      if (disconnectCount >= expected) return Promise.resolve()
      return new Promise<void>((resolve, reject) => {
        const onDisconnect = () => {
          if (disconnectCount < expected) return
          clearTimeout(timeout)
          disconnectListeners.delete(onDisconnect)
          resolve()
        }
        const timeout = setTimeout(() => {
          disconnectListeners.delete(onDisconnect)
          reject(
            new Error(
              `expected ${expected} disconnected response(s), received ${disconnectCount}`
            )
          )
        }, 250)
        disconnectListeners.add(onDisconnect)
        onDisconnect()
      })
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
        for (const socket of sockets) socket.destroy()
      }),
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
      expect(result.metadata.requestId).toBe('resp_test')
      expect(result.metadata.attempt).toBe(1)
      expect(result.metadata.usage).toEqual({
        inputTokens: 10,
        outputTokens: 6,
        reasoningTokens: 2,
      })
    } finally {
      await server.close()
    }
  })

  it('aborts timed-out requests and stops at the configured attempt limit', async () => {
    const server = await withServer(() => ({ type: 'hang' }))
    try {
      const client = new OpenAICompatibleClient({
        apiKey: 'test-key',
        baseUrl: server.baseUrl,
        model: 'test',
        timeoutMs: 100,
        maxRetries: 1,
        retryDelayMs: 0,
      })

      const promise = client.completeJson({
        system: 'private system prompt',
        user: 'private resume and job description',
        schemaName: 'Test',
      })

      await expect(promise).rejects.toMatchObject({
        name: 'LlmRequestError',
        message: 'LLM request timed out',
        reason: 'timeout',
        retryable: true,
      })
      expect(server.requestCount()).toBe(2)
      await server.waitForDisconnects(2)
    } finally {
      await server.close()
    }
  })

  it('retries network failures and returns a stable error after exhaustion', async () => {
    const server = await withServer(() => ({ type: 'destroy-connection' }))
    try {
      const client = new OpenAICompatibleClient({
        apiKey: 'test-key',
        baseUrl: server.baseUrl,
        model: 'test',
        maxRetries: 2,
        retryDelayMs: 0,
      })

      await expect(
        client.completeJson({ system: '', user: '', schemaName: 'Test' })
      ).rejects.toMatchObject({
        name: 'LlmRequestError',
        message: 'LLM network request failed',
        reason: 'network_error',
        retryable: true,
      })
      expect(server.requestCount()).toBe(3)
    } finally {
      await server.close()
    }
  })

  it('retries a connection failure while reading the response body', async () => {
    const server = await withServer(() => ({
      type: 'truncate-body',
      body: '{"partial":',
    }))
    try {
      const client = new OpenAICompatibleClient({
        apiKey: 'test-key',
        baseUrl: server.baseUrl,
        model: 'test',
        maxRetries: 1,
        retryDelayMs: 0,
      })

      await expect(
        client.completeJson({ system: '', user: '', schemaName: 'Test' })
      ).rejects.toMatchObject({
        message: 'LLM network request failed',
        reason: 'network_error',
        retryable: true,
      })
      expect(server.requestCount()).toBe(2)
    } finally {
      await server.close()
    }
  })

  it.each([408, 409, 429, 500, 503])(
    'retries HTTP %i responses up to the configured limit',
    async (status) => {
      const server = await withServer(() => ({
        status,
        body: responseBody('provider internal detail', status),
      }))
      try {
        const client = new OpenAICompatibleClient({
          apiKey: 'test-key',
          baseUrl: server.baseUrl,
          model: 'test',
          maxRetries: 1,
          retryDelayMs: 0,
        })

        await expect(
          client.completeJson({ system: '', user: '', schemaName: 'Test' })
        ).rejects.toMatchObject({
          message: `LLM request failed with HTTP status ${status}`,
          reason: 'http_status',
          retryable: true,
          status,
        })
        expect(server.requestCount()).toBe(2)
      } finally {
        await server.close()
      }
    }
  )

  it('does not retry ordinary 4xx responses', async () => {
    const server = await withServer(() => ({
      status: 400,
      body: responseBody('provider validation detail', 400),
    }))
    try {
      const client = new OpenAICompatibleClient({
        apiKey: 'test-key',
        baseUrl: server.baseUrl,
        model: 'test',
        maxRetries: 2,
        retryDelayMs: 0,
      })

      await expect(
        client.completeJson({ system: '', user: '', schemaName: 'Test' })
      ).rejects.toMatchObject({
        message: 'LLM request failed with HTTP status 400',
        reason: 'http_status',
        retryable: false,
        status: 400,
      })
      expect(server.requestCount()).toBe(1)
    } finally {
      await server.close()
    }
  })

  it.each([
    { status: 503, maxRetries: 1, requests: 2, retryable: true },
    { status: 400, maxRetries: 2, requests: 1, retryable: false },
    { status: 200, maxRetries: 2, requests: 1, retryable: false },
  ])(
    'classifies a non-JSON HTTP $status body without exposing it',
    async ({ status, maxRetries, requests, retryable }) => {
      const server = await withServer(() => ({
        status,
        body: '<html>raw-private-provider-body</html>',
      }))
      try {
        const client = new OpenAICompatibleClient({
          apiKey: 'test-key',
          baseUrl: server.baseUrl,
          model: 'test',
          maxRetries,
          retryDelayMs: 0,
        })

        await expect(
          client.completeJson({ system: '', user: '', schemaName: 'Test' })
        ).rejects.toMatchObject({
          message: 'LLM response body was not valid JSON',
          reason: 'response_body_invalid_json',
          retryable,
          status,
        })
        expect(server.requestCount()).toBe(requests)
      } finally {
        await server.close()
      }
    }
  )

  it.each([
    {
      label: 'choices',
      body: JSON.stringify({ id: 'missing_choices', model: 'test' }),
    },
    {
      label: 'message content',
      body: JSON.stringify({
        id: 'missing_content',
        model: 'test',
        choices: [{ message: {} }],
      }),
    },
    { label: 'an object payload', body: 'null' },
  ])('does not retry a 200 response missing $label', async ({ body }) => {
    const server = await withServer(() => ({ status: 200, body }))
    try {
      const client = new OpenAICompatibleClient({
        apiKey: 'test-key',
        baseUrl: server.baseUrl,
        model: 'test',
        maxRetries: 2,
        retryDelayMs: 0,
      })

      await expect(
        client.completeJson({ system: '', user: '', schemaName: 'Test' })
      ).rejects.toMatchObject({
        message: 'LLM response did not include message content',
        reason: 'response_content_missing',
        retryable: false,
      })
      expect(server.requestCount()).toBe(1)
    } finally {
      await server.close()
    }
  })

  it('does not retry message content that is not valid JSON', async () => {
    const server = await withServer(() => ({
      status: 200,
      body: responseBody('raw-private-model-content'),
    }))
    try {
      const client = new OpenAICompatibleClient({
        apiKey: 'test-key',
        baseUrl: server.baseUrl,
        model: 'test',
        maxRetries: 2,
        retryDelayMs: 0,
      })

      await expect(
        client.completeJson({ system: '', user: '', schemaName: 'Test' })
      ).rejects.toMatchObject({
        message: 'LLM message content was not valid JSON',
        reason: 'response_content_invalid_json',
        retryable: false,
      })
      expect(server.requestCount()).toBe(1)
    } finally {
      await server.close()
    }
  })

  it('keeps accepting JSON inside a Markdown fence', async () => {
    const server = await withServer(() => ({
      status: 200,
      body: responseBody('```json\n{"ok":true}\n```'),
    }))
    try {
      const client = new OpenAICompatibleClient({
        apiKey: 'test-key',
        baseUrl: server.baseUrl,
        model: 'test',
        maxRetries: 0,
      })

      await expect(
        client.completeJson({ system: '', user: '', schemaName: 'Test' })
      ).resolves.toMatchObject({
        data: { ok: true },
        metadata: { attempt: 1 },
      })
      expect(server.requestCount()).toBe(1)
    } finally {
      await server.close()
    }
  })

  it.each([
    {
      label: 'blank API key',
      config: { apiKey: '   ' },
      message: 'An API key is required for the LLM client',
    },
    {
      label: 'blank base URL',
      config: { baseUrl: ' \t ' },
      message: 'An LLM base URL is required',
    },
    {
      label: 'blank model',
      config: { model: '\n' },
      message: 'An LLM model is required',
    },
    {
      label: 'zero timeout',
      config: { timeoutMs: 0 },
      message: 'LLM timeout must be a positive number',
    },
    {
      label: 'non-finite timeout',
      config: { timeoutMs: Number.POSITIVE_INFINITY },
      message: 'LLM timeout must be a positive number',
    },
    {
      label: 'negative retries',
      config: { maxRetries: -1 },
      message: 'LLM maxRetries must be an integer between 0 and 5',
    },
    {
      label: 'fractional retries',
      config: { maxRetries: 1.5 },
      message: 'LLM maxRetries must be an integer between 0 and 5',
    },
    {
      label: 'too many retries',
      config: { maxRetries: 6 },
      message: 'LLM maxRetries must be an integer between 0 and 5',
    },
    {
      label: 'negative retry delay',
      config: { retryDelayMs: -1 },
      message: 'LLM retryDelayMs must be a non-negative number',
    },
    {
      label: 'non-finite retry delay',
      config: { retryDelayMs: Number.NaN },
      message: 'LLM retryDelayMs must be a non-negative number',
    },
  ])('rejects $label configuration', ({ config, message }) => {
    expect(
      () =>
        new OpenAICompatibleClient({
          apiKey: 'test-key',
          baseUrl: 'https://provider.invalid/v1',
          model: 'test-model',
          ...config,
        })
    ).toThrowError(LlmConfigurationError)
    expect(
      () =>
        new OpenAICompatibleClient({
          apiKey: 'test-key',
          baseUrl: 'https://provider.invalid/v1',
          model: 'test-model',
          ...config,
        })
    ).toThrow(message)
  })

  it('keeps request and response secrets out of errors and serialization', async () => {
    const secrets = {
      apiKey: 'secret-api-key-value',
      prompt: 'private prompt with resume and job description',
      responseBody: 'raw-private-response-body',
      providerMessage: 'provider-original-private-error-message',
    }
    const server = await withServer(() => ({
      status: 400,
      body: JSON.stringify({
        error: { message: secrets.providerMessage },
        raw: secrets.responseBody,
      }),
    }))
    try {
      const client = new OpenAICompatibleClient({
        apiKey: secrets.apiKey,
        baseUrl: server.baseUrl,
        model: 'test',
        maxRetries: 0,
      })

      let thrown: unknown
      try {
        await client.completeJson({
          system: secrets.prompt,
          user: secrets.prompt,
          schemaName: 'PrivateTest',
        })
      } catch (error) {
        thrown = error
      }

      expect(thrown).toBeInstanceOf(LlmRequestError)
      const error = thrown as LlmRequestError
      const serialized = JSON.stringify(error)
      const observableError = [error.message, error.stack ?? '', serialized]
        .join('\n')
        .toLowerCase()

      for (const secret of Object.values(secrets)) {
        expect(observableError).not.toContain(secret.toLowerCase())
      }
      expect(JSON.parse(serialized)).toEqual({
        name: 'LlmRequestError',
        message: 'LLM request failed with HTTP status 400',
        reason: 'http_status',
        retryable: false,
        status: 400,
      })
    } finally {
      await server.close()
    }
  })
})
