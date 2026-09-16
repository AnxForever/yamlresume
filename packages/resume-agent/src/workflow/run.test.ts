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
import {
  InMemoryRunStore,
  ResumeAgentRunService,
  type StoredResumeAgentRun,
} from '@/workflow/run'

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

function questionAgent(): ResumeTailoringAgent {
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
              reason: 'The source name must be confirmed.',
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
  return new ResumeTailoringAgent(llm)
}

class ContendedRunStore extends InMemoryRunStore {
  successfulCompareAndSets = 0
  private blockedReads = 0
  private barrier: Promise<void> = Promise.resolve()
  private releaseBarrier: (() => void) | undefined

  blockNextGets(count: number): void {
    this.blockedReads = count
    this.barrier = new Promise<void>((resolve) => {
      this.releaseBarrier = resolve
    })
  }

  resetSuccessfulCompareAndSets(): void {
    this.successfulCompareAndSets = 0
  }

  override async get(id: string): Promise<StoredResumeAgentRun | undefined> {
    const run = await super.get(id)
    if (this.blockedReads > 0) {
      this.blockedReads -= 1
      if (this.blockedReads === 0) this.releaseBarrier?.()
      await this.barrier
    }
    return run
  }

  override async compareAndSet(run: StoredResumeAgentRun): Promise<boolean> {
    const updated = await super.compareAndSet(run)
    if (updated) this.successfulCompareAndSets += 1
    return updated
  }
}

function storedRun(id: string): StoredResumeAgentRun {
  return {
    revision: 0,
    snapshot: {
      id,
      status: 'queued',
      createdAt: '2026-09-16T12:00:00.000Z',
      updatedAt: '2026-09-16T12:00:00.000Z',
    },
  }
}

describe('InMemoryRunStore', () => {
  it('creates a run only when its ID does not exist', async () => {
    const store = new InMemoryRunStore()
    const first = storedRun('run-create')

    expect(await store.create(first)).toBe(true)
    expect(
      await store.create({
        ...first,
        snapshot: { ...first.snapshot, status: 'failed' },
      })
    ).toBe(false)
    expect(await store.get('run-create')).toEqual(first)

    const invalidInitialRevision = {
      ...storedRun('run-invalid-initial-revision'),
      revision: 1,
    }
    expect(await store.create(invalidInitialRevision)).toBe(false)
    expect(await store.get('run-invalid-initial-revision')).toBeUndefined()
  })

  it('atomically updates a matching revision and increments it', async () => {
    const store = new InMemoryRunStore()
    const first = storedRun('run-cas-match')
    await store.create(first)

    expect(
      await store.compareAndSet({
        ...first,
        snapshot: { ...first.snapshot, status: 'ingesting_inputs' },
      })
    ).toBe(true)
    expect(await store.get('run-cas-match')).toEqual({
      ...first,
      revision: 1,
      snapshot: { ...first.snapshot, status: 'ingesting_inputs' },
    })
  })

  it('rejects a stale revision without changing the stored run', async () => {
    const store = new InMemoryRunStore()
    const stale = storedRun('run-cas-stale')
    await store.create(stale)
    await store.compareAndSet({
      ...stale,
      snapshot: { ...stale.snapshot, status: 'ingesting_inputs' },
    })
    const winner = await store.get('run-cas-stale')

    expect(
      await store.compareAndSet({
        ...stale,
        snapshot: { ...stale.snapshot, status: 'failed' },
      })
    ).toBe(false)
    expect(await store.get('run-cas-stale')).toEqual(winner)
  })

  it('isolates create, compare-and-set, and get values by cloning', async () => {
    const store = new InMemoryRunStore()
    const created = storedRun('run-clone')
    await store.create(created)
    created.snapshot.status = 'failed'

    const firstRead = await store.get('run-clone')
    expect(firstRead?.snapshot.status).toBe('queued')
    if (!firstRead) throw new Error('Expected stored run')
    firstRead.snapshot.status = 'failed'
    expect((await store.get('run-clone'))?.snapshot.status).toBe('queued')

    const update = await store.get('run-clone')
    if (!update) throw new Error('Expected stored run')
    update.snapshot.status = 'ingesting_inputs'
    await store.compareAndSet(update)
    update.snapshot.status = 'failed'

    expect(await store.get('run-clone')).toEqual({
      ...storedRun('run-clone'),
      revision: 1,
      snapshot: {
        ...storedRun('run-clone').snapshot,
        status: 'ingesting_inputs',
      },
    })
  })
})

