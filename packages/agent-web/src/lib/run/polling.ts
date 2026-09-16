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

import type { ResumeAgentRun } from '@/lib/api/types'
import { diffRunSnapshots } from '@/lib/run/diff'
import {
  isTerminalRunStatus,
  type RunEvent,
  type RunEventListener,
  type RunEventStream,
  type RunStreamStop,
  type RunStreamStopReason,
} from '@/lib/run/events'

export const DEFAULT_POLL_INTERVAL_MS = 1_000
export const DEFAULT_MAX_POLL_INTERVAL_MS = 15_000
export const DEFAULT_BACKOFF_FACTOR = 2
export const DEFAULT_MAX_CONSECUTIVE_FAILURES = 5

/**
 * What one poll observed. `not_found` is distinct from `error` on purpose: a
 * 404 means the in-memory store lost the run, which is terminal, while an
 * error is worth retrying with backoff.
 */
export type PollResult =
  | { kind: 'found'; run: ResumeAgentRun }
  | { kind: 'not_found' }
  | { kind: 'error'; message: string }

export interface PollingRunEventStreamOptions {
  fetchRun: () => Promise<PollResult>
  /** Injected so the state machine is testable without real timers. */
  sleep?: (ms: number) => Promise<void>
  intervalMs?: number
  maxIntervalMs?: number
  backoffFactor?: number
  maxFailures?: number
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/**
 * Turns REST snapshot polling into an AG-UI-shaped event stream.
 *
 * The backend exposes `GET /v1/runs/{id}` and nothing else, so stage
 * transitions have to be derived by comparing consecutive snapshots. All of
 * that inference lives in `diffRunSnapshots`; this class only owns scheduling,
 * backoff, and the stop conditions.
 *
 * Replace with an SSE implementation of `RunEventStream` once the backend
 * streams events — the workbench does not need to change.
 */
export class PollingRunEventStream implements RunEventStream {
  private readonly fetchRun: () => Promise<PollResult>
  private readonly sleep: (ms: number) => Promise<void>
  private readonly intervalMs: number
  private readonly maxIntervalMs: number
  private readonly backoffFactor: number
  private readonly maxFailures: number

  private readonly listeners = new Set<RunEventListener>()
  private readonly stopListeners = new Set<(stop: RunStreamStop) => void>()

  private previous: ResumeAgentRun | undefined
  private failures = 0
  private running = false
  private stopped = false

  constructor(options: PollingRunEventStreamOptions) {
    this.fetchRun = options.fetchRun
    this.sleep = options.sleep ?? defaultSleep
    this.intervalMs = options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS
    this.maxIntervalMs = options.maxIntervalMs ?? DEFAULT_MAX_POLL_INTERVAL_MS
    this.backoffFactor = options.backoffFactor ?? DEFAULT_BACKOFF_FACTOR
    this.maxFailures = options.maxFailures ?? DEFAULT_MAX_CONSECUTIVE_FAILURES
  }

  subscribe(listener: RunEventListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  onStop(listener: (stop: RunStreamStop) => void): () => void {
    this.stopListeners.add(listener)
    return () => {
      this.stopListeners.delete(listener)
    }
  }

  stop(): void {
    if (this.stopped) {
      return
    }
    this.stopped = true
    this.notifyStop('cancelled')
  }

  private emit(events: RunEvent[]): void {
    for (const event of events) {
      for (const listener of [...this.listeners]) {
        listener(event)
      }
    }
  }

  private notifyStop(reason: RunStreamStopReason): void {
    const stop: RunStreamStop = { reason, at: new Date().toISOString() }
    for (const listener of [...this.stopListeners]) {
      listener(stop)
    }
  }

  /** Exponential backoff, capped so a broken backend is polled slowly. */
  private delayFor(failures: number): number {
    if (failures === 0) {
      return this.intervalMs
    }
    const delay = this.intervalMs * this.backoffFactor ** failures
    return Math.min(delay, this.maxIntervalMs)
  }

  async start(): Promise<void> {
    if (this.running || this.stopped) {
      return
    }
    this.running = true

    try {
      while (!this.stopped) {
        const result = await this.fetchRun()
        if (this.stopped) {
          return
        }

        if (result.kind === 'not_found') {
          this.stopped = true
          this.notifyStop('run_lost')
          return
        }

        if (result.kind === 'error') {
          this.failures += 1
          if (this.failures >= this.maxFailures) {
            this.stopped = true
            this.notifyStop('unreachable')
            return
          }
          await this.sleep(this.delayFor(this.failures))
          continue
        }

        this.failures = 0
        const { run } = result
        this.emit(
          diffRunSnapshots(this.previous, run, {
            ...(run.result?.trace ? { trace: run.result.trace } : {}),
          })
        )
        this.previous = run

        if (isTerminalRunStatus(run.status)) {
          this.stopped = true
          this.notifyStop('terminal')
          return
        }

        await this.sleep(this.delayFor(0))
      }
    } finally {
      this.running = false
    }
  }
}
