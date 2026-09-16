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

import { describe, expect, it, vi } from 'vitest'

import type { AgentRunStatus, ResumeAgentRun } from '@/lib/api/types'
import type { RunEvent, RunStreamStop } from '@/lib/run/events'
import { PollingRunEventStream, type PollResult } from '@/lib/run/polling'

function run(
  status: AgentRunStatus,
  overrides: Partial<ResumeAgentRun> = {}
): ResumeAgentRun {
  return {
    id: 'run_1',
    status,
    createdAt: '2026-09-16T00:00:00.000Z',
    updatedAt: `2026-09-16T00:00:0${Math.min(9, status.length % 10)}.000Z`,
    ...overrides,
  }
}

interface Harness {
  stream: PollingRunEventStream
  events: RunEvent[]
  stops: RunStreamStop[]
  sleeps: number[]
  fetchRun: ReturnType<typeof vi.fn>
}

function harness(
  results: PollResult[],
  options: { maxFailures?: number } = {}
): Harness {
  const events: RunEvent[] = []
  const stops: RunStreamStop[] = []
  const sleeps: number[] = []
  let index = 0

  const fetchRun = vi.fn(async (): Promise<PollResult> => {
    const result = results[Math.min(index, results.length - 1)]
    index += 1
    if (!result) {
      throw new Error('no poll result configured')
    }
    return result
  })

  const stream = new PollingRunEventStream({
    fetchRun,
    sleep: async (ms) => {
      sleeps.push(ms)
    },
    intervalMs: 100,
    maxIntervalMs: 800,
    ...(options.maxFailures === undefined
      ? {}
      : { maxFailures: options.maxFailures }),
  })

  stream.subscribe((event) => events.push(event))
  stream.onStop((stop) => stops.push(stop))

  return { stream, events, stops, sleeps, fetchRun }
}

describe('PollingRunEventStream', () => {
  it('streams a run from queued to completed', async () => {
    const { stream, events, stops } = harness([
      { kind: 'found', run: run('queued') },
      { kind: 'found', run: run('ingesting_inputs') },
      { kind: 'found', run: run('rendering') },
      { kind: 'found', run: run('completed') },
    ])

    await stream.start()

    expect(events[0]).toMatchObject({ type: 'RUN_STARTED' })
    expect(events.at(-1)).toMatchObject({ type: 'STEP_FINISHED' })
    expect(stops).toEqual([{ reason: 'terminal', at: expect.any(String) }])
  })

  it('stops immediately when the first snapshot is already terminal', async () => {
    const { stream, stops, fetchRun } = harness([
      { kind: 'found', run: run('completed') },
    ])

    await stream.start()

    expect(fetchRun).toHaveBeenCalledTimes(1)
    expect(stops[0]?.reason).toBe('terminal')
  })

  it('reports run_lost when the backend forgets the run', async () => {
    const { stream, stops } = harness([
      { kind: 'found', run: run('drafting') },
      { kind: 'not_found' },
    ])

    await stream.start()

    expect(stops).toEqual([{ reason: 'run_lost', at: expect.any(String) }])
  })

  it('backs off exponentially across transport failures', async () => {
    const { stream, sleeps, stops } = harness([
      { kind: 'error', message: 'network down' },
      { kind: 'error', message: 'network down' },
      { kind: 'error', message: 'network down' },
      { kind: 'found', run: run('completed') },
    ])

    await stream.start()

    expect(sleeps).toEqual([200, 400, 800])
    expect(stops[0]?.reason).toBe('terminal')
  })

  it('caps the backoff delay', async () => {
    const { stream, sleeps } = harness(
      [{ kind: 'error', message: 'still down' }],
      { maxFailures: 6 }
    )

    await stream.start()

    expect(sleeps).toEqual([200, 400, 800, 800, 800])
    expect(Math.max(...sleeps)).toBe(800)
  })

  it('gives up as unreachable after too many consecutive failures', async () => {
    const { stream, stops } = harness([{ kind: 'error', message: 'down' }], {
      maxFailures: 3,
    })

    await stream.start()

    expect(stops).toEqual([{ reason: 'unreachable', at: expect.any(String) }])
  })

  it('resets the failure count after a successful poll', async () => {
    const { stream, sleeps, stops } = harness(
      [
        { kind: 'error', message: 'blip' },
        { kind: 'error', message: 'blip' },
        { kind: 'found', run: run('drafting') },
        { kind: 'error', message: 'blip' },
        { kind: 'found', run: run('completed') },
      ],
      { maxFailures: 3 }
    )

    await stream.start()

    // 200, 400 (two failures), 100 (steady state after success), 200 (reset
    // failure count means the third error backs off from scratch).
    expect(sleeps).toEqual([200, 400, 100, 200])
    expect(stops[0]?.reason).toBe('terminal')
  })

  it('polls at the steady interval while a run is in flight', async () => {
    const { stream, sleeps } = harness([
      { kind: 'found', run: run('drafting') },
      { kind: 'found', run: run('validating') },
      { kind: 'found', run: run('completed') },
    ])

    await stream.start()

    expect(sleeps).toEqual([100, 100])
  })

  it('stops polling when cancelled', async () => {
    const { stream, stops, fetchRun } = harness([
      { kind: 'found', run: run('drafting') },
    ])

    stream.stop()
    await stream.start()

    expect(fetchRun).not.toHaveBeenCalled()
    expect(stops).toEqual([{ reason: 'cancelled', at: expect.any(String) }])
  })

  it('notifies cancellation only once', async () => {
    const { stream, stops } = harness([{ kind: 'found', run: run('drafting') }])

    stream.stop()
    stream.stop()

    expect(stops).toHaveLength(1)
  })

  it('delivers the same events to every subscriber', async () => {
    const { stream, events } = harness([
      { kind: 'found', run: run('completed') },
    ])
    const second: RunEvent[] = []
    stream.subscribe((event) => second.push(event))

    await stream.start()

    expect(second).toEqual(events)
    expect(second.length).toBeGreaterThan(0)
  })

  it('stops delivering to an unsubscribed listener', async () => {
    const { stream } = harness([{ kind: 'found', run: run('completed') }])
    const received: RunEvent[] = []
    const unsubscribe = stream.subscribe((event) => received.push(event))

    unsubscribe()
    await stream.start()

    expect(received).toEqual([])
  })

  it('ignores a second start while already running', async () => {
    const { stream, fetchRun } = harness([
      { kind: 'found', run: run('completed') },
    ])

    await Promise.all([stream.start(), stream.start()])

    expect(fetchRun).toHaveBeenCalledTimes(1)
  })

  it('passes the completed trace into the diff', async () => {
    const completed = run('rendering')
    const finished: ResumeAgentRun = {
      ...run('completed'),
      result: {
        status: 'completed',
        trace: [
          {
            name: 'render_resume',
            status: 'completed',
            at: '2026-09-16T00:00:09.000Z',
            metadata: { artifacts: 3 },
          },
        ],
      } as unknown as ResumeAgentRun['result'],
    }

    const { stream, events } = harness([
      { kind: 'found', run: completed },
      { kind: 'found', run: finished },
    ])

    await stream.start()

    const rendering = events.find(
      (event) => event.type === 'STEP_FINISHED' && event.stage === 'rendering'
    )
    expect(rendering).toMatchObject({ metadata: { artifacts: 3 } })
  })
})
