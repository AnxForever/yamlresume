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

import type { AgentTraceEvent, ResumeAgentRun } from '@/lib/api/types'
import {
  isRunStage,
  RUN_STAGES,
  type RunEvent,
  type RunInterrupt,
  STAGE_TRACE_NAMES,
  stageIndex,
} from '@/lib/run/events'

/**
 * How far a snapshot has progressed, expressed as a count of stages that are
 * done or in flight.
 *
 * `completed` counts every stage; `failed` yields 0 because a failure snapshot
 * says nothing new about stage boundaries — the last observed stage already
 * did.
 */
function reachedStageCount(status: ResumeAgentRun['status']): number {
  if (status === 'completed') {
    return RUN_STAGES.length
  }
  if (isRunStage(status)) {
    return stageIndex(status)
  }
  return 0
}

function traceMetadataFor(
  trace: AgentTraceEvent[] | undefined,
  names: readonly string[]
): AgentTraceEvent['metadata'] | undefined {
  if (!trace) {
    return undefined
  }
  for (let index = trace.length - 1; index >= 0; index -= 1) {
    const event = trace[index]
    if (
      event &&
      event.status === 'completed' &&
      names.includes(event.name) &&
      event.metadata
    ) {
      return event.metadata
    }
  }
  return undefined
}

function interruptsOf(run: ResumeAgentRun): RunInterrupt[] {
  return (run.interactions ?? []).map((request) => ({
    id: request.id,
    reason: 'needs_input' as const,
    request,
  }))
}

function interactionIds(run: ResumeAgentRun | undefined): string[] {
  return (run?.interactions ?? []).map((request) => request.id)
}

function sameInteractions(
  previous: ResumeAgentRun | undefined,
  next: ResumeAgentRun
): boolean {
  const before = interactionIds(previous)
  const after = interactionIds(next)
  if (before.length !== after.length) {
    return false
  }
  return after.every((id, index) => before[index] === id)
}

export interface DiffRunSnapshotsOptions {
  /**
   * Trace events observed for this run. The public run snapshot does not carry
   * a trace while the run is in flight, so the caller supplies whatever it has
   * — typically `run.result.trace` once the run completes.
   */
  trace?: AgentTraceEvent[]
}

/**
 * Derive AG-UI-shaped events from two consecutive REST snapshots.
 *
 * This is the only place in the frontend that infers state. It is a pure
 * function: no timers, no fetch, no clock. `at` always comes from the
 * snapshot's own `updatedAt`, so replaying the same pair of snapshots always
 * produces the same events.
 *
 * Stages that were skipped between two polls are backfilled: a poll interval
 * longer than a stage means the frontend never observes that stage as current,
 * but the timeline must still show it started and finished.
 */
export function diffRunSnapshots(
  previous: ResumeAgentRun | undefined,
  next: ResumeAgentRun,
  options: DiffRunSnapshotsOptions = {}
): RunEvent[] {
  const events: RunEvent[] = []
  const at = next.updatedAt
  const runId = next.id

  if (!previous) {
    events.push({ type: 'RUN_STARTED', runId, at: next.createdAt })
  }

  // A terminal snapshot never re-enters a running state, so once the previous
  // snapshot is terminal there is nothing left to derive.
  if (
    previous &&
    (previous.status === 'completed' || previous.status === 'failed')
  ) {
    return events
  }

  const previousReached = previous ? reachedStageCount(previous.status) : 0
  const nextReached = reachedStageCount(next.status)

  for (let index = previousReached; index < nextReached; index += 1) {
    const stage = RUN_STAGES[index]
    if (!stage) {
      continue
    }
    events.push({ type: 'STEP_STARTED', runId, stage, at })
    const metadata = traceMetadataFor(options.trace, STAGE_TRACE_NAMES[stage])
    events.push({
      type: 'STEP_FINISHED',
      runId,
      stage,
      at,
      ...(metadata ? { metadata } : {}),
    })
  }

  if (isRunStage(next.status) && next.status !== previous?.status) {
    events.push({ type: 'STEP_STARTED', runId, stage: next.status, at })
  }

  if (next.status === 'needs_input' && !sameInteractions(previous, next)) {
    events.push({
      type: 'RUN_FINISHED',
      runId,
      at,
      outcome: { type: 'interrupt', interrupts: interruptsOf(next) },
    })
  }

  if (next.status === 'completed' && next.result) {
    events.push({ type: 'STATE_SNAPSHOT', runId, at, result: next.result })
    events.push({
      type: 'RUN_FINISHED',
      runId,
      at,
      outcome: { type: 'success' },
    })
  }

  if (next.status === 'failed') {
    events.push({
      type: 'RUN_ERROR',
      runId,
      at,
      code: next.error?.code ?? 'agent_failed',
      message: next.error?.message ?? 'Run failed without a reported reason',
    })
  }

  return events
}
