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

import type {
  JsonCompletionRequest,
  LlmCallMetadata,
  LlmClient,
  LlmCompletion,
} from '@/contracts'

export interface OpenAICompatibleConfig {
  apiKey: string
  baseUrl: string
  model: string
  provider?: string
  timeoutMs?: number
  maxRetries?: number
  retryDelayMs?: number
  temperature?: number
}

interface ResolvedConfig {
  apiKey: string
  baseUrl: string
  model: string
  provider: string
  timeoutMs: number
  maxRetries: number
  retryDelayMs: number
  temperature?: number
}

export class LlmConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LlmConfigurationError'
  }
}

export class LlmRequestError extends Error {
  readonly retryable: boolean
  readonly status?: number

  constructor(
    message: string,
    options: { retryable?: boolean; status?: number } = {}
  ) {
    super(message)
    this.name = 'LlmRequestError'
    this.retryable = options.retryable ?? false
    this.status = options.status
  }
}

interface ChatCompletionResponse {
  id?: string
  model?: string
  choices?: Array<{
    message?: {
      content?: string | null
    }
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    completion_tokens_details?: {
      reasoning_tokens?: number
    }
  }
  error?: {
    message?: string
  }
}

function stripJsonFence(content: string): string {
  const trimmed = content.trim()
  if (trimmed.startsWith('```') && trimmed.endsWith('```')) {
    return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  }
  return trimmed
}

function getContent(payload: ChatCompletionResponse): string {
  const content = payload.choices?.[0]?.message?.content
  if (!content) {
    throw new LlmRequestError('LLM returned an empty response', {
      retryable: true,
    })
  }
  return content
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function usageFrom(payload: ChatCompletionResponse) {
  if (!payload.usage) return undefined
  return {
    inputTokens: payload.usage.prompt_tokens,
    outputTokens: payload.usage.completion_tokens,
    reasoningTokens: payload.usage.completion_tokens_details?.reasoning_tokens,
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500
}

export class OpenAICompatibleClient implements LlmClient {
  private readonly config: ResolvedConfig

  constructor(config: OpenAICompatibleConfig) {
    this.config = {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl.replace(/\/$/, ''),
      model: config.model,
      provider: config.provider ?? 'openai-compatible',
      timeoutMs: config.timeoutMs ?? 60_000,
      maxRetries: config.maxRetries ?? 2,
      retryDelayMs: config.retryDelayMs ?? 250,
      ...(config.temperature === undefined
        ? {}
        : { temperature: config.temperature }),
    }

    if (!this.config.apiKey) {
      throw new LlmConfigurationError(
        'An API key is required for the LLM client'
      )
    }
    if (!this.config.baseUrl) {
      throw new LlmConfigurationError('An LLM base URL is required')
    }
    if (!this.config.model) {
      throw new LlmConfigurationError('An LLM model is required')
    }
    if (!Number.isFinite(this.config.timeoutMs) || this.config.timeoutMs <= 0) {
      throw new LlmConfigurationError('LLM timeout must be a positive number')
    }
    if (
      !Number.isInteger(this.config.maxRetries) ||
      this.config.maxRetries < 0 ||
      this.config.maxRetries > 5
    ) {
      throw new LlmConfigurationError(
        'LLM maxRetries must be an integer between 0 and 5'
      )
    }
    if (
      !Number.isFinite(this.config.retryDelayMs) ||
      this.config.retryDelayMs < 0
    ) {
      throw new LlmConfigurationError(
        'LLM retryDelayMs must be a non-negative number'
      )
    }
  }

  async completeJson<T>(
    request: JsonCompletionRequest
  ): Promise<LlmCompletion<T>> {
    let lastError: LlmRequestError | undefined
    const attempts = this.config.maxRetries + 1

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const startedAt = Date.now()
      try {
        const result = await this.requestOnce<T>(request, attempt, startedAt)
        return result
      } catch (error) {
        const normalized =
          error instanceof LlmRequestError
            ? error
            : new LlmRequestError(
                `LLM request failed: ${error instanceof Error ? error.message : String(error)}`,
                { retryable: true }
              )
        lastError = normalized
        if (!normalized.retryable || attempt === attempts) {
          throw normalized
        }
        await sleep(this.config.retryDelayMs * attempt)
      }
    }

    throw (
      lastError ??
      new LlmRequestError('LLM request failed without a recorded error')
    )
  }

  private async requestOnce<T>(
    request: JsonCompletionRequest,
    attempt: number,
    startedAt: number
  ): Promise<LlmCompletion<T>> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs)
    const requestBody = {
      model: this.config.model,
      ...(this.config.temperature === undefined
        ? {}
        : { temperature: this.config.temperature }),
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: request.system },
        {
          role: 'user',
          content: request.images?.length
            ? [
                { type: 'text', text: request.user },
                ...request.images.map((image) => ({
                  type: 'image_url',
                  image_url: { url: image.dataUrl },
                })),
              ]
            : request.user,
        },
      ],
    }

    try {
      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      })

      let payload: ChatCompletionResponse
      try {
        payload = (await response.json()) as ChatCompletionResponse
      } catch (error) {
        throw new LlmRequestError(
          `LLM returned a non-JSON response: ${
            error instanceof Error ? error.message : String(error)
          }`,
          {
            retryable: isRetryableStatus(response.status),
            status: response.status,
          }
        )
      }

      if (!response.ok) {
        throw new LlmRequestError(
          payload.error?.message ??
            `LLM request failed with status ${response.status}`,
          {
            retryable: isRetryableStatus(response.status),
            status: response.status,
          }
        )
      }

      let data: T
      try {
        data = JSON.parse(stripJsonFence(getContent(payload))) as T
      } catch (error) {
        if (error instanceof LlmRequestError) throw error
        throw new LlmRequestError(
          `LLM returned invalid JSON: ${
            error instanceof Error ? error.message : String(error)
          }`,
          { retryable: true }
        )
      }

      const metadata: LlmCallMetadata = {
        provider: this.config.provider,
        model: payload.model ?? this.config.model,
        durationMs: Date.now() - startedAt,
        attempt,
        ...(payload.id ? { requestId: payload.id } : {}),
        ...(usageFrom(payload) ? { usage: usageFrom(payload) } : {}),
      }
      return { data, metadata }
    } catch (error) {
      if (error instanceof LlmRequestError) throw error
      if (error instanceof Error && error.name === 'AbortError') {
        throw new LlmRequestError(
          `LLM request timed out after ${this.config.timeoutMs}ms`,
          { retryable: true }
        )
      }
      throw new LlmRequestError(
        `LLM request failed: ${error instanceof Error ? error.message : String(error)}`,
        { retryable: true }
      )
    } finally {
      clearTimeout(timeout)
    }
  }
}

export function createOpenAICompatibleClientFromEnv(
  env: NodeJS.ProcessEnv = process.env
): OpenAICompatibleClient | undefined {
  const apiKey = env.OPENAI_API_KEY
  if (!apiKey) {
    return undefined
  }

  return new OpenAICompatibleClient({
    apiKey,
    baseUrl: env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
    model: env.OPENAI_MODEL ?? 'gpt-4o-mini',
    timeoutMs: env.OPENAI_TIMEOUT_MS
      ? Number(env.OPENAI_TIMEOUT_MS)
      : undefined,
    maxRetries: env.OPENAI_MAX_RETRIES
      ? Number(env.OPENAI_MAX_RETRIES)
      : undefined,
    retryDelayMs: env.OPENAI_RETRY_DELAY_MS
      ? Number(env.OPENAI_RETRY_DELAY_MS)
      : undefined,
  })
}
