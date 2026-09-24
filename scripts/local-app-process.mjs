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

import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const serverEntry = join(
  repositoryRoot,
  'packages/resume-agent-api/dist/server.js'
)
const processTimeoutMs = 15_000

function runtimeEnvironment(databasePath, overrides) {
  const environment = {
    RESUME_AGENT_AUTH_MODE: 'disabled',
    RESUME_AGENT_HOST: '127.0.0.1',
    RESUME_AGENT_LLM_PROVIDER: 'offline',
    RESUME_AGENT_RUN_DB_PATH: databasePath,
    RESUME_AGENT_RUN_STORE: 'sqlite',
    PORT: '0',
    ...overrides,
  }
  for (const name of ['LANG', 'LC_ALL', 'PATH', 'TZ']) {
    if (process.env[name]) environment[name] = process.env[name]
  }
  return environment
}

export async function startLocalApiProcess(
  databasePath,
  environmentOverrides = {}
) {
  const child = spawn(process.execPath, [serverEntry], {
    cwd: repositoryRoot,
    env: runtimeEnvironment(databasePath, environmentOverrides),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let startupOutput = ''
  let startupError = ''

  try {
    const url = await new Promise((resolveReady, rejectReady) => {
      const timeout = setTimeout(() => {
        finish(
          rejectReady,
          new Error('Local API did not become ready in time.')
        )
      }, processTimeoutMs)
      const finish = (callback, value) => {
        clearTimeout(timeout)
        child.stdout.off('data', onOutput)
        child.stderr.off('data', onErrorOutput)
        child.off('error', onError)
        child.off('exit', onExit)
        callback(value)
      }
      const onOutput = (chunk) => {
        startupOutput = `${startupOutput}${chunk}`.slice(-4_096)
        const match = startupOutput.match(
          /YAMLResume agent API listening on (http:\/\/127\.0\.0\.1:\d+)/
        )
        if (match?.[1]) finish(resolveReady, match[1])
      }
      const onErrorOutput = (chunk) => {
        startupError = `${startupError}${chunk}`.slice(-4_096)
      }
      const onError = () => {
        finish(rejectReady, new Error('Local API process could not start.'))
      }
      const onExit = (code) => {
        const detail = startupError.trim() || startupOutput.trim()
        finish(
          rejectReady,
          new Error(
            `Local API exited before readiness (code ${code ?? 'unknown'})${
              detail ? `: ${detail}` : '.'
            }`
          )
        )
      }

      child.stdout.on('data', onOutput)
      child.stderr.on('data', onErrorOutput)
      child.once('error', onError)
      child.once('exit', onExit)
    })
    child.stdout.resume()
    child.stderr.resume()
    return { child, url }
  } catch (error) {
    await stopLocalApiProcess(child).catch(() => undefined)
    throw error
  }
}

export async function stopLocalApiProcess(child, signal = 'SIGTERM') {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { code: child.exitCode, signal: child.signalCode }
  }
  return new Promise((resolveExit, rejectExit) => {
    const timeout = setTimeout(() => {
      if (signal !== 'SIGKILL') child.kill('SIGKILL')
      rejectExit(new Error('Local API did not stop in time.'))
    }, processTimeoutMs)
    const finish = (callback, value) => {
      clearTimeout(timeout)
      child.off('error', onError)
      child.off('exit', onExit)
      callback(value)
    }
    const onError = (error) => finish(rejectExit, error)
    const onExit = (code, exitSignal) => {
      if (code === 0 || exitSignal === signal) {
        finish(resolveExit, { code, signal: exitSignal })
        return
      }
      finish(
        rejectExit,
        new Error(`Local API stopped unexpectedly (code ${code ?? 'unknown'}).`)
      )
    }
    child.once('error', onError)
    child.once('exit', onExit)
    child.kill(signal)
  })
}
