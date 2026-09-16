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
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { LlmClient } from '@/contracts'
import { ResumeTailoringAgent } from '@/workflow/agent'
import {
  ResumeAgentRunService,
  type StoredResumeAgentRun,
} from '@/workflow/run'
import { RunStoreError, SqliteRunStore } from '@/workflow/sqlite-run-store'

const stores: SqliteRunStore[] = []
const temporaryDirectories: string[] = []

async function temporaryDatabasePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'yamlresume-run-store-'))
  temporaryDirectories.push(directory)
  return join(directory, 'runs.sqlite')
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
      createdAt: '2026-09-16T12:00:00.000Z',
      updatedAt: '2026-09-16T12:00:00.000Z',
    },
    request: {
      jobDescription: 'Private job description for a TypeScript engineer.',
      candidate: { resume: { content: { basics: { name: 'Ada' } } } },
    },
  }
}

function unusedAgent(): ResumeTailoringAgent {
  const llm: LlmClient = {
    async completeJson() {
      throw new Error('Scheduled workflow should not run in this test')
    },
  }
  return new ResumeTailoringAgent(llm)
}

afterEach(async () => {
  for (const store of stores.splice(0).reverse()) store.close()
  for (const directory of temporaryDirectories.splice(0).reverse()) {
    await rm(directory, { recursive: true, force: true })
  }
})

