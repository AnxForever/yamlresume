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
  LlmCallOptions,
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

const MAX_RETRY_AFTER_MS = 30_000
const IMF_FIXDATE_PATTERN =
  /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} (?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d GMT$/
const RFC850_DATE_PATTERN =
  /^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), \d{2}-(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-\d{2} (?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d GMT$/
const ASCTIME_DATE_PATTERN =
  /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (?: [1-9]|[12]\d|3[01]) (?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d \d{4}$/

export class LlmConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LlmConfigurationError'
  }
}

export type LlmRequestErrorReason =
  | 'request_failed'
  | 'cancelled'
  | 'timeout'
  | 'network_error'
  | 'http_status'
  | 'response_body_invalid_json'
  | 'response_content_missing'
  | 'response_content_invalid_json'

export class LlmRequestError extends Error {
  readonly reason: LlmRequestErrorReason
  readonly retryable: boolean
  readonly status?: number
  readonly retryAfterMs?: number

  constructor(
    message: string,
    options: {
      reason?: LlmRequestErrorReason
      retryable?: boolean
      status?: number
      retryAfterMs?: number
    } = {}
  ) {
    super(message)
    this.name = 'LlmRequestError'
    this.reason = options.reason ?? 'request_failed'
    this.retryable = options.retryable ?? false
    this.status = options.status
    this.retryAfterMs = normalizeRetryAfterMs(options.retryAfterMs)
  }

  toJSON(): {
    name: string
    message: string
    reason: LlmRequestErrorReason
    retryable: boolean
    status?: number
    retryAfterMs?: number
  } {
    return {
      name: this.name,
      message: this.message,
      reason: this.reason,
      retryable: this.retryable,
      ...(this.status === undefined ? {} : { status: this.status }),
      ...(this.retryAfterMs === undefined
        ? {}
        : { retryAfterMs: this.retryAfterMs }),
    }
  }
}

function normalizeRetryAfterMs(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value < 0) {
    return undefined
  }
  return Math.min(Math.ceil(value), MAX_RETRY_AFTER_MS)
}

function retryAfterMs(response: Response): number | undefined {
  const value = response.headers.get('Retry-After')?.trim()
  if (!value) return undefined
  if (/^\d+$/.test(value)) {
    const seconds = Number(value)
    return normalizeRetryAfterMs(
      Number.isFinite(seconds) ? seconds * 1_000 : MAX_RETRY_AFTER_MS
    )
  }
  if (
    !IMF_FIXDATE_PATTERN.test(value) &&
    !RFC850_DATE_PATTERN.test(value) &&
    !ASCTIME_DATE_PATTERN.test(value)
  ) {
    return undefined
  }
  const retryAt = Date.parse(value)
  return Number.isFinite(retryAt)
    ? normalizeRetryAfterMs(Math.max(0, retryAt - Date.now()))
    : undefined
}

function stripJsonFence(content: string): string {
  const trimmed = content.trim()
  if (trimmed.startsWith('```') && trimmed.endsWith('```')) {
    return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  }
  return trimmed
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getContent(payload: unknown): string {
  let content: unknown
  if (isRecord(payload) && Array.isArray(payload.choices)) {
    const choice = payload.choices[0]
    if (isRecord(choice) && isRecord(choice.message)) {
      content = choice.message.content
    }
  }

  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new LlmRequestError('LLM response did not include message content', {
      reason: 'response_content_missing',
      retryable: false,
    })
  }
  return content
}

function cancelledRequestError(): LlmRequestError {
  return new LlmRequestError('LLM request was cancelled', {
    reason: 'cancelled',
    retryable: false,
  })
}

function sleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(cancelledRequestError())
  if (milliseconds === 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const finish = (): void => {
      signal?.removeEventListener('abort', cancel)
      resolve()
    }
    const cancel = (): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', cancel)
      reject(cancelledRequestError())
    }
    const timer = setTimeout(finish, milliseconds)
    signal?.addEventListener('abort', cancel, { once: true })
  })
}

function optionalTokenCount(
  record: Record<string, unknown>,
  key: string
): number | undefined {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined
}

function stringField(payload: unknown, key: string): string | undefined {
  if (!isRecord(payload)) return undefined
  const value = payload[key]
  return typeof value === 'string' && value.trim().length > 0
    ? value
    : undefined
}

