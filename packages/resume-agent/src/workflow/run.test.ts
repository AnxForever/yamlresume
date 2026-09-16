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

import { describe, expect, it } from 'vitest'

import type { LlmClient } from '@/contracts'
import { ResumeTailoringAgent } from '@/workflow/agent'
import { InMemoryRunStore, ResumeAgentRunService } from '@/workflow/run'

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

describe('ResumeAgentRunService', () => {
  it('returns a queued run before executing it to completion', async () => {
    const tasks: Array<() => Promise<void>> = []
    const service = new ResumeAgentRunService(fakeAgent(), {
      store: new InMemoryRunStore(),
      idFactory: () => 'run-1',
      now: () => new Date('2026-09-16T12:00:00.000Z'),
      schedule: (task) => tasks.push(task),
    })

    const created = await service.start({
      jobDescription:
        'We need a TypeScript Engineer to build reliable systems.',
      candidate: { resume: candidate },
    })

    expect(created).toEqual({
      id: 'run-1',
      status: 'queued',
      createdAt: '2026-09-16T12:00:00.000Z',
      updatedAt: '2026-09-16T12:00:00.000Z',
    })
    expect(tasks).toHaveLength(1)

    await tasks[0]?.()

    const completed = await service.get('run-1')
    expect(completed?.status).toBe('completed')
    expect(completed?.result?.jobSpec.targetTitle).toBe('TypeScript Engineer')
  })

  it('stores a safe failure without leaking the underlying error', async () => {
    const tasks: Array<() => Promise<void>> = []
    const llm: LlmClient = {
      async completeJson() {
        throw new Error('Secret Company and private resume content')
      },
    }
    const service = new ResumeAgentRunService(new ResumeTailoringAgent(llm), {
      idFactory: () => 'run-failed',
      schedule: (task) => tasks.push(task),
    })

    await service.start({
      jobDescription:
        'Secret Company needs a TypeScript Engineer for private systems.',
      candidate: { resume: candidate },
    })
    await tasks[0]?.()

    const failed = await service.get('run-failed')
    expect(failed?.status).toBe('failed')
    expect(failed?.error).toEqual({
      code: 'agent_run_failed',
      message: 'The resume tailoring run failed.',
    })
    expect(JSON.stringify(failed)).not.toContain('Secret Company')
    expect(JSON.stringify(failed)).not.toContain('private resume content')
  })

  it('publishes the current stage while a run is still executing', async () => {
    const tasks: Array<() => Promise<void>> = []
    let resolveJobAnalysis: ((value: unknown) => void) | undefined
    const pendingJobAnalysis = new Promise<unknown>((resolve) => {
      resolveJobAnalysis = resolve
    })
    let modelCall = 0
    const llm: LlmClient = {
      async completeJson<T>() {
        modelCall += 1
        const data =
          modelCall === 1
            ? await pendingJobAnalysis
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
    const service = new ResumeAgentRunService(new ResumeTailoringAgent(llm), {
      idFactory: () => 'run-progress',
      schedule: (task) => tasks.push(task),
    })

    await service.start({
      jobDescription:
        'We need a TypeScript Engineer to build reliable systems.',
      candidate: { resume: candidate },
    })
    const execution = tasks[0]?.()
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect((await service.get('run-progress'))?.status).toBe('analyzing_jd')

    resolveJobAnalysis?.({
      targetTitle: 'TypeScript Engineer',
      seniority: 'junior',
      summary: 'TypeScript engineer',
      requirements: [],
      keywords: [],
    })
    await execution

    expect((await service.get('run-progress'))?.status).toBe('completed')
  })

  it('pauses with one focused interaction when normalization needs input', async () => {
    const tasks: Array<() => Promise<void>> = []
    let modelCalls = 0
    const llm: LlmClient = {
      async completeJson<T>() {
        modelCalls += 1
        return {
          data: {
            resume: candidate,
            sourceArtifactIds: ['candidate-source'],
            questions: [
              {
                field: 'content.basics.name',
                question: 'What is your full name?',
                reason: 'The source document did not contain a reliable name.',
                severity: 'blocking',
              },
              {
                field: 'content.basics.headline',
                question: 'What professional headline do you prefer?',
                reason: 'A headline helps position the resume.',
                severity: 'important',
              },
            ],
            warnings: [],
          } as T,
          metadata: {
            provider: 'fake',
            model: 'fake-model',
            durationMs: 1,
            attempt: 1,
          },
        }
      },
    }
    const service = new ResumeAgentRunService(new ResumeTailoringAgent(llm), {
      idFactory: () => 'run-needs-input',
      schedule: (task) => tasks.push(task),
    })

    await service.start({
      jobDescription:
        'We need a TypeScript Engineer to build reliable systems.',
      candidate: {
        resume: candidate,
        files: [
          {
            id: 'candidate-source',
            filename: 'candidate.txt',
            mediaType: 'text/plain',
            text: 'Candidate profile without a reliable name.',
          },
        ],
      },
    })
    await tasks[0]?.()

    const paused = await service.get('run-needs-input')
    expect(paused?.status).toBe('needs_input')
    expect(paused?.interactions).toEqual([
      expect.objectContaining({
        id: 'candidate-normalization:1',
        field: 'content.basics.name',
        control: expect.objectContaining({ type: 'text' }),
      }),
    ])
    expect(modelCalls).toBe(1)
    expect(JSON.stringify(paused)).not.toContain('Candidate profile without')

    const nextQuestion = await service.answer('run-needs-input', {
      interactionId: 'candidate-normalization:1',
      idempotencyKey: 'answer-first-question',
      value: 'Ada Lovelace',
    })
    expect(nextQuestion.status).toBe('needs_input')
    expect(nextQuestion.interactions?.[0]?.id).toBe('candidate-normalization:2')
    expect(tasks).toHaveLength(1)
    expect(modelCalls).toBe(1)
  })

  it('applies an answer and resumes without repeating completed stages', async () => {
    const tasks: Array<() => Promise<void>> = []
    const store = new InMemoryRunStore()
    const normalizedCandidate = {
      ...candidate,
      content: {
        ...candidate.content,
        basics: { ...candidate.content.basics, name: 'Unknown Candidate' },
      },
    }
    let modelCalls = 0
    const llm: LlmClient = {
      async completeJson<T>() {
        modelCalls += 1
        const data =
          modelCalls === 1
            ? {
                resume: normalizedCandidate,
                sourceArtifactIds: ['candidate-source'],
                questions: [
                  {
                    field: 'content.basics.name',
                    question: 'What is your full name?',
                    reason: 'The uploaded document contains no reliable name.',
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
                  resume: {
                    ...normalizedCandidate,
                    content: {
                      ...normalizedCandidate.content,
                      basics: {
                        ...normalizedCandidate.content.basics,
                        name: 'Grace Hopper',
                      },
                    },
                  },
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
    const service = new ResumeAgentRunService(new ResumeTailoringAgent(llm), {
      store,
      idFactory: () => 'run-resume',
      schedule: (task) => tasks.push(task),
    })

    await service.start({
      jobDescription:
        'We need a TypeScript Engineer to build reliable systems.',
      candidate: {
        files: [
          {
            id: 'candidate-source',
            filename: 'candidate.txt',
            mediaType: 'text/plain',
            text: 'Candidate profile without a reliable name.',
          },
        ],
      },
    })
    await tasks[0]?.()

    const resumed = await service.answer('run-resume', {
      interactionId: 'candidate-normalization:1',
      idempotencyKey: 'answer-name-1',
      value: 'Grace Hopper',
    })
    expect(resumed.status).toBe('analyzing_jd')
    expect(tasks).toHaveLength(2)
    const receipts = (await store.get('run-resume'))?.answerReceipts
    expect(receipts).toEqual([
      expect.objectContaining({
        interactionId: 'candidate-normalization:1',
        idempotencyKey: 'answer-name-1',
        valueFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    ])
    expect(JSON.stringify(receipts)).not.toContain('Grace Hopper')

    const duplicate = await service.answer('run-resume', {
      interactionId: 'candidate-normalization:1',
      idempotencyKey: 'answer-name-1',
      value: 'Grace Hopper',
    })
    expect(duplicate).toEqual(resumed)
    expect(tasks).toHaveLength(2)
    await expect(
      service.answer('run-resume', {
        interactionId: 'candidate-normalization:1',
        idempotencyKey: 'answer-name-1',
        value: 'Ada Lovelace',
      })
    ).rejects.toMatchObject({ code: 'idempotency_conflict' })

    await tasks[1]?.()

    const completed = await service.get('run-resume')
    expect(completed?.status).toBe('completed')
    expect(completed?.result?.resume.content.basics.name).toBe('Grace Hopper')
    expect(completed?.result?.questions).toEqual([])
    expect(
      completed?.result?.trace.filter(
        (event) =>
          event.status === 'started' &&
          ['ingest_inputs', 'normalize_candidate'].includes(event.name)
      )
    ).toHaveLength(2)
    expect(modelCalls).toBe(3)
  })

  it('rejects a stale interaction without changing the paused run', async () => {
    const tasks: Array<() => Promise<void>> = []
    const llm: LlmClient = {
      async completeJson<T>() {
        return {
          data: {
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
          } as T,
          metadata: {
            provider: 'fake',
            model: 'fake-model',
            durationMs: 1,
            attempt: 1,
          },
        }
      },
    }
    const service = new ResumeAgentRunService(new ResumeTailoringAgent(llm), {
      idFactory: () => 'run-stale',
      schedule: (task) => tasks.push(task),
    })

    await service.start({
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
    })
    await tasks[0]?.()

    await expect(
      service.answer('run-stale', {
        interactionId: 'candidate-normalization:previous',
        idempotencyKey: 'stale-answer-1',
        value: 'Grace Hopper',
      })
    ).rejects.toMatchObject({ code: 'stale_interaction' })
    expect((await service.get('run-stale'))?.status).toBe('needs_input')
    expect(tasks).toHaveLength(1)
  })

  it('keeps the run paused when a required answer is empty', async () => {
    const tasks: Array<() => Promise<void>> = []
    const llm: LlmClient = {
      async completeJson<T>() {
        return {
          data: {
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
          } as T,
          metadata: {
            provider: 'fake',
            model: 'fake-model',
            durationMs: 1,
            attempt: 1,
          },
        }
      },
    }
    const service = new ResumeAgentRunService(new ResumeTailoringAgent(llm), {
      idFactory: () => 'run-invalid-answer',
      schedule: (task) => tasks.push(task),
    })

    await service.start({
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
    })
    await tasks[0]?.()

    await expect(
      service.answer('run-invalid-answer', {
        interactionId: 'candidate-normalization:1',
        idempotencyKey: 'empty-answer-1',
        value: '   ',
      })
    ).rejects.toMatchObject({ code: 'invalid_answer' })

    const paused = await service.get('run-invalid-answer')
    expect(paused?.status).toBe('needs_input')
    expect(paused?.interactions?.[0]?.id).toBe('candidate-normalization:1')
    expect(tasks).toHaveLength(1)
  })

  it('removes every answered question when priority changes the answer order', async () => {
    const tasks: Array<() => Promise<void>> = []
    const answeredCandidate = {
      ...candidate,
      content: {
        ...candidate.content,
        basics: {
          ...candidate.content.basics,
          headline: 'Platform Engineer',
          summary: 'Built reliable systems.',
        },
      },
    }
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
                    field: 'content.basics.headline',
                    question: 'What headline do you prefer?',
                    reason: 'The headline is missing.',
                    severity: 'important',
                  },
                  {
                    field: 'content.basics.name',
                    question: 'What is your full name?',
                    reason: 'The source name must be confirmed.',
                    severity: 'blocking',
                  },
                  {
                    field: 'content.basics.summary',
                    question: 'How would you summarize your experience?',
                    reason: 'The summary is missing.',
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
                  resume: answeredCandidate,
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
    const service = new ResumeAgentRunService(new ResumeTailoringAgent(llm), {
      idFactory: () => 'run-priority-order',
      schedule: (task) => tasks.push(task),
    })

    await service.start({
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
    })
    await tasks[0]?.()

    expect(
      (await service.get('run-priority-order'))?.interactions?.[0]?.id
    ).toBe('candidate-normalization:2')
    await service.answer('run-priority-order', {
      interactionId: 'candidate-normalization:2',
      idempotencyKey: 'priority-answer-1',
      value: 'Ada Lovelace',
    })
    expect(
      (await service.get('run-priority-order'))?.interactions?.[0]?.id
    ).toBe('candidate-normalization:3')
    await service.answer('run-priority-order', {
      interactionId: 'candidate-normalization:3',
      idempotencyKey: 'priority-answer-2',
      value: 'Built reliable systems.',
    })
    expect(
      (await service.get('run-priority-order'))?.interactions?.[0]?.id
    ).toBe('candidate-normalization:1')
    await service.answer('run-priority-order', {
      interactionId: 'candidate-normalization:1',
      idempotencyKey: 'priority-answer-3',
      value: 'Platform Engineer',
    })
    await tasks[1]?.()

    const completed = await service.get('run-priority-order')
    expect(completed?.status).toBe('completed')
    expect(completed?.result?.questions).toEqual([])
  })

  it('does not pause for optional normalization questions', async () => {
    const tasks: Array<() => Promise<void>> = []
    const responses = [
      {
        resume: candidate,
        sourceArtifactIds: ['candidate-source'],
        questions: [
          {
            field: 'content.basics.summary',
            question: 'Would you like to add a professional summary?',
            reason: 'A summary is helpful but not required.',
            severity: 'optional',
          },
        ],
        warnings: [],
      },
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
      async completeJson<T>() {
        return {
          data: responses.shift() as T,
          metadata: {
            provider: 'fake',
            model: 'fake-model',
            durationMs: 1,
            attempt: 1,
          },
        }
      },
    }
    const service = new ResumeAgentRunService(new ResumeTailoringAgent(llm), {
      idFactory: () => 'run-optional',
      schedule: (task) => tasks.push(task),
    })

    await service.start({
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
    })
    await tasks[0]?.()

    const completed = await service.get('run-optional')
    expect(completed?.status).toBe('completed')
    expect(completed?.result?.questions).toEqual([
      expect.objectContaining({ severity: 'optional' }),
    ])
  })
})

describe('ResumeTailoringAgent progress', () => {
  it('reports each externally observable workflow stage in order', async () => {
    const statuses: string[] = []

    await fakeAgent().run(
      {
        jobDescription:
          'We need a TypeScript Engineer to build reliable systems.',
        candidate: { resume: candidate },
      },
      {
        onStatus: (status) => {
          statuses.push(status)
        },
      }
    )

    expect(statuses).toEqual([
      'ingesting_inputs',
      'normalizing_candidate',
      'analyzing_jd',
      'matching_evidence',
      'drafting',
      'validating',
      'rendering',
    ])
  })
})