describe('ResumeAgentRunService', () => {
  it('keeps the revision and trusted workflow data out of public runs', async () => {
    const tasks: Array<() => Promise<void>> = []
    const store = new InMemoryRunStore()
    const service = new ResumeAgentRunService(fakeAgent(), {
      store,
      idFactory: () => 'run-private-state',
      schedule: (task) => tasks.push(task),
    })

    await service.start({
      jobDescription: 'Private job description',
      candidate: { resume: candidate },
    })

    const stored = await store.get('run-private-state')
    expect(stored?.revision).toBe(0)
    expect(stored?.request?.jobDescription).toBe('Private job description')
    expect(await service.get('run-private-state')).toEqual(stored?.snapshot)
    expect(await service.get('run-private-state')).not.toHaveProperty(
      'revision'
    )
    expect(await service.get('run-private-state')).not.toHaveProperty('request')
    expect(await service.get('run-private-state')).not.toHaveProperty(
      'checkpoint'
    )
    expect(await service.get('run-private-state')).not.toHaveProperty(
      'answerReceipts'
    )
  })

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

  it('preserves a stable input failure on an asynchronous run', async () => {
    const tasks: Array<() => Promise<void>> = []
    const privateMarker = 'PRIVATE_ASYNC_CANDIDATE_61932'
    const service = new ResumeAgentRunService(fakeAgent(), {
      idFactory: () => 'run-invalid-file',
      schedule: (task) => tasks.push(task),
    })

    await service.start({
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
    })
    await tasks[0]?.()

    const failed = await service.get('run-invalid-file')
    expect(failed?.status).toBe('failed')
    expect(failed?.error).toEqual({
      code: 'file_type_mismatch',
      message: 'File type does not match its content.',
    })
    expect(JSON.stringify(failed)).not.toContain(privateMarker)
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

  it('accepts two concurrent identical answers only once', async () => {
    const tasks: Array<() => Promise<void>> = []
    const store = new ContendedRunStore()
    const service = new ResumeAgentRunService(questionAgent(), {
      store,
      idFactory: () => 'run-concurrent-replay',
      schedule: (task) => tasks.push(task),
    })
    await service.start({
      jobDescription: 'We need a TypeScript Engineer.',
      candidate: {
        resume: candidate,
        files: [
          {
            id: 'candidate-source',
            filename: 'candidate.txt',
            text: 'Candidate profile whose name must be confirmed.',
          },
        ],
      },
    })
    await tasks[0]?.()
    store.resetSuccessfulCompareAndSets()
    store.blockNextGets(2)
    const answer = {
      interactionId: 'candidate-normalization:1',
      idempotencyKey: 'concurrent-answer-1',
      value: 'Grace Hopper',
    }

    const [first, replay] = await Promise.all([
      service.answer('run-concurrent-replay', answer),
      service.answer('run-concurrent-replay', answer),
    ])

    expect(replay).toEqual(first)
    expect(first.status).toBe('analyzing_jd')
    expect(store.successfulCompareAndSets).toBe(1)
    expect(tasks).toHaveLength(2)
    expect(
      (await store.get('run-concurrent-replay'))?.answerReceipts
    ).toHaveLength(1)
  })

  it('rejects concurrent different answers that reuse an idempotency key', async () => {
    const tasks: Array<() => Promise<void>> = []
    const store = new ContendedRunStore()
    const service = new ResumeAgentRunService(questionAgent(), {
      store,
      idFactory: () => 'run-concurrent-idempotency-conflict',
      schedule: (task) => tasks.push(task),
    })
    await service.start({
      jobDescription: 'We need a TypeScript Engineer.',
      candidate: {
        resume: candidate,
        files: [
          {
            id: 'candidate-source',
            filename: 'candidate.txt',
            text: 'Candidate profile whose name must be confirmed.',
          },
        ],
      },
    })
    await tasks[0]?.()
    store.resetSuccessfulCompareAndSets()
    store.blockNextGets(2)

    const outcomes = await Promise.allSettled([
      service.answer('run-concurrent-idempotency-conflict', {
        interactionId: 'candidate-normalization:1',
        idempotencyKey: 'reused-answer-key',
        value: 'Grace Hopper',
      }),
      service.answer('run-concurrent-idempotency-conflict', {
        interactionId: 'candidate-normalization:1',
        idempotencyKey: 'reused-answer-key',
        value: 'Ada Byron',
      }),
    ])

    expect(
      outcomes.filter(({ status }) => status === 'fulfilled')
    ).toHaveLength(1)
    expect(outcomes.filter(({ status }) => status === 'rejected')).toEqual([
      expect.objectContaining({
        reason: expect.objectContaining({ code: 'idempotency_conflict' }),
      }),
    ])
    expect(store.successfulCompareAndSets).toBe(1)
    expect(tasks).toHaveLength(2)
    const stored = await store.get('run-concurrent-idempotency-conflict')
    expect(stored?.snapshot.status).toBe('analyzing_jd')
    expect(stored?.checkpoint?.candidate.content.basics.name).toMatch(
      /^(Grace Hopper|Ada Byron)$/
    )
    expect(stored?.answerReceipts).toHaveLength(1)
    expect(stored?.request?.jobDescription).toBe(
      'We need a TypeScript Engineer.'
    )
    expect(stored?.revision).toBeGreaterThan(0)
    const publicRun = await service.get('run-concurrent-idempotency-conflict')
    expect(publicRun).toEqual(stored?.snapshot)
    expect(publicRun).not.toHaveProperty('revision')
    expect(publicRun).not.toHaveProperty('request')
    expect(publicRun).not.toHaveProperty('checkpoint')
    expect(publicRun).not.toHaveProperty('answerReceipts')
  })

  it('accepts only one of two different concurrent answer commands', async () => {
    const tasks: Array<() => Promise<void>> = []
    const store = new ContendedRunStore()
    const service = new ResumeAgentRunService(questionAgent(), {
      store,
      idFactory: () => 'run-concurrent-answer-conflict',
      schedule: (task) => tasks.push(task),
    })
    await service.start({
      jobDescription: 'We need a TypeScript Engineer.',
      candidate: {
        resume: candidate,
        files: [
          {
            id: 'candidate-source',
            filename: 'candidate.txt',
            text: 'Candidate profile whose name must be confirmed.',
          },
        ],
      },
    })
    await tasks[0]?.()
    store.resetSuccessfulCompareAndSets()
    store.blockNextGets(2)

    const outcomes = await Promise.allSettled([
      service.answer('run-concurrent-answer-conflict', {
        interactionId: 'candidate-normalization:1',
        idempotencyKey: 'answer-command-a',
        value: 'Grace Hopper',
      }),
      service.answer('run-concurrent-answer-conflict', {
        interactionId: 'candidate-normalization:1',
        idempotencyKey: 'answer-command-b',
        value: 'Ada Byron',
      }),
    ])

    expect(
      outcomes.filter(({ status }) => status === 'fulfilled')
    ).toHaveLength(1)
    expect(outcomes.filter(({ status }) => status === 'rejected')).toEqual([
      expect.objectContaining({
        reason: expect.objectContaining({ code: 'answer_conflict' }),
      }),
    ])
    expect(store.successfulCompareAndSets).toBe(1)
    expect(tasks).toHaveLength(2)
    expect(
      (await store.get('run-concurrent-answer-conflict'))?.answerReceipts
    ).toHaveLength(1)
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
