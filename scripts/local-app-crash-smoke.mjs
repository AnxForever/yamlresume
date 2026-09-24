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
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildLocalApi } from './local-app-build.mjs'
import {
  startLocalApiProcess,
  stopLocalApiProcess,
} from './local-app-process.mjs'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const requestTimeoutMs = 5_000
const recoveryTimeoutMs = 20_000
const shutdownTimeoutMs = 5_000

const candidate = {
  content: {
    basics: {
      name: 'Crash Recovery Candidate',
      email: 'crash-recovery@example.invalid',
    },
    education: [],
  },
  layouts: [{ engine: 'html', template: 'calm' }],
}

const runRequest = {
  jobDescription:
    'We need a TypeScript backend engineer to build reliable local systems.',
  candidate: { resume: candidate },
  preferences: { formats: ['yaml'] },
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function interruptionSignal() {
  const arguments_ = process.argv.slice(2)
  if (arguments_.length === 0) return 'SIGKILL'
  if (arguments_.length === 1 && arguments_[0] === '--signal=SIGTERM') {
    return 'SIGTERM'
  }
  throw new Error(
    'Usage: node scripts/local-app-crash-smoke.mjs [--signal=SIGTERM]'
  )
}

function readRequestBody(request) {
  return new Promise((resolveBody, rejectBody) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => {
      body += chunk
    })
    request.once('end', () => resolveBody(body))
    request.once('error', rejectBody)
  })
}

async function startMockProvider() {
  let holdingFirstRequest = true
  let resolveFirstRequest
  let jobSpecRequests = 0
  let draftRequests = 0
  const sockets = new Set()
  const firstRequest = new Promise((resolveRequest) => {
    resolveFirstRequest = resolveRequest
  })
  let resolveFirstDisconnect
  const firstDisconnect = new Promise((resolveDisconnect) => {
    resolveFirstDisconnect = resolveDisconnect
  })

  const server = createServer(async (request, response) => {
    try {
      if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
        response.writeHead(404).end()
        return
      }
      const body = JSON.parse(await readRequestBody(request))
      const system = body?.messages?.[0]?.content
      const isJobSpec =
        typeof system === 'string' &&
        system.includes('You are a resume tailoring analyst')
      const isDraft =
        typeof system === 'string' && system.includes('You are a resume editor')
      if (!isJobSpec && !isDraft) {
        response.writeHead(400).end()
        return
      }
      if (isJobSpec) jobSpecRequests += 1
      if (isDraft) draftRequests += 1

      if (holdingFirstRequest) {
        holdingFirstRequest = false
        response.once('close', resolveFirstDisconnect)
        resolveFirstRequest()
        return
      }

      const content = isJobSpec
        ? {
            targetTitle: 'TypeScript Backend Engineer',
            seniority: 'unknown',
            summary: 'Build reliable local systems',
            requirements: [],
            keywords: [],
          }
        : {
            resume: candidate,
            selectedEvidenceIds: [],
            questions: [],
            notes: [],
          }
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(
        JSON.stringify({
          id: 'local_mock',
          model: 'local-crash-smoke',
          choices: [{ message: { content: JSON.stringify(content) } }],
        })
      )
    } catch {
      if (!response.headersSent) response.writeHead(400)
      response.end()
    }
  })
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
  })
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', rejectListen)
      resolveListen()
    })
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Mock Provider did not expose a TCP port.')
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    async waitForFirstRequest() {
      let timeout
      try {
        await Promise.race([
          firstRequest,
          new Promise((_, rejectRequest) => {
            timeout = setTimeout(
              () =>
                rejectRequest(
                  new Error(
                    'Mock Provider did not receive the first request in time.'
                  )
                ),
              requestTimeoutMs
            )
          }),
        ])
      } finally {
        clearTimeout(timeout)
      }
    },
    async waitForFirstDisconnect() {
      let timeout
      try {
        await Promise.race([
          firstDisconnect,
          new Promise((_, rejectDisconnect) => {
            timeout = setTimeout(
              () =>
                rejectDisconnect(
                  new Error(
                    'Mock Provider did not observe the interrupted request disconnect.'
                  )
                ),
              shutdownTimeoutMs
            )
          }),
        ])
      } finally {
        clearTimeout(timeout)
      }
    },
    requestCounts() {
      return { draftRequests, jobSpecRequests }
    },
    async close() {
      for (const socket of sockets) socket.destroy()
      await new Promise((resolveClose, rejectClose) => {
        server.close((error) => (error ? rejectClose(error) : resolveClose()))
      })
    },
  }
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

