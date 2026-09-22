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

import { randomUUID, timingSafeEqual } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http'
import { dirname, resolve } from 'node:path'
import {
  type AgentValidationStage,
  ArtifactInputError,
  CandidateValidationError,
  ChatRequestSchema,
  createOfflineLlmClient,
  createOpenAICompatibleClientFromEnv,
  DraftValidationError,
  InMemoryRunStore,
  type InputFile,
  InteractionAnswerSchema,
  type LlmClient,
  LlmConfigurationError,
  LlmRequestError,
  ResumeAgentRunService,
  ResumeTailoringAgent,
  RunAnswerError,
  type RunStore,
  SqliteRunStore,
  STYLE_PRESETS,
  StructuredOutputValidationError,
  TailorResumeRequestSchema,
} from '@yamlresume/resume-agent'

import {
  type AuthCredentials,
  AuthError,
  AuthService,
  type AuthSession,
  type AuthUser,
} from './auth'
import { createSmtpEmailPort, readSmtpConfig } from './email'
import {
  MultipartRequestError,
  parseAnswerMultipartRequest,
  parseMultipartRequest,
} from './multipart'
import { readOAuthProviders } from './oauth'
import {
  PROFILE_MATERIAL_LIMIT,
  ProfilePayloadSchema,
  parseStoredProfile,
  serializeProfile,
} from './profile'

const DEFAULT_PORT = 8787
const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_RECOVERY_LIMIT = 100
const DEFAULT_DATABASE_PATH = '.data/resume-agent/runs.sqlite'
const DEFAULT_AUTH_DATABASE_PATH = '.data/resume-agent/auth.sqlite'
const DEFAULT_ALLOWED_ORIGIN = 'http://localhost:5173'
const JSON_BODY_BYTES = 1_000_000
const API_VERSION = 'v1'

export const API_ROUTES = [
  { method: 'get', path: '/healthz' },
  { method: 'get', path: '/v1/capabilities' },
  { method: 'post', path: '/v1/auth/register' },
  { method: 'post', path: '/v1/auth/login' },
  { method: 'get', path: '/v1/auth/me' },
  { method: 'post', path: '/v1/auth/logout' },
  { method: 'post', path: '/v1/auth/password-reset' },
  { method: 'post', path: '/v1/auth/password-reset/confirm' },
  { method: 'get', path: '/v1/auth/oauth/{provider}/start' },
  { method: 'get', path: '/v1/auth/oauth/{provider}/callback' },
  { method: 'post', path: '/v1/chat' },
  { method: 'get', path: '/v1/provider-credentials' },
  { method: 'put', path: '/v1/provider-credentials/{providerId}' },
  { method: 'delete', path: '/v1/provider-credentials/{providerId}' },
  { method: 'get', path: '/v1/profile' },
  { method: 'put', path: '/v1/profile' },
  { method: 'delete', path: '/v1/profile' },
  { method: 'post', path: '/v1/tailor-resume' },
  { method: 'post', path: '/v1/runs' },
  { method: 'get', path: '/v1/runs/{id}' },
  { method: 'post', path: '/v1/runs/{id}/answers' },
] as const

interface ApiMeta {
  apiVersion: typeof API_VERSION
  requestId: string
}

interface ApiErrorDetail {
  path?: string
  message: string
}

interface ApiErrorBody {
  error: {
    code: string
    message: string
    stage?: AgentValidationStage
    details?: ApiErrorDetail[]
  }
  meta: ApiMeta
}

interface ApiSuccessBody<T> {
  data: T
  meta: ApiMeta
}

function json<T>(
  response: ServerResponse,
  status: number,
  body: ApiSuccessBody<T> | ApiErrorBody,
  requestId: string
): void {
  const serialized = JSON.stringify(body)
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Content-Length', Buffer.byteLength(serialized))
  response.setHeader('X-Request-Id', requestId)
  response.end(serialized)
}

function success<T>(
  response: ServerResponse,
  status: number,
  data: T,
  requestId: string
): void {
  json(
    response,
    status,
    {
      data,
      meta: { apiVersion: API_VERSION, requestId },
    },
    requestId
  )
}

function noContent(response: ServerResponse, requestId: string): void {
  response.statusCode = 204
  response.setHeader('X-Request-Id', requestId)
  response.end()
}

function error(
  response: ServerResponse,
  status: number,
  code: string,
  message: string,
  requestId: string,
  details?: ApiErrorDetail[],
  stage?: AgentValidationStage
): void {
  json(
    response,
    status,
    {
      error: {
        code,
        message,
        ...(stage ? { stage } : {}),
        ...(details?.length ? { details } : {}),
      },
      meta: { apiVersion: API_VERSION, requestId },
    },
    requestId
  )
}

function authErrorResponse(
  response: ServerResponse,
  authError: unknown,
  requestId: string
): void {
  if (!(authError instanceof AuthError)) {
    error(
      response,
      500,
      'authentication_failed',
      'Authentication operation failed',
      requestId
    )
    return
  }
  switch (authError.code) {
    case 'invalid_registration':
    case 'invalid_provider_credential':
    case 'invalid_profile':
      error(response, 400, authError.code, authError.message, requestId)
      return
    case 'user_exists':
      error(response, 409, authError.code, authError.message, requestId)
      return
    case 'invalid_credentials':
    case 'invalid_invite_code':
      error(response, 403, authError.code, authError.message, requestId)
      return
    case 'invalid_reset_token':
      error(response, 400, authError.code, authError.message, requestId)
      return
    case 'reset_rate_limited':
      error(response, 429, authError.code, authError.message, requestId)
      return
    case 'oauth_unavailable':
    case 'invalid_oauth_state':
    case 'oauth_email_unverified':
    case 'oauth_email_unavailable':
    case 'oauth_failed':
      error(response, 400, authError.code, authError.message, requestId)
      return
    case 'not_authenticated':
      error(response, 401, authError.code, authError.message, requestId)
      return
    case 'login_rate_limited':
      response.setHeader('Retry-After', '900')
      error(response, 429, authError.code, authError.message, requestId)
      return
    case 'credential_not_found':
    case 'run_not_found':
      error(response, 404, authError.code, authError.message, requestId)
      return
    default:
      error(
        response,
        500,
        'authentication_failed',
        'Authentication operation failed',
        requestId
      )
  }
}

