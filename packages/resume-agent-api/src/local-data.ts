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

import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  rename,
  rm,
  stat,
  unlink,
} from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { backup, DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'

import {
  SQLITE_RUN_STORE_SCHEMA_VERSION,
  SqliteRunStore,
} from '@yamlresume/resume-agent'

export type LocalDataErrorCode =
  | 'invalid_configuration'
  | 'source_not_found'
  | 'destination_exists'
  | 'invalid_database'
  | 'unsupported_schema'
  | 'database_in_use'
  | 'backup_failed'
  | 'restore_failed'

export class LocalDataError extends Error {
  constructor(readonly code: LocalDataErrorCode) {
    super(localDataErrorMessage(code))
    this.name = 'LocalDataError'
  }
}

export interface BackupLocalRunDatabaseOptions {
  sourcePath: string
  destinationPath: string
}

export interface LocalRunDatabaseBackup {
  path: string
  sha256: string
}

export interface RestoreLocalRunDatabaseOptions {
  backupPath: string
  targetPath: string
  safetyBackupPath?: string
}

export interface RestoredLocalRunDatabase {
  path: string
  safetyBackupPath?: string
}

export type LocalRunDatabaseCheck =
  | { state: 'missing' }
  | { state: 'ready'; schemaVersion: number }

function localDataErrorMessage(code: LocalDataErrorCode): string {
  switch (code) {
    case 'invalid_configuration':
      return 'Local data configuration is invalid'
    case 'source_not_found':
      return 'Local Run database does not exist'
    case 'destination_exists':
      return 'Backup destination already exists'
    case 'invalid_database':
      return 'Local Run database is invalid'
    case 'unsupported_schema':
      return 'Local Run database schema is not supported'
    case 'database_in_use':
      return 'Local Run database must be closed'
    case 'backup_failed':
      return 'Local Run database backup failed'
    case 'restore_failed':
      return 'Local Run database restore failed'
  }
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT'
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (isMissing(error)) return false
    throw error
  }
}

async function hasPendingWal(path: string): Promise<boolean> {
  try {
    return (await stat(`${path}-wal`)).size > 0
  } catch (error) {
    if (isMissing(error)) return false
    throw new LocalDataError('invalid_database')
  }
}

async function removeSqliteArtifacts(path: string): Promise<void> {
  await Promise.all(
    [path, `${path}-wal`, `${path}-shm`].map((artifactPath) =>
      rm(artifactPath, { force: true })
    )
  )
}

async function assertRegularSource(path: string): Promise<void> {
  try {
    const source = await stat(path)
    if (!source.isFile()) throw new LocalDataError('source_not_found')
  } catch (error) {
    if (error instanceof LocalDataError) throw error
    if (isMissing(error)) throw new LocalDataError('source_not_found')
    throw new LocalDataError('backup_failed')
  }
}

function immutableDatabaseUrl(path: string): URL {
  const url = pathToFileURL(path)
  url.searchParams.set('immutable', '1')
  return url
}

function inspectRunDatabase(
  path: string,
  options: { immutable?: boolean } = {}
): number {
  let database: DatabaseSync | undefined
  try {
    const location = options.immutable ? immutableDatabaseUrl(path) : path
    database = new DatabaseSync(location, {
      readOnly: true,
      enableDoubleQuotedStringLiterals: false,
      allowExtension: false,
    })
    const integrity = database.prepare('PRAGMA quick_check').all() as Array<
      Record<string, unknown>
    >
    const version = database.prepare('PRAGMA user_version').get() as
      | Record<string, unknown>
      | undefined
    const runTable = database
      .prepare(
        `SELECT name
         FROM sqlite_master
         WHERE type = 'table' AND name = 'resume_agent_runs'`
      )
      .get()
    const schemaVersion = Number(version?.user_version)
    if (
      integrity.length !== 1 ||
      integrity[0]?.quick_check !== 'ok' ||
      !Number.isSafeInteger(schemaVersion) ||
      schemaVersion < 1 ||
      !runTable
    ) {
      throw new LocalDataError('invalid_database')
    }
    return schemaVersion
  } catch (error) {
    if (error instanceof LocalDataError) throw error
    throw new LocalDataError('invalid_database')
  } finally {
    try {
      database?.close()
    } catch {
      // Validation is already failing or complete; never expose SQLite detail.
    }
  }
}

export async function checkLocalRunDatabase(
  path: string
): Promise<LocalRunDatabaseCheck> {
  if (!path.trim()) throw new LocalDataError('invalid_configuration')
  const databasePath = resolve(path)
  if (!(await pathExists(databasePath))) return { state: 'missing' }
  await assertRegularSource(databasePath)
  if (await hasPendingWal(databasePath)) {
    throw new LocalDataError('database_in_use')
  }
  const schemaVersion = inspectRunDatabase(databasePath, { immutable: true })
  if (await hasPendingWal(databasePath)) {
    throw new LocalDataError('database_in_use')
  }
  if (schemaVersion > SQLITE_RUN_STORE_SCHEMA_VERSION) {
    throw new LocalDataError('unsupported_schema')
  }
  return {
    state: 'ready',
    schemaVersion,
  }
}

