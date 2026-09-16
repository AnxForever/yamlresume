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

import type { InteractionRequest, TailorResumeResult } from '@/lib/api/types'
import { RUN_STAGES } from '@/lib/run/events'
import {
  applyRunEvent,
  applyRunEvents,
  applyRunStop,
  initialWorkbenchState,
} from '@/lib/run/state'

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

function stageOf(
  state: ReturnType<typeof initialWorkbenchState>,
  stage: string
) {
  return state.stages.find((entry) => entry.stage === stage)
}

describe('initialWorkbenchState', () => {
  it('lists every stage as pending', () => {
    const state = initialWorkbenchState()

    expect(state.status).toBe('idle')
    expect(state.stages).toHaveLength(RUN_STAGES.length)
    expect(state.stages.every((stage) => stage.state === 'pending')).toBe(true)
    expect(state.telemetry).toEqual({
      modelCalls: 0,
      repairAttempts: 0,
      transportAttempts: 0,
    })
  })
})

describe('applyRunEvent', () => {
  it('records the run id and start time', () => {
    const state = applyRunEvent(initialWorkbenchState(), {
      type: 'RUN_STARTED',
      runId: 'run_1',
      at: '2026-09-16T00:00:00.000Z',
    })

    expect(state).toMatchObject({
      runId: 'run_1',
      startedAt: '2026-09-16T00:00:00.000Z',
      status: 'running',
    })
  })

  it('marks a stage running and keeps its first start time', () => {
    const started = applyRunEvent(initialWorkbenchState(), {
      type: 'STEP_STARTED',
      runId: 'run_1',
      stage: 'drafting',
      at: '2026-09-16T00:00:01.000Z',
    })
    const restarted = applyRunEvent(started, {
      type: 'STEP_STARTED',
      runId: 'run_1',
      stage: 'drafting',
      at: '2026-09-16T00:00:05.000Z',
    })

    expect(stageOf(restarted, 'drafting')).toMatchObject({
      state: 'running',
      startedAt: '2026-09-16T00:00:01.000Z',
    })
  })

  it('computes stage duration from observed timestamps', () => {
    const state = applyRunEvents(initialWorkbenchState(), [
      {
        type: 'STEP_STARTED',
        runId: 'run_1',
        stage: 'analyzing_jd',
        at: '2026-09-16T00:00:01.000Z',
      },
      {
        type: 'STEP_FINISHED',
        runId: 'run_1',
        stage: 'analyzing_jd',
        at: '2026-09-16T00:00:04.400Z',
      },
    ])

    expect(stageOf(state, 'analyzing_jd')).toMatchObject({
      state: 'done',
      durationMs: 3400,
    })
  })

  it('omits duration for a stage backfilled within one poll', () => {
    const state = applyRunEvents(initialWorkbenchState(), [
      {
        type: 'STEP_STARTED',
        runId: 'run_1',
        stage: 'validating',
        at: '2026-09-16T00:00:02.000Z',
      },
      {
        type: 'STEP_FINISHED',
        runId: 'run_1',
        stage: 'validating',
        at: '2026-09-16T00:00:02.000Z',
      },
    ])

    const stage = stageOf(state, 'validating')
    expect(stage?.state).toBe('done')
    expect(stage).not.toHaveProperty('durationMs')
  })

  it('omits duration when a stage finishes without a start', () => {
    const state = applyRunEvent(initialWorkbenchState(), {
      type: 'STEP_FINISHED',
      runId: 'run_1',
      stage: 'rendering',
      at: '2026-09-16T00:00:09.000Z',
    })

    expect(stageOf(state, 'rendering')).not.toHaveProperty('durationMs')
  })

  it('accumulates telemetry across stages', () => {
    const state = applyRunEvents(initialWorkbenchState(), [
      {
        type: 'STEP_FINISHED',
        runId: 'run_1',
        stage: 'normalizing_candidate',
        at: '2026-09-16T00:00:02.000Z',
        metadata: {
          modelCalls: 1,
          repairAttempts: 0,
          transportAttempts: 1,
          inputTokens: 900,
          outputTokens: 120,
        },
      },
      {
        type: 'STEP_FINISHED',
        runId: 'run_1',
        stage: 'analyzing_jd',
        at: '2026-09-16T00:00:05.000Z',
        metadata: {
          modelCalls: 2,
          repairAttempts: 1,
          transportAttempts: 3,
          inputTokens: 1500,
          reasoningTokens: 64,
        },
      },
    ])

    expect(state.telemetry).toEqual({
      modelCalls: 3,
      repairAttempts: 1,
      transportAttempts: 4,
      inputTokens: 2400,
      outputTokens: 120,
      reasoningTokens: 64,
    })
  })

  it('ignores non-numeric telemetry fields', () => {
    const state = applyRunEvent(initialWorkbenchState(), {
      type: 'STEP_FINISHED',
      runId: 'run_1',
      stage: 'drafting',
      at: '2026-09-16T00:00:06.000Z',
      metadata: { provider: 'openai', model: 'gpt-4o-mini', modelCalls: 1 },
    })

    expect(state.telemetry).toEqual({
      modelCalls: 1,
      repairAttempts: 0,
      transportAttempts: 0,
    })
  })

  it('keeps stage metadata for the stage card', () => {
    const state = applyRunEvent(initialWorkbenchState(), {
      type: 'STEP_FINISHED',
      runId: 'run_1',
      stage: 'rendering',
      at: '2026-09-16T00:00:09.000Z',
      metadata: { artifacts: 7 },
    })

    expect(stageOf(state, 'rendering')?.metadata).toEqual({ artifacts: 7 })
  })

  it('stores the result from a state snapshot', () => {
    const state = applyRunEvent(initialWorkbenchState(), {
      type: 'STATE_SNAPSHOT',
      runId: 'run_1',
      at: '2026-09-16T00:00:09.000Z',
      result,
    })

    expect(state.result).toBe(result)
  })

  it('treats a trace-only delta as a no-op', () => {
    const before = initialWorkbenchState()
    const after = applyRunEvent(before, {
      type: 'STATE_DELTA',
      runId: 'run_1',
      at: '2026-09-16T00:00:03.000Z',
      trace: [],
    })

    expect(after).toBe(before)
  })

  it('pauses for input and exposes the pending question', () => {
    const state = applyRunEvent(initialWorkbenchState(), {
      type: 'RUN_FINISHED',
      runId: 'run_1',
      at: '2026-09-16T00:00:03.000Z',
      outcome: {
        type: 'interrupt',
        interrupts: [
          { id: 'q1', reason: 'needs_input', request: interaction('q1') },
        ],
      },
    })

    expect(state.status).toBe('needs_input')
    expect(state.pendingInteractions).toEqual([interaction('q1')])
  })

  it('clears pending questions on success', () => {
    const paused = applyRunEvent(initialWorkbenchState(), {
      type: 'RUN_FINISHED',
      runId: 'run_1',
      at: '2026-09-16T00:00:03.000Z',
      outcome: {
        type: 'interrupt',
        interrupts: [
          { id: 'q1', reason: 'needs_input', request: interaction('q1') },
        ],
      },
    })
    const done = applyRunEvent(paused, {
      type: 'RUN_FINISHED',
      runId: 'run_1',
      at: '2026-09-16T00:00:09.000Z',
      outcome: { type: 'success' },
    })

    expect(done.status).toBe('completed')
    expect(done.pendingInteractions).toEqual([])
  })

  it('records a failure with its code and message', () => {
    const state = applyRunEvent(initialWorkbenchState(), {
      type: 'RUN_ERROR',
      runId: 'run_1',
      at: '2026-09-16T00:00:07.000Z',
      code: 'structured_output_validation_failed',
      message: '模型输出不符合契约',
    })

    expect(state).toMatchObject({
      status: 'failed',
      error: {
        code: 'structured_output_validation_failed',
        message: '模型输出不符合契约',
      },
    })
  })

  it('never mutates the previous state', () => {
    const before = initialWorkbenchState()
    const snapshot = structuredClone(before)

    applyRunEvent(before, {
      type: 'STEP_STARTED',
      runId: 'run_1',
      stage: 'drafting',
      at: '2026-09-16T00:00:01.000Z',
    })

    expect(before).toEqual(snapshot)
  })
})

describe('applyRunStop', () => {
  it('marks the run lost when the backend forgot it', () => {
    const state = applyRunStop(initialWorkbenchState(), {
      reason: 'run_lost',
      at: '2026-09-16T00:00:10.000Z',
    })

    expect(state.status).toBe('lost')
  })

  it('keeps the last known status when the backend is unreachable', () => {
    const running = applyRunEvent(initialWorkbenchState(), {
      type: 'RUN_STARTED',
      runId: 'run_1',
      at: '2026-09-16T00:00:00.000Z',
    })
    const state = applyRunStop(running, {
      reason: 'unreachable',
      at: '2026-09-16T00:00:10.000Z',
    })

    expect(state.status).toBe('running')
  })

  it('leaves a terminal run untouched', () => {
    const completed = applyRunEvent(initialWorkbenchState(), {
      type: 'RUN_FINISHED',
      runId: 'run_1',
      at: '2026-09-16T00:00:09.000Z',
      outcome: { type: 'success' },
    })

    expect(
      applyRunStop(completed, {
        reason: 'terminal',
        at: '2026-09-16T00:00:09.000Z',
      })
    ).toBe(completed)
  })
})
