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

import type { LlmClient } from '@yamlresume/resume-agent'
import { ResumeTailoringAgent } from '@yamlresume/resume-agent'
import { describe, expect, it } from 'vitest'

import { createAgentApiServer } from './server'

const candidate = {
  content: {
    basics: { name: 'Ada Lovelace', email: 'ada@example.com' },
    education: [],
  },
  layouts: [
    { engine: 'latex', template: 'jake' },
    { engine: 'html', template: 'calm' },
  ],
}

function fakeAgent(): ResumeTailoringAgent {
  const responses = [
    {
      targetTitle: 'TypeScript Engineer',
      seniority: 'junior',
      summary: 'TypeScript engineer',
      requirements: [],
      keywords: [],
    },
    { resume: candidate, selectedEvidenceIds: [], questions: [], notes: [] },
  ]
  const llm: LlmClient = {
    async completeJson() {
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
  return new ResumeTailoringAgent(llm)
}

async function withServer<T>(
  callback: (baseUrl: string) => Promise<T>,
  agent = fakeAgent()
): Promise<T> {
  const server = createAgentApiServer({ agent })
  await new Promise<void>((resolve) => server.listen(0, resolve))
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Server did not start')
  }

  try {
    return await callback(`http://127.0.0.1:${address.port}`)
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((closeError) =>
        closeError ? reject(closeError) : resolve()
      )
    )
  }
}

describe('agent API', () => {
  it('documents backend capabilities for frontend clients', async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/capabilities`, {
        headers: { 'X-Request-Id': 'frontend-test' },
      })
      const payload = (await response.json()) as {
        data?: { output?: { formats?: string[]; styles?: unknown[] } }
        meta?: { requestId?: string }
      }

      expect(response.status).toBe(200)
      expect(response.headers.get('x-request-id')).toBe('frontend-test')
      expect(payload.meta?.requestId).toBe('frontend-test')
      expect(payload.data?.output?.formats).toContain('docx')
      expect(payload.data?.output?.styles).toHaveLength(5)
    })
  })

  it('validates JSON requests and returns a tailored resume result', async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/tailor-resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobDescription:
            'We need a TypeScript Engineer to build reliable systems.',
          candidate: { resume: candidate },
        }),
      })
      const payload = (await response.json()) as {
        data?: { status: string; rendered?: { artifacts?: unknown[] } }
        meta?: { requestId?: string }
      }
      expect(response.status).toBe(200)
      expect(payload.data?.status).toBe('completed')
      expect(payload.data?.rendered?.artifacts).toHaveLength(5)
      expect(payload.meta?.requestId).toBe(response.headers.get('x-request-id'))
    })
  })

  it('accepts multipart job files for browser uploads', async () => {
    await withServer(async (baseUrl) => {
      const form = new FormData()
      form.set('candidate', JSON.stringify({ resume: candidate }))
      form.append(
        'jobFiles',
        new Blob(['TypeScript Engineer role building reliable API systems.'], {
          type: 'text/plain',
        }),
        'job.txt'
      )

      const response = await fetch(`${baseUrl}/v1/tailor-resume`, {
        method: 'POST',
        body: form,
      })
      const payload = (await response.json()) as {
        data?: { status?: string }
      }

      expect(response.status).toBe(200)
      expect(payload.data?.status).toBe('completed')
    })
  })

  it('returns structured validation details for malformed requests', async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/tailor-resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const payload = (await response.json()) as {
        error?: { code: string; details?: Array<{ path?: string }> }
      }
      expect(response.status).toBe(400)
      expect(payload.error?.code).toBe('invalid_request')
      expect(payload.error?.details?.length).toBeGreaterThan(0)
    })
  })

  it('rejects unsupported request content types', async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/tailor-resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/xml' },
        body: '<resume />',
      })
      const payload = (await response.json()) as {
        error?: { code?: string }
      }

      expect(response.status).toBe(415)
      expect(payload.error?.code).toBe('invalid_request')
    })
  })

  it('returns a safe domain error when structured-output repair is exhausted', async () => {
    const llm: LlmClient = {
      async completeJson() {
        return {
          data: { privateValue: 'sensitive-model-output' },
          metadata: {
            provider: 'fake',
            model: 'fake-model',
            durationMs: 1,
            attempt: 1,
          },
        }
      },
    }
    const agent = new ResumeTailoringAgent(llm)

    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/tailor-resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobDescription:
            'Secret Company needs a TypeScript Engineer for private systems.',
          candidate: { resume: candidate },
        }),
      })
      const responseText = await response.text()
      const payload = JSON.parse(responseText) as {
        error?: { code?: string }
      }

      expect(response.status).toBe(502)
      expect(payload.error?.code).toBe('structured_output_validation_failed')
      expect(responseText).not.toContain('Secret Company')
      expect(responseText).not.toContain('sensitive-model-output')
    }, agent)
  })
})
