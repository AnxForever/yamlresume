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

import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildLocalApi } from './local-app-build.mjs'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const defaultDatabasePath = join(
  repositoryRoot,
  '.data/resume-agent/local-app.sqlite'
)
const defaultBackupDirectory = join(
  repositoryRoot,
  '.data/resume-agent/backups'
)

function timestamp() {
  return new Date().toISOString().replaceAll(/[-:.]/g, '')
}

function databasePath() {
  const configured = process.env.RESUME_AGENT_RUN_DB_PATH?.trim()
  return resolve(configured || defaultDatabasePath)
}

async function localDataModule() {
  return import('../packages/resume-agent-api/dist/local-data.js')
}

async function backupCommand(argument) {
  const sourcePath = databasePath()
  const destinationPath = argument
    ? resolve(argument)
    : join(defaultBackupDirectory, `local-app-${timestamp()}.sqlite`)
  const { backupLocalRunDatabase } = await localDataModule()
  const result = await backupLocalRunDatabase({ sourcePath, destinationPath })
  console.log(`Backup created: ${result.path}`)
  console.log(`SHA-256: ${result.sha256}`)
}

async function restoreCommand(argument) {
  if (!argument) {
    throw new Error('Usage: pnpm local-app:restore -- <path-to-backup.sqlite>')
  }
  const backupPath = resolve(argument)
  const targetPath = databasePath()
  const safetyBackupPath = join(
    defaultBackupDirectory,
    `local-app-before-restore-${timestamp()}.sqlite`
  )
  const { restoreLocalRunDatabase } = await localDataModule()
  const result = await restoreLocalRunDatabase({
    backupPath,
    targetPath,
    safetyBackupPath,
  })
  console.log(`Database restored: ${result.path}`)
  if (result.safetyBackupPath) {
    console.log(`Previous database preserved: ${result.safetyBackupPath}`)
  }
}

async function doctorCommand() {
  const path = databasePath()
  const { checkLocalRunDatabase } = await localDataModule()
  const result = await checkLocalRunDatabase(path)
  console.log(`Database path: ${path}`)
  if (result.state === 'missing') {
    console.log('Database status: not created yet; ready for first start')
    return
  }
  console.log('Database status: ready')
  console.log(`Schema version: ${result.schemaVersion}`)
}

async function main() {
  const [command, ...rawArguments] = process.argv.slice(2)
  const commandArguments =
    rawArguments[0] === '--' ? rawArguments.slice(1) : rawArguments
  const [argument, ...extra] = commandArguments
  if (
    extra.length > 0 ||
    (command !== 'backup' && command !== 'doctor' && command !== 'restore') ||
    (command === 'doctor' && argument !== undefined)
  ) {
    throw new Error(
      'Usage: node scripts/local-app-data.mjs <backup|doctor|restore> [path]'
    )
  }
  buildLocalApi(repositoryRoot)
  if (command === 'backup') {
    await backupCommand(argument)
    return
  }
  if (command === 'doctor') {
    await doctorCommand()
    return
  }
  await restoreCommand(argument)
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : 'Local data command failed.'
  )
  process.exitCode = 1
})