export interface AgentApiAuthOptions {
  service: AuthService
  allowedOrigin: string
  secureCookies: boolean
}

interface AuthenticatedRequest {
  user: AuthUser
  token: string
}

function sessionCookieName(auth: AgentApiAuthOptions): string {
  return auth.secureCookies ? '__Host-yamlresume_session' : 'yamlresume_session'
}

function readSessionToken(
  request: IncomingMessage,
  auth: AgentApiAuthOptions
): string | undefined {
  const name = sessionCookieName(auth)
  const values = (request.headers.cookie ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`))
    .map((part) => part.slice(name.length + 1))
  if (values.length !== 1 || !/^[A-Za-z0-9_-]{43}$/u.test(values[0] ?? '')) {
    return undefined
  }
  return values[0]
}

function setSessionCookie(
  response: ServerResponse,
  auth: AgentApiAuthOptions,
  session: AuthSession
): void {
  // `Expires` only for a remembered session. Without it the browser treats
  // the cookie as session-scoped and drops it on close, which is exactly what
  // an unticked "remember me" should mean.
  const expiry = session.persistent
    ? `; Expires=${new Date(session.expiresAt).toUTCString()}`
    : ''
  response.setHeader(
    'Set-Cookie',
    `${sessionCookieName(auth)}=${session.token}; Path=/; HttpOnly; SameSite=Lax${expiry}${auth.secureCookies ? '; Secure' : ''}`
  )
}

function clearSessionCookie(
  response: ServerResponse,
  auth: AgentApiAuthOptions
): void {
  response.setHeader(
    'Set-Cookie',
    `${sessionCookieName(auth)}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${auth.secureCookies ? '; Secure' : ''}`
  )
}

function allowCors(
  request: IncomingMessage,
  response: ServerResponse,
  auth: AgentApiAuthOptions | undefined
): boolean {
  const origin = request.headers.origin
  if (auth) {
    if (origin === auth.allowedOrigin) {
      response.setHeader('Access-Control-Allow-Origin', origin)
      response.setHeader('Access-Control-Allow-Credentials', 'true')
      response.setHeader('Vary', 'Origin')
    }
  } else {
    response.setHeader(
      'Access-Control-Allow-Origin',
      process.env.CORS_ORIGIN ?? '*'
    )
  }
  response.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Request-Id'
  )
  response.setHeader(
    'Access-Control-Allow-Methods',
    'GET, POST, PUT, DELETE, OPTIONS'
  )
  response.setHeader('Access-Control-Expose-Headers', 'X-Request-Id')
  return !auth || !origin || origin === auth.allowedOrigin
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  let size = 0
  const chunks: Buffer[] = []

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > JSON_BODY_BYTES) {
      throw new Error(`JSON request body exceeds ${JSON_BODY_BYTES} bytes`)
    }
    chunks.push(buffer)
  }

  const body = Buffer.concat(chunks).toString('utf8')
  if (!body.trim()) {
    throw new Error('Request body is required')
  }

  try {
    return JSON.parse(body) as unknown
  } catch {
    throw new Error('Request body must be valid JSON')
  }
}

function getErrorMessage(value: unknown): string {
  return value instanceof Error ? value.message : 'Unexpected server error'
}

function getRequestId(request: IncomingMessage): string {
  const requested = request.headers['x-request-id']
  return typeof requested === 'string' && requested.trim().length > 0
    ? requested.slice(0, 128)
    : randomUUID()
}

async function authenticateRequest(
  request: IncomingMessage,
  auth: AgentApiAuthOptions
): Promise<AuthenticatedRequest | undefined> {
  const token = readSessionToken(request, auth)
  if (!token) return undefined
  try {
    return { token, user: await auth.service.authenticate(token) }
  } catch (authError) {
    if (
      authError instanceof AuthError &&
      authError.code === 'not_authenticated'
    ) {
      return undefined
    }
    throw authError
  }
}

async function requireAuthenticatedRequest(
  request: IncomingMessage,
  response: ServerResponse,
  auth: AgentApiAuthOptions,
  requestId: string
): Promise<AuthenticatedRequest | undefined> {
  try {
    const identity = await authenticateRequest(request, auth)
    if (!identity) throw new AuthError('not_authenticated')
    return identity
  } catch (authError) {
    authErrorResponse(response, authError, requestId)
    return undefined
  }
}

/**
 * Invitation codes that gate registration.
 *
 * Empty means registration is open — that is the development and
 * single-operator default. When codes are configured, a would-be account must
 * present one, which is what lets the browser-level gate be removed without
 * leaving sign-up open to the whole internet.
 */
function readInviteCodes(env: NodeJS.ProcessEnv): string[] {
  return (env.RESUME_AGENT_INVITE_CODES ?? '')
    .split(',')
    .map((code) => code.trim())
    .filter((code) => code.length > 0)
}

/** Compares without leaking length or prefix through timing. */
function matchesInviteCode(
  supplied: string,
  codes: readonly string[]
): boolean {
  const suppliedBytes = Buffer.from(supplied, 'utf8')
  let matched = false
  for (const code of codes) {
    const codeBytes = Buffer.from(code, 'utf8')
    // timingSafeEqual throws on a length mismatch, so lengths are compared
    // first and the result folded in rather than short-circuiting.
    const sameLength = suppliedBytes.length === codeBytes.length
    const candidate = sameLength
      ? suppliedBytes
      : Buffer.alloc(codeBytes.length)
    if (timingSafeEqual(candidate, codeBytes) && sameLength) {
      matched = true
    }
  }
  return matched
}

function authCredentials(
  payload: unknown
): (AuthCredentials & { inviteCode?: string }) | undefined {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    Array.isArray(payload)
  ) {
    return undefined
  }
  const record = payload as Record<string, unknown>
  if (
    Object.keys(record).some(
      (key) =>
        key !== 'email' &&
        key !== 'password' &&
        key !== 'remember' &&
        key !== 'inviteCode'
    )
  ) {
    return undefined
  }
  const { email, password, remember, inviteCode } = record
  // `remember` is optional; anything that is not a boolean is rejected rather
  // than coerced, so a typo cannot silently produce a persistent session.
  if (remember !== undefined && typeof remember !== 'boolean') {
    return undefined
  }
  if (inviteCode !== undefined && typeof inviteCode !== 'string') {
    return undefined
  }
  return typeof email === 'string' && typeof password === 'string'
    ? {
        email,
        password,
        remember: remember === true,
        ...(typeof inviteCode === 'string' ? { inviteCode } : {}),
      }
    : undefined
}

function providerApiKey(payload: unknown): string | undefined {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    Array.isArray(payload)
  ) {
    return undefined
  }
  const record = payload as Record<string, unknown>
  if (Object.keys(record).some((key) => key !== 'apiKey')) return undefined
  const { apiKey } = record
  return typeof apiKey === 'string' ? apiKey : undefined
}

async function readPayload(request: IncomingMessage): Promise<unknown> {
  const contentType = request.headers['content-type']?.split(';')[0].trim()
  if (contentType === 'application/json' || !contentType) {
    return readJson(request)
  }
  if (contentType === 'multipart/form-data') {
    return parseMultipartRequest(request)
  }
  throw new Error(
    'Unsupported Content-Type. Use application/json or multipart/form-data'
  )
}

function validationDetails(
  issues: Array<{ path: PropertyKey[]; message: string }>
): ApiErrorDetail[] {
  return issues.map((issue) => ({
    ...(issue.path.length ? { path: issue.path.join('.') } : {}),
    message: issue.message,
  }))
}

interface AgentApiRuntimeCapabilities {
  providerConfigured: boolean
  runStore: 'memory' | 'sqlite'
  authentication: 'enabled' | 'disabled'
  oauthProviders?: Array<{ id: string; label: string }>
  /** Whether a new account needs an invitation code. */
  registration?: 'open' | 'invite'
  /**
   * Present only when this server has accounts, because a profile is stored
   * per account. Its absence is the client's signal that the profile routes
   * are unavailable, and its `materials` cap is the limit the editor enforces
   * — the frontend hard-codes neither.
   */
  profile?: { materials: number }
}

function capabilities(runtime: AgentApiRuntimeCapabilities) {
  return {
    apiVersion: API_VERSION,
    endpoints: {
      health: 'GET /healthz',
      capabilities: 'GET /v1/capabilities',
      register: 'POST /v1/auth/register',
      login: 'POST /v1/auth/login',
      currentUser: 'GET /v1/auth/me',
      logout: 'POST /v1/auth/logout',
      requestPasswordReset: 'POST /v1/auth/password-reset',
      confirmPasswordReset: 'POST /v1/auth/password-reset/confirm',
      oauthStart: 'GET /v1/auth/oauth/:provider/start',
      oauthCallback: 'GET /v1/auth/oauth/:provider/callback',
      chat: 'POST /v1/chat',
      providerCredentials: 'GET/PUT/DELETE /v1/provider-credentials',
      // Advertised so a client can tell an older deployment (which has no
      // profile routes) from one whose profile is merely empty.
      profile: 'GET/PUT/DELETE /v1/profile',
      tailorResume: 'POST /v1/tailor-resume',
      createRun: 'POST /v1/runs',
      getRun: 'GET /v1/runs/:id',
      answerRun: 'POST /v1/runs/:id/answers',
    },
    input: {
      requestContentTypes: ['application/json', 'multipart/form-data'],
      fileTypes: [
        'text/plain',
        'text/markdown',
        'text/html',
        'application/json',
        'application/yaml',
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.oasis.opendocument.text',
        'application/rtf',
        'image/png',
        'image/jpeg',
        'image/webp',
        'image/gif',
      ],
      limits: {
        jsonBodyBytes: JSON_BODY_BYTES,
        fileBytes: 12 * 1024 * 1024,
        totalMultipartBytes: 30 * 1024 * 1024,
        candidateFiles: 12,
        jobFiles: 8,
      },
    },
    output: {
      formats: [
        'yaml',
        'json',
        'markdown',
        'html',
        'latex',
        'pdf',
        'docx',
        'txt',
        'rtf',
        'odt',
      ],
      styles: Object.values(STYLE_PRESETS).map((style) => ({
        id: style.id,
        label: style.label,
        description: style.description,
        template: style.template,
      })),
    },
    // Only advertised when the routes actually exist: accumulating a profile
    // needs an account to scope it to, and a server with auth off has none.
    ...(runtime.authentication === 'enabled'
      ? { profile: { materials: PROFILE_MATERIAL_LIMIT } }
      : {}),
    runtime,
  }
}

export interface AgentApiOptions {
  agent?: ResumeTailoringAgent
  runService?: ResumeAgentRunService
  auth?: AgentApiAuthOptions
  env?: NodeJS.ProcessEnv
  runtime?: Partial<AgentApiRuntimeCapabilities>
}

function validateAuthHttpOptions(auth: AgentApiAuthOptions): void {
  try {
    const origin = new URL(auth.allowedOrigin)
    if (
      origin.origin !== auth.allowedOrigin ||
      (origin.protocol !== 'http:' && origin.protocol !== 'https:') ||
      auth.secureCookies !== (origin.protocol === 'https:')
    ) {
      throw new Error('Invalid authentication origin')
    }
  } catch {
    throw new Error('Authentication requires an exact allowed origin')
  }
}

export interface AgentApiStartOptions extends AgentApiOptions {
  port?: number
  host?: string
  recoveryLimit?: number
  logger?: (message: string) => void
}

export type AgentApiRuntimeErrorCode =
  | 'invalid_configuration'
  | 'store_open_failed'
  | 'auth_open_failed'
  | 'listen_failed'

export class AgentApiRuntimeError extends Error {
  constructor(readonly code: AgentApiRuntimeErrorCode) {
    super(
      code === 'invalid_configuration'
        ? 'Agent API runtime configuration is invalid.'
        : code === 'store_open_failed'
          ? 'Agent API run store could not be opened.'
          : code === 'auth_open_failed'
            ? 'Agent API authentication store could not be opened.'
            : 'Agent API could not start listening.'
    )
    this.name = 'AgentApiRuntimeError'
  }
}

export interface StartedAgentApiServer {
  server: Server
  url: string
  recoveredTasks: number
  runStore: 'memory' | 'sqlite'
  authentication: 'enabled' | 'disabled'
  close(): Promise<void>
}

export function createAgentApiServer(options: AgentApiOptions = {}): Server {
  if (options.auth) validateAuthHttpOptions(options.auth)
  const defaultAgent = options.agent
    ? undefined
    : createDefaultAgent(options.env)
  const agent = options.agent ?? defaultAgent?.agent
  if (!agent) throw new Error('Agent API initialization failed')
  const runService = options.runService ?? new ResumeAgentRunService(agent)
  // Registration policy is deployment configuration, not an account rule, so
  // it is read here where both the capabilities payload and the register
  // handler can see it.
  const inviteCodes = readInviteCodes(options.env ?? process.env)

  const runtime: AgentApiRuntimeCapabilities = {
    providerConfigured:
      options.runtime?.providerConfigured ??
      (options.agent ? true : (defaultAgent?.providerConfigured ?? false)),
    runStore: options.runtime?.runStore ?? 'memory',
    authentication:
      options.runtime?.authentication ??
      (options.auth ? 'enabled' : 'disabled'),
    oauthProviders:
      options.runtime?.oauthProviders ??
      options.auth?.service.listOAuthProviders() ??
      [],
    registration:
      options.runtime?.registration ??
      (inviteCodes.length > 0 ? 'invite' : 'open'),
  }

  return createServer(async (request, response) => {
    const requestId = getRequestId(request)
    const corsAllowed = allowCors(request, response, options.auth)

    if (
      !corsAllowed &&
      (request.method === 'OPTIONS' ||
        request.method === 'POST' ||
        request.method === 'PUT' ||
        request.method === 'DELETE')
    ) {
      error(
        response,
        403,
        'origin_not_allowed',
        'Request origin is not allowed',
        requestId
      )
      return
    }

    if (request.method === 'OPTIONS') {
      response.statusCode = 204
      response.setHeader('X-Request-Id', requestId)
      response.end()
      return
    }

    const url = new URL(request.url ?? '/', 'http://localhost')

    if (request.method === 'GET' && url.pathname === '/healthz') {
      success(response, 200, { ok: true }, requestId)
      return
    }

    if (request.method === 'GET' && url.pathname === '/v1/capabilities') {
      success(response, 200, capabilities(runtime), requestId)
      return
    }

    const isAuthRoute = url.pathname.startsWith('/v1/auth/')
    const isProviderCredentialRoute =
      url.pathname === '/v1/provider-credentials' ||
      url.pathname.startsWith('/v1/provider-credentials/')
    if (isAuthRoute || isProviderCredentialRoute) {
      response.setHeader('Cache-Control', 'no-store')
    }
    if (!options.auth && (isAuthRoute || isProviderCredentialRoute)) {
      error(
        response,
        503,
        'authentication_disabled',
        'Authentication is disabled',
        requestId
      )
      return
    }

    if (
      options.auth &&
      request.method === 'POST' &&
      (url.pathname === '/v1/auth/register' ||
        url.pathname === '/v1/auth/login')
    ) {
      try {
        const isRegistration = url.pathname === '/v1/auth/register'
        let input: ReturnType<typeof authCredentials>
        try {
          input = authCredentials(await readJson(request))
        } catch {
          throw new AuthError(
            isRegistration ? 'invalid_registration' : 'invalid_credentials'
          )
        }
        if (!input) {
          throw new AuthError(
            isRegistration ? 'invalid_registration' : 'invalid_credentials'
          )
        }
        if (isRegistration && inviteCodes.length > 0) {
          const supplied = input.inviteCode ?? ''
          if (!matchesInviteCode(supplied, inviteCodes)) {
            // Same answer for "no code" and "wrong code": the caller learns
            // nothing about which codes exist.
            throw new AuthError('invalid_invite_code')
          }
        }
        const session = isRegistration
          ? await options.auth.service.register(input)
          : await options.auth.service.login(input)
        setSessionCookie(response, options.auth, session)
        success(
          response,
          isRegistration ? 201 : 200,
          { user: session.user, expiresAt: session.expiresAt },
          requestId
        )
      } catch (authError) {
        authErrorResponse(response, authError, requestId)
      }
      return
    }

    if (
      options.auth &&
      request.method === 'POST' &&
      url.pathname === '/v1/auth/logout'
    ) {
      try {
        await options.auth.service.logout(
          readSessionToken(request, options.auth)
        )
        clearSessionCookie(response, options.auth)
        noContent(response, requestId)
      } catch (authError) {
        authErrorResponse(response, authError, requestId)
      }
      return
    }

    if (
      options.auth &&
      request.method === 'POST' &&
      url.pathname === '/v1/auth/password-reset'
    ) {
      try {
        const payload = (await readJson(request)) as { email?: unknown }
        if (typeof payload?.email === 'string') {
          await options.auth.service.requestPasswordReset({
            email: payload.email,
          })
        }
        // Always 204, whatever happened: a different status for "no such
        // account" would turn this endpoint into an account oracle.
        noContent(response, requestId)
      } catch (resetError) {
        authErrorResponse(response, resetError, requestId)
      }
      return
    }

    if (
      options.auth &&
      request.method === 'POST' &&
      url.pathname === '/v1/auth/password-reset/confirm'
    ) {
      try {
        const payload = (await readJson(request)) as {
          token?: unknown
          password?: unknown
        }
        if (
          typeof payload?.token !== 'string' ||
          typeof payload?.password !== 'string'
        ) {
          error(
            response,
            400,
            'invalid_reset_token',
            'A reset token and a new password are required',
            requestId
          )
          return
        }
        await options.auth.service.resetPassword({
          token: payload.token,
          password: payload.password,
        })
        clearSessionCookie(response, options.auth)
        noContent(response, requestId)
      } catch (resetError) {
        authErrorResponse(response, resetError, requestId)
      }
      return
    }

    const oauthStart = url.pathname.match(
      /^\/v1\/auth\/oauth\/([a-z0-9_-]+)\/start$/u
    )
    if (options.auth && request.method === 'GET' && oauthStart) {
      try {
        // Derived from the request so the callback URL matches the host the
        // browser used; a fixed default would break every deployment that is
        // not on the assumed port.
        const forwardedProto = request.headers['x-forwarded-proto']
        const host = request.headers.host ?? 'localhost'
        const protocol =
          typeof forwardedProto === 'string' ? forwardedProto : 'http'
        const target = options.auth.service.beginOAuth(oauthStart[1] ?? '', {
          redirectBase: `${protocol}://${host}`,
        })
        response.statusCode = 302
        response.setHeader('Location', target)
        response.setHeader('Cache-Control', 'no-store')
        response.end()
      } catch (oauthError) {
        authErrorResponse(response, oauthError, requestId)
      }
      return
    }

    const oauthCallback = url.pathname.match(
      /^\/v1\/auth\/oauth\/([a-z0-9_-]+)\/callback$/u
    )
    if (options.auth && request.method === 'GET' && oauthCallback) {
      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state')
      // Failure lands back in the app with a flag rather than a JSON body, so
      // a browser never ends up staring at an API error document.
      const failureRedirect = (reason: string) => {
        response.statusCode = 302
        response.setHeader(
          'Location',
          `${options.auth?.allowedOrigin}/#auth_error=${reason}`
        )
        response.setHeader('Cache-Control', 'no-store')
        response.end()
      }
      if (!code || !state) {
        failureRedirect('oauth_failed')
        return
      }
      try {
        const forwardedProto = request.headers['x-forwarded-proto']
        const host = request.headers.host ?? 'localhost'
        const protocol =
          typeof forwardedProto === 'string' ? forwardedProto : 'http'
        const session = await options.auth.service.completeOAuth(
          oauthCallback[1] ?? '',
          { code, state, redirectBase: `${protocol}://${host}` }
        )
        setSessionCookie(response, options.auth, session)
        response.statusCode = 302
        response.setHeader('Location', options.auth.allowedOrigin)
        response.setHeader('Cache-Control', 'no-store')
        response.end()
      } catch (oauthError) {
        failureRedirect(
          oauthError instanceof AuthError ? oauthError.code : 'oauth_failed'
        )
      }
      return
    }

    if (
      options.auth &&
      request.method === 'GET' &&
      url.pathname === '/v1/auth/me'
    ) {
      try {
        const identity = await authenticateRequest(request, options.auth)
        if (!identity) throw new AuthError('not_authenticated')
        success(response, 200, identity.user, requestId)
      } catch (authError) {
        authErrorResponse(response, authError, requestId)
      }
      return
    }

    if (
      options.auth &&
      request.method === 'GET' &&
      url.pathname === '/v1/provider-credentials'
    ) {
      try {
        const identity = await authenticateRequest(request, options.auth)
        if (!identity) throw new AuthError('not_authenticated')
        success(
          response,
          200,
          await options.auth.service.listProviderCredentials(identity.user.id),
          requestId
        )
      } catch (authError) {
        authErrorResponse(response, authError, requestId)
      }
      return
    }

    const providerCredentialMatch = url.pathname.match(
      /^\/v1\/provider-credentials\/([^/]+)$/
    )
    if (
      options.auth &&
      providerCredentialMatch &&
      (request.method === 'PUT' || request.method === 'DELETE')
    ) {
      try {
        const identity = await authenticateRequest(request, options.auth)
        if (!identity) throw new AuthError('not_authenticated')
        const providerId = providerCredentialMatch[1]
        if (request.method === 'DELETE') {
          await options.auth.service.deleteProviderCredential(
            identity.user.id,
            providerId
          )
          noContent(response, requestId)
          return
        }
        let apiKey: string | undefined
        try {
          apiKey = providerApiKey(await readJson(request))
        } catch {
          throw new AuthError('invalid_provider_credential')
        }
        if (apiKey === undefined) {
          throw new AuthError('invalid_provider_credential')
        }
        const credential = await options.auth.service.putProviderCredential(
          identity.user.id,
          { providerId, apiKey }
        )
        success(response, 200, credential, requestId)
      } catch (authError) {
        authErrorResponse(response, authError, requestId)
      }
      return
    }

    if (
      options.auth &&
      url.pathname === '/v1/profile' &&
      request.method === 'GET'
    ) {
      try {
        const identity = await authenticateRequest(request, options.auth)
        if (!identity) throw new AuthError('not_authenticated')
        const stored = await options.auth.service.readProfile(identity.user.id)
        if (!stored) {
          // "No profile yet" is a state, not a failure — but it is still a
          // missing resource, and the client distinguishes it from an empty
          // document so it can tell "never saved" from "saved as blank".
          error(
            response,
            404,
            'profile_not_found',
            'No profile has been saved for this account',
            requestId
          )
          return
        }
        success(
          response,
          200,
          parseStoredProfile(stored.payload, stored),
          requestId
        )
      } catch (authError) {
        authErrorResponse(response, authError, requestId)
      }
      return
    }

    if (
      options.auth &&
      url.pathname === '/v1/profile' &&
      request.method === 'PUT'
    ) {
      try {
        const identity = await authenticateRequest(request, options.auth)
        if (!identity) throw new AuthError('not_authenticated')
        let payload: unknown
        try {
          payload = await readJson(request)
        } catch (requestError) {
          error(
            response,
            400,
            'invalid_profile',
            getErrorMessage(requestError),
            requestId
          )
          return
        }
        const parsed = ProfilePayloadSchema.safeParse(payload)
        if (!parsed.success) {
          error(
            response,
            400,
            'invalid_profile',
            'Profile data is invalid',
            requestId,
            validationDetails(parsed.error.issues)
          )
          return
        }
        const summary = await options.auth.service.putProfile(
          identity.user.id,
          serializeProfile(parsed.data)
        )
        success(response, 200, summary, requestId)
      } catch (authError) {
        authErrorResponse(response, authError, requestId)
      }
      return
    }

    if (
      options.auth &&
      url.pathname === '/v1/profile' &&
      request.method === 'DELETE'
    ) {
      try {
        const identity = await authenticateRequest(request, options.auth)
        if (!identity) throw new AuthError('not_authenticated')
        // Deletion is idempotent: whether or not a profile was there, the
        // caller's next `GET` returns 404, which is the only thing they can
        // observe. Reporting "was it there" would leak nothing useful.
        await options.auth.service.deleteProfile(identity.user.id)
        noContent(response, requestId)
      } catch (authError) {
        authErrorResponse(response, authError, requestId)
      }
      return
    }

    const answerMatch = url.pathname.match(/^\/v1\/runs\/([^/]+)\/answers$/)
    if (request.method === 'POST' && answerMatch) {
      if (options.auth) {
        const identity = await requireAuthenticatedRequest(
          request,
          response,
          options.auth,
          requestId
        )
        if (!identity) return
        try {
          if (
            !(await options.auth.service.isRunOwner(
              identity.user.id,
              answerMatch[1]
            ))
          ) {
            error(response, 404, 'run_not_found', 'Run not found', requestId)
            return
          }
        } catch (authError) {
          authErrorResponse(response, authError, requestId)
          return
        }
      }
      let answerPayload: unknown
      let answerFiles: InputFile[] = []
      try {
        if (
          request.headers['content-type']?.startsWith('multipart/form-data')
        ) {
          // A `file`-control answer references uploaded binaries; they ride
          // along in the same multipart request, keyed by the fileIds the
          // answer declares.
          const parsedMultipart = await parseAnswerMultipartRequest(request)
          answerPayload = parsedMultipart.answer
          answerFiles = parsedMultipart.candidateFiles
        } else {
          answerPayload = await readPayload(request)
        }
      } catch (requestError) {
        error(
          response,
          400,
          'invalid_answer',
          getErrorMessage(requestError),
          requestId
        )
        return
      }
      const parsedAnswer = InteractionAnswerSchema.safeParse(answerPayload)
      if (!parsedAnswer.success) {
        error(
          response,
          400,
          'invalid_answer',
          'Invalid interaction answer',
          requestId,
          validationDetails(parsedAnswer.error.issues)
        )
        return
      }
      try {
        const run = await runService.answer(answerMatch[1], parsedAnswer.data, {
          candidateFiles: answerFiles,
        })
        success(response, 202, run, requestId)
      } catch (answerError) {
        if (answerError instanceof RunAnswerError) {
          const status =
            answerError.code === 'run_not_found'
              ? 404
              : answerError.code === 'invalid_answer'
                ? 400
                : 409
          error(
            response,
            status,
            answerError.code,
            answerError.message,
            requestId
          )
          return
        }
        error(
          response,
          500,
          'answer_failed',
          'The interaction answer could not be processed.',
          requestId
        )
      }
      return
    }

    const runMatch = url.pathname.match(/^\/v1\/runs\/([^/]+)$/)
    if (request.method === 'GET' && runMatch) {
      if (options.auth) {
        const identity = await requireAuthenticatedRequest(
          request,
          response,
          options.auth,
          requestId
        )
        if (!identity) return
        try {
          if (
            !(await options.auth.service.isRunOwner(
              identity.user.id,
              runMatch[1]
            ))
          ) {
            error(response, 404, 'run_not_found', 'Run not found', requestId)
            return
          }
        } catch (authError) {
          authErrorResponse(response, authError, requestId)
          return
        }
      }
      const run = await runService.get(runMatch[1])
      if (!run) {
        error(response, 404, 'run_not_found', 'Run not found', requestId)
        return
      }
      success(response, 200, run, requestId)
      return
    }

    const isSynchronousRun =
      request.method === 'POST' && url.pathname === '/v1/tailor-resume'
    const isAsynchronousRun =
      request.method === 'POST' && url.pathname === '/v1/runs'
    if (!isSynchronousRun && !isAsynchronousRun) {
      if (request.method === 'POST' && url.pathname === '/v1/chat') {
        const identity = options.auth
          ? await requireAuthenticatedRequest(
              request,
              response,
              options.auth,
              requestId
            )
          : undefined
        if (options.auth && !identity) return
        let payload: unknown
        try {
          payload = await readPayload(request)
        } catch (requestError) {
          error(
            response,
            400,
            'invalid_request',
            getErrorMessage(requestError),
            requestId
          )
          return
        }
        const parsed = ChatRequestSchema.safeParse(payload)
        if (!parsed.success) {
          const issue = parsed.error.issues[0]
          error(
            response,
            400,
            'invalid_request',
            issue?.message ?? 'Invalid chat request',
            requestId
          )
          return
        }
        try {
          success(response, 200, await agent.chat(parsed.data), requestId)
        } catch (chatError) {
          const message = getErrorMessage(chatError)
          if (chatError instanceof LlmConfigurationError) {
            error(response, 503, 'llm_not_configured', message, requestId)
            return
          }
          if (chatError instanceof LlmRequestError) {
            error(response, 502, 'llm_request_failed', message, requestId)
            return
          }
          error(response, 500, 'agent_failed', message, requestId)
        }
        return
      }
      error(response, 404, 'not_found', 'Route not found', requestId)
      return
    }

    const identity = options.auth
      ? await requireAuthenticatedRequest(
          request,
          response,
          options.auth,
          requestId
        )
      : undefined
    if (options.auth && !identity) return

    let payload: unknown
    try {
      payload = await readPayload(request)
    } catch (requestError) {
      const message = getErrorMessage(requestError)
      error(
        response,
        requestError instanceof MultipartRequestError ||
          !message.startsWith('Unsupported Content-Type')
          ? 400
          : 415,
        'invalid_request',
        message,
        requestId
      )
      return
    }

    const parsed = TailorResumeRequestSchema.safeParse(payload)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      error(
        response,
        400,
        'invalid_request',
        `Invalid tailor-resume request: ${issue?.message ?? 'unknown validation error'}`,
        requestId,
        validationDetails(parsed.error.issues)
      )
      return
    }

    try {
      if (isAsynchronousRun) {
        const run = await runService.start(parsed.data)
        if (options.auth && identity) {
          await options.auth.service.claimRun(identity.user.id, run.id)
        }
        success(response, 202, run, requestId)
        return
      }
      const result = await agent.run(parsed.data)
      success(response, 200, result, requestId)
    } catch (runError) {
      const message = getErrorMessage(runError)
      if (runError instanceof AuthError) {
        authErrorResponse(response, runError, requestId)
        return
      }
      if (runError instanceof ArtifactInputError) {
        const status =
          runError.code === 'document_limit_exceeded'
            ? 413
            : runError.code === 'unsupported_file_type'
              ? 415
              : 422
        error(response, status, runError.code, runError.message, requestId)
        return
      }
      if (
        runError instanceof CandidateValidationError ||
        runError instanceof DraftValidationError
      ) {
        error(
          response,
          422,
          'agent_validation_failed',
          message,
          requestId,
          undefined,
          runError.stage
        )
        return
      }
      if (runError instanceof LlmConfigurationError) {
        error(response, 503, 'llm_not_configured', message, requestId)
        return
      }
      if (runError instanceof LlmRequestError) {
        error(response, 502, 'llm_request_failed', message, requestId)
        return
      }
      if (runError instanceof StructuredOutputValidationError) {
        error(response, 502, runError.code, message, requestId)
        return
      }
      error(response, 500, 'agent_failed', message, requestId)
    }
  })
}

