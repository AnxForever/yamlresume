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

import {
  access,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import {
  SqliteRunStore,
  type StoredResumeAgentRun,
} from '@yamlresume/resume-agent'
import { afterEach, describe, expect, it } from 'vitest'

import {
  backupLocalRunDatabase,
  checkLocalRunDatabase,
  restoreLocalRunDatabase,
} from './local-data'

const directories: string[] = []
const stores: SqliteRunStore[] = []

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'yamlresume-local-data-'))
  directories.push(directory)
  return directory
}

async function openStore(path: string): Promise<SqliteRunStore> {
  const store = await SqliteRunStore.open(path)
  stores.push(store)
  return store
}

function storedRun(id: string): StoredResumeAgentRun {
  return {
    revision: 0,
    snapshot: {
      id,
      status: 'queued',
      createdAt: '2026-09-24T08:00:00.000Z',
      updatedAt: '2026-09-24T08:00:00.000Z',
    },
    request: {
      jobDescription: 'Synthetic TypeScript backend role.',
      candidate: {
        resume: { content: { basics: { name: 'Backup Test Candidate' } } },
      },
    },
  }
}

afterEach(async () => {
  for (const store of stores.splice(0)) {
    try {
      store.close()
    } catch {
      // A behavior may deliberately close a Store before verification.
    }
  }
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('local Run database protection', () => {
  it('checks a valid Run database without changing its files', async () => {
    const directory = await temporaryDirectory()
    const databasePath = join(directory, 'runs.sqlite')
    const store = await openStore(databasePath)
    await store.create(storedRun('run-checked-read-only'))
    store.close()
    const entriesBefore = (await readdir(directory)).sort()
    const contentsBefore = await Promise.all(
      entriesBefore.map((entry) => readFile(join(directory, entry)))
    )

    await expect(checkLocalRunDatabase(databasePath)).resolves.toEqual({
      state: 'ready',
      schemaVersion: 2,
    })

    const entriesAfter = (await readdir(directory)).sort()
    expect(entriesAfter).toEqual(entriesBefore)
    const contentsAfter = await Promise.all(
      entriesAfter.map((entry) => readFile(join(directory, entry)))
    )
    expect(contentsAfter).toEqual(contentsBefore)
  })

  it('reports a future Run database schema as unsupported', async () => {
    const directory = await temporaryDirectory()
    const databasePath = join(directory, 'future.sqlite')
    const store = await openStore(databasePath)
    store.close()
    const future = new DatabaseSync(databasePath)
    future.exec('PRAGMA user_version = 999')
    future.close()

    await expect(checkLocalRunDatabase(databasePath)).rejects.toMatchObject({
      code: 'unsupported_schema',
      message: 'Local Run database schema is not supported',
    })
  })

  it('reports a missing Run database without creating it', async () => {
    const directory = await temporaryDirectory()
    const databasePath = join(directory, 'not-created.sqlite')

    await expect(checkLocalRunDatabase(databasePath)).resolves.toEqual({
      state: 'missing',
    })
    await expect(access(databasePath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('refuses to inspect a Run database with pending WAL writes', async () => {
    const directory = await temporaryDirectory()
    const databasePath = join(directory, 'active.sqlite')
    const store = await openStore(databasePath)
    await store.create(storedRun('run-still-in-wal'))
    expect((await stat(`${databasePath}-wal`)).size).toBeGreaterThan(0)

    await expect(checkLocalRunDatabase(databasePath)).rejects.toMatchObject({
      code: 'database_in_use',
    })
  })

  it('creates a private consistent backup while the source Store is open', async () => {
    const directory = await temporaryDirectory()
    const sourcePath = join(directory, 'runs.sqlite')
    const destinationPath = join(directory, 'backups', 'runs.sqlite')
    const source = await openStore(sourcePath)
    const run = storedRun('run-backed-up-online')
    await source.create(run)

    const result = await backupLocalRunDatabase({
      sourcePath,
      destinationPath,
    })

    expect(result.path).toBe(destinationPath)
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect((await stat(destinationPath)).mode & 0o777).toBe(0o600)
    const backup = await openStore(destinationPath)
    await expect(backup.get(run.snapshot.id)).resolves.toEqual(run)
  })

  it('removes temporary SQLite sidecars after publishing a backup', async () => {
    const directory = await temporaryDirectory()
    const sourcePath = join(directory, 'runs.sqlite')
    const backupDirectory = join(directory, 'backups')
    const destinationPath = join(backupDirectory, 'runs.sqlite')
    const source = await openStore(sourcePath)
    await source.create(storedRun('run-with-private-temporary-artifacts'))

    await backupLocalRunDatabase({ sourcePath, destinationPath })

    await expect(readdir(backupDirectory)).resolves.toEqual(['runs.sqlite'])
  })

  it('rejects an invalid source without publishing a backup', async () => {
    const directory = await temporaryDirectory()
    const sourcePath = join(directory, 'invalid.sqlite')
    const destinationPath = join(directory, 'backups', 'runs.sqlite')
    await writeFile(sourcePath, 'not a SQLite database', { mode: 0o600 })

    await expect(
      backupLocalRunDatabase({ sourcePath, destinationPath })
    ).rejects.toMatchObject({ code: 'invalid_database' })
    await expect(access(destinationPath)).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('does not overwrite an existing backup destination', async () => {
    const directory = await temporaryDirectory()
    const sourcePath = join(directory, 'runs.sqlite')
    const destinationPath = join(directory, 'existing.sqlite')
    const source = await openStore(sourcePath)
    await source.create(storedRun('run-for-no-overwrite'))
    await writeFile(destinationPath, 'keep-this-file', { mode: 0o600 })

    await expect(
      backupLocalRunDatabase({ sourcePath, destinationPath })
    ).rejects.toMatchObject({ code: 'destination_exists' })
    await expect(readFile(destinationPath, 'utf8')).resolves.toBe(
      'keep-this-file'
    )
  })

  it('restores a private Run database when the target does not exist', async () => {
    const directory = await temporaryDirectory()
    const sourcePath = join(directory, 'source.sqlite')
    const backupPath = join(directory, 'backups', 'runs.sqlite')
    const targetPath = join(directory, 'restored', 'runs.sqlite')
    const source = await openStore(sourcePath)
    const run = storedRun('run-restored-to-empty-target')
    await source.create(run)
    await backupLocalRunDatabase({
      sourcePath,
      destinationPath: backupPath,
    })

    const result = await restoreLocalRunDatabase({ backupPath, targetPath })

    expect(result).toEqual({ path: targetPath })
    expect((await stat(targetPath)).mode & 0o777).toBe(0o600)
    const restored = await openStore(targetPath)
    await expect(restored.get(run.snapshot.id)).resolves.toEqual(run)
  })

  it('preserves the current database before replacing it', async () => {
    const directory = await temporaryDirectory()
    const sourcePath = join(directory, 'source.sqlite')
    const backupPath = join(directory, 'backups', 'source.sqlite')
    const targetPath = join(directory, 'current.sqlite')
    const safetyBackupPath = join(directory, 'backups', 'before-restore.sqlite')
    const source = await openStore(sourcePath)
    const incomingRun = storedRun('run-from-selected-backup')
    await source.create(incomingRun)
    await backupLocalRunDatabase({
      sourcePath,
      destinationPath: backupPath,
    })
    const current = await openStore(targetPath)
    const currentRun = storedRun('run-preserved-before-restore')
    await current.create(currentRun)
    current.close()

    const result = await restoreLocalRunDatabase({
      backupPath,
      targetPath,
      safetyBackupPath,
    })

    expect(result).toEqual({ path: targetPath, safetyBackupPath })
    const restored = await openStore(targetPath)
    await expect(restored.get(incomingRun.snapshot.id)).resolves.toEqual(
      incomingRun
    )
    await expect(restored.get(currentRun.snapshot.id)).resolves.toBeUndefined()
    const safetyBackup = await openStore(safetyBackupPath)
    await expect(safetyBackup.get(currentRun.snapshot.id)).resolves.toEqual(
      currentRun
    )
  })

  it('refuses to replace a database that is open in WAL mode', async () => {
    const directory = await temporaryDirectory()
    const sourcePath = join(directory, 'source.sqlite')
    const backupPath = join(directory, 'backups', 'source.sqlite')
    const targetPath = join(directory, 'current.sqlite')
    const safetyBackupPath = join(directory, 'backups', 'before-restore.sqlite')
    const source = await openStore(sourcePath)
    await source.create(storedRun('run-in-backup'))
    await backupLocalRunDatabase({
      sourcePath,
      destinationPath: backupPath,
    })
    const current = await openStore(targetPath)
    const currentRun = storedRun('run-in-open-target')
    await current.create(currentRun)

    await expect(
      restoreLocalRunDatabase({
        backupPath,
        targetPath,
        safetyBackupPath,
      })
    ).rejects.toMatchObject({ code: 'database_in_use' })
    await expect(current.get(currentRun.snapshot.id)).resolves.toEqual(
      currentRun
    )
    await expect(access(safetyBackupPath)).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('refuses a missing target path when WAL state is still present', async () => {
    const directory = await temporaryDirectory()
    const sourcePath = join(directory, 'source.sqlite')
    const backupPath = join(directory, 'backup.sqlite')
    const targetPath = join(directory, 'missing-current.sqlite')
    const source = await openStore(sourcePath)
    await source.create(storedRun('run-for-orphaned-wal-check'))
    await backupLocalRunDatabase({
      sourcePath,
      destinationPath: backupPath,
    })
    await writeFile(`${targetPath}-wal`, 'stale-or-active-wal', { mode: 0o600 })

    await expect(
      restoreLocalRunDatabase({ backupPath, targetPath })
    ).rejects.toMatchObject({ code: 'database_in_use' })
    await expect(access(targetPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('leaves the current database unchanged when the selected backup is invalid', async () => {
    const directory = await temporaryDirectory()
    const backupPath = join(directory, 'invalid.sqlite')
    const targetPath = join(directory, 'current.sqlite')
    const safetyBackupPath = join(directory, 'before-restore.sqlite')
    await writeFile(backupPath, 'not a SQLite database', { mode: 0o600 })
    const current = await openStore(targetPath)
    const currentRun = storedRun('run-kept-after-invalid-restore')
    await current.create(currentRun)
    current.close()

    await expect(
      restoreLocalRunDatabase({
        backupPath,
        targetPath,
        safetyBackupPath,
      })
    ).rejects.toMatchObject({ code: 'invalid_database' })
    const unchanged = await openStore(targetPath)
    await expect(unchanged.get(currentRun.snapshot.id)).resolves.toEqual(
      currentRun
    )
    await expect(access(safetyBackupPath)).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })
})
