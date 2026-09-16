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
  type ClaimedRunTask,
  type ClaimRunTaskOptions,
  type DurableRunStore,
  ResumeAgentRunService,
  type RunTask,
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

function runTask(
  runId: string,
  id = `${runId}:prepare:0`,
  kind: RunTask['kind'] = 'prepare'
): RunTask {
  return {
    id,
    runId,
    kind,
    createdAt: '2026-09-16T12:00:00.000Z',
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

const completeCandidate = {
  content: {
    basics: { name: 'Ada Lovelace', email: 'ada@example.com' },
    education: [],
  },
  layouts: [
    { engine: 'latex', template: 'jake' },
    { engine: 'html', template: 'calm' },
  ],
}

function completingAgent(name = 'Ada Lovelace'): ResumeTailoringAgent {
  const completedCandidate = {
    ...completeCandidate,
    content: {
      ...completeCandidate.content,
      basics: { ...completeCandidate.content.basics, name },
    },
  }
  const responses = [
    {
      targetTitle: 'TypeScript Engineer',
      seniority: 'junior',
      summary: 'TypeScript engineer',
      requirements: [],
      keywords: [],
    },
    {
      resume: completedCandidate,
      selectedEvidenceIds: [],
      questions: [],
      notes: [],
    },
  ]
  const llm: LlmClient = {
    async completeJson() {
      return {
        data: responses.shift(),
        metadata: {
          provider: 'fake',
          model: 'fake-model',
          durationMs: 1,
          attempt: 1,
        },
      }
    },
  }
  return new ResumeTailoringAgent(llm)
}

function questionAgent(): ResumeTailoringAgent {
  const llm: LlmClient = {
    async completeJson<T>() {
      return {
        data: {
          resume: completeCandidate,
          sourceArtifactIds: ['candidate-source'],
          questions: [
            {
              field: 'content.basics.name',
              question: 'What is your full name?',
              reason: 'The source name must be confirmed.',
              severity: 'blocking',
            },
          ],
          warnings: [],
        } as T,
        metadata: {
          provider: 'fake',
          model: 'fake-model',
          durationMs: 1,
          attempt: 1,
        },
      }
    },
  }
  return new ResumeTailoringAgent(llm)
}

function countingFailAgent(calls: { count: number }): ResumeTailoringAgent {
  const llm: LlmClient = {
    async completeJson() {
      calls.count += 1
      throw new Error('A terminal task replay must not call the model')
    },
  }
  return new ResumeTailoringAgent(llm)
}

class LostAcknowledgementStore implements DurableRunStore {
  private loseNextAcknowledgement = true

  constructor(private readonly delegate: DurableRunStore) {}

  get(id: string): Promise<StoredResumeAgentRun | undefined> {
    return this.delegate.get(id)
  }

  create(run: StoredResumeAgentRun): Promise<boolean> {
    return this.delegate.create(run)
  }

  compareAndSet(run: StoredResumeAgentRun): Promise<boolean> {
    return this.delegate.compareAndSet(run)
  }

  createWithTask(run: StoredResumeAgentRun, task: RunTask): Promise<boolean> {
    return this.delegate.createWithTask(run, task)
  }

  compareAndSetWithTask(
    run: StoredResumeAgentRun,
    task: RunTask
  ): Promise<boolean> {
    return this.delegate.compareAndSetWithTask(run, task)
  }

  claimNextTask(
    options: ClaimRunTaskOptions
  ): Promise<ClaimedRunTask | undefined> {
    return this.delegate.claimNextTask(options)
  }

  async acknowledgeTask(taskId: string, leaseOwner: string): Promise<boolean> {
    if (this.loseNextAcknowledgement) {
      this.loseNextAcknowledgement = false
      return false
    }
    return this.delegate.acknowledgeTask(taskId, leaseOwner)
  }

  releaseTask(taskId: string, leaseOwner: string): Promise<boolean> {
    return this.delegate.releaseTask(taskId, leaseOwner)
  }
}

afterEach(async () => {
  for (const store of stores.splice(0).reverse()) store.close()
  for (const directory of temporaryDirectories.splice(0).reverse()) {
    await rm(directory, { recursive: true, force: true })
  }
})

describe('SqliteRunStore', () => {
  it('migrates schema v1 to the outbox schema without losing runs', async () => {
    const databasePath = await temporaryDatabasePath()
    const { DatabaseSync } = await import('node:sqlite')
    const legacyDatabase = new DatabaseSync(databasePath)
    const run = storedRun('run-schema-v1')
    try {
      legacyDatabase.exec(`
        CREATE TABLE resume_agent_runs (
          id TEXT PRIMARY KEY,
          revision INTEGER NOT NULL CHECK (revision >= 0),
          record_json TEXT NOT NULL CHECK (json_valid(record_json))
        ) STRICT;
        PRAGMA user_version = 1;
      `)
      legacyDatabase
        .prepare(
          `INSERT INTO resume_agent_runs (id, revision, record_json)
           VALUES (?, ?, ?)`
        )
        .run(run.snapshot.id, run.revision, JSON.stringify(run))
    } finally {
      legacyDatabase.close()
    }

    const store = await openStore(databasePath)
    expect(await store.get(run.snapshot.id)).toEqual(run)
    store.close()

    const migratedDatabase = new DatabaseSync(databasePath)
    try {
      expect(
        migratedDatabase.prepare('PRAGMA user_version').get()
      ).toMatchObject({ user_version: 2 })
      expect(
        migratedDatabase
          .prepare(
            `SELECT name FROM sqlite_master
             WHERE type = 'table' AND name = 'resume_agent_tasks'`
          )
          .get()
      ).toEqual({ name: 'resume_agent_tasks' })
    } finally {
      migratedDatabase.close()
    }
  })

  it('atomically creates a run and exactly one outbox task', async () => {
    const databasePath = await temporaryDatabasePath()
    const store = await openStore(databasePath)
    const run = storedRun('run-create-with-task')

    expect(await store.createWithTask(run, runTask(run.snapshot.id))).toBe(true)
    expect(
      await store.createWithTask(
        { ...run, snapshot: { ...run.snapshot, status: 'failed' } },
        runTask(run.snapshot.id, `${run.snapshot.id}:duplicate`)
      )
    ).toBe(false)
    expect(await store.get(run.snapshot.id)).toEqual(run)
    store.close()

    const { DatabaseSync } = await import('node:sqlite')
    const database = new DatabaseSync(databasePath)
    try {
      expect(
        database
          .prepare(
            'SELECT id, run_id, kind FROM resume_agent_tasks ORDER BY id'
          )
          .all()
      ).toEqual([
        {
          id: `${run.snapshot.id}:prepare:0`,
          run_id: run.snapshot.id,
          kind: 'prepare',
        },
      ])
    } finally {
      database.close()
    }
  })

  it('atomically compare-and-sets a run and its outbox task', async () => {
    const databasePath = await temporaryDatabasePath()
    const store = await openStore(databasePath)
    const stale = storedRun('run-cas-with-task')
    await store.create(stale)
    const winner = {
      ...stale,
      snapshot: { ...stale.snapshot, status: 'analyzing_jd' as const },
    }

    expect(
      await store.compareAndSetWithTask(
        winner,
        runTask(
          stale.snapshot.id,
          `${stale.snapshot.id}:complete:1`,
          'complete'
        )
      )
    ).toBe(true)
    expect(
      await store.compareAndSetWithTask(
        { ...stale, snapshot: { ...stale.snapshot, status: 'failed' } },
        runTask(stale.snapshot.id, `${stale.snapshot.id}:stale-task`)
      )
    ).toBe(false)
    expect(await store.get(stale.snapshot.id)).toEqual({
      ...winner,
      revision: 1,
    })
    store.close()

    const { DatabaseSync } = await import('node:sqlite')
    const database = new DatabaseSync(databasePath)
    try {
      expect(
        database.prepare('SELECT id FROM resume_agent_tasks ORDER BY id').all()
      ).toEqual([{ id: `${stale.snapshot.id}:complete:1` }])
    } finally {
      database.close()
    }
  })

  it('rolls back the run mutation when its task insert fails', async () => {
    const store = await openStore(await temporaryDatabasePath())
    const firstRun = storedRun('run-task-collision-a')
    const sharedTaskId = 'shared-task-id'
    await store.createWithTask(
      firstRun,
      runTask(firstRun.snapshot.id, sharedTaskId)
    )
    const secondRun = storedRun('run-task-collision-b')

    await expect(
      store.createWithTask(
        secondRun,
        runTask(secondRun.snapshot.id, sharedTaskId)
      )
    ).rejects.toMatchObject({ code: 'storage_failed' })
    expect(await store.get(secondRun.snapshot.id)).toBeUndefined()

    await expect(
      store.compareAndSetWithTask(
        {
          ...firstRun,
          snapshot: { ...firstRun.snapshot, status: 'ingesting_inputs' },
        },
        runTask(firstRun.snapshot.id, sharedTaskId)
      )
    ).rejects.toMatchObject({ code: 'storage_failed' })
    expect(await store.get(firstRun.snapshot.id)).toEqual(firstRun)
  })

  it('leases a task to only one of two competing connections', async () => {
    const databasePath = await temporaryDatabasePath()
    const firstStore = await openStore(databasePath)
    const secondStore = await openStore(databasePath)
    const run = storedRun('run-claim-race')
    const task = runTask(run.snapshot.id)
    await firstStore.createWithTask(run, task)
    const claimOptions = {
      workerId: 'worker-a',
      now: new Date('2026-09-16T12:00:00.000Z'),
      leaseDurationMs: 30_000,
    }

    const [firstClaim, secondClaim] = await Promise.all([
      firstStore.claimNextTask(claimOptions),
      secondStore.claimNextTask({ ...claimOptions, workerId: 'worker-b' }),
    ])
    const claims = [firstClaim, secondClaim].filter(
      (claim) => claim !== undefined
    )

    expect(claims).toEqual([
      {
        ...task,
        attempt: 1,
        leaseOwner: expect.stringMatching(/^worker-[ab]$/),
        leaseExpiresAt: '2026-09-16T12:00:30.000Z',
      },
    ])
  })

  it('requires the lease owner to ack or release and supports expiry takeover', async () => {
    const store = await openStore(await temporaryDatabasePath())
    const run = storedRun('run-lease-lifecycle')
    await store.createWithTask(run, runTask(run.snapshot.id))
    const firstClaim = await store.claimNextTask({
      workerId: 'worker-a',
      now: new Date('2026-09-16T12:00:00.000Z'),
      leaseDurationMs: 30_000,
    })
    if (!firstClaim) throw new Error('Expected claimed task')

    expect(await store.acknowledgeTask(firstClaim.id, 'worker-b')).toBe(false)
    expect(await store.releaseTask(firstClaim.id, 'worker-b')).toBe(false)
    expect(
      await store.claimNextTask({
        workerId: 'worker-b',
        now: new Date('2026-09-16T12:00:29.999Z'),
        leaseDurationMs: 30_000,
      })
    ).toBeUndefined()

    const takeover = await store.claimNextTask({
      workerId: 'worker-b',
      now: new Date('2026-09-16T12:00:30.000Z'),
      leaseDurationMs: 30_000,
    })
    expect(takeover).toMatchObject({
      id: firstClaim.id,
      attempt: 2,
      leaseOwner: 'worker-b',
    })
    expect(await store.acknowledgeTask(firstClaim.id, 'worker-a')).toBe(false)
    expect(await store.releaseTask(firstClaim.id, 'worker-a')).toBe(false)
    expect(await store.releaseTask(firstClaim.id, 'worker-b')).toBe(true)

    const released = await store.claimNextTask({
      workerId: 'worker-c',
      now: new Date('2026-09-16T12:00:30.000Z'),
      leaseDurationMs: 30_000,
    })
    expect(released).toMatchObject({ attempt: 3, leaseOwner: 'worker-c' })
    expect(await store.acknowledgeTask(firstClaim.id, 'worker-c')).toBe(true)
    expect(
      await store.claimNextTask({
        workerId: 'worker-d',
        now: new Date('2026-09-16T12:01:00.000Z'),
        leaseDurationMs: 30_000,
      })
    ).toBeUndefined()
  })

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

  it('recovers a committed start task when the original schedule hint is lost', async () => {
    const databasePath = await temporaryDatabasePath()
    const originalTasks: Array<() => Promise<void>> = []
    const originalStore = await openStore(databasePath)
    const originalService = new ResumeAgentRunService(completingAgent(), {
      store: originalStore,
      idFactory: () => 'run-recover-start',
      now: () => new Date('2026-09-16T12:00:00.000Z'),
      schedule: (task) => originalTasks.push(task),
    })
    await originalService.start({
      jobDescription: 'We need a TypeScript Engineer for reliable systems.',
      candidate: { resume: completeCandidate },
    })
    expect(originalTasks).toHaveLength(1)
    originalStore.close()

    const recoveredTasks: Array<() => Promise<void>> = []
    const recoveredStore = await openStore(databasePath)
    const recoveredService = new ResumeAgentRunService(completingAgent(), {
      store: recoveredStore,
      now: () => new Date('2026-09-16T12:01:00.000Z'),
      schedule: (task) => recoveredTasks.push(task),
    })
    expect(await recoveredService.recoverPendingTasks()).toBe(1)
    expect(recoveredTasks).toHaveLength(1)

    await recoveredTasks[0]?.()

    expect((await recoveredService.get('run-recover-start'))?.status).toBe(
      'completed'
    )
    expect(await recoveredService.recoverPendingTasks()).toBe(0)
  })

  it('recovers completion after an answered run loses its schedule hint', async () => {
    const databasePath = await temporaryDatabasePath()
    const originalTasks: Array<() => Promise<void>> = []
    const originalStore = await openStore(databasePath)
    const originalService = new ResumeAgentRunService(questionAgent(), {
      store: originalStore,
      idFactory: () => 'run-recover-answer',
      now: () => new Date('2026-09-16T12:00:00.000Z'),
      schedule: (task) => originalTasks.push(task),
    })
    await originalService.start({
      jobDescription: 'We need a TypeScript Engineer for reliable systems.',
      candidate: {
        resume: completeCandidate,
        files: [
          {
            id: 'candidate-source',
            filename: 'candidate.txt',
            text: 'Candidate profile whose name must be confirmed.',
          },
        ],
      },
    })
    await originalTasks[0]?.()
    expect((await originalService.get('run-recover-answer'))?.status).toBe(
      'needs_input'
    )

    const accepted = await originalService.answer('run-recover-answer', {
      interactionId: 'candidate-normalization:1',
      idempotencyKey: 'durable-answer-1',
      value: 'Grace Hopper',
    })
    expect(accepted.status).toBe('analyzing_jd')
    expect(originalTasks).toHaveLength(2)
    originalStore.close()

    const recoveredTasks: Array<() => Promise<void>> = []
    const recoveredStore = await openStore(databasePath)
    const recoveredService = new ResumeAgentRunService(
      completingAgent('Grace Hopper'),
      {
        store: recoveredStore,
        now: () => new Date('2026-09-16T12:01:00.000Z'),
        schedule: (task) => recoveredTasks.push(task),
      }
    )
    expect(await recoveredService.recoverPendingTasks()).toBe(1)
    expect(recoveredTasks).toHaveLength(1)

    await recoveredTasks[0]?.()

    expect((await recoveredService.get('run-recover-answer'))?.status).toBe(
      'completed'
    )
    expect(
      (await recoveredStore.get('run-recover-answer'))?.answerReceipts
    ).toHaveLength(1)
    expect(await recoveredService.recoverPendingTasks()).toBe(0)
  })

  it('lets only one of two services drain and execute a pending task', async () => {
    const databasePath = await temporaryDatabasePath()
    const originalStore = await openStore(databasePath)
    const originalService = new ResumeAgentRunService(completingAgent(), {
      store: originalStore,
      idFactory: () => 'run-two-workers',
      now: () => new Date('2026-09-16T12:00:00.000Z'),
      schedule: () => undefined,
    })
    await originalService.start({
      jobDescription: 'We need a TypeScript Engineer for reliable systems.',
      candidate: { resume: completeCandidate },
    })
    originalStore.close()

    const firstTasks: Array<() => Promise<void>> = []
    const secondTasks: Array<() => Promise<void>> = []
    const firstStore = await openStore(databasePath)
    const secondStore = await openStore(databasePath)
    const firstService = new ResumeAgentRunService(completingAgent(), {
      store: firstStore,
      workerId: 'worker-first',
      now: () => new Date('2026-09-16T12:01:00.000Z'),
      schedule: (task) => firstTasks.push(task),
    })
    const secondService = new ResumeAgentRunService(completingAgent(), {
      store: secondStore,
      workerId: 'worker-second',
      now: () => new Date('2026-09-16T12:01:00.000Z'),
      schedule: (task) => secondTasks.push(task),
    })

    const recovered = await Promise.all([
      firstService.recoverPendingTasks(),
      secondService.recoverPendingTasks(),
    ])
    expect(recovered.sort()).toEqual([0, 1])
    expect([...firstTasks, ...secondTasks]).toHaveLength(1)

    await [...firstTasks, ...secondTasks][0]?.()

    expect((await firstService.get('run-two-workers'))?.status).toBe(
      'completed'
    )
    expect(await firstService.recoverPendingTasks()).toBe(0)
    expect(await secondService.recoverPendingTasks()).toBe(0)
  })

  it('acks an expired replay without rerunning a terminal workflow', async () => {
    const databasePath = await temporaryDatabasePath()
    const originalTasks: Array<() => Promise<void>> = []
    const originalStore = await openStore(databasePath)
    const service = new ResumeAgentRunService(completingAgent(), {
      store: new LostAcknowledgementStore(originalStore),
      idFactory: () => 'run-terminal-replay',
      workerId: 'worker-before-crash',
      taskLeaseMs: 1_000,
      now: () => new Date('2026-09-16T12:00:00.000Z'),
      schedule: (task) => originalTasks.push(task),
    })
    await service.start({
      jobDescription: 'We need a TypeScript Engineer for reliable systems.',
      candidate: { resume: completeCandidate },
    })
    await originalTasks[0]?.()
    expect((await service.get('run-terminal-replay'))?.status).toBe('completed')
    originalStore.close()

    const replayCalls = { count: 0 }
    const replayTasks: Array<() => Promise<void>> = []
    const replayStore = await openStore(databasePath)
    const replayService = new ResumeAgentRunService(
      countingFailAgent(replayCalls),
      {
        store: replayStore,
        workerId: 'worker-after-crash',
        taskLeaseMs: 1_000,
        now: () => new Date('2026-09-16T12:00:01.000Z'),
        schedule: (task) => replayTasks.push(task),
      }
    )
    expect(await replayService.recoverPendingTasks()).toBe(1)
    await replayTasks[0]?.()

    expect(replayCalls.count).toBe(0)
    expect((await replayService.get('run-terminal-replay'))?.status).toBe(
      'completed'
    )
    expect(await replayService.recoverPendingTasks()).toBe(0)
  })
})