/**
 * Pick the model provider from the environment.
 *
 * `RESUME_AGENT_LLM_PROVIDER=offline` selects the heuristic client that calls
 * no model at all, for the local demo and browser smoke runs; it counts as a
 * configured provider because every workflow stage can complete. Otherwise an
 * OpenAI-compatible client is built from `OPENAI_*`, and when that is absent
 * the API still starts but every model call fails with a stable
 * configuration error, so health and capabilities stay reachable.
 */
function createDefaultAgent(env: NodeJS.ProcessEnv = process.env): {
  agent: ResumeTailoringAgent
  providerConfigured: boolean
  provider: 'offline' | 'openai-compatible' | 'none'
} {
  const requested = env.RESUME_AGENT_LLM_PROVIDER?.trim() || 'openai-compatible'
  if (requested === 'offline') {
    return {
      agent: new ResumeTailoringAgent(createOfflineLlmClient()),
      providerConfigured: true,
      provider: 'offline',
    }
  }
  if (requested !== 'openai-compatible') {
    throw new AgentApiRuntimeError('invalid_configuration')
  }
  const client = createOpenAICompatibleClientFromEnv(env)
  if (client) {
    return {
      agent: new ResumeTailoringAgent(client),
      providerConfigured: true,
      provider: 'openai-compatible',
    }
  }
  const unavailableClient: LlmClient = {
    async completeJson() {
      throw new LlmConfigurationError('LLM provider is not configured.')
    },
  }
  return {
    agent: new ResumeTailoringAgent(unavailableClient),
    providerConfigured: false,
    provider: 'none',
  }
}

