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

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildLocalApi } from './local-app-build.mjs'
import {
  startLocalApiProcess,
  stopLocalApiProcess,
} from './local-app-process.mjs'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const runTimeoutMs = 20_000
const requestTimeoutMs = 5_000

const request = {
  jobDescription:
    'We need a TypeScript backend engineer to build reliable local systems.',
  candidate: {
    resume: {
      content: {
        basics: {
          name: 'Local Smoke Candidate',
          email: 'local-smoke@example.invalid',
        },
        education: [],
      },
      layouts: [{ engine: 'html', template: 'calm' }],
    },
  },
  preferences: { formats: ['yaml'] },
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function apiRequest(url, options) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(requestTimeoutMs),
  })
  let payload
  try {
    payload = await response.json()
  } catch {
    throw new Error(`Local API returned non-JSON HTTP ${response.status}.`)
  }
  return { payload, response }
}

async function verifyRuntime(url) {
  const health = await apiRequest(`${url}/healthz`)
  assert(
    health.response.status === 200,
    'Health check did not return HTTP 200.'
  )
  assert(
    health.payload?.data?.ok === true,
    'Health check did not report ready.'
  )

  const { payload, response } = await apiRequest(`${url}/v1/capabilities`)
  assert(
    response.status === 200,
    'Capabilities request did not return HTTP 200.'
  )
  assert(
    payload?.data?.runtime?.providerConfigured === true,
    'Offline Provider was not configured.'
  )
  assert(
    payload?.data?.runtime?.runStore === 'sqlite',
    'Local API did not use SQLite.'
  )
  assert(
    payload?.data?.runtime?.authentication === 'disabled',
    'Local smoke authentication was not disabled.'
  )
}

async function createRun(url) {
  const { payload, response } = await apiRequest(`${url}/v1/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
  assert(response.status === 202, 'Run creation did not return HTTP 202.')
  assert(typeof payload?.data?.id === 'string', 'Run creation returned no ID.')
  return payload.data.id
}

async function getRun(url, runId) {
  const { payload, response } = await apiRequest(
    `${url}/v1/runs/${encodeURIComponent(runId)}`
  )
  assert(response.status === 200, 'Run lookup did not return HTTP 200.')
  return payload?.data
}

async function waitForCompletedRun(url, runId) {
  const deadline = Date.now() + runTimeoutMs
  while (Date.now() < deadline) {
    const run = await getRun(url, runId)
    if (run?.status === 'completed') return run
    if (run?.status === 'failed') {
      throw new Error(`Run failed with ${run.error?.code ?? 'unknown_error'}.`)
    }
    if (run?.status === 'waiting_for_input') {
      throw new Error('Run unexpectedly requires user input.')
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  throw new Error('Run did not complete in time.')
}

async function main() {
  buildLocalApi(repositoryRoot)
  const directory = await mkdtemp(join(tmpdir(), 'yamlresume-local-smoke-'))
  const databasePath = join(directory, 'runs.sqlite')
  let runtime

  try {
    runtime = await startLocalApiProcess(databasePath)
    await verifyRuntime(runtime.url)
    const runId = await createRun(runtime.url)
    const completed = await waitForCompletedRun(runtime.url, runId)
    const yaml = completed?.result?.rendered?.yaml
    assert(
      typeof yaml === 'string' && yaml.includes('Local Smoke Candidate'),
      'Completed Run did not contain the expected YAML artifact.'
    )

    await stopLocalApiProcess(runtime.child)
    runtime = await startLocalApiProcess(databasePath)
    await verifyRuntime(runtime.url)
    const restored = await getRun(runtime.url, runId)
    assert(
      restored?.status === 'completed',
      'Restarted API lost the Run state.'
    )
    assert(
      restored?.result?.rendered?.yaml === yaml,
      'Restarted API changed the persisted YAML artifact.'
    )

    console.log('Local app smoke passed:')
    console.log('- offline Provider and SQLite runtime are healthy')
    console.log('- asynchronous Run completed with a YAML artifact')
    console.log('- a new API process restored the same completed Run')
  } finally {
    if (runtime) {
      await stopLocalApiProcess(runtime.child).catch(() => undefined)
    }
    await rm(directory, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : 'Local app smoke failed.'
  )
  process.exitCode = 1
})
