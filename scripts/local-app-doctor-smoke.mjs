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

import { spawnSync } from 'node:child_process'
import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const doctorEntry = join(repositoryRoot, 'scripts/local-app-data.mjs')
const privateMarker = 'synthetic-private-doctor-smoke-content'
const stableError = 'Local Run database is invalid'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function doctorEnvironment(databasePath) {
  const environment = {
    NODE_NO_WARNINGS: '1',
    RESUME_AGENT_RUN_DB_PATH: databasePath,
  }
  for (const name of ['LANG', 'LC_ALL', 'PATH', 'TZ']) {
    if (process.env[name]) environment[name] = process.env[name]
  }
  return environment
}

async function main() {
  const directory = await mkdtemp(join(tmpdir(), 'yamlresume-doctor-smoke-'))
  const databasePath = join(directory, 'corrupt.sqlite')

  try {
    await writeFile(databasePath, privateMarker, { mode: 0o600 })
    const contentsBefore = await readFile(databasePath)
    const modeBefore = (await stat(databasePath)).mode & 0o777
    const entriesBefore = (await readdir(directory)).sort()

    const result = spawnSync(process.execPath, [doctorEntry, 'doctor'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: doctorEnvironment(databasePath),
    })
    const stdout = result.stdout ?? ''
    const stderr = result.stderr ?? ''
    const output = `${stdout}\n${stderr}`

    assert(!result.error, 'Doctor process could not be executed.')
    assert(result.signal === null, 'Doctor process ended from a signal.')
    assert(
      result.status !== null && result.status !== 0,
      'Doctor accepted a corrupt database.'
    )
    assert(
      stderr.trim() === stableError,
      'Doctor did not return only its stable database error.'
    )
    assert(
      !output.includes(privateMarker),
      'Doctor exposed the corrupt database contents.'
    )
    assert(
      !output.toLowerCase().includes('file is not a database'),
      'Doctor exposed a raw SQLite error.'
    )

    const entriesAfter = (await readdir(directory)).sort()
    const contentsAfter = await readFile(databasePath)
    const modeAfter = (await stat(databasePath)).mode & 0o777
    assert(
      JSON.stringify(entriesAfter) === JSON.stringify(entriesBefore),
      'Doctor created SQLite sidecar files.'
    )
    assert(
      contentsAfter.equals(contentsBefore),
      'Doctor changed the corrupt database bytes.'
    )
    assert(modeAfter === modeBefore, 'Doctor changed the database permissions.')

    console.log('Local database doctor smoke passed:')
    console.log('- a corrupt database was rejected with the stable CLI error')
    console.log('- no database contents or raw SQLite errors were exposed')
    console.log(
      '- database bytes, permissions, and directory entries stayed unchanged'
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : 'Local doctor smoke failed.'
  )
  process.exitCode = 1
})