function usageFrom(payload: unknown): LlmCallMetadata['usage'] | undefined {
  if (!isRecord(payload) || !isRecord(payload.usage)) return undefined
  const details = isRecord(payload.usage.completion_tokens_details)
    ? payload.usage.completion_tokens_details
    : undefined
  return {
    inputTokens: optionalTokenCount(payload.usage, 'prompt_tokens'),
    outputTokens: optionalTokenCount(payload.usage, 'completion_tokens'),
    reasoningTokens: details
      ? optionalTokenCount(details, 'reasoning_tokens')
      : undefined,
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
      baseUrl: config.baseUrl.trim().replace(/\/+$/, ''),
      model: config.model.trim(),
      provider: config.provider ?? 'openai-compatible',
      timeoutMs: config.timeoutMs ?? 60_000,
      maxRetries: config.maxRetries ?? 2,
      retryDelayMs: config.retryDelayMs ?? 250,
      ...(config.temperature === undefined
        ? {}
        : { temperature: config.temperature }),
    }

    if (!this.config.apiKey.trim()) {
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
    request: JsonCompletionRequest,
    options: LlmCallOptions = {}
  ): Promise<LlmCompletion<T>> {
    let lastError: LlmRequestError | undefined
    const attempts = this.config.maxRetries + 1

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const startedAt = Date.now()
      try {
        const result = await this.requestOnce<T>(
          request,
          attempt,
          startedAt,
          options.signal
        )
        return result
      } catch (error) {
        const normalized =
          error instanceof LlmRequestError
            ? error
            : new LlmRequestError('LLM request failed', {
                reason: 'request_failed',
                retryable: false,
              })
        lastError = normalized
        if (!normalized.retryable || attempt === attempts) {
          throw normalized
        }
        await sleep(
          Math.max(
            this.config.retryDelayMs * 2 ** (attempt - 1),
            normalized.retryAfterMs ?? 0
          ),
          options.signal
        )
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
    startedAt: number,
    callerSignal?: AbortSignal
  ): Promise<LlmCompletion<T>> {
    const controller = new AbortController()
    let abortSource: 'caller' | 'timeout' | undefined
    const abortFromCaller = (): void => {
      if (abortSource) return
      abortSource = 'caller'
      controller.abort()
    }
    callerSignal?.addEventListener('abort', abortFromCaller, { once: true })
    if (callerSignal?.aborted) abortFromCaller()
    const timeout = setTimeout(() => {
      if (abortSource) return
      abortSource = 'timeout'
      controller.abort()
    }, this.config.timeoutMs)
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

      const responseBody = await response.text()
      const retryableStatus = isRetryableStatus(response.status)
      const responseRetryAfterMs = retryableStatus
        ? retryAfterMs(response)
        : undefined
      let payload: unknown
      try {
        payload = JSON.parse(responseBody) as unknown
      } catch {
        throw new LlmRequestError('LLM response body was not valid JSON', {
          reason: 'response_body_invalid_json',
          retryable: retryableStatus,
          status: response.status,
          retryAfterMs: responseRetryAfterMs,
        })
      }

      if (!response.ok) {
        throw new LlmRequestError(
          `LLM request failed with HTTP status ${response.status}`,
          {
            reason: 'http_status',
            retryable: retryableStatus,
            status: response.status,
            retryAfterMs: responseRetryAfterMs,
          }
        )
      }

      let data: T
      try {
        data = JSON.parse(stripJsonFence(getContent(payload))) as T
      } catch (error) {
        if (error instanceof LlmRequestError) throw error
        throw new LlmRequestError('LLM message content was not valid JSON', {
          reason: 'response_content_invalid_json',
          retryable: false,
        })
      }

      const model = stringField(payload, 'model') ?? this.config.model
      const requestId = stringField(payload, 'id')
      const usage = usageFrom(payload)
      const metadata: LlmCallMetadata = {
        provider: this.config.provider,
        model,
        durationMs: Date.now() - startedAt,
        attempt,
        ...(requestId ? { requestId } : {}),
        ...(usage ? { usage } : {}),
      }
      return { data, metadata }
    } catch (error) {
      if (error instanceof LlmRequestError) throw error
      if (abortSource === 'caller') {
        throw cancelledRequestError()
      }
      if (abortSource === 'timeout') {
        throw new LlmRequestError('LLM request timed out', {
          reason: 'timeout',
          retryable: true,
        })
      }
      throw new LlmRequestError('LLM network request failed', {
        reason: 'network_error',
        retryable: true,
      })
    } finally {
      clearTimeout(timeout)
      callerSignal?.removeEventListener('abort', abortFromCaller)
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