async function normalizeAndInspectRunDatabase(path: string): Promise<void> {
  inspectRunDatabase(path)
  let store: SqliteRunStore | undefined
  try {
    store = await SqliteRunStore.open(path)
  } catch {
    throw new LocalDataError('invalid_database')
  } finally {
    try {
      store?.close()
    } catch {
      // Treat an otherwise valid closed snapshot as invalid below.
    }
  }
  inspectRunDatabase(path)
}

async function fileSha256(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

export async function backupLocalRunDatabase(
  options: BackupLocalRunDatabaseOptions
): Promise<LocalRunDatabaseBackup> {
  const sourcePath = resolve(options.sourcePath)
  const destinationPath = resolve(options.destinationPath)
  if (
    !options.sourcePath.trim() ||
    !options.destinationPath.trim() ||
    sourcePath === destinationPath
  ) {
    throw new LocalDataError('invalid_configuration')
  }
  await assertRegularSource(sourcePath)
  if (await pathExists(destinationPath)) {
    throw new LocalDataError('destination_exists')
  }
  inspectRunDatabase(sourcePath)

  const destinationDirectory = dirname(destinationPath)
  const temporaryPath = resolve(
    destinationDirectory,
    `.${randomUUID()}.sqlite.tmp`
  )
  let source: DatabaseSync | undefined
  try {
    await mkdir(destinationDirectory, { recursive: true, mode: 0o700 })
    const temporaryFile = await open(temporaryPath, 'wx', 0o600)
    await temporaryFile.close()
    source = new DatabaseSync(sourcePath, {
      readOnly: true,
      enableDoubleQuotedStringLiterals: false,
      allowExtension: false,
    })
    await backup(source, temporaryPath)
    source.close()
    source = undefined
    await normalizeAndInspectRunDatabase(temporaryPath)
    await chmod(temporaryPath, 0o600)
    try {
      await link(temporaryPath, destinationPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException | undefined)?.code === 'EEXIST') {
        throw new LocalDataError('destination_exists')
      }
      throw error
    }
    await unlink(temporaryPath)
    return {
      path: options.destinationPath,
      sha256: await fileSha256(destinationPath),
    }
  } catch (error) {
    if (error instanceof LocalDataError) throw error
    throw new LocalDataError('backup_failed')
  } finally {
    try {
      source?.close()
    } catch {
      // Preserve the stable backup error.
    }
    await removeSqliteArtifacts(temporaryPath).catch(() => undefined)
  }
}

export async function restoreLocalRunDatabase(
  options: RestoreLocalRunDatabaseOptions
): Promise<RestoredLocalRunDatabase> {
  if (!options.backupPath.trim() || !options.targetPath.trim()) {
    throw new LocalDataError('invalid_configuration')
  }
  const backupPath = resolve(options.backupPath)
  const targetPath = resolve(options.targetPath)
  const safetyBackupPath = options.safetyBackupPath
    ? resolve(options.safetyBackupPath)
    : undefined
  if (
    backupPath === targetPath ||
    safetyBackupPath === backupPath ||
    safetyBackupPath === targetPath
  ) {
    throw new LocalDataError('invalid_configuration')
  }
  if (
    (await pathExists(`${targetPath}-wal`)) ||
    (await pathExists(`${targetPath}-shm`))
  ) {
    throw new LocalDataError('database_in_use')
  }

  if (!(await pathExists(targetPath))) {
    const restored = await backupLocalRunDatabase({
      sourcePath: backupPath,
      destinationPath: targetPath,
    })
    return { path: restored.path }
  }
  if (!safetyBackupPath) {
    throw new LocalDataError('invalid_configuration')
  }

  const targetDirectory = dirname(targetPath)
  const candidatePath = resolve(
    targetDirectory,
    `.${randomUUID()}.restore.sqlite`
  )
  const displacedPath = resolve(
    targetDirectory,
    `.${randomUUID()}.before-restore.sqlite`
  )
  let displaced = false
  let installed = false
  try {
    await backupLocalRunDatabase({
      sourcePath: backupPath,
      destinationPath: candidatePath,
    })
    await backupLocalRunDatabase({
      sourcePath: targetPath,
      destinationPath: safetyBackupPath,
    })
    await rename(targetPath, displacedPath)
    displaced = true
    await rename(candidatePath, targetPath)
    installed = true
    inspectRunDatabase(targetPath)
    await rm(displacedPath, { force: true })
    displaced = false
    return {
      path: options.targetPath,
      safetyBackupPath: options.safetyBackupPath,
    }
  } catch (error) {
    if (installed) {
      try {
        await rename(targetPath, candidatePath)
        installed = false
      } catch {
        // Keep both the installed candidate and displaced original recoverable.
      }
    }
    if (displaced) {
      try {
        await rename(displacedPath, targetPath)
        displaced = false
      } catch {
        // Do not delete the displaced original when rollback cannot complete.
      }
    }
    if (error instanceof LocalDataError) throw error
    throw new LocalDataError('restore_failed')
  } finally {
    await rm(candidatePath, { force: true }).catch(() => undefined)
    if (!displaced) {
      await rm(displacedPath, { force: true }).catch(() => undefined)
    }
  }
}