function configuredInteger(
  value: number | string | undefined,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const resolved = value === undefined ? fallback : Number(value)
  if (
    !Number.isSafeInteger(resolved) ||
    resolved < minimum ||
    resolved > maximum
  ) {
    throw new AgentApiRuntimeError('invalid_configuration')
  }
  return resolved
}

async function createRuntimeStore(
  env: NodeJS.ProcessEnv
): Promise<{ kind: 'memory' | 'sqlite'; store: RunStore; close?: () => void }> {
  const kind = env.RESUME_AGENT_RUN_STORE?.trim() || 'sqlite'
  if (kind === 'memory') {
    return { kind, store: new InMemoryRunStore() }
  }
  if (kind !== 'sqlite') {
    throw new AgentApiRuntimeError('invalid_configuration')
  }

  const configuredPath =
    env.RESUME_AGENT_RUN_DB_PATH?.trim() || DEFAULT_DATABASE_PATH
  if (!configuredPath) {
    throw new AgentApiRuntimeError('invalid_configuration')
  }
  const databasePath = resolve(configuredPath)
  try {
    await mkdir(dirname(databasePath), { recursive: true, mode: 0o700 })
    const store = await SqliteRunStore.open(databasePath)
    return { kind, store, close: () => store.close() }
  } catch {
    throw new AgentApiRuntimeError('store_open_failed')
  }
}

