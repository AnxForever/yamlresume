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

import type { DatabaseSync } from 'node:sqlite'

import type {
  ClaimedRunTask,
  ClaimRunTaskOptions,
  DurableRunStore,
  RenewRunTaskLeaseOptions,
  RunTask,
  RunTaskClaimIdentity,
  StoredResumeAgentRun,
  TaskFencedRunUpdateResult,
} from '@/workflow/run'

const SCHEMA_VERSION = 2
const DEFAULT_BUSY_TIMEOUT_MS = 5_000

export type RunStoreErrorCode =
  | 'invalid_configuration'
  | 'open_failed'
  | 'unsupported_schema'
  | 'closed'
  | 'invalid_task'
  | 'serialization_failed'
  | 'corrupt_record'
  | 'storage_failed'

export class RunStoreError extends Error {
  constructor(readonly code: RunStoreErrorCode) {
    super(runStoreErrorMessage(code))
    this.name = 'RunStoreError'
  }
}

export interface SqliteRunStoreOptions {
  busyTimeoutMs?: number
}

interface StoredRow {
  revision: number | bigint
  record_json: string
}

interface TaskRow {
  id: string
  run_id: string
  kind: string
  created_at: number | bigint
  attempts: number | bigint
  lease_owner: string
  lease_expires_at: number | bigint
}

function runStoreErrorMessage(code: RunStoreErrorCode): string {
  switch (code) {
    case 'invalid_configuration':
      return 'Run store configuration is invalid'
    case 'open_failed':
      return 'Run store could not be opened'
    case 'unsupported_schema':
      return 'Run store schema is not supported'
    case 'closed':
      return 'Run store is closed'
    case 'invalid_task':
      return 'Run task is invalid'
    case 'serialization_failed':
      return 'Run store record could not be serialized'
    case 'corrupt_record':
      return 'Run store record is invalid'
    case 'storage_failed':
      return 'Run store operation failed'
  }
}

function serializeRecord(run: StoredResumeAgentRun): string {
  try {
    const serialized = JSON.stringify(run)
    if (!serialized) throw new Error('Record did not serialize')
    return serialized
  } catch {
    throw new RunStoreError('serialization_failed')
  }
}

function taskCreatedAt(task: RunTask, runId: string): number {
  const createdAt = Date.parse(task.createdAt)
  if (
    !task.id.trim() ||
    task.runId !== runId ||
    (task.kind !== 'prepare' && task.kind !== 'complete') ||
    !Number.isSafeInteger(createdAt)
  ) {
    throw new RunStoreError('invalid_task')
  }
  return createdAt
}

function claimTimes(options: ClaimRunTaskOptions): {
  now: number
  leaseExpiresAt: number
} {
  const now = options.now.getTime()
  const leaseExpiresAt = now + options.leaseDurationMs
  if (
    !options.workerId.trim() ||
    !Number.isSafeInteger(now) ||
    !Number.isSafeInteger(options.leaseDurationMs) ||
    options.leaseDurationMs <= 0 ||
    !Number.isSafeInteger(leaseExpiresAt)
  ) {
    throw new RunStoreError('invalid_task')
  }
  return { now, leaseExpiresAt }
}

function renewalTimes(options: RenewRunTaskLeaseOptions): {
  now: number
  leaseExpiresAt: number
} {
  const now = options.now.getTime()
  const leaseExpiresAt = now + options.leaseDurationMs
  if (
    !options.id.trim() ||
    !options.runId.trim() ||
    !options.leaseOwner.trim() ||
    !Number.isSafeInteger(options.attempt) ||
    options.attempt < 1 ||
    !Number.isSafeInteger(now) ||
    !Number.isSafeInteger(options.leaseDurationMs) ||
    options.leaseDurationMs <= 0 ||
    !Number.isSafeInteger(leaseExpiresAt)
  ) {
    throw new RunStoreError('invalid_task')
  }
  return { now, leaseExpiresAt }
}

