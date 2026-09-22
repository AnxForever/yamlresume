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

import { describe, expect, it, vi } from 'vitest'

import { AgentApiClient } from '@/lib/api/client'

function jsonResponse(
  body: unknown,
  init: { status?: number; requestId?: string } = {}
): Response {
  // A real `Response`, not a hand-rolled stand-in: the client reads the body
  // as text so it can tell an empty 204 from a malformed payload, and a fake
  // that only implements `json()` would hide exactly that distinction.
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: init.requestId ? { 'X-Request-Id': init.requestId } : {},
  })
}

function client(
  fetchImpl: typeof fetch,
  requestId = 'req-fixed'
): AgentApiClient {
  return new AgentApiClient({
    baseUrl: 'http://localhost:8787',
    fetchImpl,
    requestIdFactory: () => requestId,
  })
}

describe('AgentApiClient', () => {
  it('unwraps the success envelope', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ data: { ok: true }, meta: { requestId: 'req-server' } })
    ) as unknown as typeof fetch

    const result = await client(fetchImpl).health()

    expect(result).toEqual({
      kind: 'ok',
      data: { ok: true },
      requestId: 'req-server',
    })
  })

  it('sends a client-generated X-Request-Id', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ data: {} }))

    await client(fetchImpl as unknown as typeof fetch, 'req-abc').capabilities()

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:8787/v1/capabilities',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ 'X-Request-Id': 'req-abc' }),
      })
    )
  })

  it('posts a JSON body with a content type', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ data: {} }, { status: 202 })
    )

    await client(fetchImpl as unknown as typeof fetch).createRun({
      jobDescription: 'x',
    })

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:8787/v1/runs',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ jobDescription: 'x' }),
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
      })
    )
  })

  it('omits a body and content type for GET requests', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () =>
      jsonResponse({ data: {} })
    )

    await client(fetchImpl).health()

    const init = vi.mocked(fetchImpl).mock.calls[0]?.[1] as RequestInit
    expect(init.body).toBeUndefined()
    expect(init.headers).not.toHaveProperty('Content-Type')
  })

  it('maps a validation error with its field paths', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        {
          error: {
            code: 'invalid_request',
            message: '请求无效',
            details: [{ path: 'candidate.files.0', message: '不支持的类型' }],
          },
          meta: { requestId: 'req-server' },
        },
        { status: 400 }
      )
    )

    const result = await client(fetchImpl as unknown as typeof fetch).createRun(
      {}
    )

    expect(result).toEqual({
      kind: 'error',
      error: {
        code: 'invalid_request',
        message: '请求无效',
        details: [{ path: 'candidate.files.0', message: '不支持的类型' }],
        requestId: 'req-server',
        status: 400,
      },
    })
  })

  it('preserves the structured-output failure code', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        {
          error: {
            code: 'structured_output_validation_failed',
            message: '模型输出不符合契约',
          },
        },
        { status: 502 }
      )
    )

    const result = await client(fetchImpl as unknown as typeof fetch).createRun(
      {}
    )

    expect(result.kind).toBe('error')
    if (result.kind === 'error') {
      expect(result.error.code).toBe('structured_output_validation_failed')
      expect(result.error.status).toBe(502)
    }
  })

  it('returns not_found for a missing run instead of an error', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        { error: { code: 'run_not_found', message: 'Run not found' } },
        { status: 404 }
      )
    )

    const result = await client(fetchImpl as unknown as typeof fetch).getRun(
      'run_1'
    )

    expect(result).toEqual({ kind: 'not_found' })
  })

  it('returns found with the run snapshot', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ data: { id: 'run_1', status: 'drafting' } })
    )

    const result = await client(fetchImpl as unknown as typeof fetch).getRun(
      'run_1'
    )

    expect(result).toMatchObject({
      kind: 'found',
      run: { id: 'run_1', status: 'drafting' },
    })
  })

  it('returns error for a non-404 run failure', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        { error: { code: 'agent_failed', message: '内部错误' } },
        { status: 500 }
      )
    )

    const result = await client(fetchImpl as unknown as typeof fetch).getRun(
      'run_1'
    )

    expect(result).toMatchObject({
      kind: 'error',
      error: { code: 'agent_failed', status: 500 },
    })
  })

  it('url-encodes the run id', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ data: {} }))

    await client(fetchImpl as unknown as typeof fetch).getRun('run/1 2')

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:8787/v1/runs/run%2F1%202',
      expect.anything()
    )
  })

  it('reports a network failure without throwing', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    })

    const result = await client(fetchImpl as unknown as typeof fetch).health()

    expect(result).toEqual({
      kind: 'error',
      error: {
        code: 'network_error',
        message: 'ECONNREFUSED',
        requestId: 'req-fixed',
      },
    })
  })

  it('reports a non-JSON response without throwing', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('<html>gateway error</html>', { status: 200 })
    )

    const result = await client(fetchImpl as unknown as typeof fetch).health()

    expect(result).toMatchObject({
      kind: 'error',
      error: { code: 'invalid_response', status: 200 },
    })
  })

  it('falls back to the header request id when meta is absent', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ data: {} }, { requestId: 'req-header' })
    )

    const result = await client(fetchImpl as unknown as typeof fetch).health()

    expect(result).toMatchObject({ kind: 'ok', requestId: 'req-header' })
  })

  it('falls back to a stable code when an error body has none', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, { status: 500 }))

    const result = await client(fetchImpl as unknown as typeof fetch).health()

    expect(result).toMatchObject({
      kind: 'error',
      error: { code: 'unknown_error', message: '请求失败（500）' },
    })
  })

  it('strips trailing slashes from the base url', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ data: {} }))
    const api = new AgentApiClient({
      baseUrl: 'http://localhost:8787///',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      requestIdFactory: () => 'req-fixed',
    })

    await api.health()

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:8787/healthz',
      expect.anything()
    )
  })
})

