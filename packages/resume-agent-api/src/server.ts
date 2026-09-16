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

import { randomUUID } from 'node:crypto'
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http'
import {
  CandidateValidationError,
  createOpenAICompatibleClientFromEnv,
  DraftValidationError,
  InteractionAnswerSchema,
  LlmConfigurationError,
  LlmRequestError,
  ResumeAgentRunService,
  ResumeTailoringAgent,
  RunAnswerError,
  STYLE_PRESETS,
  StructuredOutputValidationError,
  TailorResumeRequestSchema,
} from '@yamlresume/resume-agent'

import { MultipartRequestError, parseMultipartRequest } from './multipart'

const DEFAULT_PORT = 8787
const JSON_BODY_BYTES = 1_000_000
const API_VERSION = 'v1'

export const API_ROUTES = [
  { method: 'get', path: '/healthz' },
  { method: 'get', path: '/v1/capabilities' },
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

function error(
  response: ServerResponse,
  status: number,
  code: string,
  message: string,
  requestId: string,
  details?: ApiErrorDetail[]
): void {
  json(
    response,
    status,
    {
      error: { code, message, ...(details?.length ? { details } : {}) },
      meta: { apiVersion: API_VERSION, requestId },
    },
    requestId
  )
}

function allowCors(response: ServerResponse): void {
  response.setHeader(
    'Access-Control-Allow-Origin',
    process.env.CORS_ORIGIN ?? '*'
  )
  response.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Request-Id'
  )
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  response.setHeader('Access-Control-Expose-Headers', 'X-Request-Id')
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

function capabilities() {
  return {
    apiVersion: API_VERSION,
    endpoints: {
      health: 'GET /healthz',
      capabilities: 'GET /v1/capabilities',
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
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
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
      formats: ['yaml', 'json', 'markdown', 'html', 'latex', 'pdf', 'docx'],
      styles: Object.values(STYLE_PRESETS).map((style) => ({
        id: style.id,
        label: style.label,
        description: style.description,
        template: style.template,
      })),
    },
  }
}

export interface AgentApiOptions {
  agent?: ResumeTailoringAgent
  runService?: ResumeAgentRunService
}

export function createAgentApiServer(options: AgentApiOptions = {}): Server {
  const agent = options.agent ?? createDefaultAgent()
  const runService = options.runService ?? new ResumeAgentRunService(agent)

  return createServer(async (request, response) => {
    const requestId = getRequestId(request)
    allowCors(response)

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
      success(response, 200, capabilities(), requestId)
      return
    }

    const answerMatch = url.pathname.match(/^\/v1\/runs\/([^/]+)\/answers$/)
    if (request.method === 'POST' && answerMatch) {
      let answerPayload: unknown
      try {
        answerPayload = await readPayload(request)
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
        const run = await runService.answer(answerMatch[1], parsedAnswer.data)
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
      error(response, 404, 'not_found', 'Route not found', requestId)
      return
    }

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
        success(response, 202, run, requestId)
        return
      }
      const result = await agent.run(parsed.data)
      success(response, 200, result, requestId)
    } catch (runError) {
      const message = getErrorMessage(runError)
      if (
        runError instanceof CandidateValidationError ||
        runError instanceof DraftValidationError
      ) {
        error(response, 422, 'agent_validation_failed', message, requestId)
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

function createDefaultAgent(): ResumeTailoringAgent {
  const client = createOpenAICompatibleClientFromEnv()
  if (!client) {
    throw new Error('OPENAI_API_KEY is required to start the default agent API')
  }
  return new ResumeTailoringAgent(client)
}

export function startAgentApiServer(
  options: AgentApiOptions = {},
  port = Number(process.env.PORT ?? DEFAULT_PORT)
): Server {
  const server = createAgentApiServer(options)
  server.listen(port, () => {
    console.log(`YAMLResume agent API listening on http://localhost:${port}`)
  })
  return server
}

if (
  process.argv[1]?.endsWith('/server.ts') ||
  process.argv[1]?.endsWith('/server.js')
) {
  startAgentApiServer()
}