function parseClaimedTask(row: TaskRow): ClaimedRunTask {
  const createdAt = Number(row.created_at)
  const attempt = Number(row.attempts)
  const leaseExpiresAt = Number(row.lease_expires_at)
  if (
    !row.id ||
    !row.run_id ||
    (row.kind !== 'prepare' && row.kind !== 'complete') ||
    !row.lease_owner ||
    !Number.isSafeInteger(createdAt) ||
    !Number.isSafeInteger(attempt) ||
    attempt < 1 ||
    !Number.isSafeInteger(leaseExpiresAt)
  ) {
    throw new RunStoreError('corrupt_record')
  }
  return {
    id: row.id,
    runId: row.run_id,
    kind: row.kind,
    createdAt: new Date(createdAt).toISOString(),
    attempt,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: new Date(leaseExpiresAt).toISOString(),
  }
}

function parseRecord(id: string, row: StoredRow): StoredResumeAgentRun {
  try {
    const parsed = JSON.parse(row.record_json) as unknown
    const revision = Number(row.revision)
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !Number.isSafeInteger(revision) ||
      revision < 0
    ) {
      throw new Error('Invalid record')
    }
    const record = parsed as Partial<StoredResumeAgentRun>
    if (
      record.revision !== revision ||
      !record.snapshot ||
      record.snapshot.id !== id
    ) {
      throw new Error('Record does not match its key')
    }
    return record as StoredResumeAgentRun
  } catch {
    throw new RunStoreError('corrupt_record')
  }
}

function readSchemaVersion(database: DatabaseSync): number {
  const row = database.prepare('PRAGMA user_version').get() as
    | Record<string, unknown>
    | undefined
  const version = Number(row?.user_version)
  if (!Number.isSafeInteger(version) || version < 0) {
    throw new RunStoreError('unsupported_schema')
  }
  return version
}