async function createRun(url) {
  const { payload, response } = await apiRequest(`${url}/v1/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(runRequest),
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
  const deadline = Date.now() + recoveryTimeoutMs
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
  throw new Error('Recovered Run did not complete in time.')
}

async function main() {
  const signal = interruptionSignal()
  const controlledShutdown = signal === 'SIGTERM'
  buildLocalApi(repositoryRoot)
  const directory = await mkdtemp(
    join(tmpdir(), 'yamlresume-local-crash-smoke-')
  )
  const databasePath = join(directory, 'runs.sqlite')
  let provider
  let runtime

  try {
    provider = await startMockProvider()
    const environment = {
      RESUME_AGENT_LLM_PROVIDER: 'openai-compatible',
      RESUME_AGENT_TASK_LEASE_MS: '800',
      RESUME_AGENT_TASK_POLL_MS: '50',
      OPENAI_API_KEY: 'synthetic-local-key',
      OPENAI_BASE_URL: provider.baseUrl,
      OPENAI_MODEL: 'local-crash-smoke',
      OPENAI_TIMEOUT_MS: controlledShutdown ? '60000' : '5000',
      OPENAI_MAX_RETRIES: '0',
    }

    runtime = await startLocalApiProcess(databasePath, environment)
    const runId = await createRun(runtime.url)
    await provider.waitForFirstRequest()
    const shutdownStartedAt = Date.now()
    const stopped = await stopLocalApiProcess(runtime.child, signal)
    await provider.waitForFirstDisconnect()
    if (controlledShutdown) {
      assert(
        stopped.code === 0 && stopped.signal === null,
        'API did not exit cleanly after SIGTERM.'
      )
      assert(
        Date.now() - shutdownStartedAt < shutdownTimeoutMs,
        'API waited for the Provider timeout after SIGTERM.'
      )
    }
    runtime = undefined

    runtime = await startLocalApiProcess(databasePath, environment)
    const completed = await waitForCompletedRun(runtime.url, runId)
    const yaml = completed?.result?.rendered?.yaml
    assert(
      typeof yaml === 'string' && yaml.includes('Crash Recovery Candidate'),
      'Recovered Run did not contain the expected YAML artifact.'
    )
    const counts = provider.requestCounts()
    assert(
      counts.jobSpecRequests === 2,
      'Recovered worker did not retry the interrupted Provider stage once.'
    )
    assert(
      counts.draftRequests === 1,
      'Recovered worker did not complete the draft Provider stage once.'
    )

    console.log(
      controlledShutdown
        ? 'Local app controlled shutdown smoke passed:'
        : 'Local app crash recovery smoke passed:'
    )
    console.log(
      controlledShutdown
        ? '- the first API cancelled its in-flight Provider connection and exited cleanly'
        : '- the first API was killed during an in-flight Provider call'
    )
    console.log('- the local mock observed the interrupted connection close')
    console.log('- a new API process reclaimed the expired SQLite task lease')
    console.log('- the original Run completed with its YAML artifact')
  } finally {
    if (runtime) {
      await stopLocalApiProcess(runtime.child).catch(() => undefined)
    }
    if (provider) await provider.close().catch(() => undefined)
    await rm(directory, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(
    error instanceof Error
      ? error.message
      : 'Local app crash recovery smoke failed.'
  )
  process.exitCode = 1
})
