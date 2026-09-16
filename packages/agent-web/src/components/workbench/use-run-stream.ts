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

'use client'

import { useEffect, useReducer, useState } from 'react'
import type { AgentApiClient } from '@/lib/api/client'
import type { RunEvent, RunStreamStop } from '@/lib/run/events'
import { PollingRunEventStream, type PollResult } from '@/lib/run/polling'
import {
  applyRunEvent,
  applyRunStop,
  initialWorkbenchState,
  type WorkbenchState,
} from '@/lib/run/state'

type WorkbenchAction =
  | { type: 'event'; event: RunEvent }
  | { type: 'stop'; stop: RunStreamStop }

function reducer(
  state: WorkbenchState,
  action: WorkbenchAction
): WorkbenchState {
  if (action.type === 'event') {
    return applyRunEvent(state, action.event)
  }
  return applyRunStop(state, action.stop)
}

export interface UseRunStreamResult {
  state: WorkbenchState
  stop: RunStreamStop | null
}

/**
 * Subscribe to one run: `GET /v1/runs/{id}` is polled and diffed into
 * AG-UI-shaped events, which fold into the workbench view model.
 *
 * `stop` carries the reason the stream ended — `terminal` (completed/failed),
 * `run_lost` (backend restarted, run gone) or `unreachable` (backend down).
 */
export function useRunStream(
  runId: string,
  client: AgentApiClient | null
): UseRunStreamResult {
  const [state, dispatch] = useReducer(
    reducer,
    undefined,
    initialWorkbenchState
  )
  const [stop, setStop] = useState<RunStreamStop | null>(null)

  useEffect(() => {
    if (!client) {
      return undefined
    }
    const fetchRun = async (): Promise<PollResult> => {
      const result = await client.getRun(runId)
      if (result.kind === 'found') {
        return { kind: 'found', run: result.run }
      }
      if (result.kind === 'not_found') {
        return { kind: 'not_found' }
      }
      return { kind: 'error', message: result.error.message }
    }
    const stream = new PollingRunEventStream({ fetchRun })
    stream.subscribe((event) => dispatch({ type: 'event', event }))
    stream.onStop((next) => setStop(next))
    void stream.start()
    return () => stream.stop()
  }, [runId, client])

  return { state, stop }
}
