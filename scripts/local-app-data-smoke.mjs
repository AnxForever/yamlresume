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

import { mkdtemp, rename, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildLocalApi } from './local-app-build.mjs'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const requestTimeoutMs = 5_000
const runTimeoutMs = 20_000

const request = {
  jobDescription:
    'We need a TypeScript backend engineer to build reliable local systems.',
  candidate: {
    resume: {
      content: {
        basics: {
          name: 'Local Data Smoke Candidate',
          email: 'local-data-smoke@example.invalid',
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
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  throw new Error('Run did not complete in time.')
}

async function main() {
  buildLocalApi(repositoryRoot)
  const [{ startAgentApiServer }, localData] = await Promise.all([
    import('../packages/resume-agent-api/dist/server.js'),
    import('../packages/resume-agent-api/dist/local-data.js'),
  ])
  const directory = await mkdtemp(join(tmpdir(), 'yamlresume-data-smoke-'))
  const databasePath = join(directory, 'runs.sqlite')
  const lostDatabasePath = join(directory, 'lost-runs.sqlite')
  const backupPath = join(directory, 'backups', 'runs.sqlite')
  const env = {
    RESUME_AGENT_AUTH_MODE: 'disabled',
    RESUME_AGENT_HOST: '127.0.0.1',
    RESUME_AGENT_LLM_PROVIDER: 'offline',
    RESUME_AGENT_RUN_DB_PATH: databasePath,
    RESUME_AGENT_RUN_STORE: 'sqlite',
  }
  let runtime

  try {
    runtime = await startAgentApiServer({ env, port: 0 })
    const runId = await createRun(runtime.url)
    const completed = await waitForCompletedRun(runtime.url, runId)
    const yaml = completed?.result?.rendered?.yaml
    assert(
      typeof yaml === 'string' && yaml.includes('Local Data Smoke Candidate'),
      'Completed Run did not contain the expected YAML artifact.'
    )

    await localData.backupLocalRunDatabase({
      sourcePath: databasePath,
      destinationPath: backupPath,
    })
    assert((await stat(backupPath)).mode & 0o777, 'Backup file is missing.')
    assert(
      ((await stat(backupPath)).mode & 0o777) === 0o600,
      'Backup file is not private.'
    )
    await runtime.close()
    runtime = undefined
    await rename(databasePath, lostDatabasePath)

    await localData.restoreLocalRunDatabase({
      backupPath,
      targetPath: databasePath,
    })
    runtime = await startAgentApiServer({ env, port: 0 })
    const restored = await getRun(runtime.url, runId)
    assert(restored?.status === 'completed', 'Restored Run is not completed.')
    assert(
      restored?.result?.rendered?.yaml === yaml,
      'Restored Run did not preserve the YAML artifact.'
    )

    console.log('Local data smoke passed:')
    console.log('- an online SQLite backup was created with mode 0600')
    console.log('- the original test database was removed and restored')
    console.log('- a restarted API read the same Run and YAML through HTTP')
  } finally {
    await runtime?.close().catch(() => undefined)
    await rm(directory, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : 'Local data smoke failed.'
  )
  process.exitCode = 1
})
