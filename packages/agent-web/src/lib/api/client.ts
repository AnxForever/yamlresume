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

import type { InteractionAnswer, ResumeAgentRun } from '@/lib/api/types'

export const DEFAULT_AGENT_API_BASE_URL = 'http://localhost:8787'

/**
 * Per-request ceiling. Chosen well above the slowest legitimate call (a full
 * tailoring run is async, so no single request should take minutes) while
 * still terminating a hung connection in reasonable time.
 */
export const DEFAULT_TIMEOUT_MS = 30_000

/**
 * Uploads carry candidate files (up to 30 MiB total) and are read and parsed
 * server-side before the run is queued, so they get a longer ceiling than a
 * plain metadata request.
 */
export const UPLOAD_TIMEOUT_MS = 120_000

export interface ApiErrorDetail {
  path?: string
  message: string
}

export interface ApiFailure {
  code: string
  message: string
  stage?: 'candidate_input' | 'candidate_normalization' | 'draft_validation'
  details?: ApiErrorDetail[]
  requestId?: string
  status?: number
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatResponse {
  reply: string
  readyToGenerate: boolean
}

export interface AuthUser {
  id: string
  email: string
  createdAt: string
}
export interface AuthSession {
  user: AuthUser
  expiresAt: string
}

/**
 * Discriminated on a string `kind`, not a boolean `ok`.
 *
 * This package inherits `strict: false` from the repository tsconfig, which
 * turns off `strictNullChecks` — and without it TypeScript widens `true` /
 * `false` literals, so a boolean discriminant stops narrowing. A string tag
 * narrows either way.
 */
export type ApiResult<T> =
  | { kind: 'ok'; data: T; requestId?: string }
  | { kind: 'error'; error: ApiFailure }

/**
 * `not_found` is deliberately separate from `error`: the in-memory `RunStore`
 * loses runs on restart, and that must surface as "记录丢失", never as a
 * transport problem the user should retry.
 */
export type GetRunResult =
  | { kind: 'found'; run: ResumeAgentRun }
  | { kind: 'not_found' }
  | { kind: 'error'; error: ApiFailure }

/**
 * Shape of a `multipart/form-data` run creation. The candidate YAML is sent as
 * a JSON field (the API contract), while binary files travel as separate
 * multipart parts.
 */
export interface MultipartRunPayload {
  jobDescription: string
  candidateYaml: string
  preferences: unknown
  jobFiles: Array<{ file: File }>
  candidateFiles: Array<{ file: File }>
}

export interface AgentCapabilities {
  apiVersion: string
  endpoints: Record<string, string>
  input: {
    requestContentTypes: string[]
    fileTypes: string[]
    limits: {
      jsonBodyBytes: number
      fileBytes: number
      totalMultipartBytes: number
      candidateFiles: number
      jobFiles: number
    }
  }
  output: {
    formats: string[]
    styles: Array<{
      id: string
      label: string
      description: string
      template: string
    }>
  }
}

export interface AgentApiClientOptions {
  baseUrl?: string
  fetchImpl?: typeof fetch
  /** Injected so tests do not depend on `crypto.randomUUID`. */
  requestIdFactory?: () => string
}

function defaultRequestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `req_${Math.random().toString(36).slice(2)}`
}

/**
 * Thin transport over `@yamlresume/resume-agent-api`.
 *
 * It unwraps the `{ data, meta }` / `{ error, meta }` envelope and never
 * throws for an HTTP or network failure — callers get a discriminated
 * `ApiResult` so every failure has to be handled explicitly. Model API keys
 * stay server-side; nothing here reads or forwards them.
 */
export class AgentApiClient {
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch
  private readonly requestIdFactory: () => string

