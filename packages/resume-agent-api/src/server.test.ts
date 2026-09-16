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
import {
  ResumeAgentRunService,
  ResumeTailoringAgent,
} from '@yamlresume/resume-agent'
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
  agent = fakeAgent(),
  runService?: ResumeAgentRunService
): Promise<T> {
  const server = createAgentApiServer({
    agent,
    ...(runService ? { runService } : {}),
  })
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
      expect(payload.data?.output?.formats).toContain('txt')
      expect(payload.data?.output?.formats).toContain('rtf')
      expect(payload.data?.output?.formats).toContain('odt')
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

  it('returns a stable input error when uploaded content contradicts its type', async () => {
    const privateMarker = 'PRIVATE_CANDIDATE_DETAIL_72891'

    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/tailor-resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobDescription:
            'We need a TypeScript Engineer to build reliable systems.',
          candidate: {
            files: [
              {
                filename: 'candidate.txt',
                mediaType: 'text/plain',
                contentBase64: Buffer.from(
                  `%PDF-1.7\n${privateMarker}`,
                  'utf8'
                ).toString('base64'),
              },
            ],
          },
        }),
      })
      const payload = (await response.json()) as {
        error?: { code?: string; message?: string }
      }

      expect(response.status).toBe(422)
      expect(payload.error).toEqual({
        code: 'file_type_mismatch',
        message: 'File type does not match its content.',
      })
      expect(JSON.stringify(payload)).not.toContain(privateMarker)
    })
  })

  it('delivers a requested ODT package through the HTTP contract', async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/tailor-resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobDescription:
            'We need a TypeScript Engineer to build reliable systems.',
          candidate: { resume: candidate },
          preferences: { formats: ['odt'] },
        }),
      })
      const payload = (await response.json()) as {
        data?: {
          rendered?: {
            artifacts?: Array<{
              format?: string
              filename?: string
              mediaType?: string
              encoding?: string
              content?: string
              sizeBytes?: number
            }>
          }
        }
      }

      expect(response.status).toBe(200)
      const artifact = payload.data?.rendered?.artifacts?.[0]
      expect(artifact).toMatchObject({
        format: 'odt',
        filename: 'resume-ats-compact.odt',
        mediaType: 'application/vnd.oasis.opendocument.text',
        encoding: 'base64',
      })
      const decoded = Buffer.from(artifact?.content ?? '', 'base64')
      expect(decoded.subarray(0, 4)).toEqual(Buffer.from('PK\u0003\u0004'))
      expect(decoded.includes(Buffer.from('META-INF/manifest.xml'))).toBe(true)
      expect(decoded.includes(Buffer.from('content.xml'))).toBe(true)
      expect(artifact?.sizeBytes).toBe(decoded.byteLength)
    })
  })

  it('creates an asynchronous run and exposes its terminal result', async () => {
    await withServer(async (baseUrl) => {
      const createdResponse = await fetch(`${baseUrl}/v1/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobDescription:
            'We need a TypeScript Engineer to build reliable systems.',
          candidate: { resume: candidate },
        }),
      })
      const createdPayload = (await createdResponse.json()) as {
        data?: { id?: string; status?: string }
      }

      expect(createdResponse.status).toBe(202)
      expect(createdPayload.data?.id).toBeTypeOf('string')
      expect(createdPayload.data?.status).toBe('queued')

      const runId = createdPayload.data?.id
      let terminalPayload:
        | { data?: { status?: string; result?: { status?: string } } }
        | undefined
      for (let attempt = 0; attempt < 20 && runId; attempt += 1) {
        const runResponse = await fetch(`${baseUrl}/v1/runs/${runId}`)
        terminalPayload = (await runResponse.json()) as {
          data?: { status?: string; result?: { status?: string } }
        }
        if (terminalPayload.data?.status === 'completed') break
      }

      expect(terminalPayload?.data?.status).toBe('completed')
      expect(terminalPayload?.data?.result?.status).toBe('completed')
    })
  })

  it('accepts a structured answer and resumes a paused run', async () => {
    const tasks: Array<() => Promise<void>> = []
    let modelCalls = 0
    const llm: LlmClient = {
      async completeJson<T>() {
        modelCalls += 1
        const data =
          modelCalls === 1
            ? {
                resume: candidate,
                sourceArtifactIds: ['candidate-source'],
                questions: [
                  {
                    field: 'content.basics.name',
                    question: 'What is your full name?',
                    reason: 'The source did not contain a reliable name.',
                    severity: 'blocking',
                  },
                ],
                warnings: [],
              }
            : modelCalls === 2
              ? {
                  targetTitle: 'TypeScript Engineer',
                  seniority: 'junior',
                  summary: 'TypeScript engineer',
                  requirements: [],
                  keywords: [],
                }
              : {
                  resume: candidate,
                  selectedEvidenceIds: [],
                  questions: [],
                  notes: [],
                }
        return {
          data: data as T,
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
    const runService = new ResumeAgentRunService(agent, {
      idFactory: () => 'run-answer-api',
      schedule: (task) => tasks.push(task),
    })

    await withServer(
      async (baseUrl) => {
        await fetch(`${baseUrl}/v1/runs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jobDescription:
              'We need a TypeScript Engineer to build reliable systems.',
            candidate: {
              resume: candidate,
              files: [
                {
                  id: 'candidate-source',
                  filename: 'candidate.txt',
                  text: 'Candidate profile.',
                },
              ],
            },
          }),
        })
        await tasks[0]?.()

        const invalidResponse = await fetch(
          `${baseUrl}/v1/runs/run-answer-api/answers`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              interactionId: 'candidate-normalization:1',
              idempotencyKey: 'answer-api-empty',
              value: '   ',
            }),
          }
        )
        const invalidPayload = (await invalidResponse.json()) as {
          error?: { code?: string }
        }
        expect(invalidResponse.status).toBe(400)
        expect(invalidPayload.error?.code).toBe('invalid_answer')
        expect(tasks).toHaveLength(1)

        const response = await fetch(
          `${baseUrl}/v1/runs/run-answer-api/answers`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              interactionId: 'candidate-normalization:1',
              idempotencyKey: 'answer-api-1',
              value: 'Ada Lovelace',
            }),
          }
        )
        const payload = (await response.json()) as {
          data?: { status?: string; interactions?: unknown }
        }

        expect(response.status).toBe(202)
        expect(payload.data?.status).toBe('analyzing_jd')
        expect(payload.data?.interactions).toBeUndefined()
        expect(tasks).toHaveLength(2)
      },
      agent,
      runService
    )
  })

  it('returns stable validation and not-found errors for answers', async () => {
    await withServer(async (baseUrl) => {
      const invalidResponse = await fetch(
        `${baseUrl}/v1/runs/missing-run/answers`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }
      )
      const invalidPayload = (await invalidResponse.json()) as {
        error?: { code?: string }
      }
      expect(invalidResponse.status).toBe(400)
      expect(invalidPayload.error?.code).toBe('invalid_answer')

      const missingResponse = await fetch(
        `${baseUrl}/v1/runs/missing-run/answers`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            interactionId: 'candidate-normalization:1',
            idempotencyKey: 'missing-run-answer',
            value: 'Ada Lovelace',
          }),
        }
      )
      const missingPayload = (await missingResponse.json()) as {
        error?: { code?: string }
      }
      expect(missingResponse.status).toBe(404)
      expect(missingPayload.error?.code).toBe('run_not_found')
    })
  })

  it('returns a conflict when a run is not waiting for input', async () => {
    const tasks: Array<() => Promise<void>> = []
    const agent = fakeAgent()
    const runService = new ResumeAgentRunService(agent, {
      idFactory: () => 'run-not-waiting',
      schedule: (task) => tasks.push(task),
    })
    await runService.start({
      jobDescription:
        'We need a TypeScript Engineer to build reliable systems.',
      candidate: { resume: candidate },
    })

    await withServer(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/v1/runs/run-not-waiting/answers`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              interactionId: 'candidate-normalization:1',
              idempotencyKey: 'wrong-state-answer',
              value: 'Ada Lovelace',
            }),
          }
        )
        const payload = (await response.json()) as {
          error?: { code?: string }
        }

        expect(response.status).toBe(409)
        expect(payload.error?.code).toBe('run_not_waiting_for_input')
        expect(tasks).toHaveLength(1)
      },
      agent,
      runService
    )
  })

  it('returns a stable not-found error for an unknown run', async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/runs/run-that-does-not-exist`)
      const payload = (await response.json()) as {
        error?: { code?: string; message?: string }
      }

      expect(response.status).toBe(404)
      expect(payload.error).toEqual({
        code: 'run_not_found',
        message: 'Run not found',
      })
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