function migrate(database: DatabaseSync): void {
  const version = readSchemaVersion(database)
  if (version > SCHEMA_VERSION) {
    throw new RunStoreError('unsupported_schema')
  }
  if (version === SCHEMA_VERSION) return

  try {
    database.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS resume_agent_runs (
        id TEXT PRIMARY KEY,
        revision INTEGER NOT NULL CHECK (revision >= 0),
        record_json TEXT NOT NULL CHECK (json_valid(record_json))
      ) STRICT;
      CREATE TABLE IF NOT EXISTS resume_agent_tasks (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('prepare', 'complete')),
        created_at INTEGER NOT NULL,
        available_at INTEGER NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        lease_owner TEXT,
        lease_expires_at INTEGER,
        FOREIGN KEY (run_id) REFERENCES resume_agent_runs(id) ON DELETE CASCADE,
        CHECK (
          (lease_owner IS NULL AND lease_expires_at IS NULL) OR
          (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
        )
      ) STRICT;
      CREATE INDEX IF NOT EXISTS resume_agent_tasks_ready
      ON resume_agent_tasks (
        available_at,
        lease_expires_at,
        created_at,
        id
      );
      PRAGMA user_version = ${SCHEMA_VERSION};
      COMMIT;
    `)
  } catch {
    try {
      database.exec('ROLLBACK')
    } catch {
      // The failed statement may already have rolled the transaction back.
    }
    throw new RunStoreError('open_failed')
  }
}

export class SqliteRunStore implements DurableRunStore {
  private closed = false

  private constructor(private readonly database: DatabaseSync) {}

  static async open(
    path: string,
    options: SqliteRunStoreOptions = {}
  ): Promise<SqliteRunStore> {
    const busyTimeoutMs = options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS
    if (
      !path.trim() ||
      !Number.isSafeInteger(busyTimeoutMs) ||
      busyTimeoutMs < 0
    ) {
      throw new RunStoreError('invalid_configuration')
    }

    let database: DatabaseSync | undefined
    try {
      const { DatabaseSync } = await import('node:sqlite')
      database = new DatabaseSync(path, {
        enableDoubleQuotedStringLiterals: false,
        allowExtension: false,
      })
      database.exec(`
        PRAGMA foreign_keys = ON;
        PRAGMA busy_timeout = ${busyTimeoutMs};
      `)
      migrate(database)
      database.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = FULL;
      `)
      return new SqliteRunStore(database)
    } catch (error) {
      try {
        database?.close()
      } catch {
        // Opening failed; there is no usable connection to preserve.
      }
      if (error instanceof RunStoreError) throw error
      throw new RunStoreError('open_failed')
    }
  }

  async get(id: string): Promise<StoredResumeAgentRun | undefined> {
    this.ensureOpen()
    try {
      const row = this.database
        .prepare(
          'SELECT revision, record_json FROM resume_agent_runs WHERE id = ?'
        )
        .get(id) as unknown as StoredRow | undefined
      return row ? parseRecord(id, row) : undefined
    } catch (error) {
      if (error instanceof RunStoreError) throw error
      throw new RunStoreError('storage_failed')
    }
  }

  async create(run: StoredResumeAgentRun): Promise<boolean> {
    this.ensureOpen()
    if (run.revision !== 0) return false
    const recordJson = serializeRecord(run)
    try {
      const result = this.database
        .prepare(
          `INSERT INTO resume_agent_runs (id, revision, record_json)
           VALUES (?, ?, ?)
           ON CONFLICT(id) DO NOTHING`
        )
        .run(run.snapshot.id, run.revision, recordJson)
      return Number(result.changes) === 1
    } catch {
      throw new RunStoreError('storage_failed')
    }
  }

  async createWithTask(
    run: StoredResumeAgentRun,
    task: RunTask
  ): Promise<boolean> {
    this.ensureOpen()
    if (run.revision !== 0) return false
    const recordJson = serializeRecord(run)
    const createdAt = taskCreatedAt(task, run.snapshot.id)
    try {
      this.database.exec('BEGIN IMMEDIATE')
      const result = this.database
        .prepare(
          `INSERT INTO resume_agent_runs (id, revision, record_json)
           VALUES (?, ?, ?)
           ON CONFLICT(id) DO NOTHING`
        )
        .run(run.snapshot.id, run.revision, recordJson)
      if (Number(result.changes) !== 1) {
        this.database.exec('ROLLBACK')
        return false
      }
      this.database
        .prepare(
          `INSERT INTO resume_agent_tasks (
             id, run_id, kind, created_at, available_at
           ) VALUES (?, ?, ?, ?, ?)`
        )
        .run(task.id, task.runId, task.kind, createdAt, createdAt)
      this.database.exec('COMMIT')
      return true
    } catch (error) {
      this.rollback()
      if (error instanceof RunStoreError) throw error
      throw new RunStoreError('storage_failed')
    }
  }

  async compareAndSet(run: StoredResumeAgentRun): Promise<boolean> {
    this.ensureOpen()
    if (
      !Number.isSafeInteger(run.revision) ||
      run.revision < 0 ||
      run.revision >= Number.MAX_SAFE_INTEGER
    ) {
      throw new RunStoreError('serialization_failed')
    }
    const nextRevision = run.revision + 1
    const recordJson = serializeRecord({ ...run, revision: nextRevision })
    try {
      const result = this.database
        .prepare(
          `UPDATE resume_agent_runs
           SET revision = ?, record_json = ?
           WHERE id = ? AND revision = ?`
        )
        .run(nextRevision, recordJson, run.snapshot.id, run.revision)
      return Number(result.changes) === 1
    } catch {
      throw new RunStoreError('storage_failed')
    }
  }

  async compareAndSetWithTask(
    run: StoredResumeAgentRun,
    task: RunTask
  ): Promise<boolean> {
    this.ensureOpen()
    if (
      !Number.isSafeInteger(run.revision) ||
      run.revision < 0 ||
      run.revision >= Number.MAX_SAFE_INTEGER
    ) {
      throw new RunStoreError('serialization_failed')
    }
    const nextRevision = run.revision + 1
    const recordJson = serializeRecord({ ...run, revision: nextRevision })
    const createdAt = taskCreatedAt(task, run.snapshot.id)
    try {
      this.database.exec('BEGIN IMMEDIATE')
      const result = this.database
        .prepare(
          `UPDATE resume_agent_runs
           SET revision = ?, record_json = ?
           WHERE id = ? AND revision = ?`
        )
        .run(nextRevision, recordJson, run.snapshot.id, run.revision)
      if (Number(result.changes) !== 1) {
        this.database.exec('ROLLBACK')
        return false
      }
      this.database
        .prepare(
          `INSERT INTO resume_agent_tasks (
             id, run_id, kind, created_at, available_at
           ) VALUES (?, ?, ?, ?, ?)`
        )
        .run(task.id, task.runId, task.kind, createdAt, createdAt)
      this.database.exec('COMMIT')
      return true
    } catch (error) {
      this.rollback()
      if (error instanceof RunStoreError) throw error
      throw new RunStoreError('storage_failed')
    }
  }

  async compareAndSetForTask(
    run: StoredResumeAgentRun,
    claim: RunTaskClaimIdentity,
    now: Date
  ): Promise<TaskFencedRunUpdateResult> {
    this.ensureOpen()
    if (
      !Number.isSafeInteger(run.revision) ||
      run.revision < 0 ||
      run.revision >= Number.MAX_SAFE_INTEGER
    ) {
      throw new RunStoreError('serialization_failed')
    }
    const nowMs = now.getTime()
    if (
      !claim.id.trim() ||
      !claim.runId.trim() ||
      !claim.leaseOwner.trim() ||
      !Number.isSafeInteger(claim.attempt) ||
      claim.attempt < 1 ||
      !Number.isSafeInteger(nowMs)
    ) {
      throw new RunStoreError('invalid_task')
    }
    const nextRevision = run.revision + 1
    const recordJson = serializeRecord({ ...run, revision: nextRevision })
    try {
      this.database.exec('BEGIN IMMEDIATE')
      const updated = this.database
        .prepare(
          `UPDATE resume_agent_runs
           SET revision = ?, record_json = ?
           WHERE id = ?
             AND revision = ?
             AND EXISTS (
               SELECT 1
               FROM resume_agent_tasks AS task
               WHERE task.id = ?
                 AND task.run_id = resume_agent_runs.id
                 AND task.run_id = ?
                 AND task.lease_owner = ?
                 AND task.attempts = ?
                 AND task.lease_expires_at > ?
             )
           RETURNING revision`
        )
        .get(
          nextRevision,
          recordJson,
          run.snapshot.id,
          run.revision,
          claim.id,
          claim.runId,
          claim.leaseOwner,
          claim.attempt,
          nowMs
        )
      if (updated) {
        this.database.exec('COMMIT')
        return 'updated'
      }
      const activeClaim = this.database
        .prepare(
          `SELECT 1
           FROM resume_agent_tasks
           WHERE id = ?
             AND run_id = ?
             AND run_id = ?
             AND lease_owner = ?
             AND attempts = ?
             AND lease_expires_at > ?`
        )
        .get(
          claim.id,
          claim.runId,
          run.snapshot.id,
          claim.leaseOwner,
          claim.attempt,
          nowMs
        )
      this.database.exec('COMMIT')
      return activeClaim ? 'revision_conflict' : 'lease_lost'
    } catch (error) {
      this.rollback()
      if (error instanceof RunStoreError) throw error
      throw new RunStoreError('storage_failed')
    }
  }

  async claimNextTask(
    options: ClaimRunTaskOptions
  ): Promise<ClaimedRunTask | undefined> {
    this.ensureOpen()
    const { now, leaseExpiresAt } = claimTimes(options)
    try {
      const row = this.database
        .prepare(
          `UPDATE resume_agent_tasks
           SET lease_owner = ?, lease_expires_at = ?, attempts = attempts + 1
           WHERE id = (
             SELECT candidate.id
             FROM resume_agent_tasks AS candidate
             WHERE candidate.available_at <= ?
               AND (
                 candidate.lease_owner IS NULL OR
                 candidate.lease_expires_at <= ?
               )
               AND NOT EXISTS (
                 SELECT 1
                 FROM resume_agent_tasks AS active
                 WHERE active.run_id = candidate.run_id
                   AND active.lease_owner IS NOT NULL
                   AND active.lease_expires_at > ?
               )
             ORDER BY candidate.available_at, candidate.created_at, candidate.id
             LIMIT 1
           )
           RETURNING
             id,
             run_id,
             kind,
             created_at,
             attempts,
             lease_owner,
             lease_expires_at`
        )
        .get(options.workerId, leaseExpiresAt, now, now, now) as unknown as
        | TaskRow
        | undefined
      return row ? parseClaimedTask(row) : undefined
    } catch (error) {
      if (error instanceof RunStoreError) throw error
      throw new RunStoreError('storage_failed')
    }
  }

  async acknowledgeTask(
    taskId: string,
    leaseOwner: string,
    attempt: number
  ): Promise<boolean> {
    this.ensureOpen()
    if (
      !taskId.trim() ||
      !leaseOwner.trim() ||
      !Number.isSafeInteger(attempt) ||
      attempt < 1
    ) {
      throw new RunStoreError('invalid_task')
    }
    try {
      const result = this.database
        .prepare(
          `DELETE FROM resume_agent_tasks
           WHERE id = ? AND lease_owner = ? AND attempts = ?`
        )
        .run(taskId, leaseOwner, attempt)
      return Number(result.changes) === 1
    } catch {
      throw new RunStoreError('storage_failed')
    }
  }

  async renewTaskLease(
    options: RenewRunTaskLeaseOptions
  ): Promise<ClaimedRunTask | undefined> {
    this.ensureOpen()
    const { now, leaseExpiresAt } = renewalTimes(options)
    try {
      const row = this.database
        .prepare(
          `UPDATE resume_agent_tasks
           SET lease_expires_at = MAX(lease_expires_at, ?)
           WHERE id = ?
             AND run_id = ?
             AND lease_owner = ?
             AND attempts = ?
             AND lease_expires_at > ?
           RETURNING
             id,
             run_id,
             kind,
             created_at,
             attempts,
             lease_owner,
             lease_expires_at`
        )
        .get(
          leaseExpiresAt,
          options.id,
          options.runId,
          options.leaseOwner,
          options.attempt,
          now
        ) as unknown as TaskRow | undefined
      return row ? parseClaimedTask(row) : undefined
    } catch (error) {
      if (error instanceof RunStoreError) throw error
      throw new RunStoreError('storage_failed')
    }
  }

  async releaseTask(
    taskId: string,
    leaseOwner: string,
    attempt: number
  ): Promise<boolean> {
    this.ensureOpen()
    if (
      !taskId.trim() ||
      !leaseOwner.trim() ||
      !Number.isSafeInteger(attempt) ||
      attempt < 1
    ) {
      throw new RunStoreError('invalid_task')
    }
    try {
      const result = this.database
        .prepare(
          `UPDATE resume_agent_tasks
           SET lease_owner = NULL, lease_expires_at = NULL
           WHERE id = ? AND lease_owner = ? AND attempts = ?`
        )
        .run(taskId, leaseOwner, attempt)
      return Number(result.changes) === 1
    } catch {
      throw new RunStoreError('storage_failed')
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    try {
      this.database.close()
    } catch {
      throw new RunStoreError('storage_failed')
    }
  }

  private ensureOpen(): void {
    if (this.closed) throw new RunStoreError('closed')
  }

  private rollback(): void {
    try {
      this.database.exec('ROLLBACK')
    } catch {
      // The failing statement may already have ended the transaction.
    }
  }
}
