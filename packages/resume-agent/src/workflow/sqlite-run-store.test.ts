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

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { LlmClient } from '@/contracts'
import { LlmRequestError } from '@/llm/openai-compatible'
import { renderOdtDocument } from '@/rendering/odt'
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

function completingAgent(
  name = 'Ada Lovelace',
  calls?: { count: number }
): ResumeTailoringAgent {
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
      if (calls) calls.count += 1
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

  constructor(protected readonly delegate: DurableRunStore) {}

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

  compareAndSetForTask(
    ...args: Parameters<DurableRunStore['compareAndSetForTask']>
  ): ReturnType<DurableRunStore['compareAndSetForTask']> {
    return this.delegate.compareAndSetForTask(...args)
  }

  claimNextTask(
    options: ClaimRunTaskOptions
  ): Promise<ClaimedRunTask | undefined> {
    return this.delegate.claimNextTask(options)
  }

  async acknowledgeTask(
    taskId: string,
    leaseOwner: string,
    attempt: number
  ): Promise<boolean> {
    if (this.loseNextAcknowledgement) {
      this.loseNextAcknowledgement = false
      return false
    }
    return this.delegate.acknowledgeTask(taskId, leaseOwner, attempt)
  }

  releaseTask(
    ...args: Parameters<DurableRunStore['releaseTask']>
  ): ReturnType<DurableRunStore['releaseTask']> {
    return this.delegate.releaseTask(...args)
  }

  renewTaskLease(
    options: Parameters<DurableRunStore['renewTaskLease']>[0]
  ): ReturnType<DurableRunStore['renewTaskLease']> {
    return this.delegate.renewTaskLease(options)
  }
}

class FailedAcknowledgementStore extends LostAcknowledgementStore {
  override acknowledgeTask(): Promise<boolean> {
    return Promise.reject(new Error('Synthetic acknowledgement failure'))
  }
}

class FailedHeartbeatStore extends LostAcknowledgementStore {
  renewalCalls = 0
  acknowledgementCalls = 0
  releaseCalls = 0

  override renewTaskLease(
    options: Parameters<DurableRunStore['renewTaskLease']>[0]
  ): ReturnType<DurableRunStore['renewTaskLease']> {
    this.renewalCalls += 1
    if (this.renewalCalls === 2) return Promise.resolve(undefined)
    return this.delegate.renewTaskLease(options)
  }

  override acknowledgeTask(
    taskId: string,
    leaseOwner: string,
    attempt: number
  ): Promise<boolean> {
    this.acknowledgementCalls += 1
    return this.delegate.acknowledgeTask(taskId, leaseOwner, attempt)
  }

  override releaseTask(
    taskId: string,
    leaseOwner: string,
    attempt: number
  ): Promise<boolean> {
    this.releaseCalls += 1
    return this.delegate.releaseTask(taskId, leaseOwner, attempt)
  }
}

class DeferredHeartbeatStore extends LostAcknowledgementStore {
  renewalCalls = 0
  releaseRenewal: (() => void) | undefined

  override renewTaskLease(
    options: Parameters<DurableRunStore['renewTaskLease']>[0]
  ): ReturnType<DurableRunStore['renewTaskLease']> {
    this.renewalCalls += 1
    const renewal = this.delegate.renewTaskLease(options)
    if (this.renewalCalls !== 2) return renewal
    return new Promise((resolve, reject) => {
      void renewal.then((value) => {
        this.releaseRenewal = () => resolve(value)
      }, reject)
    })
  }

  override acknowledgeTask(
    taskId: string,
    leaseOwner: string,
    attempt: number
  ): Promise<boolean> {
    return this.delegate.acknowledgeTask(taskId, leaseOwner, attempt)
  }
}

class RevisionConflictStore extends LostAcknowledgementStore {
  fencedCompareAndSets = 0

  override compareAndSetForTask(
    ...args: Parameters<DurableRunStore['compareAndSetForTask']>
  ): ReturnType<DurableRunStore['compareAndSetForTask']> {
    this.fencedCompareAndSets += 1
    if (this.fencedCompareAndSets === 1) {
      return Promise.resolve('revision_conflict')
    }
    return this.delegate.compareAndSetForTask(...args)
  }

  override acknowledgeTask(
    taskId: string,
    leaseOwner: string,
    attempt: number
  ): Promise<boolean> {
    return this.delegate.acknowledgeTask(taskId, leaseOwner, attempt)
  }
}

class ErroredHeartbeatStore extends LostAcknowledgementStore {
  renewalCalls = 0

  constructor(
    delegate: DurableRunStore,
    private readonly privateErrorMarker: string
  ) {
    super(delegate)
  }

  override renewTaskLease(
    options: Parameters<DurableRunStore['renewTaskLease']>[0]
  ): ReturnType<DurableRunStore['renewTaskLease']> {
    this.renewalCalls += 1
    if (this.renewalCalls === 2) {
      return Promise.reject(new Error(this.privateErrorMarker))
    }
    return this.delegate.renewTaskLease(options)
  }

  override acknowledgeTask(
    taskId: string,
    leaseOwner: string,
    attempt: number
  ): Promise<boolean> {
    return this.delegate.acknowledgeTask(taskId, leaseOwner, attempt)
  }
}