describe('AgentApiClient multipart and answers', () => {
  it('posts a multipart run with the documented field names', async () => {
    let captured: RequestInit | undefined
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      captured = init
      return jsonResponse(
        { data: { id: 'run_1', status: 'queued' } },
        { status: 202 }
      )
    })

    const api = client(fetchImpl as unknown as typeof fetch)
    const jobFile = new File(['jd'], 'jd.txt', { type: 'text/plain' })
    const result = await api.createRunMultipart({
      jobDescription: '这是一段足够长的岗位描述',
      candidateYaml: 'name: Ada',
      preferences: { styles: ['ats-compact'], formats: ['html'] },
      jobFiles: [{ file: jobFile }],
      candidateFiles: [],
    })

    expect(result.kind).toBe('ok')
    expect(captured?.body).toBeInstanceOf(FormData)
    const form = captured?.body as FormData
    expect(form.get('jobDescription')).toBe('这是一段足够长的岗位描述')
    expect(form.get('candidate')).toBe(JSON.stringify({ yaml: 'name: Ada' }))
    expect(form.get('preferences')).toBe(
      JSON.stringify({ styles: ['ats-compact'], formats: ['html'] })
    )
    expect(form.getAll('jobFiles')).toHaveLength(1)
    expect(form.getAll('candidateFiles')).toHaveLength(0)
  })

  it('omits the candidate JSON field when only files are supplied', async () => {
    let captured: RequestInit | undefined
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      captured = init
      return jsonResponse(
        { data: { id: 'run_1', status: 'queued' } },
        { status: 202 }
      )
    })

    const api = client(fetchImpl as unknown as typeof fetch)
    const pdf = new File(['pdf'], 'resume.pdf', { type: 'application/pdf' })
    await api.createRunMultipart({
      jobDescription: '这是一段足够长的岗位描述',
      candidateYaml: '  ',
      preferences: { styles: ['ats-compact'], formats: ['html'] },
      jobFiles: [],
      candidateFiles: [{ file: pdf }],
    })

    const form = captured?.body as FormData
    expect(form.get('candidate')).toBeNull()
    expect(form.getAll('candidateFiles')).toHaveLength(1)
  })

  it('posts an answer with the interaction id and idempotency key', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        { data: { id: 'run_1', status: 'analyzing_jd' } },
        { status: 202 }
      )
    )

    const result = await client(fetchImpl as unknown as typeof fetch).answerRun(
      'run_1',
      { interactionId: 'q1', idempotencyKey: 'key-1', value: 'Ada' }
    )

    expect(result.kind).toBe('ok')
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:8787/v1/runs/run_1/answers',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          interactionId: 'q1',
          idempotencyKey: 'key-1',
          value: 'Ada',
        }),
      })
    )
  })
})