  constructor(options: AgentApiClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_AGENT_API_BASE_URL).replace(
      /\/+$/,
      ''
    )
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
    this.requestIdFactory = options.requestIdFactory ?? defaultRequestId
  }

  async health(): Promise<ApiResult<{ ok: boolean }>> {
    return this.send<{ ok: boolean }>('GET', '/healthz')
  }

  async login(
    email: string,
    password: string
  ): Promise<ApiResult<AuthSession>> {
    return this.send<AuthSession>('POST', '/v1/auth/login', { email, password })
  }
  async register(
    email: string,
    password: string
  ): Promise<ApiResult<AuthSession>> {
    return this.send<AuthSession>('POST', '/v1/auth/register', {
      email,
      password,
    })
  }
  async me(): Promise<ApiResult<AuthSession>> {
    return this.send<AuthSession>('GET', '/v1/auth/me')
  }
  async logout(): Promise<ApiResult<null>> {
    return this.send<null>('POST', '/v1/auth/logout')
  }

  async capabilities(): Promise<ApiResult<AgentCapabilities>> {
    return this.send<AgentCapabilities>('GET', '/v1/capabilities')
  }

  async chat(
    message: string,
    history: ChatMessage[] = [],
    context?: string
  ): Promise<ApiResult<ChatResponse>> {
    return this.send<ChatResponse>('POST', '/v1/chat', {
      message,
      history,
      ...(context ? { context } : {}),
    })
  }

  async createRun(body: unknown): Promise<ApiResult<ResumeAgentRun>> {
    return this.send<ResumeAgentRun>('POST', '/v1/runs', body)
  }

  /**
   * Browser upload path: `multipart/form-data`, per the API's integration
   * rules. Field names mirror the multipart contract —
   * `jobDescription` / `candidate` (JSON) / `preferences` (JSON) / `jobFiles` /
   * `candidateFiles`.
   */
  async createRunMultipart(
    payload: MultipartRunPayload
  ): Promise<ApiResult<ResumeAgentRun>> {
    const form = new FormData()
    if (payload.jobDescription.trim().length > 0) {
      form.append('jobDescription', payload.jobDescription)
    }
    if (payload.candidateYaml.trim().length > 0) {
      form.append('candidate', JSON.stringify({ yaml: payload.candidateYaml }))
    }
    form.append('preferences', JSON.stringify(payload.preferences))
    for (const file of payload.jobFiles) {
      form.append('jobFiles', file.file, file.file.name)
    }
    for (const file of payload.candidateFiles) {
      form.append('candidateFiles', file.file, file.file.name)
    }
    return this.sendMultipart('/v1/runs', form)
  }

  /**
   * Answer the current structured interaction. The caller owns the
   * `idempotencyKey`: the same key with the same payload may be retried
   * safely, while a different payload under the same key fails with a 409.
   */
  async answerRun(
    runId: string,
    answer: InteractionAnswer
  ): Promise<ApiResult<ResumeAgentRun>> {
    return this.send<ResumeAgentRun>(
      'POST',
      `/v1/runs/${encodeURIComponent(runId)}/answers`,
      answer
    )
  }

  private async sendMultipart<T>(
    path: string,
    form: FormData
  ): Promise<ApiResult<T>> {
    const requestId = this.requestIdFactory()
    const envelope = await this.perform<T>(
      `${this.baseUrl}${path}`,
      {
        method: 'POST',
        headers: { 'X-Request-Id': requestId },
        body: form,
      },
      UPLOAD_TIMEOUT_MS
    )
    return envelope
  }

  /**
   * A missing run is a normal outcome, not an error: the development
   * `RunStore` is in-memory, so a restarted backend legitimately returns 404.
   * The result is a three-way union so callers cannot accidentally treat a
   * lost run as a transport failure.
   */
  async getRun(runId: string): Promise<GetRunResult> {
    const result = await this.send<ResumeAgentRun>(
      'GET',
      `/v1/runs/${encodeURIComponent(runId)}`
    )
    if (result.kind === 'ok') {
      return { kind: 'found', run: result.data }
    }
    if (result.error.status === 404) {
      return { kind: 'not_found' }
    }
    return { kind: 'error', error: result.error }
  }

  private async send<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown
  ): Promise<ApiResult<T>> {
    return this.perform<T>(`${this.baseUrl}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  }

  /**
   * Shared request/response handling: attaches the request id, unwraps the
   * `{ data, meta }` / `{ error, meta }` envelope, and never throws for an
   * HTTP or network failure.
   *
   * Every request is bounded by a timeout. Without one, a backend that accepts
   * the connection but never answers would leave the UI in `loading` forever —
   * a spinner with no retry and no explanation, which is exactly the kind of
   * dead end this frontend must not have.
   */
  private async perform<T>(
    url: string,
    init: RequestInit,
    timeoutMs: number = DEFAULT_TIMEOUT_MS
  ): Promise<ApiResult<T>> {
    const requestId = this.requestIdFactory()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const timedOut = () => controller.signal.aborted

    let response: Response
    try {
      response = await this.fetchImpl(url, {
        ...init,
        signal: controller.signal,
        // The API can run with session-cookie auth; `include` is required for
        // the cookie to travel on cross-origin dev requests (integration rule
        // #7). It is harmless while auth is disabled server-side.
        credentials: 'include',
        headers: {
          ...(init.headers ?? {}),
          'X-Request-Id': requestId,
        },
      })
    } catch (error) {
      clearTimeout(timer)
      if (timedOut()) {
        return {
          kind: 'error',
          error: {
            code: 'timeout',
            message: `请求超过 ${Math.round(timeoutMs / 1000)} 秒没有响应`,
            requestId,
          },
        }
      }
      return {
        kind: 'error',
        error: {
          code: 'network_error',
          message: error instanceof Error ? error.message : '无法连接到后端',
          requestId,
        },
      }
    }
    clearTimeout(timer)

    const headerRequestId = response.headers?.get?.('X-Request-Id') ?? undefined

    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      return {
        kind: 'error',
        error: {
          code: 'invalid_response',
          message: '后端返回的不是合法 JSON',
          status: response.status,
          ...(headerRequestId ? { requestId: headerRequestId } : { requestId }),
        },
      }
    }

    const envelope = (payload ?? {}) as {
      data?: T
      error?: {
        code?: string
        message?: string
        stage?: ApiFailure['stage']
        details?: ApiErrorDetail[]
      }
      meta?: { requestId?: string }
    }
    const resolvedRequestId =
      envelope.meta?.requestId ?? headerRequestId ?? requestId

    if (!response.ok || envelope.error) {
      return {
        kind: 'error',
        error: {
          code: envelope.error?.code ?? 'unknown_error',
          message: envelope.error?.message ?? `请求失败（${response.status}）`,
          ...(envelope.error?.stage ? { stage: envelope.error.stage } : {}),
          ...(envelope.error?.details
            ? { details: envelope.error.details }
            : {}),
          requestId: resolvedRequestId,
          status: response.status,
        },
      }
    }

    return {
      kind: 'ok',
      data: envelope.data as T,
      requestId: resolvedRequestId,
    }
  }
}