afterEach(async () => {
  vi.useRealTimers()
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

  it('atomically fences run compare-and-set with the current claim', async () => {
    const store = await openStore(await temporaryDatabasePath())
    const run = storedRun('run-task-fenced-cas')
    await store.createWithTask(run, runTask(run.snapshot.id))
    const firstClaim = await store.claimNextTask({
      workerId: 'worker-before-takeover',
      now: new Date('2026-09-16T12:00:00.000Z'),
      leaseDurationMs: 30_000,
    })
    if (!firstClaim) throw new Error('Expected first claim')

    expect(
      await store.compareAndSetForTask(
        {
          ...run,
          snapshot: { ...run.snapshot, status: 'ingesting_inputs' },
        },
        firstClaim,
        new Date('2026-09-16T12:00:10.000Z')
      )
    ).toBe('updated')
    expect(
      await store.compareAndSetForTask(
        { ...run, snapshot: { ...run.snapshot, status: 'failed' } },
        firstClaim,
        new Date('2026-09-16T12:00:10.000Z')
      )
    ).toBe('revision_conflict')

    const takeover = await store.claimNextTask({
      workerId: 'worker-after-takeover',
      now: new Date('2026-09-16T12:00:30.000Z'),
      leaseDurationMs: 30_000,
    })
    if (!takeover) throw new Error('Expected takeover claim')
    const current = await store.get(run.snapshot.id)
    if (!current) throw new Error('Expected current run')
    expect(
      await store.compareAndSetForTask(
        { ...current, snapshot: { ...current.snapshot, status: 'failed' } },
        firstClaim,
        new Date('2026-09-16T12:00:30.000Z')
      )
    ).toBe('lease_lost')
    expect((await store.get(run.snapshot.id))?.snapshot.status).toBe(
      'ingesting_inputs'
    )
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

  it('leases at most one task for the same run at a time', async () => {
    const databasePath = await temporaryDatabasePath()
    const firstStore = await openStore(databasePath)
    const secondStore = await openStore(databasePath)
    const run = storedRun('run-claim-serial')
    await firstStore.createWithTask(run, runTask(run.snapshot.id))
    await firstStore.compareAndSetWithTask(
      { ...run, snapshot: { ...run.snapshot, status: 'analyzing_jd' } },
      runTask(run.snapshot.id, `${run.snapshot.id}:complete:1`, 'complete')
    )
    const now = new Date('2026-09-16T12:00:00.000Z')

    const claims = await Promise.all([
      firstStore.claimNextTask({
        workerId: 'worker-a',
        now,
        leaseDurationMs: 30_000,
      }),
      secondStore.claimNextTask({
        workerId: 'worker-b',
        now,
        leaseDurationMs: 30_000,
      }),
    ])
    const claimed = claims.filter(
      (task): task is ClaimedRunTask => task !== undefined
    )

    expect(claimed).toHaveLength(1)
    expect(
      await firstStore.acknowledgeTask(
        claimed[0]?.id ?? '',
        claimed[0]?.leaseOwner ?? '',
        claimed[0]?.attempt ?? 0
      )
    ).toBe(true)
    expect(
      await secondStore.claimNextTask({
        workerId: 'worker-c',
        now,
        leaseDurationMs: 30_000,
      })
    ).toMatchObject({ runId: run.snapshot.id, leaseOwner: 'worker-c' })
  })

  it('rejects an old claim generation after the same worker reclaims a task', async () => {
    const store = await openStore(await temporaryDatabasePath())
    const run = storedRun('run-same-worker-generation')
    await store.createWithTask(run, runTask(run.snapshot.id))
    const firstClaim = await store.claimNextTask({
      workerId: 'stable-worker-id',
      now: new Date('2026-09-16T12:00:00.000Z'),
      leaseDurationMs: 30_000,
    })
    const secondClaim = await store.claimNextTask({
      workerId: 'stable-worker-id',
      now: new Date('2026-09-16T12:00:30.000Z'),
      leaseDurationMs: 30_000,
    })
    if (!firstClaim || !secondClaim) throw new Error('Expected both claims')

    expect(secondClaim.attempt).toBe(firstClaim.attempt + 1)
    expect(
      await store.renewTaskLease({
        id: firstClaim.id,
        runId: firstClaim.runId,
        leaseOwner: firstClaim.leaseOwner,
        attempt: firstClaim.attempt,
        now: new Date('2026-09-16T12:00:30.000Z'),
        leaseDurationMs: 30_000,
      })
    ).toBeUndefined()
    expect(
      await store.acknowledgeTask(
        firstClaim.id,
        firstClaim.leaseOwner,
        firstClaim.attempt
      )
    ).toBe(false)
    expect(
      await store.releaseTask(
        firstClaim.id,
        firstClaim.leaseOwner,
        firstClaim.attempt
      )
    ).toBe(false)
    expect(
      await store.acknowledgeTask(
        secondClaim.id,
        secondClaim.leaseOwner,
        secondClaim.attempt
      )
    ).toBe(true)
  })

  it('renews the current unexpired claim without shortening its lease', async () => {
    const store = await openStore(await temporaryDatabasePath())
    const run = storedRun('run-renew-current-claim')
    await store.createWithTask(run, runTask(run.snapshot.id))
    const claim = await store.claimNextTask({
      workerId: 'renewing-worker',
      now: new Date('2026-09-16T12:00:00.000Z'),
      leaseDurationMs: 30_000,
    })
    if (!claim) throw new Error('Expected claimed task')

    const renewed = await store.renewTaskLease({
      id: claim.id,
      runId: claim.runId,
      leaseOwner: claim.leaseOwner,
      attempt: claim.attempt,
      now: new Date('2026-09-16T12:00:20.000Z'),
      leaseDurationMs: 30_000,
    })

    expect(renewed).toEqual({
      ...claim,
      leaseExpiresAt: '2026-09-16T12:00:50.000Z',
    })
    expect(
      await store.claimNextTask({
        workerId: 'waiting-worker',
        now: new Date('2026-09-16T12:00:30.000Z'),
        leaseDurationMs: 30_000,
      })
    ).toBeUndefined()
  })

  it('renews only the exact current generation before its expiry', async () => {
    const store = await openStore(await temporaryDatabasePath())
    const currentRun = storedRun('run-renew-identity')
    await store.createWithTask(currentRun, runTask(currentRun.snapshot.id))
    const currentClaim = await store.claimNextTask({
      workerId: 'current-worker',
      now: new Date('2026-09-16T12:00:00.000Z'),
      leaseDurationMs: 30_000,
    })
    if (!currentClaim) throw new Error('Expected current claim')
    const renewal = {
      id: currentClaim.id,
      runId: currentClaim.runId,
      leaseOwner: currentClaim.leaseOwner,
      attempt: currentClaim.attempt,
      now: new Date('2026-09-16T12:00:29.999Z'),
      leaseDurationMs: 30_000,
    }

    await expect(
      store.renewTaskLease({ ...renewal, id: 'missing-task' })
    ).resolves.toBeUndefined()
    await expect(
      store.renewTaskLease({ ...renewal, runId: 'wrong-run' })
    ).resolves.toBeUndefined()
    await expect(
      store.renewTaskLease({ ...renewal, leaseOwner: 'old-worker' })
    ).resolves.toBeUndefined()
    await expect(
      store.renewTaskLease({ ...renewal, attempt: currentClaim.attempt + 1 })
    ).resolves.toBeUndefined()
    await expect(store.renewTaskLease(renewal)).resolves.toMatchObject({
      leaseExpiresAt: '2026-09-16T12:00:59.999Z',
    })

    const expiredRun = storedRun('run-renew-expired')
    await store.createWithTask(expiredRun, runTask(expiredRun.snapshot.id))
    const expiredClaim = await store.claimNextTask({
      workerId: 'expired-worker',
      now: new Date('2026-09-16T12:00:00.000Z'),
      leaseDurationMs: 30_000,
    })
    if (!expiredClaim) throw new Error('Expected expiring claim')
    expect(
      await store.renewTaskLease({
        id: expiredClaim.id,
        runId: expiredClaim.runId,
        leaseOwner: expiredClaim.leaseOwner,
        attempt: expiredClaim.attempt,
        now: new Date('2026-09-16T12:00:30.000Z'),
        leaseDurationMs: 30_000,
      })
    ).toBeUndefined()
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

    expect(
      await store.acknowledgeTask(firstClaim.id, 'worker-b', firstClaim.attempt)
    ).toBe(false)
    expect(
      await store.releaseTask(firstClaim.id, 'worker-b', firstClaim.attempt)
    ).toBe(false)
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
    expect(
      await store.acknowledgeTask(firstClaim.id, 'worker-a', firstClaim.attempt)
    ).toBe(false)
    expect(
      await store.releaseTask(firstClaim.id, 'worker-a', firstClaim.attempt)
    ).toBe(false)
    expect(
      await store.releaseTask(firstClaim.id, 'worker-b', takeover?.attempt ?? 0)
    ).toBe(true)

    const released = await store.claimNextTask({
      workerId: 'worker-c',
      now: new Date('2026-09-16T12:00:30.000Z'),
      leaseDurationMs: 30_000,
    })
    expect(released).toMatchObject({ attempt: 3, leaseOwner: 'worker-c' })
    expect(
      await store.acknowledgeTask(
        firstClaim.id,
        'worker-c',
        released?.attempt ?? 0
      )
    ).toBe(true)
    expect(
      await store.claimNextTask({
        workerId: 'worker-d',
        now: new Date('2026-09-16T12:01:00.000Z'),
        leaseDurationMs: 30_000,
      })
    ).toBeUndefined()
  })

  it('persists a delayed release and honors its exact availability time', async () => {
    const databasePath = await temporaryDatabasePath()
    const store = await openStore(databasePath)
    const run = storedRun('run-delayed-release')
    const claimedAt = new Date('2026-09-24T12:00:00.000Z')
    const availableAt = new Date('2026-09-24T12:00:01.000Z')
    await store.createWithTask(run, runTask(run.snapshot.id))
    const firstClaim = await store.claimNextTask({
      workerId: 'worker-before-backoff',
      now: claimedAt,
      leaseDurationMs: 30_000,
    })
    if (!firstClaim) throw new Error('Expected claimed task')

    await expect(
      store.releaseTask(
        firstClaim.id,
        firstClaim.leaseOwner,
        firstClaim.attempt,
        new Date(Number.NaN)
      )
    ).rejects.toMatchObject({ code: 'invalid_task' })
    expect(
      await store.releaseTask(
        firstClaim.id,
        firstClaim.leaseOwner,
        firstClaim.attempt,
        availableAt
      )
    ).toBe(true)
    await expect(
      store.claimNextTask({
        workerId: 'worker-too-early',
        now: new Date('2026-09-24T12:00:00.999Z'),
        leaseDurationMs: 30_000,
      })
    ).resolves.toBeUndefined()

    store.close()
    const reopened = await openStore(databasePath)
    await expect(
      reopened.claimNextTask({
        workerId: 'worker-at-boundary',
        now: availableAt,
        leaseDurationMs: 30_000,
      })
    ).resolves.toMatchObject({
      id: firstClaim.id,
      attempt: 2,
      leaseOwner: 'worker-at-boundary',
    })
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

  it('extracts a persisted ODT job after restart recovery', async () => {
    const databasePath = await temporaryDatabasePath()
    const originalStore = await openStore(databasePath)
    const originalService = new ResumeAgentRunService(unusedAgent(), {
      store: originalStore,
      idFactory: () => 'run-recover-odt-job',
      now: () => new Date('2026-09-16T12:00:00.000Z'),
      schedule: () => undefined,
    })
    const jobOdt = renderOdtDocument({
      title: 'Recovered Platform Engineer Role',
      headline: '',
      contacts: [],
      summaryHeading: 'Requirements',
      summary: ['Build reliable TypeScript systems after restart.'],
      sections: [],
    })
    await originalService.start({
      jobFiles: [
        {
          filename: 'role.odt',
          contentBase64: jobOdt.toString('base64'),
        },
      ],
      candidate: { resume: completeCandidate },
    })
    originalStore.close()

    const requests: string[] = []
    const responses = [
      {
        targetTitle: 'TypeScript Engineer',
        seniority: 'junior',
        summary: 'TypeScript engineer',
        requirements: [],
        keywords: [],
      },
      {
        resume: completeCandidate,
        selectedEvidenceIds: [],
        questions: [],
        notes: [],
      },
    ]
    const recoveredAgent = new ResumeTailoringAgent({
      async completeJson(request) {
        requests.push(request.user)
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
    })
    const recoveredTasks: Array<() => Promise<void>> = []
    const recoveredStore = await openStore(databasePath)
    const recoveredService = new ResumeAgentRunService(recoveredAgent, {
      store: recoveredStore,
      now: () => new Date('2026-09-16T12:01:00.000Z'),
      schedule: (task) => recoveredTasks.push(task),
    })

    expect(await recoveredService.recoverPendingTasks()).toBe(1)
    await recoveredTasks[0]?.()

    expect((await recoveredService.get('run-recover-odt-job'))?.status).toBe(
      'completed'
    )
    expect(requests[0]).toContain(
      'Build reliable TypeScript systems after restart.'
    )
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

  it('recomputes a worker mutation after a revision conflict', async () => {
    const store = await openStore(await temporaryDatabasePath())
    const conflictStore = new RevisionConflictStore(store)
    const scheduled: Array<() => Promise<void>> = []
    const service = new ResumeAgentRunService(completingAgent(), {
      store: conflictStore,
      idFactory: () => 'run-fenced-revision-conflict',
      schedule: (task) => scheduled.push(task),
    })

    await service.start({
      jobDescription: 'We need a TypeScript Engineer for reliable systems.',
      candidate: { resume: completeCandidate },
    })
    await scheduled[0]?.()

    expect(conflictStore.fencedCompareAndSets).toBeGreaterThan(1)
    expect((await service.get('run-fenced-revision-conflict'))?.status).toBe(
      'completed'
    )
    expect(await service.recoverPendingTasks()).toBe(0)
  })

  it('lets a second service take over when the first crashes before execution', async () => {
    const databasePath = await temporaryDatabasePath()
    const firstStore = await openStore(databasePath)
    const firstTasks: Array<() => Promise<void>> = []
    const firstService = new ResumeAgentRunService(completingAgent(), {
      store: firstStore,
      idFactory: () => 'run-crash-before-execution',
      workerId: 'worker-before-crash',
      taskLeaseMs: 1_000,
      now: () => new Date('2026-09-16T12:00:00.000Z'),
      schedule: (task) => firstTasks.push(task),
    })
    await firstService.start({
      jobDescription: 'We need a TypeScript Engineer for reliable systems.',
      candidate: { resume: completeCandidate },
    })
    firstTasks.splice(0)
    expect(await firstService.recoverPendingTasks()).toBe(1)
    expect(firstTasks).toHaveLength(1)
    firstStore.close()

    const takeoverTasks: Array<() => Promise<void>> = []
    const takeoverStore = await openStore(databasePath)
    const beforeExpiry = new ResumeAgentRunService(completingAgent(), {
      store: takeoverStore,
      workerId: 'worker-after-crash',
      taskLeaseMs: 1_000,
      now: () => new Date('2026-09-16T12:00:00.999Z'),
      schedule: (task) => takeoverTasks.push(task),
    })
    expect(await beforeExpiry.recoverPendingTasks()).toBe(0)

    const atExpiry = new ResumeAgentRunService(completingAgent(), {
      store: takeoverStore,
      workerId: 'worker-after-crash',
      taskLeaseMs: 1_000,
      now: () => new Date('2026-09-16T12:00:01.000Z'),
      schedule: (task) => takeoverTasks.push(task),
    })
    expect(await atExpiry.recoverPendingTasks()).toBe(1)
    await takeoverTasks[0]?.()

    expect((await atExpiry.get('run-crash-before-execution'))?.status).toBe(
      'completed'
    )
    expect(await atExpiry.recoverPendingTasks()).toBe(0)
  })

  it('keeps a deferred task leased across multiple original lease periods', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-16T12:00:00.000Z'))
    let resolveJobAnalysis: ((value: unknown) => void) | undefined
    let markProviderStarted: (() => void) | undefined
    const providerStarted = new Promise<void>((resolve) => {
      markProviderStarted = resolve
    })
    const pendingJobAnalysis = new Promise<unknown>((resolve) => {
      resolveJobAnalysis = resolve
    })
    let modelCalls = 0
    const llm: LlmClient = {
      async completeJson<T>() {
        modelCalls += 1
        if (modelCalls === 1) {
          markProviderStarted?.()
          return {
            data: (await pendingJobAnalysis) as T,
            metadata: {
              provider: 'fake',
              model: 'fake-model',
              durationMs: 1,
              attempt: 1,
            },
          }
        }
        return {
          data: {
            resume: completeCandidate,
            selectedEvidenceIds: [],
            questions: [],
            notes: [],
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
    const databasePath = await temporaryDatabasePath()
    const workerStore = await openStore(databasePath)
    const competingStore = await openStore(databasePath)
    const scheduled: Array<() => Promise<void>> = []
    const service = new ResumeAgentRunService(new ResumeTailoringAgent(llm), {
      store: workerStore,
      idFactory: () => 'run-heartbeat-long-task',
      workerId: 'heartbeat-worker',
      taskLeaseMs: 900,
      taskHeartbeatMs: 300,
      now: () => new Date(),
      schedule: (task) => scheduled.push(task),
    })
    let execution: Promise<void> | undefined
    try {
      await service.start({
        jobDescription: 'We need a TypeScript Engineer for reliable systems.',
        candidate: { resume: completeCandidate },
      })
      execution = scheduled[0]?.()
      await providerStarted

      for (let elapsed = 300; elapsed <= 2_700; elapsed += 300) {
        await vi.advanceTimersByTimeAsync(300)
        expect(
          await competingStore.claimNextTask({
            workerId: 'competing-worker',
            now: new Date(),
            leaseDurationMs: 900,
          })
        ).toBeUndefined()
      }

      resolveJobAnalysis?.({
        targetTitle: 'TypeScript Engineer',
        seniority: 'junior',
        summary: 'TypeScript engineer',
        requirements: [],
        keywords: [],
      })
      await execution
      expect((await service.get('run-heartbeat-long-task'))?.status).toBe(
        'completed'
      )
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      resolveJobAnalysis?.({
        targetTitle: 'TypeScript Engineer',
        seniority: 'junior',
        summary: 'TypeScript engineer',
        requirements: [],
        keywords: [],
      })
      await execution
      vi.useRealTimers()
    }
  })

  it('discards a deferred result after heartbeat loss and takeover', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-16T12:00:00.000Z'))
    let resolveJobAnalysis: ((value: unknown) => void) | undefined
    let markProviderStarted: (() => void) | undefined
    let providerSignal: AbortSignal | undefined
    let providerCancelled = false
    const providerStarted = new Promise<void>((resolve) => {
      markProviderStarted = resolve
    })
    const pendingJobAnalysis = new Promise<unknown>((resolve) => {
      resolveJobAnalysis = resolve
    })
    const llm: LlmClient = {
      async completeJson<T>(_request, options) {
        providerSignal = options?.signal
        providerSignal?.addEventListener(
          'abort',
          () => {
            providerCancelled = true
          },
          { once: true }
        )
        markProviderStarted?.()
        return {
          data: (await pendingJobAnalysis) as T,
          metadata: {
            provider: 'fake',
            model: 'fake-model',
            durationMs: 1,
            attempt: 1,
          },
        }
      },
    }
    const databasePath = await temporaryDatabasePath()
    const workerStore = await openStore(databasePath)
    const heartbeatStore = new FailedHeartbeatStore(workerStore)
    const competingStore = await openStore(databasePath)
    const scheduled: Array<() => Promise<void>> = []
    const service = new ResumeAgentRunService(new ResumeTailoringAgent(llm), {
      store: heartbeatStore,
      idFactory: () => 'run-heartbeat-lost-result',
      workerId: 'stale-heartbeat-worker',
      taskLeaseMs: 900,
      taskHeartbeatMs: 300,
      now: () => new Date(),
      schedule: (task) => scheduled.push(task),
    })
    let execution: Promise<void> | undefined
    try {
      await service.start({
        jobDescription: 'Private deferred job description marker.',
        candidate: { resume: completeCandidate },
      })
      execution = scheduled[0]?.()
      await providerStarted

      await vi.advanceTimersByTimeAsync(300)
      expect(heartbeatStore.renewalCalls).toBe(2)
      expect(providerSignal?.aborted).toBe(true)
      expect(providerCancelled).toBe(true)
      await vi.advanceTimersByTimeAsync(600)
      const takeover = await competingStore.claimNextTask({
        workerId: 'takeover-worker',
        now: new Date(),
        leaseDurationMs: 900,
      })
      expect(takeover).toMatchObject({ attempt: 2 })

      resolveJobAnalysis?.({
        targetTitle: 'TypeScript Engineer',
        seniority: 'junior',
        summary: 'TypeScript engineer',
        requirements: [],
        keywords: [],
      })
      await execution

      const stored = await workerStore.get('run-heartbeat-lost-result')
      expect(stored?.snapshot.status).toBe('analyzing_jd')
      expect(stored?.snapshot).not.toHaveProperty('result')
      expect(stored?.snapshot).not.toHaveProperty('error')
      expect(heartbeatStore.acknowledgementCalls).toBe(0)
      expect(heartbeatStore.releaseCalls).toBe(0)
      expect(vi.getTimerCount()).toBe(0)
      expect(
        await competingStore.acknowledgeTask(
          takeover?.id ?? '',
          takeover?.leaseOwner ?? '',
          takeover?.attempt ?? 0
        )
      ).toBe(true)
    } finally {
      resolveJobAnalysis?.({
        targetTitle: 'TypeScript Engineer',
        seniority: 'junior',
        summary: 'TypeScript engineer',
        requirements: [],
        keywords: [],
      })
      await execution
      vi.useRealTimers()
    }
  })

  it('treats a heartbeat storage error as data-safe lease loss', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-16T12:00:00.000Z'))
    const privateErrorMarker = 'PRIVATE_HEARTBEAT_STORAGE_ERROR_MARKER'
    let resolveJobAnalysis: ((value: unknown) => void) | undefined
    let markProviderStarted: (() => void) | undefined
    const providerStarted = new Promise<void>((resolve) => {
      markProviderStarted = resolve
    })
    const pendingJobAnalysis = new Promise<unknown>((resolve) => {
      resolveJobAnalysis = resolve
    })
    const llm: LlmClient = {
      async completeJson<T>() {
        markProviderStarted?.()
        return {
          data: (await pendingJobAnalysis) as T,
          metadata: {
            provider: 'fake',
            model: 'fake-model',
            durationMs: 1,
            attempt: 1,
          },
        }
      },
    }
    const store = await openStore(await temporaryDatabasePath())
    const heartbeatStore = new ErroredHeartbeatStore(store, privateErrorMarker)
    const scheduled: Array<() => Promise<void>> = []
    const service = new ResumeAgentRunService(new ResumeTailoringAgent(llm), {
      store: heartbeatStore,
      idFactory: () => 'run-heartbeat-storage-error',
      taskLeaseMs: 900,
      taskHeartbeatMs: 300,
      now: () => new Date(),
      schedule: (task) => scheduled.push(task),
    })
    let execution: Promise<void> | undefined
    try {
      await service.start({
        jobDescription: `Private JD ${privateErrorMarker}`,
        candidate: { resume: completeCandidate },
      })
      execution = scheduled[0]?.()
      await providerStarted
      await vi.advanceTimersByTimeAsync(300)
      expect(heartbeatStore.renewalCalls).toBe(2)

      resolveJobAnalysis?.({
        targetTitle: 'TypeScript Engineer',
        seniority: 'junior',
        summary: 'TypeScript engineer',
        requirements: [],
        keywords: [],
      })
      await execution
      const publicRun = await service.get('run-heartbeat-storage-error')
      expect(publicRun?.status).toBe('analyzing_jd')
      expect(publicRun).not.toHaveProperty('result')
      expect(publicRun).not.toHaveProperty('error')
      expect(JSON.stringify(publicRun)).not.toContain(privateErrorMarker)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      resolveJobAnalysis?.({
        targetTitle: 'TypeScript Engineer',
        seniority: 'junior',
        summary: 'TypeScript engineer',
        requirements: [],
        keywords: [],
      })
      await execution
      await service.close()
      vi.useRealTimers()
    }
  })

  it('clears heartbeat and fences a pending result when the service closes', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-16T12:00:00.000Z'))
    let resolveJobAnalysis: ((value: unknown) => void) | undefined
    let markProviderStarted: (() => void) | undefined
    let providerSignal: AbortSignal | undefined
    let providerCancelled = false
    const providerStarted = new Promise<void>((resolve) => {
      markProviderStarted = resolve
    })
    const pendingJobAnalysis = new Promise<unknown>((resolve) => {
      resolveJobAnalysis = resolve
    })
    const llm: LlmClient = {
      async completeJson<T>(_request, options) {
        providerSignal = options?.signal
        providerSignal?.addEventListener(
          'abort',
          () => {
            providerCancelled = true
          },
          { once: true }
        )
        markProviderStarted?.()
        return {
          data: (await pendingJobAnalysis) as T,
          metadata: {
            provider: 'fake',
            model: 'fake-model',
            durationMs: 1,
            attempt: 1,
          },
        }
      },
    }
    const databasePath = await temporaryDatabasePath()
    const workerStore = await openStore(databasePath)
    const competingStore = await openStore(databasePath)
    const scheduled: Array<() => Promise<void>> = []
    const service = new ResumeAgentRunService(new ResumeTailoringAgent(llm), {
      store: workerStore,
      idFactory: () => 'run-heartbeat-service-close',
      workerId: 'closing-worker',
      taskLeaseMs: 900,
      taskHeartbeatMs: 300,
      now: () => new Date(),
      schedule: (task) => scheduled.push(task),
    })
    let execution: Promise<void> | undefined
    try {
      await service.start({
        jobDescription: 'We need a TypeScript Engineer for reliable systems.',
        candidate: { resume: completeCandidate },
      })
      execution = scheduled[0]?.()
      await providerStarted
      expect(vi.getTimerCount()).toBe(1)
      expect(providerSignal?.aborted).toBe(false)

      await service.close()
      expect(vi.getTimerCount()).toBe(0)
      expect(providerSignal?.aborted).toBe(true)
      expect(providerCancelled).toBe(true)
      await vi.advanceTimersByTimeAsync(900)
      const takeover = await competingStore.claimNextTask({
        workerId: 'worker-after-close',
        now: new Date(),
        leaseDurationMs: 900,
      })
      expect(takeover).toMatchObject({ attempt: 2 })

      resolveJobAnalysis?.({
        targetTitle: 'TypeScript Engineer',
        seniority: 'junior',
        summary: 'TypeScript engineer',
        requirements: [],
        keywords: [],
      })
      await execution
      const stored = await workerStore.get('run-heartbeat-service-close')
      expect(stored?.snapshot.status).toBe('analyzing_jd')
      expect(stored?.snapshot).not.toHaveProperty('result')
      expect(stored?.snapshot).not.toHaveProperty('error')
    } finally {
      resolveJobAnalysis?.({
        targetTitle: 'TypeScript Engineer',
        seniority: 'junior',
        summary: 'TypeScript engineer',
        requirements: [],
        keywords: [],
      })
      await execution
      vi.useRealTimers()
    }
  })

  it('does not overlap renewal and waits for an in-flight renewal on close', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-16T12:00:00.000Z'))
    let resolveJobAnalysis: ((value: unknown) => void) | undefined
    let markProviderStarted: (() => void) | undefined
    const providerStarted = new Promise<void>((resolve) => {
      markProviderStarted = resolve
    })
    const pendingJobAnalysis = new Promise<unknown>((resolve) => {
      resolveJobAnalysis = resolve
    })
    const llm: LlmClient = {
      async completeJson<T>() {
        markProviderStarted?.()
        return {
          data: (await pendingJobAnalysis) as T,
          metadata: {
            provider: 'fake',
            model: 'fake-model',
            durationMs: 1,
            attempt: 1,
          },
        }
      },
    }
    const store = await openStore(await temporaryDatabasePath())
    const heartbeatStore = new DeferredHeartbeatStore(store)
    const scheduled: Array<() => Promise<void>> = []
    const service = new ResumeAgentRunService(new ResumeTailoringAgent(llm), {
      store: heartbeatStore,
      idFactory: () => 'run-heartbeat-in-flight-close',
      taskLeaseMs: 900,
      taskHeartbeatMs: 300,
      now: () => new Date(),
      schedule: (task) => scheduled.push(task),
    })
    let execution: Promise<void> | undefined
    try {
      await service.start({
        jobDescription: 'We need a TypeScript Engineer for reliable systems.',
        candidate: { resume: completeCandidate },
      })
      execution = scheduled[0]?.()
      await providerStarted

      await vi.advanceTimersByTimeAsync(300)
      expect(heartbeatStore.renewalCalls).toBe(2)
      await vi.advanceTimersByTimeAsync(600)
      expect(heartbeatStore.renewalCalls).toBe(2)

      let closeSettled = false
      const closing = service.close().then(() => {
        closeSettled = true
      })
      await Promise.resolve()
      expect(closeSettled).toBe(false)
      expect(vi.getTimerCount()).toBe(0)
      heartbeatStore.releaseRenewal?.()
      await closing
      expect(closeSettled).toBe(true)

      resolveJobAnalysis?.({
        targetTitle: 'TypeScript Engineer',
        seniority: 'junior',
        summary: 'TypeScript engineer',
        requirements: [],
        keywords: [],
      })
      await execution
      expect((await service.get('run-heartbeat-in-flight-close'))?.status).toBe(
        'analyzing_jd'
      )
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      heartbeatStore.releaseRenewal?.()
      resolveJobAnalysis?.({
        targetTitle: 'TypeScript Engineer',
        seniority: 'junior',
        summary: 'TypeScript engineer',
        requirements: [],
        keywords: [],
      })
      await execution
      await service.close()
      vi.useRealTimers()
    }
  })

  it('clears heartbeat after a provider failure is stored safely', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-16T12:00:00.000Z'))
    const privateErrorMarker = 'PRIVATE_PROVIDER_HEARTBEAT_ERROR_MARKER'
    const llm: LlmClient = {
      async completeJson() {
        throw new LlmRequestError(privateErrorMarker, {
          reason: 'http_status',
          retryable: false,
          status: 400,
        })
      },
    }
    const store = await openStore(await temporaryDatabasePath())
    const scheduled: Array<() => Promise<void>> = []
    const service = new ResumeAgentRunService(new ResumeTailoringAgent(llm), {
      store,
      idFactory: () => 'run-heartbeat-provider-error',
      taskLeaseMs: 900,
      taskHeartbeatMs: 300,
      now: () => new Date(),
      schedule: (task) => scheduled.push(task),
    })
    try {
      await service.start({
        jobDescription: 'Private job description.',
        candidate: { resume: completeCandidate },
      })
      await scheduled[0]?.()

      const failed = await service.get('run-heartbeat-provider-error')
      expect(failed).toMatchObject({
        status: 'failed',
        error: {
          code: 'agent_run_failed',
          message: 'The resume tailoring run failed.',
        },
      })
      expect(JSON.stringify(failed)).not.toContain(privateErrorMarker)
      expect(vi.getTimerCount()).toBe(0)
      expect(await service.recoverPendingTasks()).toBe(0)
    } finally {
      await service.close()
      vi.useRealTimers()
    }
  })

  it('resumes a retryable provider failure from persisted backoff after restart', async () => {
    const privateErrorMarker = 'PRIVATE_RETRYABLE_PROVIDER_ERROR_MARKER'
    const databasePath = await temporaryDatabasePath()
    const firstStore = await openStore(databasePath)
    const firstTasks: Array<() => Promise<void>> = []
    const responses = [
      {
        targetTitle: 'TypeScript Engineer',
        seniority: 'junior',
        summary: 'TypeScript engineer',
        requirements: [],
        keywords: [],
      },
      {
        resume: completeCandidate,
        selectedEvidenceIds: [],
        questions: [],
        notes: [],
      },
    ]
    let modelCalls = 0
    const llm: LlmClient = {
      async completeJson<T>() {
        modelCalls += 1
        if (modelCalls === 1) {
          throw new LlmRequestError(privateErrorMarker, {
            reason: 'network_error',
            retryable: true,
            retryAfterMs: 500,
          })
        }
        return {
          data: responses.shift() as T,
          metadata: {
            provider: 'fake',
            model: 'fake-model',
            durationMs: 1,
            attempt: 1,
          },
        }
      },
    }
    let now = new Date('2026-09-24T12:00:00.000Z')
    const firstService = new ResumeAgentRunService(
      new ResumeTailoringAgent(llm),
      {
        store: firstStore,
        idFactory: () => 'run-retryable-provider-restart',
        workerId: 'provider-worker-before-restart',
        taskLeaseMs: 10_000,
        now: () => now,
        schedule: (task) => firstTasks.push(task),
      }
    )

    await firstService.start({
      jobDescription: 'We need a TypeScript Engineer for reliable systems.',
      candidate: { resume: completeCandidate },
    })
    await firstTasks.shift()?.()

    const retrying = await firstService.get('run-retryable-provider-restart')
    expect(retrying?.status).toBe('analyzing_jd')
    expect(JSON.stringify(retrying)).not.toContain(privateErrorMarker)
    now = new Date('2026-09-24T12:00:00.999Z')
    expect(await firstService.recoverPendingTasks()).toBe(0)
    await firstService.close()
    firstStore.close()

    now = new Date('2026-09-24T12:00:01.000Z')
    const reopenedStore = await openStore(databasePath)
    const resumedTasks: Array<() => Promise<void>> = []
    const resumedService = new ResumeAgentRunService(
      new ResumeTailoringAgent(llm),
      {
        store: reopenedStore,
        workerId: 'provider-worker-after-restart',
        taskLeaseMs: 10_000,
        now: () => now,
        schedule: (task) => resumedTasks.push(task),
      }
    )
    expect(await resumedService.recoverPendingTasks()).toBe(1)
    await resumedTasks.shift()?.()

    expect(
      await resumedService.get('run-retryable-provider-restart')
    ).toMatchObject({ status: 'completed' })
    expect(modelCalls).toBe(3)
    expect(await resumedService.recoverPendingTasks()).toBe(0)
    await resumedService.close()
  })

  it('stops retrying when the next delivery would reach its elapsed deadline', async () => {
    const privateErrorMarker = 'PRIVATE_RETRY_DEADLINE_PROVIDER_MARKER'
    const store = await openStore(await temporaryDatabasePath())
    const scheduled: Array<() => Promise<void>> = []
    let modelCalls = 0
    const llm: LlmClient = {
      async completeJson() {
        modelCalls += 1
        throw new LlmRequestError(privateErrorMarker, {
          reason: 'http_status',
          retryable: true,
          status: 429,
          retryAfterMs: 5_000,
        })
      },
    }
    const service = new ResumeAgentRunService(new ResumeTailoringAgent(llm), {
      store,
      idFactory: () => 'run-retry-deadline-next-delivery',
      workerId: 'retry-deadline-worker',
      taskLeaseMs: 10_000,
      maxTaskRetryElapsedMs: 5_000,
      now: () => new Date('2026-09-24T12:00:00.000Z'),
      schedule: (task) => scheduled.push(task),
    })
    await service.start({
      jobDescription: 'We need a TypeScript Engineer for reliable systems.',
      candidate: { resume: completeCandidate },
    })
    await scheduled.shift()?.()

    const failed = await service.get('run-retry-deadline-next-delivery')
    expect(failed).toMatchObject({
      status: 'failed',
      error: {
        code: 'agent_task_retry_deadline_exceeded',
        message: 'The resume tailoring task exceeded its retry deadline.',
      },
    })
    expect(JSON.stringify(failed)).not.toContain(privateErrorMarker)
    expect(modelCalls).toBe(1)
    expect(await service.recoverPendingTasks()).toBe(0)
    await service.close()
  })

  it('keeps the retry deadline across restart and stops before another model call', async () => {
    const privateErrorMarker = 'PRIVATE_RESTARTED_RETRY_DEADLINE_MARKER'
    const databasePath = await temporaryDatabasePath()
    const firstStore = await openStore(databasePath)
    const firstTasks: Array<() => Promise<void>> = []
    let modelCalls = 0
    const llm: LlmClient = {
      async completeJson() {
        modelCalls += 1
        throw new LlmRequestError(privateErrorMarker, {
          reason: 'network_error',
          retryable: true,
        })
      },
    }
    let now = new Date('2026-09-24T12:00:00.000Z')
    const firstService = new ResumeAgentRunService(
      new ResumeTailoringAgent(llm),
      {
        store: firstStore,
        idFactory: () => 'run-retry-deadline-restart',
        workerId: 'retry-deadline-before-restart',
        taskLeaseMs: 10_000,
        maxTaskRetryElapsedMs: 5_000,
        now: () => now,
        schedule: (task) => firstTasks.push(task),
      }
    )
    await firstService.start({
      jobDescription: 'We need a TypeScript Engineer for reliable systems.',
      candidate: { resume: completeCandidate },
    })
    await firstTasks.shift()?.()
    expect((await firstService.get('run-retry-deadline-restart'))?.status).toBe(
      'analyzing_jd'
    )
    expect(modelCalls).toBe(1)
    await firstService.close()
    firstStore.close()

    now = new Date('2026-09-24T12:00:05.000Z')
    const reopenedStore = await openStore(databasePath)
    const resumedTasks: Array<() => Promise<void>> = []
    const resumedService = new ResumeAgentRunService(
      new ResumeTailoringAgent(llm),
      {
        store: reopenedStore,
        workerId: 'retry-deadline-after-restart',
        taskLeaseMs: 10_000,
        maxTaskRetryElapsedMs: 5_000,
        now: () => now,
        schedule: (task) => resumedTasks.push(task),
      }
    )
    expect(await resumedService.recoverPendingTasks()).toBe(1)
    await resumedTasks.shift()?.()

    const failed = await resumedService.get('run-retry-deadline-restart')
    expect(failed).toMatchObject({
      status: 'failed',
      error: {
        code: 'agent_task_retry_deadline_exceeded',
        message: 'The resume tailoring task exceeded its retry deadline.',
      },
    })
    expect(JSON.stringify(failed)).not.toContain(privateErrorMarker)
    expect(modelCalls).toBe(1)
    expect(await resumedService.recoverPendingTasks()).toBe(0)
    await resumedService.close()
  })

  it('cancels an in-flight retry when its persisted deadline arrives', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-25T00:00:00.000Z'))
    const privateAbortMarker = 'PRIVATE_IN_FLIGHT_DEADLINE_ABORT_MARKER'
    const store = await openStore(await temporaryDatabasePath())
    const scheduled: Array<() => Promise<void>> = []
    let modelCalls = 0
    let retrySignal: AbortSignal | undefined
    let markRetryStarted: (() => void) | undefined
    const retryStarted = new Promise<void>((resolve) => {
      markRetryStarted = resolve
    })
    const llm: LlmClient = {
      async completeJson<_T>(_request, options) {
        modelCalls += 1
        if (modelCalls === 1) {
          throw new LlmRequestError('transient failure', {
            reason: 'network_error',
            retryable: true,
          })
        }
        retrySignal = options?.signal
        markRetryStarted?.()
        return new Promise<never>((_resolve, reject) => {
          retrySignal?.addEventListener(
            'abort',
            () =>
              reject(
                new LlmRequestError(privateAbortMarker, {
                  reason: 'cancelled',
                  retryable: false,
                })
              ),
            { once: true }
          )
        })
      },
    }
    const service = new ResumeAgentRunService(new ResumeTailoringAgent(llm), {
      store,
      idFactory: () => 'run-in-flight-retry-deadline',
      workerId: 'in-flight-retry-deadline-worker',
      taskLeaseMs: 10_000,
      maxTaskRetryElapsedMs: 1_500,
      now: () => new Date(),
      schedule: (task) => scheduled.push(task),
    })
    let retryExecution: Promise<void> | undefined
    try {
      await service.start({
        jobDescription: 'We need a TypeScript Engineer for reliable systems.',
        candidate: { resume: completeCandidate },
      })
      await scheduled.shift()?.()

      await vi.advanceTimersByTimeAsync(1_000)
      expect(await service.recoverPendingTasks()).toBe(1)
      retryExecution = scheduled.shift()?.()
      await retryStarted
      expect(retrySignal?.aborted).toBe(false)

      await vi.advanceTimersByTimeAsync(499)
      expect(retrySignal?.aborted).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      await retryExecution

      const failed = await service.get('run-in-flight-retry-deadline')
      expect(failed).toMatchObject({
        status: 'failed',
        error: {
          code: 'agent_task_retry_deadline_exceeded',
          message: 'The resume tailoring task exceeded its retry deadline.',
        },
      })
      expect(JSON.stringify(failed)).not.toContain(privateAbortMarker)
      expect(retrySignal?.aborted).toBe(true)
      expect(modelCalls).toBe(2)
      expect(await service.recoverPendingTasks()).toBe(0)
    } finally {
      await service.close()
      await retryExecution
      vi.useRealTimers()
    }
  })

  it('allows one delivery for a task first claimed after its retry window', async () => {
    const store = await openStore(await temporaryDatabasePath())
    const run = storedRun('run-old-first-delivery')
    if (!run.request) throw new Error('Expected stored request')
    run.request.candidate = { resume: completeCandidate }
    await expect(
      store.createWithTask(run, runTask(run.snapshot.id))
    ).resolves.toBe(true)
    const scheduled: Array<() => Promise<void>> = []
    const modelCalls = { count: 0 }
    const service = new ResumeAgentRunService(
      completingAgent('Ada Lovelace', modelCalls),
      {
        store,
        workerId: 'old-first-delivery-worker',
        maxTaskRetryElapsedMs: 1_000,
        now: () => new Date('2026-09-24T12:00:00.000Z'),
        schedule: (task) => scheduled.push(task),
      }
    )

    expect(await service.recoverPendingTasks()).toBe(1)
    await scheduled.shift()?.()

    expect(await service.get(run.snapshot.id)).toMatchObject({
      status: 'completed',
    })
    expect(modelCalls.count).toBe(2)
    expect(await service.recoverPendingTasks()).toBe(0)
    await service.close()
  })

  it('persists the longer provider retry delay across restart', async () => {
    const privateErrorMarker = 'PRIVATE_PROVIDER_RETRY_AFTER_MARKER'
    const databasePath = await temporaryDatabasePath()
    const firstStore = await openStore(databasePath)
    const firstTasks: Array<() => Promise<void>> = []
    const responses = [
      {
        targetTitle: 'TypeScript Engineer',
        seniority: 'junior',
        summary: 'TypeScript engineer',
        requirements: [],
        keywords: [],
      },
      {
        resume: completeCandidate,
        selectedEvidenceIds: [],
        questions: [],
        notes: [],
      },
    ]
    let modelCalls = 0
    const llm: LlmClient = {
      async completeJson<T>() {
        modelCalls += 1
        if (modelCalls === 1) {
          throw new LlmRequestError(privateErrorMarker, {
            reason: 'http_status',
            retryable: true,
            status: 429,
            retryAfterMs: 5_000,
          })
        }
        return {
          data: responses.shift() as T,
          metadata: {
            provider: 'fake',
            model: 'fake-model',
            durationMs: 1,
            attempt: 1,
          },
        }
      },
    }
    let now = new Date('2026-09-24T12:00:00.000Z')
    const firstService = new ResumeAgentRunService(
      new ResumeTailoringAgent(llm),
      {
        store: firstStore,
        idFactory: () => 'run-provider-retry-after-restart',
        workerId: 'retry-after-worker-before-restart',
        taskLeaseMs: 10_000,
        maxTaskRetryElapsedMs: 5_001,
        now: () => now,
        schedule: (task) => firstTasks.push(task),
      }
    )
    await firstService.start({
      jobDescription: 'We need a TypeScript Engineer for reliable systems.',
      candidate: { resume: completeCandidate },
    })
    await firstTasks.shift()?.()

    const waiting = await firstService.get('run-provider-retry-after-restart')
    expect(waiting?.status).toBe('analyzing_jd')
    expect(JSON.stringify(waiting)).not.toContain(privateErrorMarker)
    now = new Date('2026-09-24T12:00:04.999Z')
    expect(await firstService.recoverPendingTasks()).toBe(0)
    await firstService.close()
    firstStore.close()

    now = new Date('2026-09-24T12:00:05.000Z')
    const reopenedStore = await openStore(databasePath)
    const resumedTasks: Array<() => Promise<void>> = []
    const resumedService = new ResumeAgentRunService(
      new ResumeTailoringAgent(llm),
      {
        store: reopenedStore,
        workerId: 'retry-after-worker-after-restart',
        taskLeaseMs: 10_000,
        maxTaskRetryElapsedMs: 5_001,
        now: () => now,
        schedule: (task) => resumedTasks.push(task),
      }
    )
    expect(await resumedService.recoverPendingTasks()).toBe(1)
    await resumedTasks.shift()?.()

    expect(
      await resumedService.get('run-provider-retry-after-restart')
    ).toMatchObject({ status: 'completed' })
    expect(modelCalls).toBe(3)
    expect(await resumedService.recoverPendingTasks()).toBe(0)
    await resumedService.close()
  })

  it('retries a transient provider failure after a durable interaction resumes', async () => {
    const privateErrorMarker = 'PRIVATE_COMPLETION_PROVIDER_ERROR_MARKER'
    const databasePath = await temporaryDatabasePath()
    const originalStore = await openStore(databasePath)
    const originalTasks: Array<() => Promise<void>> = []
    const originalService = new ResumeAgentRunService(questionAgent(), {
      store: originalStore,
      idFactory: () => 'run-retryable-completion',
      workerId: 'interaction-worker',
      now: () => new Date('2026-09-24T12:00:00.000Z'),
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
    await originalTasks.shift()?.()
    expect(
      (await originalService.get('run-retryable-completion'))?.status
    ).toBe('needs_input')
    await originalService.answer('run-retryable-completion', {
      interactionId: 'candidate-normalization:1',
      idempotencyKey: 'retryable-completion-answer',
      value: 'Grace Hopper',
    })
    await originalService.close()
    originalStore.close()

    const completedCandidate = {
      ...completeCandidate,
      content: {
        ...completeCandidate.content,
        basics: { ...completeCandidate.content.basics, name: 'Grace Hopper' },
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
    let modelCalls = 0
    const llm: LlmClient = {
      async completeJson<T>() {
        modelCalls += 1
        if (modelCalls === 1) {
          throw new LlmRequestError(privateErrorMarker, {
            reason: 'timeout',
            retryable: true,
          })
        }
        return {
          data: responses.shift() as T,
          metadata: {
            provider: 'fake',
            model: 'fake-model',
            durationMs: 1,
            attempt: 1,
          },
        }
      },
    }
    let now = new Date('2026-09-24T12:00:00.000Z')
    const completionStore = await openStore(databasePath)
    const completionTasks: Array<() => Promise<void>> = []
    const completionService = new ResumeAgentRunService(
      new ResumeTailoringAgent(llm),
      {
        store: completionStore,
        workerId: 'completion-worker',
        taskLeaseMs: 10_000,
        now: () => now,
        schedule: (task) => completionTasks.push(task),
      }
    )
    expect(await completionService.recoverPendingTasks()).toBe(1)
    await completionTasks.shift()?.()

    const retrying = await completionService.get('run-retryable-completion')
    expect(retrying?.status).toBe('analyzing_jd')
    expect(JSON.stringify(retrying)).not.toContain(privateErrorMarker)
    now = new Date('2026-09-24T12:00:00.999Z')
    expect(await completionService.recoverPendingTasks()).toBe(0)
    now = new Date('2026-09-24T12:00:01.000Z')
    expect(await completionService.recoverPendingTasks()).toBe(1)
    await completionTasks.shift()?.()

    expect(
      await completionService.get('run-retryable-completion')
    ).toMatchObject({ status: 'completed' })
    expect(modelCalls).toBe(3)
    expect(await completionService.recoverPendingTasks()).toBe(0)
    await completionService.close()
  })

  it('bounds durable deliveries for a persistently transient provider failure', async () => {
    const privateErrorMarker = 'PRIVATE_EXHAUSTED_PROVIDER_ERROR_MARKER'
    const store = await openStore(await temporaryDatabasePath())
    const scheduled: Array<() => Promise<void>> = []
    let modelCalls = 0
    const llm: LlmClient = {
      async completeJson() {
        modelCalls += 1
        throw new LlmRequestError(privateErrorMarker, {
          reason: 'http_status',
          retryable: true,
          status: 503,
        })
      },
    }
    let now = new Date('2026-09-24T12:00:00.000Z')
    const service = new ResumeAgentRunService(new ResumeTailoringAgent(llm), {
      store,
      idFactory: () => 'run-exhausted-provider-retries',
      workerId: 'provider-exhaustion-worker',
      taskLeaseMs: 10_000,
      maxTaskAttempts: 3,
      now: () => now,
      schedule: (task) => scheduled.push(task),
    })
    await service.start({
      jobDescription: 'We need a TypeScript Engineer for reliable systems.',
      candidate: { resume: completeCandidate },
    })
    await scheduled.shift()?.()

    for (const availableAt of [
      '2026-09-24T12:00:01.000Z',
      '2026-09-24T12:00:03.000Z',
    ]) {
      now = new Date(new Date(availableAt).getTime() - 1)
      expect(await service.recoverPendingTasks()).toBe(0)
      now = new Date(availableAt)
      expect(await service.recoverPendingTasks()).toBe(1)
      await scheduled.shift()?.()
    }

    expect(modelCalls).toBe(3)
    expect((await service.get('run-exhausted-provider-retries'))?.status).toBe(
      'analyzing_jd'
    )
    now = new Date('2026-09-24T12:00:06.999Z')
    expect(await service.recoverPendingTasks()).toBe(0)
    now = new Date('2026-09-24T12:00:07.000Z')
    expect(await service.recoverPendingTasks()).toBe(1)
    await scheduled.shift()?.()

    const exhausted = await service.get('run-exhausted-provider-retries')
    expect(exhausted).toMatchObject({
      status: 'failed',
      error: {
        code: 'agent_task_attempts_exhausted',
        message: 'The resume tailoring task exceeded its retry limit.',
      },
    })
    expect(JSON.stringify(exhausted)).not.toContain(privateErrorMarker)
    expect(modelCalls).toBe(3)
    expect(await service.recoverPendingTasks()).toBe(0)
    await service.close()
  })

  it('clears heartbeat before a lost acknowledgement is recovered', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-16T12:00:00.000Z'))
    const databasePath = await temporaryDatabasePath()
    const workerStore = await openStore(databasePath)
    const competingStore = await openStore(databasePath)
    const scheduled: Array<() => Promise<void>> = []
    const service = new ResumeAgentRunService(completingAgent(), {
      store: new LostAcknowledgementStore(workerStore),
      idFactory: () => 'run-heartbeat-lost-ack',
      workerId: 'worker-with-lost-ack',
      taskLeaseMs: 900,
      taskHeartbeatMs: 300,
      now: () => new Date(),
      schedule: (task) => scheduled.push(task),
    })
    try {
      await service.start({
        jobDescription: 'We need a TypeScript Engineer for reliable systems.',
        candidate: { resume: completeCandidate },
      })
      await scheduled[0]?.()

      expect((await service.get('run-heartbeat-lost-ack'))?.status).toBe(
        'completed'
      )
      expect(vi.getTimerCount()).toBe(0)
      await vi.advanceTimersByTimeAsync(900)
      expect(
        await competingStore.claimNextTask({
          workerId: 'worker-recovering-lost-ack',
          now: new Date(),
          leaseDurationMs: 900,
        })
      ).toMatchObject({ attempt: 2 })
    } finally {
      await service.close()
      vi.useRealTimers()
    }
  })

  it('persists exponential backoff after worker infrastructure failures', async () => {
    const databasePath = await temporaryDatabasePath()
    const store = await openStore(databasePath)
    const scheduled: Array<() => Promise<void>> = []
    const modelCalls = { count: 0 }
    let now = new Date('2026-09-24T12:00:00.000Z')
    const service = new ResumeAgentRunService(
      completingAgent('Ada Lovelace', modelCalls),
      {
        store: new FailedAcknowledgementStore(store),
        idFactory: () => 'run-persisted-retry-backoff',
        workerId: 'worker-with-failed-ack',
        taskLeaseMs: 10_000,
        now: () => now,
        schedule: (task) => scheduled.push(task),
      }
    )
    await service.start({
      jobDescription: 'We need a TypeScript Engineer for reliable systems.',
      candidate: { resume: completeCandidate },
    })
    await scheduled.shift()?.()
    expect(modelCalls.count).toBe(2)
    expect((await service.get('run-persisted-retry-backoff'))?.status).toBe(
      'completed'
    )

    now = new Date('2026-09-24T12:00:00.999Z')
    expect(await service.recoverPendingTasks()).toBe(0)
    now = new Date('2026-09-24T12:00:01.000Z')
    expect(await service.recoverPendingTasks()).toBe(1)
    await scheduled.shift()?.()
    expect(modelCalls.count).toBe(2)

    now = new Date('2026-09-24T12:00:02.999Z')
    expect(await service.recoverPendingTasks()).toBe(0)
    await service.close()
    store.close()

    const reopened = await openStore(databasePath)
    await expect(
      reopened.claimNextTask({
        workerId: 'worker-after-reopen',
        now: new Date('2026-09-24T12:00:03.000Z'),
        leaseDurationMs: 10_000,
      })
    ).resolves.toMatchObject({
      runId: 'run-persisted-retry-backoff',
      attempt: 3,
      leaseOwner: 'worker-after-reopen',
    })
  })

  it('caps persisted infrastructure retry backoff at thirty seconds', async () => {
    const store = await openStore(await temporaryDatabasePath())
    const scheduled: Array<() => Promise<void>> = []
    const modelCalls = { count: 0 }
    let now = new Date('2026-09-24T12:00:00.000Z')
    const service = new ResumeAgentRunService(
      completingAgent('Ada Lovelace', modelCalls),
      {
        store: new FailedAcknowledgementStore(store),
        idFactory: () => 'run-capped-retry-backoff',
        workerId: 'worker-with-capped-backoff',
        taskLeaseMs: 60_000,
        now: () => now,
        schedule: (task) => scheduled.push(task),
      }
    )
    await service.start({
      jobDescription: 'We need a TypeScript Engineer for reliable systems.',
      candidate: { resume: completeCandidate },
    })
    await scheduled.shift()?.()

    for (const delayMs of [
      1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000,
    ]) {
      const availableAt = now.getTime() + delayMs
      now = new Date(availableAt - 1)
      expect(await service.recoverPendingTasks()).toBe(0)
      now = new Date(availableAt)
      expect(await service.recoverPendingTasks()).toBe(1)
      await scheduled.shift()?.()
    }

    expect(modelCalls.count).toBe(2)
    await service.close()
  })

  it('claims no more than the requested recovery batch limit', async () => {
    const databasePath = await temporaryDatabasePath()
    const store = await openStore(databasePath)
    for (const runId of ['run-batch-a', 'run-batch-b', 'run-batch-c']) {
      await store.createWithTask(storedRun(runId), runTask(runId))
    }
    const scheduled: Array<() => Promise<void>> = []
    const service = new ResumeAgentRunService(unusedAgent(), {
      store,
      workerId: 'batch-worker',
      now: () => new Date('2026-09-16T12:00:00.000Z'),
      schedule: (task) => scheduled.push(task),
    })

    expect(await service.recoverPendingTasks(2)).toBe(2)
    expect(scheduled).toHaveLength(2)

    const secondStore = await openStore(databasePath)
    expect(
      await secondStore.claimNextTask({
        workerId: 'next-batch-worker',
        now: new Date('2026-09-16T12:00:00.000Z'),
        leaseDurationMs: 30_000,
      })
    ).toMatchObject({ attempt: 1, leaseOwner: 'next-batch-worker' })
  })

  it('rejects invalid worker and recovery configurations before claiming', async () => {
    const store = await openStore(await temporaryDatabasePath())
    expect(
      () =>
        new ResumeAgentRunService(unusedAgent(), {
          store,
          workerId: ' ',
        })
    ).toThrow('Run task worker configuration is invalid')
    expect(
      () =>
        new ResumeAgentRunService(unusedAgent(), {
          store,
          taskLeaseMs: 0,
        })
    ).toThrow('Run task worker configuration is invalid')
    expect(
      () =>
        new ResumeAgentRunService(unusedAgent(), {
          store,
          taskLeaseMs: 1,
        })
    ).toThrow('Run task worker configuration is invalid')
    expect(
      () =>
        new ResumeAgentRunService(unusedAgent(), {
          store,
          taskLeaseMs: 2_147_483_648,
        })
    ).toThrow('Run task worker configuration is invalid')
    expect(
      () =>
        new ResumeAgentRunService(unusedAgent(), {
          store,
          taskLeaseMs: 1.5,
        })
    ).toThrow('Run task worker configuration is invalid')
    expect(
      () =>
        new ResumeAgentRunService(unusedAgent(), {
          store,
          taskHeartbeatMs: 0,
        })
    ).toThrow('Run task worker configuration is invalid')
    expect(
      () =>
        new ResumeAgentRunService(unusedAgent(), {
          store,
          taskHeartbeatMs: 1.5,
        })
    ).toThrow('Run task worker configuration is invalid')
    expect(
      () =>
        new ResumeAgentRunService(unusedAgent(), {
          store,
          taskLeaseMs: 1_000,
          taskHeartbeatMs: 1_000,
        })
    ).toThrow('Run task worker configuration is invalid')
    expect(
      () =>
        new ResumeAgentRunService(unusedAgent(), {
          store,
          maxTaskAttempts: 0,
        })
    ).toThrow('Run task worker configuration is invalid')
    expect(
      () =>
        new ResumeAgentRunService(unusedAgent(), {
          store,
          maxTaskAttempts: 1_001,
        })
    ).toThrow('Run task worker configuration is invalid')
    for (const maxTaskRetryElapsedMs of [999, 1_000.5, 86_400_001]) {
      expect(
        () =>
          new ResumeAgentRunService(unusedAgent(), {
            store,
            maxTaskRetryElapsedMs,
          })
      ).toThrow('Run task worker configuration is invalid')
    }

    const service = new ResumeAgentRunService(unusedAgent(), { store })
    await expect(service.recoverPendingTasks(0)).rejects.toThrow(
      'Run task recovery limit is invalid'
    )
    await expect(service.recoverPendingTasks(1.5)).rejects.toThrow(
      'Run task recovery limit is invalid'
    )
    await expect(service.recoverPendingTasks(1_001)).rejects.toThrow(
      'Run task recovery limit is invalid'
    )
  })

  it('keeps private request data out of task rows, public runs, and errors', async () => {
    const privateMarker = 'PRIVATE_WORKER_CONCURRENCY_MARKER'
    const databasePath = await temporaryDatabasePath()
    const store = await openStore(databasePath)
    const service = new ResumeAgentRunService(unusedAgent(), {
      store,
      idFactory: () => 'run-worker-privacy',
      schedule: () => undefined,
    })
    await service.start({
      jobDescription: `Private JD ${privateMarker}`,
      candidate: {
        resume: { content: { basics: { name: privateMarker } } },
      },
    })

    const { DatabaseSync } = await import('node:sqlite')
    const database = new DatabaseSync(databasePath)
    try {
      const taskRows = database
        .prepare('SELECT * FROM resume_agent_tasks')
        .all()
      expect(JSON.stringify(taskRows)).not.toContain(privateMarker)
    } finally {
      database.close()
    }

    expect(
      JSON.stringify(await service.get('run-worker-privacy'))
    ).not.toContain(privateMarker)
    const safeError = await store
      .acknowledgeTask('', privateMarker, 1)
      .catch((error: unknown) => error)
    expect(safeError).toEqual(new RunStoreError('invalid_task'))
    expect(`${String(safeError)}${JSON.stringify(safeError)}`).not.toContain(
      privateMarker
    )
    const renewalError = await store
      .renewTaskLease({
        id: '',
        runId: 'run-worker-privacy',
        leaseOwner: privateMarker,
        attempt: 1,
        now: new Date('2026-09-16T12:00:00.000Z'),
        leaseDurationMs: 30_000,
      })
      .catch((error: unknown) => error)
    expect(renewalError).toEqual(new RunStoreError('invalid_task'))
    expect(
      `${String(renewalError)}${JSON.stringify(renewalError)}`
    ).not.toContain(privateMarker)
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

  it('acks an exhausted stale prepare task without failing a paused run', async () => {
    const store = await openStore(await temporaryDatabasePath())
    const scheduled: Array<() => Promise<void>> = []
    const pausedService = new ResumeAgentRunService(questionAgent(), {
      store: new LostAcknowledgementStore(store),
      idFactory: () => 'run-paused-stale-task',
      workerId: 'worker-that-loses-ack',
      taskLeaseMs: 1_000,
      now: () => new Date('2026-09-16T12:00:00.000Z'),
      schedule: (task) => scheduled.push(task),
    })
    await pausedService.start({
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
    await scheduled[0]?.()
    expect((await pausedService.get('run-paused-stale-task'))?.status).toBe(
      'needs_input'
    )

    const reclaimTime = new Date('2026-09-16T12:00:01.000Z')
    for (const workerId of ['reclaimer-2', 'reclaimer-3']) {
      const task = await store.claimNextTask({
        workerId,
        now: reclaimTime,
        leaseDurationMs: 1_000,
      })
      if (!task) throw new Error('Expected stale task claim')
      expect(
        await store.releaseTask(task.id, task.leaseOwner, task.attempt)
      ).toBe(true)
    }

    const modelCalls = { count: 0 }
    const recoveryTasks: Array<() => Promise<void>> = []
    const recoveryService = new ResumeAgentRunService(
      countingFailAgent(modelCalls),
      {
        store,
        workerId: 'reclaimer-4',
        maxTaskAttempts: 3,
        now: () => reclaimTime,
        schedule: (task) => recoveryTasks.push(task),
      }
    )
    expect(await recoveryService.recoverPendingTasks()).toBe(1)
    await recoveryTasks[0]?.()

    expect(modelCalls.count).toBe(0)
    expect(await recoveryService.get('run-paused-stale-task')).toMatchObject({
      status: 'needs_input',
      interactions: [{ id: 'candidate-normalization:1' }],
    })
    expect(await recoveryService.recoverPendingTasks()).toBe(0)
  })

  it('fails a poison task after bounded attempts without rerunning the model', async () => {
    const store = await openStore(await temporaryDatabasePath())
    const originalService = new ResumeAgentRunService(unusedAgent(), {
      store,
      idFactory: () => 'run-poison-task',
      now: () => new Date('2026-09-16T12:00:00.000Z'),
      schedule: () => undefined,
    })
    await originalService.start({
      jobDescription: 'We need a TypeScript Engineer for reliable systems.',
      candidate: { resume: completeCandidate },
    })
    const now = new Date('2026-09-16T12:00:00.000Z')
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const task = await store.claimNextTask({
        workerId: `failed-worker-${attempt}`,
        now,
        leaseDurationMs: 1_000,
      })
      expect(task?.attempt).toBe(attempt)
      expect(
        await store.releaseTask(
          task?.id ?? '',
          task?.leaseOwner ?? '',
          task?.attempt ?? 0
        )
      ).toBe(true)
    }

    const modelCalls = { count: 0 }
    const recoveredTasks: Array<() => Promise<void>> = []
    const recoveryService = new ResumeAgentRunService(
      countingFailAgent(modelCalls),
      {
        store,
        workerId: 'final-worker',
        maxTaskAttempts: 3,
        now: () => now,
        schedule: (task) => recoveredTasks.push(task),
      }
    )

    expect(await recoveryService.recoverPendingTasks()).toBe(1)
    await recoveredTasks[0]?.()

    expect(modelCalls.count).toBe(0)
    expect(await recoveryService.get('run-poison-task')).toMatchObject({
      status: 'failed',
      error: {
        code: 'agent_task_attempts_exhausted',
        message: 'The resume tailoring task exceeded its retry limit.',
      },
    })
    expect(await recoveryService.recoverPendingTasks()).toBe(0)
  })
})
