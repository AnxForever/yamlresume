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

/**
 * Frontend run-event model, shaped after the AG-UI protocol.
 *
 * Only the *inbound* direction borrows AG-UI: the event names and the
 * `RUN_FINISHED` interrupt outcome. Answers are submitted with the backend's
 * own `{ interactionId, idempotencyKey, value }` contract, not AG-UI's
 * `resume[]`, because RA-011 already settled on idempotency keys.
 *
 * The types are hand-written rather than imported from `@ag-ui/core`: that
 * package depends on zod 3 while this repository is on zod 4, and only the
 * event shapes are needed here.
 */

import type {
  AgentRunStatus,
  AgentTraceEvent,
  InteractionRequest,
  TailorResumeResult,
  TraceMetadataValue,
} from '@/lib/api/types'

/**
 * The eight stages a run walks through, in order.
 *
 * `queued` is a pre-stage, `needs_input` is a transient node that can repeat,
 * and `completed`/`failed` are terminal — none of them belong on the timeline.
 */
export const RUN_STAGES = [
  'ingesting_inputs',
  'normalizing_candidate',
  'analyzing_jd',
  'matching_evidence',
  'drafting',
  'validating',
  'rendering',
] as const satisfies readonly AgentRunStatus[]

export type RunStage = (typeof RUN_STAGES)[number]

export const TERMINAL_RUN_STATUSES = ['completed', 'failed'] as const

export type TerminalRunStatus = (typeof TERMINAL_RUN_STATUSES)[number]

export function isRunStage(status: AgentRunStatus): status is RunStage {
  return (RUN_STAGES as readonly string[]).includes(status)
}

export function isTerminalRunStatus(
  status: AgentRunStatus
): status is TerminalRunStatus {
  return (TERMINAL_RUN_STATUSES as readonly string[]).includes(status)
}

/**
 * Stage index, or -1 for statuses that sit outside the timeline.
 */
export function stageIndex(status: AgentRunStatus): number {
  return (RUN_STAGES as readonly string[]).indexOf(status)
}

/**
 * Backend trace names do not equal run statuses: the trace also carries
 * `assess_resume`, which has no status of its own. Mapping stage → trace name
 * lets stage cards pick up per-stage telemetry without guessing.
 */
export const STAGE_TRACE_NAMES: Record<RunStage, readonly string[]> = {
  ingesting_inputs: ['ingest_inputs'],
  normalizing_candidate: ['normalize_candidate'],
  analyzing_jd: ['analyze_job'],
  matching_evidence: ['match_evidence'],
  drafting: ['draft_resume'],
  validating: ['validate_resume'],
  rendering: ['assess_resume', 'render_resume'],
}

export interface RunStartedEvent {
  type: 'RUN_STARTED'
  runId: string
  at: string
}

export interface StepStartedEvent {
  type: 'STEP_STARTED'
  runId: string
  stage: RunStage
  at: string
}

export interface StepFinishedEvent {
  type: 'STEP_FINISHED'
  runId: string
  stage: RunStage
  at: string
  metadata?: Record<string, TraceMetadataValue>
}

export interface StateSnapshotEvent {
  type: 'STATE_SNAPSHOT'
  runId: string
  at: string
  result: TailorResumeResult
}

/**
 * AG-UI models incremental state as RFC 6902 JSON Patch. The polling adapter
 * cannot produce real patches from whole snapshots, so it only emits the
 * fields it actually observed changing.
 */
export interface StateDeltaEvent {
  type: 'STATE_DELTA'
  runId: string
  at: string
  trace: AgentTraceEvent[]
}

export interface RunInterrupt {
  id: string
  reason: 'needs_input'
  request: InteractionRequest
}

export interface RunFinishedEvent {
  type: 'RUN_FINISHED'
  runId: string
  at: string
  outcome:
    | { type: 'success' }
    | { type: 'interrupt'; interrupts: RunInterrupt[] }
}

export interface RunErrorEvent {
  type: 'RUN_ERROR'
  runId: string
  at: string
  code: string
  message: string
}

export type RunEvent =
  | RunStartedEvent
  | StepStartedEvent
  | StepFinishedEvent
  | StateSnapshotEvent
  | StateDeltaEvent
  | RunFinishedEvent
  | RunErrorEvent

export type RunEventListener = (event: RunEvent) => void

/**
 * Why the stream stopped. `run_lost` is the in-memory `RunStore` limitation:
 * the backend restarted and the run is gone, which must never be shown as a
 * spinner that keeps turning.
 */
export type RunStreamStopReason =
  | 'terminal'
  | 'run_lost'
  | 'unreachable'
  | 'cancelled'

export interface RunStreamStop {
  reason: RunStreamStopReason
  at: string
}

/**
 * The seam between the workbench and the transport.
 *
 * `PollingRunEventStream` implements it today by diffing REST snapshots; an
 * `SseRunEventStream` can replace it once the backend streams AG-UI events,
 * without the workbench changing.
 */
export interface RunEventStream {
  subscribe(listener: RunEventListener): () => void
  onStop(listener: (stop: RunStreamStop) => void): () => void
  start(): Promise<void>
  stop(): void
}