describe('SqliteRunStore', () => {
  it('persists a run across closing and reopening the database', async () => {
    const databasePath = await temporaryDatabasePath()
    const firstStore = await openStore(databasePath)
    const run = storedRun('run-persisted')

    expect(await firstStore.create(run)).toBe(true)
    firstStore.close()

    const reopenedStore = await openStore(databasePath)
    expect(await reopenedStore.get('run-persisted')).toEqual(run)
  })

  it('persists a matching compare-and-set with an incremented revision', async () => {
    const databasePath = await temporaryDatabasePath()
    const store = await openStore(databasePath)
    const run = storedRun('run-cas')
    await store.create(run)

    expect(
      await store.compareAndSet({
        ...run,
        snapshot: { ...run.snapshot, status: 'ingesting_inputs' },
      })
    ).toBe(true)
    store.close()

    const reopenedStore = await openStore(databasePath)
    expect(await reopenedStore.get('run-cas')).toEqual({
      ...run,
      revision: 1,
      snapshot: { ...run.snapshot, status: 'ingesting_inputs' },
    })
  })

  it('allows only one winner across two database connections', async () => {
    const databasePath = await temporaryDatabasePath()
    const firstStore = await openStore(databasePath)
    const secondStore = await openStore(databasePath)
    await firstStore.create(storedRun('run-two-connections'))
    const firstRead = await firstStore.get('run-two-connections')
    const secondRead = await secondStore.get('run-two-connections')
    if (!firstRead || !secondRead) throw new Error('Expected stored run')

    const results = await Promise.all([
      firstStore.compareAndSet({
        ...firstRead,
        snapshot: { ...firstRead.snapshot, status: 'ingesting_inputs' },
      }),
      secondStore.compareAndSet({
        ...secondRead,
        snapshot: { ...secondRead.snapshot, status: 'failed' },
      }),
    ])

    expect(results.sort()).toEqual([false, true])
    const winner = await firstStore.get('run-two-connections')
    expect(winner?.revision).toBe(1)
    expect(['ingesting_inputs', 'failed']).toContain(winner?.snapshot.status)
  })

  it('leaves records unchanged for duplicate create and stale or missing CAS', async () => {
    const store = await openStore(await temporaryDatabasePath())
    const stale = storedRun('run-condition-failures')
    await store.create(stale)

    expect(
      await store.create({
        ...stale,
        snapshot: { ...stale.snapshot, status: 'failed' },
      })
    ).toBe(false)
    expect(await store.compareAndSet(storedRun('run-missing-from-store'))).toBe(
      false
    )
    expect(
      await store.compareAndSet({
        ...stale,
        snapshot: { ...stale.snapshot, status: 'ingesting_inputs' },
      })
    ).toBe(true)
    const winner = await store.get('run-condition-failures')
    expect(
      await store.compareAndSet({
        ...stale,
        snapshot: { ...stale.snapshot, status: 'failed' },
      })
    ).toBe(false)
    expect(await store.get('run-condition-failures')).toEqual(winner)
  })

  it('isolates create, compare-and-set, and get values by serialization', async () => {
    const store = await openStore(await temporaryDatabasePath())
    const created = storedRun('run-clone-isolation')
    await store.create(created)
    created.snapshot.status = 'failed'

    const firstRead = await store.get('run-clone-isolation')
    expect(firstRead?.snapshot.status).toBe('queued')
    if (!firstRead) throw new Error('Expected stored run')
    firstRead.snapshot.status = 'failed'
    expect((await store.get('run-clone-isolation'))?.snapshot.status).toBe(
      'queued'
    )

    const update = await store.get('run-clone-isolation')
    if (!update) throw new Error('Expected stored run')
    update.snapshot.status = 'ingesting_inputs'
    await store.compareAndSet(update)
    update.snapshot.status = 'failed'

    expect((await store.get('run-clone-isolation'))?.snapshot.status).toBe(
      'ingesting_inputs'
    )
  })

  it('fails safely after the store is closed', async () => {
    const store = await openStore(await temporaryDatabasePath())
    store.close()
    store.close()

    await expect(store.get('run-after-close')).rejects.toEqual(
      new RunStoreError('closed')
    )
    await expect(store.create(storedRun('run-after-close'))).rejects.toEqual(
      new RunStoreError('closed')
    )
    await expect(
      store.compareAndSet(storedRun('run-after-close'))
    ).rejects.toEqual(new RunStoreError('closed'))
  })

  it('rejects invalid configuration with stable safe errors', async () => {
    await expect(SqliteRunStore.open('')).rejects.toEqual(
      new RunStoreError('invalid_configuration')
    )
    await expect(
      SqliteRunStore.open(':memory:', { busyTimeoutMs: -1 })
    ).rejects.toEqual(new RunStoreError('invalid_configuration'))
    await expect(
      SqliteRunStore.open(':memory:', { busyTimeoutMs: 1.5 })
    ).rejects.toEqual(new RunStoreError('invalid_configuration'))
  })

  it('does not expose paths, record bodies, or raw storage errors', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'yamlresume-run-store-error-'))
    temporaryDirectories.push(parent)
    const privatePathMarker = 'PRIVATE_DATABASE_PATH_MARKER'
    const openError = await SqliteRunStore.open(
      join(parent, privatePathMarker, 'runs.sqlite')
    ).catch((error: unknown) => error)

    expect(openError).toMatchObject({ code: 'open_failed' })
    expect(`${String(openError)}${JSON.stringify(openError)}`).not.toContain(
      privatePathMarker
    )

    const store = await openStore(await temporaryDatabasePath())
    const privateRecordMarker = 'PRIVATE_RESUME_BODY_MARKER'
    const recursiveResume: Record<string, unknown> = {
      privateRecordMarker,
    }
    recursiveResume.self = recursiveResume
    const unserializable = storedRun('run-unserializable')
    if (!unserializable.request) throw new Error('Expected request')
    unserializable.request.candidate.resume = recursiveResume
    const serializationError = await store
      .create(unserializable)
      .catch((error: unknown) => error)

    expect(serializationError).toMatchObject({ code: 'serialization_failed' })
    expect(
      `${String(serializationError)}${JSON.stringify(serializationError)}`
    ).not.toContain(privateRecordMarker)
  })

  it('fails closed for future schemas and corrupt records', async () => {
    const futureDatabasePath = await temporaryDatabasePath()
    const { DatabaseSync } = await import('node:sqlite')
    const futureDatabase = new DatabaseSync(futureDatabasePath)
    try {
      futureDatabase.exec('PRAGMA user_version = 999')
    } finally {
      futureDatabase.close()
    }
    await expect(SqliteRunStore.open(futureDatabasePath)).rejects.toEqual(
      new RunStoreError('unsupported_schema')
    )

    const corruptDatabasePath = await temporaryDatabasePath()
    const store = await openStore(corruptDatabasePath)
    const run = storedRun('run-corrupt')
    await store.create(run)
    store.close()
    const corruptRecordMarker = 'PRIVATE_CORRUPT_RECORD_MARKER'
    const corruptDatabase = new DatabaseSync(corruptDatabasePath)
    try {
      corruptDatabase
        .prepare('UPDATE resume_agent_runs SET record_json = ? WHERE id = ?')
        .run(
          JSON.stringify({
            ...run,
            revision: 42,
            privateBody: corruptRecordMarker,
          }),
          run.snapshot.id
        )
    } finally {
      corruptDatabase.close()
    }

    const reopenedStore = await openStore(corruptDatabasePath)
    const corruptError = await reopenedStore
      .get(run.snapshot.id)
      .catch((error: unknown) => error)
    expect(corruptError).toMatchObject({ code: 'corrupt_record' })
    expect(
      `${String(corruptError)}${JSON.stringify(corruptError)}`
    ).not.toContain(corruptRecordMarker)
  })

  it('restores a public run without exposing trusted state', async () => {
    const databasePath = await temporaryDatabasePath()
    const firstStore = await openStore(databasePath)
    const firstService = new ResumeAgentRunService(unusedAgent(), {
      store: firstStore,
      idFactory: () => 'run-service-restart',
      schedule: () => undefined,
    })
    const created = await firstService.start({
      jobDescription: 'Private job description for a TypeScript engineer.',
      candidate: { resume: { content: { basics: { name: 'Ada' } } } },
    })
    firstStore.close()

    const reopenedStore = await openStore(databasePath)
    const reopenedService = new ResumeAgentRunService(unusedAgent(), {
      store: reopenedStore,
      schedule: () => undefined,
    })
    const stored = await reopenedStore.get('run-service-restart')
    const publicRun = await reopenedService.get('run-service-restart')

    expect(publicRun).toEqual(created)
    expect(stored?.request?.jobDescription).toContain('Private job description')
    expect(publicRun).not.toHaveProperty('revision')
    expect(publicRun).not.toHaveProperty('request')
    expect(publicRun).not.toHaveProperty('checkpoint')
    expect(publicRun).not.toHaveProperty('answerReceipts')
  })
})