function parseCredentialEncryptionKeys(
  value: string | undefined
): Array<{ id: string; key: Buffer }> {
  if (!value?.trim()) throw new AgentApiRuntimeError('invalid_configuration')
  try {
    const parsed = JSON.parse(value) as unknown
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new Error('Credential keyring must be an object')
    }
    const entries = Object.entries(parsed)
    if (entries.length === 0) throw new Error('Credential keyring is empty')
    return entries.map(([id, encoded]) => {
      if (!id.trim() || typeof encoded !== 'string') {
        throw new Error('Credential key entry is invalid')
      }
      const normalized = encoded.trim()
      const key = Buffer.from(normalized, 'base64')
      if (key.byteLength !== 32 || key.toString('base64') !== normalized) {
        throw new Error('Credential key must be 32-byte base64')
      }
      return { id, key }
    })
  } catch (error) {
    if (error instanceof AgentApiRuntimeError) throw error
    throw new AgentApiRuntimeError('invalid_configuration')
  }
}

function configuredBoolean(
  value: string | undefined,
  fallback: boolean
): boolean {
  if (value === undefined) return fallback
  if (value === 'true') return true
  if (value === 'false') return false
  throw new AgentApiRuntimeError('invalid_configuration')
}

async function createRuntimeAuth(
  env: NodeJS.ProcessEnv
): Promise<AgentApiAuthOptions | undefined> {
  const mode = env.RESUME_AGENT_AUTH_MODE?.trim() || 'enabled'
  if (mode === 'disabled') return undefined
  if (mode !== 'enabled') {
    throw new AgentApiRuntimeError('invalid_configuration')
  }
  const credentialEncryptionKeys = parseCredentialEncryptionKeys(
    env.RESUME_AGENT_CREDENTIAL_KEYS
  )
  const activeCredentialEncryptionKeyId =
    env.RESUME_AGENT_CREDENTIAL_ACTIVE_KEY_ID?.trim()
  if (!activeCredentialEncryptionKeyId) {
    throw new AgentApiRuntimeError('invalid_configuration')
  }
  const allowedOrigin =
    env.RESUME_AGENT_ALLOWED_ORIGIN?.trim() || DEFAULT_ALLOWED_ORIGIN
  let origin: URL
  try {
    origin = new URL(allowedOrigin)
  } catch {
    throw new AgentApiRuntimeError('invalid_configuration')
  }
  if (
    origin.origin !== allowedOrigin ||
    (origin.protocol !== 'http:' && origin.protocol !== 'https:')
  ) {
    throw new AgentApiRuntimeError('invalid_configuration')
  }
  const secureCookies = configuredBoolean(
    env.RESUME_AGENT_SECURE_COOKIES,
    origin.protocol === 'https:'
  )
  if (secureCookies !== (origin.protocol === 'https:')) {
    throw new AgentApiRuntimeError('invalid_configuration')
  }
  // Providers are opt-in by configuration; the frontend only renders the
  // buttons for whatever comes back in `/v1/capabilities`.
  const oauthProviders = readOAuthProviders(env)
  // Absent SMTP settings are fine: the service then keeps its logging port.
  // A *broken* setting throws, so a typo cannot silently stop reset mail.
  const smtp = readSmtpConfig(env)
  const oauthRedirectBase =
    env.RESUME_AGENT_OAUTH_REDIRECT_BASE?.trim() ||
    `http://localhost:${env.PORT?.trim() || DEFAULT_PORT}`
  const databasePath = resolve(
    env.RESUME_AGENT_AUTH_DB_PATH?.trim() || DEFAULT_AUTH_DATABASE_PATH
  )
  try {
    await mkdir(dirname(databasePath), { recursive: true, mode: 0o700 })
    const service = await AuthService.open({
      databasePath,
      credentialEncryptionKeys,
      activeCredentialEncryptionKeyId,
      oauthProviders,
      oauthRedirectBase,
      resetUrlBase: allowedOrigin,
      ...(smtp ? { emailPort: createSmtpEmailPort(smtp) } : {}),
    })
    return { service, allowedOrigin, secureCookies }
  } catch (error) {
    if (error instanceof AuthError && error.code === 'invalid_configuration') {
      throw new AgentApiRuntimeError('invalid_configuration')
    }
    throw new AgentApiRuntimeError('auth_open_failed')
  }
}

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolveListen, rejectListen) => {
    const onError = () => {
      server.off('listening', onListening)
      rejectListen(new AgentApiRuntimeError('listen_failed'))
    }
    const onListening = () => {
      server.off('error', onError)
      resolveListen()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, host)
  })
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve()
  return new Promise((resolveClose, rejectClose) => {
    server.close((closeError) =>
      closeError ? rejectClose(closeError) : resolveClose()
    )
  })
}