describe('no-content responses', () => {
  it('treats a 204 with an empty body as success, not a parse failure', async () => {
    // `POST /v1/auth/logout` and `DELETE /v1/profile` answer 204 with no body.
    // Reading those with `response.json()` rejected, so a successful logout
    // came back as `invalid_response` — a failure the caller could not tell
    // apart from the server being unreachable.
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }))

    await expect(
      client(fetchImpl as unknown as typeof fetch).logout()
    ).resolves.toMatchObject({ kind: 'ok', data: null })
  })

  it('reports an empty error body with its status rather than a parse error', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 502 }))

    const result = await client(fetchImpl as unknown as typeof fetch).health()

    expect(result).toMatchObject({
      kind: 'error',
      error: { code: 'unknown_error', status: 502 },
    })
  })
})

describe('profile', () => {
  it('returns a found profile without treating it as a run', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        data: {
          resumeYaml: 'name: Ada',
          preferences: { styles: ['ats-compact'], formats: ['pdf'] },
          materials: [],
          createdAt: '2026-09-16T12:00:00.000Z',
          updatedAt: '2026-09-17T09:30:00.000Z',
        },
      })
    )

    const result = await client(
      fetchImpl as unknown as typeof fetch
    ).getProfile()

    expect(result).toMatchObject({
      kind: 'found',
      profile: { resumeYaml: 'name: Ada' },
    })
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:8787/v1/profile',
      expect.objectContaining({ method: 'GET' })
    )
  })

  it('separates "no profile yet" from a transport failure', async () => {
    // A new account has no profile. Reporting that as an error would put a
    // retry button in front of a perfectly normal state.
    const missing = vi.fn(async () =>
      jsonResponse(
        { error: { code: 'profile_not_found', message: 'No profile' } },
        { status: 404 }
      )
    )
    await expect(
      client(missing as unknown as typeof fetch).getProfile()
    ).resolves.toEqual({ kind: 'not_found' })

    const broken = vi.fn(async () =>
      jsonResponse(
        { error: { code: 'storage_failed', message: 'nope' } },
        { status: 500 }
      )
    )
    await expect(
      client(broken as unknown as typeof fetch).getProfile()
    ).resolves.toMatchObject({ kind: 'error' })
  })

  it('puts the profile and deletes it with the documented verbs', async () => {
    const payload = {
      resumeYaml: 'name: Ada',
      preferences: {
        styles: ['ats-compact'] as const,
        formats: ['pdf'] as const,
      },
      materials: [],
    }
    const put = vi.fn(async () =>
      jsonResponse({
        data: {
          createdAt: '2026-09-16T12:00:00.000Z',
          updatedAt: '2026-09-16T12:00:00.000Z',
        },
      })
    )

    const written = await client(put as unknown as typeof fetch).putProfile(
      payload as never
    )

    expect(written.kind).toBe('ok')
    expect(put).toHaveBeenCalledWith(
      'http://localhost:8787/v1/profile',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify(payload) })
    )

    const remove = vi.fn(async () => new Response(null, { status: 204 }))
    await expect(
      client(remove as unknown as typeof fetch).deleteProfile()
    ).resolves.toMatchObject({ kind: 'ok' })
    expect(remove).toHaveBeenCalledWith(
      'http://localhost:8787/v1/profile',
      expect.objectContaining({ method: 'DELETE' })
    )
  })
})
