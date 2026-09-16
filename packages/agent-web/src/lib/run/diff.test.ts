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

import type {
  AgentRunStatus,
  InteractionRequest,
  ResumeAgentRun,
  TailorResumeResult,
} from '@/lib/api/types'
import { diffRunSnapshots } from '@/lib/run/diff'

function run(
  status: AgentRunStatus,
  overrides: Partial<ResumeAgentRun> = {}
): ResumeAgentRun {
  return {
    id: 'run_1',
    status,
    createdAt: '2026-09-16T00:00:00.000Z',
    updatedAt: '2026-09-16T00:00:01.000Z',
    ...overrides,
  }
}

function interaction(id: string): InteractionRequest {
  return {
    id,
    field: 'content.basics.name',
    prompt: '你的姓名是什么？',
    reason: '简历缺少姓名',
    required: true,
    severity: 'blocking',
    privacy: 'personal',
    control: { type: 'text', minLength: 1, maxLength: 500 },
  }
}

const result = {
  status: 'completed',
  trace: [],
} as unknown as TailorResumeResult

describe('diffRunSnapshots', () => {
  it('emits RUN_STARTED only on the first observation', () => {
    const first = diffRunSnapshots(undefined, run('queued'))
    expect(first).toEqual([
      {
        type: 'RUN_STARTED',
        runId: 'run_1',
        at: '2026-09-16T00:00:00.000Z',
      },
    ])

    const second = diffRunSnapshots(run('queued'), run('queued'))
    expect(second).toEqual([])
  })

  it('opens the first stage when a queued run starts working', () => {
    const events = diffRunSnapshots(run('queued'), run('ingesting_inputs'))

    expect(events).toEqual([
      {
        type: 'STEP_STARTED',
        runId: 'run_1',
        stage: 'ingesting_inputs',
        at: '2026-09-16T00:00:01.000Z',
      },
    ])
  })

  it('closes the previous stage and opens the next one', () => {
    const events = diffRunSnapshots(
      run('ingesting_inputs'),
      run('normalizing_candidate')
    )

    expect(
      events.map((event) => [event.type, 'stage' in event && event.stage])
    ).toEqual([
      ['STEP_STARTED', 'ingesting_inputs'],
      ['STEP_FINISHED', 'ingesting_inputs'],
      ['STEP_STARTED', 'normalizing_candidate'],
    ])
  })

  it('backfills stages skipped between two polls', () => {
    const events = diffRunSnapshots(run('ingesting_inputs'), run('drafting'))

    expect(
      events.map((event) => [event.type, 'stage' in event && event.stage])
    ).toEqual([
      ['STEP_STARTED', 'ingesting_inputs'],
      ['STEP_FINISHED', 'ingesting_inputs'],
      ['STEP_STARTED', 'normalizing_candidate'],
      ['STEP_FINISHED', 'normalizing_candidate'],
      ['STEP_STARTED', 'analyzing_jd'],
      ['STEP_FINISHED', 'analyzing_jd'],
      ['STEP_STARTED', 'matching_evidence'],
      ['STEP_FINISHED', 'matching_evidence'],
      ['STEP_STARTED', 'drafting'],
    ])
  })

  it('attaches trace metadata to the matching finished stage', () => {
    const events = diffRunSnapshots(
      run('analyzing_jd'),
      run('matching_evidence'),
      {
        trace: [
          {
            name: 'analyze_job',
            status: 'completed',
            at: '2026-09-16T00:00:00.500Z',
            metadata: { modelCalls: 2, repairAttempts: 1 },
          },
        ],
      }
    )

    const finished = events.find((event) => event.type === 'STEP_FINISHED')
    expect(finished).toMatchObject({
      stage: 'analyzing_jd',
      metadata: { modelCalls: 2, repairAttempts: 1 },
    })
  })

  it('ignores trace entries that are not completed', () => {
    const events = diffRunSnapshots(
      run('analyzing_jd'),
      run('matching_evidence'),
      {
        trace: [
          {
            name: 'analyze_job',
            status: 'started',
            at: '2026-09-16T00:00:00.200Z',
            metadata: { modelCalls: 99 },
          },
        ],
      }
    )

    const finished = events.find((event) => event.type === 'STEP_FINISHED')
    expect(finished).not.toHaveProperty('metadata')
  })

  it('maps the rendering stage to both of its trace names', () => {
    const events = diffRunSnapshots(run('rendering'), run('completed'), {
      trace: [
        {
          name: 'render_resume',
          status: 'completed',
          at: '2026-09-16T00:00:00.900Z',
          metadata: { artifacts: 7 },
        },
      ],
      // biome-ignore lint/suspicious/noExplicitAny: narrow fixture
    } as any)

    const finished = events.find(
      (event) => event.type === 'STEP_FINISHED' && event.stage === 'rendering'
    )
    expect(finished).toMatchObject({ metadata: { artifacts: 7 } })
  })

  it('emits an interrupt when a run pauses for input', () => {
    const events = diffRunSnapshots(
      run('normalizing_candidate'),
      run('needs_input', { interactions: [interaction('q1')] })
    )

    const finished = events.find((event) => event.type === 'RUN_FINISHED')
    expect(finished).toMatchObject({
      outcome: {
        type: 'interrupt',
        interrupts: [{ id: 'q1', reason: 'needs_input' }],
      },
    })
  })

  it('does not re-emit an interrupt while the same question is pending', () => {
    const paused = run('needs_input', { interactions: [interaction('q1')] })
    const events = diffRunSnapshots(paused, paused)

    expect(events).toEqual([])
  })

  it('emits a fresh interrupt when the next question arrives', () => {
    const events = diffRunSnapshots(
      run('needs_input', { interactions: [interaction('q1')] }),
      run('needs_input', { interactions: [interaction('q2')] })
    )

    const finished = events.find((event) => event.type === 'RUN_FINISHED')
    expect(finished).toMatchObject({
      outcome: { interrupts: [{ id: 'q2' }] },
    })
  })

  it('resumes stage progress after answering', () => {
    const events = diffRunSnapshots(
      run('needs_input', { interactions: [interaction('q1')] }),
      run('analyzing_jd')
    )

    expect(
      events.map((event) => [event.type, 'stage' in event && event.stage])
    ).toEqual([
      ['STEP_STARTED', 'ingesting_inputs'],
      ['STEP_FINISHED', 'ingesting_inputs'],
      ['STEP_STARTED', 'normalizing_candidate'],
      ['STEP_FINISHED', 'normalizing_candidate'],
      ['STEP_STARTED', 'analyzing_jd'],
    ])
  })

  it('finishes every remaining stage on completion', () => {
    const events = diffRunSnapshots(
      run('rendering'),
      run('completed', { result })
    )

    expect(events.map((event) => event.type)).toEqual([
      'STEP_STARTED',
      'STEP_FINISHED',
      'STATE_SNAPSHOT',
      'RUN_FINISHED',
    ])
    expect(events.at(-1)).toMatchObject({ outcome: { type: 'success' } })
  })

  it('omits STATE_SNAPSHOT when a completed run carries no result', () => {
    const events = diffRunSnapshots(run('rendering'), run('completed'))

    expect(events.map((event) => event.type)).toEqual([
      'STEP_STARTED',
      'STEP_FINISHED',
    ])
  })

  it('reports a failure with its backend error code', () => {
    const events = diffRunSnapshots(
      run('drafting'),
      run('failed', {
        error: { code: 'llm_request_failed', message: '模型请求失败' },
      })
    )

    expect(events).toEqual([
      {
        type: 'RUN_ERROR',
        runId: 'run_1',
        at: '2026-09-16T00:00:01.000Z',
        code: 'llm_request_failed',
        message: '模型请求失败',
      },
    ])
  })

  it('falls back to a stable code when a failure carries no error', () => {
    const events = diffRunSnapshots(run('drafting'), run('failed'))

    expect(events[0]).toMatchObject({
      type: 'RUN_ERROR',
      code: 'agent_failed',
    })
  })

  it('derives nothing further once the previous snapshot is terminal', () => {
    expect(
      diffRunSnapshots(
        run('completed', { result }),
        run('completed', { result })
      )
    ).toEqual([])
    expect(diffRunSnapshots(run('failed'), run('failed'))).toEqual([])
  })

  it('is pure: replaying the same pair yields the same events', () => {
    const previous = run('analyzing_jd')
    const next = run('drafting')

    expect(diffRunSnapshots(previous, next)).toEqual(
      diffRunSnapshots(previous, next)
    )
  })
})
