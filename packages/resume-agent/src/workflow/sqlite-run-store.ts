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

import type { RunStore, StoredResumeAgentRun } from '@/workflow/run'

const SCHEMA_VERSION = 1
const DEFAULT_BUSY_TIMEOUT_MS = 5_000

export type RunStoreErrorCode =
  | 'invalid_configuration'
  | 'open_failed'
  | 'unsupported_schema'
  | 'closed'
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

export class SqliteRunStore implements RunStore {
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
}