export async function startAgentApiServer(
  options: AgentApiStartOptions = {},
  legacyPort?: number
): Promise<StartedAgentApiServer> {
  const env = options.env ?? process.env
  const port = configuredInteger(
    options.port ?? legacyPort ?? env.PORT,
    DEFAULT_PORT,
    0,
    65_535
  )
  const recoveryLimit = configuredInteger(
    options.recoveryLimit ?? env.RESUME_AGENT_RECOVERY_LIMIT,
    DEFAULT_RECOVERY_LIMIT,
    1,
    1_000
  )
  const host = options.host ?? env.RESUME_AGENT_HOST ?? DEFAULT_HOST
  if (!host.trim()) {
    throw new AgentApiRuntimeError('invalid_configuration')
  }

  const defaultAgent = options.agent ? undefined : createDefaultAgent(env)
  const agent = options.agent ?? defaultAgent?.agent
  if (!agent) throw new AgentApiRuntimeError('invalid_configuration')
  const providerConfigured = options.agent
    ? true
    : (defaultAgent?.providerConfigured ?? false)

  let ownedStore:
    | { kind: 'memory' | 'sqlite'; store: RunStore; close?: () => void }
    | undefined
  let runService = options.runService
  let runStore: 'memory' | 'sqlite'
  if (runService) {
    runStore = options.runtime?.runStore ?? 'memory'
  } else {
    ownedStore = await createRuntimeStore(env)
    runStore = ownedStore.kind
    runService = new ResumeAgentRunService(agent, { store: ownedStore.store })
  }

  let auth = options.auth
  let ownedAuth: AuthService | undefined
  let server: Server | undefined
  try {
    if (!auth) {
      auth = await createRuntimeAuth(env)
      ownedAuth = auth?.service
    }
    const recoveredTasks = await runService.recoverPendingTasks(recoveryLimit)
    server = createAgentApiServer({
      agent,
      runService,
      auth,
      runtime: { providerConfigured, runStore },
    })
    await listen(server, port, host)
    // Keep polling after startup recovery so released tasks and tasks created
    // by later requests are retried without requiring another process restart.
    runService.startWorker()
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new AgentApiRuntimeError('listen_failed')
    }
    const url = `http://${host}:${address.port}`
    options.logger?.(
      `YAMLResume agent API listening on ${url} (${runStore} RunStore, auth ${auth ? 'enabled' : 'disabled'}, provider ${defaultAgent?.provider ?? 'injected'})`
    )

    let closing: Promise<void> | undefined
    return {
      server,
      url,
      recoveredTasks,
      runStore,
      authentication: auth ? 'enabled' : 'disabled',
      close() {
        closing ??= (async () => {
          try {
            await closeServer(server as Server)
          } finally {
            try {
              await runService.close()
            } finally {
              try {
                ownedStore?.close?.()
              } finally {
                ownedAuth?.close()
              }
            }
          }
        })()
        return closing
      },
    }
  } catch (error) {
    if (server) await closeServer(server).catch(() => undefined)
    await runService.close().catch(() => undefined)
    try {
      ownedStore?.close?.()
    } catch {
      // Preserve the safe startup error.
    }
    try {
      ownedAuth?.close()
    } catch {
      // Preserve the safe startup error.
    }
    if (error instanceof AgentApiRuntimeError) throw error
    throw new AgentApiRuntimeError('listen_failed')
  }
}

if (
  process.argv[1]?.endsWith('/server.ts') ||
  process.argv[1]?.endsWith('/server.js')
) {
  void startAgentApiServer({ logger: console.log })
    .then((runtime) => {
      let shuttingDown = false
      const shutdown = (): void => {
        if (shuttingDown) return
        shuttingDown = true
        void runtime.close().then(
          () => {
            process.exitCode = 0
          },
          () => {
            console.error('Agent API failed to shut down cleanly.')
            process.exitCode = 1
          }
        )
      }
      process.once('SIGINT', shutdown)
      process.once('SIGTERM', shutdown)
    })
    .catch((error: unknown) => {
      const message =
        error instanceof AgentApiRuntimeError
          ? error.message
          : 'Agent API failed to start.'
      console.error(message)
      process.exitCode = 1
    })
}
