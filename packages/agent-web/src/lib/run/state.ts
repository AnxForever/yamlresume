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

import type {
  InteractionRequest,
  TailorResumeResult,
  TraceMetadataValue,
} from '@/lib/api/types'
import {
  RUN_STAGES,
  type RunEvent,
  type RunStage,
  type RunStreamStop,
} from '@/lib/run/events'

export type StageState = 'pending' | 'running' | 'done'

export interface StageProgress {
  stage: RunStage
  state: StageState
  startedAt?: string
  finishedAt?: string
  /**
   * Wall-clock stage duration, derived from the observed start/finish
   * timestamps. Absent when the stage was backfilled across a single poll —
   * the frontend genuinely does not know how long it took, and showing `0ms`
   * would be a lie.
   */
  durationMs?: number
  metadata?: Record<string, TraceMetadataValue>
}

/**
 * Aggregated from `STEP_FINISHED` metadata, which the backend builds from
 * `StructuredOutputTelemetry`. Safe by construction: it carries counts and
 * token totals only, never prompts or candidate text.
 */
export interface RunTelemetry {
  modelCalls: number
  repairAttempts: number
  transportAttempts: number
  inputTokens?: number
  outputTokens?: number
  reasoningTokens?: number
}

export type WorkbenchStatus =
  | 'idle'
  | 'running'
  | 'needs_input'
  | 'completed'
  | 'failed'
  | 'lost'

export interface WorkbenchState {
  runId?: string
  startedAt?: string
  status: WorkbenchStatus
  stages: StageProgress[]
  pendingInteractions: InteractionRequest[]
  result?: TailorResumeResult
  error?: { code: string; message: string }
  telemetry: RunTelemetry
}

export function initialWorkbenchState(): WorkbenchState {
  return {
    status: 'idle',
    stages: RUN_STAGES.map((stage) => ({ stage, state: 'pending' })),
    pendingInteractions: [],
    telemetry: {
      modelCalls: 0,
      repairAttempts: 0,
      transportAttempts: 0,
    },
  }
}

function numberOf(value: TraceMetadataValue | undefined): number {
  return typeof value === 'number' ? value : 0
}

function addOptional(
  current: number | undefined,
  next: TraceMetadataValue | undefined
): number | undefined {
  if (typeof next !== 'number') {
    return current
  }
  return (current ?? 0) + next
}

function accumulate(
  telemetry: RunTelemetry,
  metadata: Record<string, TraceMetadataValue> | undefined
): RunTelemetry {
  if (!metadata) {
    return telemetry
  }
  const inputTokens = addOptional(telemetry.inputTokens, metadata.inputTokens)
  const outputTokens = addOptional(
    telemetry.outputTokens,
    metadata.outputTokens
  )
  const reasoningTokens = addOptional(
    telemetry.reasoningTokens,
    metadata.reasoningTokens
  )
  return {
    modelCalls: telemetry.modelCalls + numberOf(metadata.modelCalls),
    repairAttempts:
      telemetry.repairAttempts + numberOf(metadata.repairAttempts),
    transportAttempts:
      telemetry.transportAttempts + numberOf(metadata.transportAttempts),
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
  }
}

function durationBetween(
  startedAt: string | undefined,
  finishedAt: string
): number | undefined {
  if (!startedAt) {
    return undefined
  }
  const elapsed = Date.parse(finishedAt) - Date.parse(startedAt)
  if (!Number.isFinite(elapsed) || elapsed <= 0) {
    return undefined
  }
  return elapsed
}

function updateStage(
  stages: StageProgress[],
  stage: RunStage,
  update: (current: StageProgress) => StageProgress
): StageProgress[] {
  return stages.map((entry) => (entry.stage === stage ? update(entry) : entry))
}

/**
 * Fold one run event into the workbench view model.
 *
 * Pure and immutable: every branch returns a new object, so React can compare
 * by reference and the same event sequence always produces the same view. The
 * reducer holds no domain judgement — it only projects what the backend
 * already decided.
 */
export function applyRunEvent(
  state: WorkbenchState,
  event: RunEvent
): WorkbenchState {
  switch (event.type) {
    case 'RUN_STARTED':
      return {
        ...state,
        runId: event.runId,
        startedAt: event.at,
        status: 'running',
      }

    case 'STEP_STARTED':
      return {
        ...state,
        status: state.status === 'idle' ? 'running' : state.status,
        stages: updateStage(state.stages, event.stage, (current) => ({
          ...current,
          state: 'running',
          startedAt: current.startedAt ?? event.at,
        })),
      }

    case 'STEP_FINISHED': {
      const stages = updateStage(state.stages, event.stage, (current) => {
        const durationMs = durationBetween(current.startedAt, event.at)
        return {
          ...current,
          state: 'done',
          finishedAt: event.at,
          ...(durationMs === undefined ? {} : { durationMs }),
          ...(event.metadata ? { metadata: event.metadata } : {}),
        }
      })
      return {
        ...state,
        stages,
        telemetry: accumulate(state.telemetry, event.metadata),
      }
    }

    case 'STATE_SNAPSHOT':
      return { ...state, result: event.result }

    case 'STATE_DELTA':
      // Trace-only deltas carry no view state of their own; stage cards read
      // their metadata from STEP_FINISHED instead.
      return state

    case 'RUN_FINISHED':
      if (event.outcome.type === 'interrupt') {
        return {
          ...state,
          status: 'needs_input',
          pendingInteractions: event.outcome.interrupts.map(
            (interrupt) => interrupt.request
          ),
        }
      }
      return { ...state, status: 'completed', pendingInteractions: [] }

    case 'RUN_ERROR':
      return {
        ...state,
        status: 'failed',
        error: { code: event.code, message: event.message },
      }

    default:
      return state
  }
}

export function applyRunEvents(
  state: WorkbenchState,
  events: RunEvent[]
): WorkbenchState {
  return events.reduce(applyRunEvent, state)
}

/**
 * Project a stream stop onto the view model.
 *
 * `run_lost` is the honest rendering of the in-memory `RunStore`: the backend
 * restarted and the run is gone. `unreachable` keeps whatever the run last
 * showed, because the run may well still be executing — the frontend simply
 * cannot see it.
 */
export function applyRunStop(
  state: WorkbenchState,
  stop: RunStreamStop
): WorkbenchState {
  if (stop.reason === 'run_lost') {
    return { ...state, status: 'lost', pendingInteractions: [] }
  }
  return state
}
