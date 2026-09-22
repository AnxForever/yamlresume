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
  InteractionAnswer,
  ProfilePayload,
  ProfileResponse,
  ProfileSummary,
  ResumeAgentRun,
} from '@/lib/api/types'

/**
 * Where the API lives when nothing else says otherwise.
 *
 * An empty string means "the origin this page was served from": in a
 * deployment the API is normally published on the same origin behind a
 * reverse proxy, and relative URLs then work with no configuration at all —
 * and with none of the CORS or cookie problems that a second origin brings.
 */
export const SAME_ORIGIN_BASE_URL = ''

/** The address the API listens on when run locally for development. */
export const LOCAL_DEV_AGENT_API_BASE_URL = 'http://localhost:8787'

/**
 * Resolved once at build time. `NEXT_PUBLIC_*` variables are inlined into the
 * client bundle by Next, so this cannot be read at runtime.
 */
export function configuredBaseUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_AGENT_API_BASE_URL?.trim()
  if (fromEnv) {
    return fromEnv.replace(/\/+$/, '')
  }
  // Development talks to the local API on its own port; a production build
  // talks to whatever serves it.
  return process.env.NODE_ENV === 'development'
    ? LOCAL_DEV_AGENT_API_BASE_URL
    : SAME_ORIGIN_BASE_URL
}

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
  /** `true` when the server issued a persistent (survives restart) cookie. */
  persistent?: boolean
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
 * Three-way, for the same reason `GetRunResult` is: having no profile yet is
 * the normal state of a new account, not a transport failure, and collapsing
 * the two would leave the page unable to tell "you have not set this up" from
 * "the server is unreachable".
 */
export type GetProfileResult =
  | { kind: 'found'; profile: ProfileResponse }
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
  /**
   * What this server process actually has switched on. `authentication`
   * decides whether the app shows a login gate at all: when it is `disabled`
   * every `/v1/auth/*` route answers 503, so a login screen would be a dead
   * end that no credentials could ever get past.
   */
  runtime?: {
    providerConfigured: boolean
    runStore: 'memory' | 'sqlite'
    authentication: 'enabled' | 'disabled'
    /** Social sign-in providers this server has credentials for. */
    oauthProviders?: Array<{ id: string; label: string }>
    /** `invite` means the register form must ask for an invitation code. */
    registration?: 'open' | 'invite'
  }
  /**
   * Present only when this server has accounts, because a profile is stored
   * per account. Its absence is how the profile page knows the routes are
   * unavailable, and `materials` is the cap the editor enforces — neither is
   * hard-coded on this side.
   */
  profile?: { materials: number }
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
    this.baseUrl = (options.baseUrl ?? configuredBaseUrl()).replace(/\/+$/, '')
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
    this.requestIdFactory = options.requestIdFactory ?? defaultRequestId
  }

  async health(): Promise<ApiResult<{ ok: boolean }>> {
    return this.send<{ ok: boolean }>('GET', '/healthz')
  }

  async login(
    email: string,
    password: string,
    remember = false
  ): Promise<ApiResult<AuthSession>> {
    return this.send<AuthSession>('POST', '/v1/auth/login', {
      email,
      password,
      remember,
    })
  }
  async register(
    email: string,
    password: string,
    remember = false,
    inviteCode?: string
  ): Promise<ApiResult<AuthSession>> {
    return this.send<AuthSession>('POST', '/v1/auth/register', {
      email,
      password,
      remember,
      ...(inviteCode ? { inviteCode } : {}),
    })
  }
  /**
   * Resolve the current identity.
   *
   * Returns the bare `AuthUser`, not an `AuthSession`: the session cookie is
   * HttpOnly, so the browser can never read the token or its expiry — the
   * server responds with just the user it resolved from the cookie
   * (`server.ts` passes `identity.user`). `login`/`register` do return a full
   * `AuthSession`, which is where `expiresAt` comes from.
   */
  async me(): Promise<ApiResult<AuthUser>> {
    return this.send<AuthUser>('GET', '/v1/auth/me')
  }
  async logout(): Promise<ApiResult<null>> {
    return this.send<null>('POST', '/v1/auth/logout')
  }

  /**
   * Ask for a reset link. Resolves the same way whether or not the address has
   * an account — the server answers 204 either way on purpose, so the UI must
   * never imply "we found you" or "we did not".
   */
  async requestPasswordReset(email: string): Promise<ApiResult<null>> {
    return this.send<null>('POST', '/v1/auth/password-reset', { email })
  }

  /** Finish a reset. On success every existing session for the account is gone. */
  async confirmPasswordReset(
    token: string,
    password: string
  ): Promise<ApiResult<null>> {
    return this.send<null>('POST', '/v1/auth/password-reset/confirm', {
      token,
      password,
    })
  }

  /**
   * Where the browser must go to start a provider sign-in. This is a full-page
   * navigation, not a fetch: the provider needs to show its own consent screen
   * and the session cookie is set on the callback.
   */
  oauthStartUrl(providerId: string): string {
    return `${this.baseUrl}/v1/auth/oauth/${encodeURIComponent(providerId)}/start`
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

  /**
   * Read the signed-in user's career profile.
   *
   * A server built before these routes existed answers 404 to all three verbs.
   * The caller tells that apart from "this account has no profile yet" by
   * checking `capabilities.endpoints.profile` first.
   */
  async getProfile(): Promise<GetProfileResult> {
    const result = await this.send<ProfileResponse>('GET', '/v1/profile')
    if (result.kind === 'ok') {
      return { kind: 'found', profile: result.data }
    }
    if (result.error.status === 404) {
      return { kind: 'not_found' }
    }
    return { kind: 'error', error: result.error }
  }

  async putProfile(
    payload: ProfilePayload
  ): Promise<ApiResult<ProfileSummary>> {
    return this.send<ProfileSummary>('PUT', '/v1/profile', payload)
  }

  /** The route answers 204 with no body, so the payload is `null`. */
  async deleteProfile(): Promise<ApiResult<null>> {
    return this.send<null>('DELETE', '/v1/profile')
  }

  private async send<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
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
    const fallbackRequestId = headerRequestId ?? requestId

    // Read the body as text rather than `json()`. Several routes answer 204
    // with a deliberately empty body (`POST /v1/auth/logout`, `DELETE
    // /v1/profile`), and `response.json()` rejects on those — which turned
    // every successful logout into an `invalid_response` error that no caller
    // could tell apart from a real transport failure.
    const body = await response.text()
    if (body.trim().length === 0) {
      if (!response.ok) {
        return {
          kind: 'error',
          error: {
            code: 'unknown_error',
            message: `请求失败（${response.status}）`,
            status: response.status,
            requestId: fallbackRequestId,
          },
        }
      }
      // A no-content response has no payload; the caller names `T` and knows
      // its route returns nothing, so `null` is the honest value here.
      return {
        kind: 'ok',
        data: null as unknown as T,
        requestId: fallbackRequestId,
      }
    }

    let payload: unknown
    try {
      payload = JSON.parse(body) as unknown
    } catch {
      return {
        kind: 'error',
        error: {
          code: 'invalid_response',
          message: '后端返回的不是合法 JSON',
          status: response.status,
          requestId: fallbackRequestId,
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
