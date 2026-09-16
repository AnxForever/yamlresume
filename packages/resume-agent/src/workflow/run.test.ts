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
