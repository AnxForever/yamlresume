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
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

const AUTH_SCHEMA_VERSION = 1
const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1_000
const LOGIN_FAILURE_LIMIT = 5
const LOGIN_BLOCK_MS = 15 * 60 * 1_000
const PASSWORD_DIGEST_BYTES = 64
const PROVIDER_CREDENTIAL_SCHEMA = 'yamlresume-provider-credential-v1'

export type AuthErrorCode =
  | 'invalid_configuration'
  | 'invalid_registration'
  | 'user_exists'
  | 'invalid_credentials'
  | 'login_rate_limited'
  | 'not_authenticated'
  | 'invalid_provider_credential'
  | 'credential_not_found'
  | 'credential_unavailable'
  | 'run_not_found'
  | 'closed'
  | 'storage_failed'

export class AuthError extends Error {
  constructor(readonly code: AuthErrorCode) {
    super(authErrorMessage(code))
    this.name = 'AuthError'
  }
}

export interface AuthUser {
  readonly id: string
  readonly email: string
  readonly createdAt: string
}

export interface AuthSession {
  readonly user: AuthUser
  readonly token: string
  readonly expiresAt: string
}

export interface ProviderCredentialSummary {
  readonly providerId: string
  readonly createdAt: string
  readonly updatedAt: string
}

export interface PasswordScryptParameters {
  readonly cost: number
  readonly blockSize: number
  readonly parallelization: number
  readonly maxmem: number
}

export interface CredentialEncryptionKey {
  readonly id: string
  readonly key: Buffer
}

export interface AuthServiceOptions {
  readonly databasePath: string
  readonly credentialEncryptionKeys: readonly CredentialEncryptionKey[]
  readonly activeCredentialEncryptionKeyId: string
  readonly passwordScrypt?: PasswordScryptParameters
  readonly sessionTtlMs?: number
  readonly now?: () => Date
}

interface PasswordRecord {
  readonly algorithm: 'scrypt'
  readonly version: 1
  readonly cost: number
  readonly blockSize: number
  readonly parallelization: number
  readonly salt: string
  readonly digest: string
}

interface UserRow {
  readonly id: string
  readonly email: string
  readonly password_hash: string
  readonly created_at: number | bigint
}

interface ProviderCredentialRow {
  readonly user_id: string
  readonly provider_id: string
  readonly key_id: string
  readonly nonce: Uint8Array
  readonly ciphertext: Uint8Array
  readonly auth_tag: Uint8Array
  readonly created_at: number | bigint
  readonly updated_at: number | bigint
}

const DEFAULT_PASSWORD_SCRYPT: PasswordScryptParameters = {
  cost: 2 ** 17,
  blockSize: 8,
  parallelization: 1,
  maxmem: 256 * 1024 * 1024,
}

function authErrorMessage(code: AuthErrorCode): string {
  switch (code) {
    case 'invalid_configuration':
      return 'Authentication configuration is invalid'
    case 'invalid_registration':
      return 'Registration data is invalid'
    case 'user_exists':
      return 'An account already exists for this email'
    case 'invalid_credentials':
      return 'Email or password is invalid'
    case 'login_rate_limited':
      return 'Too many login attempts; try again later'
    case 'not_authenticated':
      return 'Authentication is required'
    case 'invalid_provider_credential':
      return 'Provider credential data is invalid'
    case 'credential_not_found':
      return 'Provider credential not found'
    case 'credential_unavailable':
      return 'Provider credential is unavailable'
    case 'run_not_found':
      return 'Run not found'
    case 'closed':
      return 'Authentication service is closed'
    case 'storage_failed':
      return 'Authentication storage operation failed'
  }
}

function isPowerOfTwo(value: number): boolean {
  return value > 1 && (value & (value - 1)) === 0
}

function validateOptions(options: AuthServiceOptions): void {
  const parameters = options.passwordScrypt ?? DEFAULT_PASSWORD_SCRYPT
  const keyIds = options.credentialEncryptionKeys.map(({ id }) => id)
  if (
    !options.databasePath.trim() ||
    !options.activeCredentialEncryptionKeyId.trim() ||
    options.credentialEncryptionKeys.length === 0 ||
    new Set(keyIds).size !== keyIds.length ||
    options.credentialEncryptionKeys.some(
      ({ id, key }) => !id.trim() || key.byteLength !== 32
    ) ||
    !keyIds.includes(options.activeCredentialEncryptionKeyId) ||
    !Number.isSafeInteger(parameters.cost) ||
    !isPowerOfTwo(parameters.cost) ||
    !Number.isSafeInteger(parameters.blockSize) ||
    parameters.blockSize < 1 ||
    !Number.isSafeInteger(parameters.parallelization) ||
    parameters.parallelization < 1 ||
    !Number.isSafeInteger(parameters.maxmem) ||
    parameters.maxmem < 128 * parameters.cost * parameters.blockSize ||
    (options.sessionTtlMs !== undefined &&
      (!Number.isSafeInteger(options.sessionTtlMs) ||
        options.sessionTtlMs < 60_000))
  ) {
    throw new AuthError('invalid_configuration')
  }
}

function migrate(database: DatabaseSync): void {
  try {
    database.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS resume_agent_auth_schema (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        version INTEGER NOT NULL CHECK (version >= 1)
      ) STRICT;
      INSERT INTO resume_agent_auth_schema (singleton, version)
      VALUES (1, ${AUTH_SCHEMA_VERSION})
      ON CONFLICT(singleton) DO NOTHING;
      CREATE TABLE IF NOT EXISTS resume_agent_users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS resume_agent_sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES resume_agent_users(id) ON DELETE CASCADE
      ) STRICT;
      CREATE INDEX IF NOT EXISTS resume_agent_sessions_user_expiry
      ON resume_agent_sessions (user_id, expires_at);
      CREATE TABLE IF NOT EXISTS resume_agent_login_failures (
        email_hash TEXT PRIMARY KEY,
        failures INTEGER NOT NULL CHECK (failures >= 1),
        blocked_until INTEGER
      ) STRICT;
      CREATE TABLE IF NOT EXISTS resume_agent_provider_credentials (
        user_id TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        key_id TEXT NOT NULL,
        nonce BLOB NOT NULL,
        ciphertext BLOB NOT NULL,
        auth_tag BLOB NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, provider_id),
        FOREIGN KEY (user_id) REFERENCES resume_agent_users(id) ON DELETE CASCADE
      ) STRICT;
      CREATE TABLE IF NOT EXISTS resume_agent_run_owners (
        run_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES resume_agent_users(id) ON DELETE CASCADE
      ) STRICT;
      CREATE INDEX IF NOT EXISTS resume_agent_run_owners_user
      ON resume_agent_run_owners (user_id, created_at);
      COMMIT;
    `)
    const schema = database
      .prepare(
        'SELECT version FROM resume_agent_auth_schema WHERE singleton = 1'
      )
      .get() as { version?: number | bigint } | undefined
    if (Number(schema?.version) !== AUTH_SCHEMA_VERSION) {
      throw new AuthError('invalid_configuration')
    }
  } catch (error) {
    try {
      database.exec('ROLLBACK')
    } catch {
      // The transaction may already have committed or rolled back.
    }
    if (error instanceof AuthError) throw error
    throw new AuthError('storage_failed')
  }
}

function canonicalEmail(email: string): string {
  const canonical = email.trim().toLocaleLowerCase('en-US')
  if (
    canonical.length < 3 ||
    canonical.length > 320 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(canonical)
  ) {
    throw new AuthError('invalid_registration')
  }
  return canonical
}

function validatePassword(password: string): void {
  if (password.length < 12 || password.length > 128) {
    throw new AuthError('invalid_registration')
  }
}

function derivePassword(
  password: string,
  salt: Buffer,
  parameters: PasswordScryptParameters
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      PASSWORD_DIGEST_BYTES,
      {
        N: parameters.cost,
        r: parameters.blockSize,
        p: parameters.parallelization,
        maxmem: parameters.maxmem,
      },
      (error, key) => (error ? reject(error) : resolve(key))
    )
  })
}

async function passwordRecord(
  password: string,
  parameters: PasswordScryptParameters
): Promise<string> {
  const salt = randomBytes(16)
  const digest = await derivePassword(password, salt, parameters)
  const record: PasswordRecord = {
    algorithm: 'scrypt',
    version: 1,
    cost: parameters.cost,
    blockSize: parameters.blockSize,
    parallelization: parameters.parallelization,
    salt: salt.toString('base64'),
    digest: digest.toString('base64'),
  }
  return JSON.stringify(record)
}

function parsePasswordRecord(value: string): PasswordRecord {
  try {
    const record = JSON.parse(value) as Partial<PasswordRecord>
    if (
      record.algorithm !== 'scrypt' ||
      record.version !== 1 ||
      !Number.isSafeInteger(record.cost) ||
      !isPowerOfTwo(record.cost ?? 0) ||
      !Number.isSafeInteger(record.blockSize) ||
      (record.blockSize ?? 0) < 1 ||
      !Number.isSafeInteger(record.parallelization) ||
      (record.parallelization ?? 0) < 1 ||
      typeof record.salt !== 'string' ||
      typeof record.digest !== 'string'
    ) {
      throw new Error('Invalid password record')
    }
    const salt = Buffer.from(record.salt, 'base64')
    const digest = Buffer.from(record.digest, 'base64')
    if (salt.byteLength !== 16 || digest.byteLength !== PASSWORD_DIGEST_BYTES) {
      throw new Error('Invalid password record encoding')
    }
    return record as PasswordRecord
  } catch {
    throw new AuthError('storage_failed')
  }
}

function toUser(row: Pick<UserRow, 'id' | 'email' | 'created_at'>): AuthUser {
  const createdAt = Number(row.created_at)
  if (!Number.isSafeInteger(createdAt)) throw new AuthError('storage_failed')
  return {
    id: row.id,
    email: row.email,
    createdAt: new Date(createdAt).toISOString(),
  }
}

function sessionTokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('base64url')
}

function loginFailureKey(email: string): string {
  return createHash('sha256').update(email, 'utf8').digest('base64url')
}

function validateProviderId(providerId: string): void {
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(providerId)) {
    throw new AuthError('invalid_provider_credential')
  }
}

function validateApiKey(apiKey: string): void {
  if (apiKey.length < 1 || apiKey.length > 8_192 || apiKey.includes('\0')) {
    throw new AuthError('invalid_provider_credential')
  }
}

function credentialAdditionalData(
  userId: string,
  providerId: string,
  keyId: string
): Buffer {
  return Buffer.from(
    JSON.stringify({
      schema: PROVIDER_CREDENTIAL_SCHEMA,
      userId,
      providerId,
      keyId,
    }),
    'utf8'
  )
}

function toProviderCredentialSummary(
  row: Pick<ProviderCredentialRow, 'provider_id' | 'created_at' | 'updated_at'>
): ProviderCredentialSummary {
  const createdAt = Number(row.created_at)
  const updatedAt = Number(row.updated_at)
  if (!Number.isSafeInteger(createdAt) || !Number.isSafeInteger(updatedAt)) {
    throw new AuthError('storage_failed')
  }
  return {
    providerId: row.provider_id,
    createdAt: new Date(createdAt).toISOString(),
    updatedAt: new Date(updatedAt).toISOString(),
  }
}

export class AuthService {
  private closed = false

  private constructor(
    private readonly database: DatabaseSync,
    private readonly passwordScrypt: PasswordScryptParameters,
    private readonly sessionTtlMs: number,
    private readonly now: () => Date,
    private readonly dummyPasswordRecord: PasswordRecord,
    private readonly credentialEncryptionKeys: ReadonlyMap<string, Buffer>,
    private readonly activeCredentialEncryptionKeyId: string
  ) {}

  static async open(options: AuthServiceOptions): Promise<AuthService> {
    validateOptions(options)
    let database: DatabaseSync | undefined
    try {
      const { DatabaseSync } = await import('node:sqlite')
      database = new DatabaseSync(options.databasePath, {
        allowExtension: false,
        enableDoubleQuotedStringLiterals: false,
      })
      database.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
      migrate(database)
      const passwordScrypt = options.passwordScrypt ?? DEFAULT_PASSWORD_SCRYPT
      const dummyPasswordRecord = parsePasswordRecord(
        await passwordRecord(
          randomBytes(32).toString('base64url'),
          passwordScrypt
        )
      )
      return new AuthService(
        database,
        passwordScrypt,
        options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS,
        options.now ?? (() => new Date()),
        dummyPasswordRecord,
        new Map(
          options.credentialEncryptionKeys.map(({ id, key }) => [
            id,
            Buffer.from(key),
          ])
        ),
        options.activeCredentialEncryptionKeyId
      )
    } catch (error) {
      try {
        database?.close()
      } catch {
        // Opening failed; there is no usable connection to preserve.
      }
      if (error instanceof AuthError) throw error
      throw new AuthError('storage_failed')
    }
  }

  async register(input: {
    email: string
    password: string
  }): Promise<AuthSession> {
    this.ensureOpen()
    const email = canonicalEmail(input.email)
    validatePassword(input.password)
    const passwordHash = await passwordRecord(
      input.password,
      this.passwordScrypt
    )
    const createdAt = this.now().getTime()
    const row: UserRow = {
      id: randomUUID(),
      email,
      password_hash: passwordHash,
      created_at: createdAt,
    }
    try {
      this.database
        .prepare(
          `INSERT INTO resume_agent_users (
             id, email, password_hash, created_at
           ) VALUES (?, ?, ?, ?)`
        )
        .run(row.id, row.email, row.password_hash, createdAt)
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes('UNIQUE constraint failed')
      ) {
        throw new AuthError('user_exists')
      }
      throw new AuthError('storage_failed')
    }
    this.clearLoginFailures(email)
    return this.issueSession(toUser(row))
  }

  async login(input: {
    email: string
    password: string
  }): Promise<AuthSession> {
    this.ensureOpen()
    let email: string
    try {
      email = canonicalEmail(input.email)
      validatePassword(input.password)
    } catch {
      throw new AuthError('invalid_credentials')
    }
    const now = this.now().getTime()
    this.ensureLoginAllowed(email, now)
    let row: UserRow | undefined
    try {
      row = this.database
        .prepare(
          `SELECT id, email, password_hash, created_at
           FROM resume_agent_users WHERE email = ?`
        )
        .get(email) as unknown as UserRow | undefined
    } catch {
      throw new AuthError('storage_failed')
    }
    const record = row
      ? parsePasswordRecord(row.password_hash)
      : this.dummyPasswordRecord
    const parameters: PasswordScryptParameters = {
      cost: record.cost,
      blockSize: record.blockSize,
      parallelization: record.parallelization,
      maxmem: Math.max(
        this.passwordScrypt.maxmem,
        128 * record.cost * record.blockSize + 1024 * 1024
      ),
    }
    const actual = await derivePassword(
      input.password,
      Buffer.from(record.salt, 'base64'),
      parameters
    )
    const expected = Buffer.from(record.digest, 'base64')
    if (!row || !timingSafeEqual(actual, expected)) {
      this.recordLoginFailure(email, now)
      throw new AuthError('invalid_credentials')
    }
    this.clearLoginFailures(email)
    return this.issueSession(toUser(row))
  }

  async authenticate(token: string): Promise<AuthUser> {
    this.ensureOpen()
    if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) {
      throw new AuthError('not_authenticated')
    }
    let row: Pick<UserRow, 'id' | 'email' | 'created_at'> | undefined
    try {
      row = this.database
        .prepare(
          `SELECT users.id, users.email, users.created_at
           FROM resume_agent_sessions AS sessions
           JOIN resume_agent_users AS users ON users.id = sessions.user_id
           WHERE sessions.token_hash = ? AND sessions.expires_at > ?`
        )
        .get(sessionTokenHash(token), this.now().getTime()) as unknown as
        | Pick<UserRow, 'id' | 'email' | 'created_at'>
        | undefined
    } catch {
      throw new AuthError('storage_failed')
    }
    if (!row) throw new AuthError('not_authenticated')
    return toUser(row)
  }

  async logout(token: string | undefined): Promise<void> {
    this.ensureOpen()
    if (!token || !/^[A-Za-z0-9_-]{43}$/u.test(token)) return
    try {
      this.database
        .prepare('DELETE FROM resume_agent_sessions WHERE token_hash = ?')
        .run(sessionTokenHash(token))
    } catch {
      throw new AuthError('storage_failed')
    }
  }

  async putProviderCredential(
    userId: string,
    input: { providerId: string; apiKey: string }
  ): Promise<ProviderCredentialSummary> {
    this.ensureOpen()
    validateProviderId(input.providerId)
    validateApiKey(input.apiKey)
    const key = this.credentialEncryptionKeys.get(
      this.activeCredentialEncryptionKeyId
    )
    if (!key) throw new AuthError('invalid_configuration')
    const nonce = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, nonce, {
      authTagLength: 16,
    })
    cipher.setAAD(
      credentialAdditionalData(
        userId,
        input.providerId,
        this.activeCredentialEncryptionKeyId
      )
    )
    const ciphertext = Buffer.concat([
      cipher.update(input.apiKey, 'utf8'),
      cipher.final(),
    ])
    const authTag = cipher.getAuthTag()
    const now = this.now().getTime()
    try {
      this.database
        .prepare(
          `INSERT INTO resume_agent_provider_credentials (
             user_id, provider_id, key_id, nonce, ciphertext, auth_tag,
             created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id, provider_id) DO UPDATE SET
             key_id = excluded.key_id,
             nonce = excluded.nonce,
             ciphertext = excluded.ciphertext,
             auth_tag = excluded.auth_tag,
             updated_at = excluded.updated_at`
        )
        .run(
          userId,
          input.providerId,
          this.activeCredentialEncryptionKeyId,
          nonce,
          ciphertext,
          authTag,
          now,
          now
        )
      const row = this.database
        .prepare(
          `SELECT provider_id, created_at, updated_at
           FROM resume_agent_provider_credentials
           WHERE user_id = ? AND provider_id = ?`
        )
        .get(userId, input.providerId) as unknown as
        | Pick<
            ProviderCredentialRow,
            'provider_id' | 'created_at' | 'updated_at'
          >
        | undefined
      if (!row) throw new AuthError('storage_failed')
      return toProviderCredentialSummary(row)
    } catch (error) {
      if (error instanceof AuthError) throw error
      throw new AuthError('storage_failed')
    }
  }

  async listProviderCredentials(
    userId: string
  ): Promise<ProviderCredentialSummary[]> {
    this.ensureOpen()
    try {
      const rows = this.database
        .prepare(
          `SELECT provider_id, created_at, updated_at
           FROM resume_agent_provider_credentials
           WHERE user_id = ? ORDER BY provider_id`
        )
        .all(userId) as unknown as Array<
        Pick<ProviderCredentialRow, 'provider_id' | 'created_at' | 'updated_at'>
      >
      return rows.map(toProviderCredentialSummary)
    } catch (error) {
      if (error instanceof AuthError) throw error
      throw new AuthError('storage_failed')
    }
  }

  async readProviderCredential(
    userId: string,
    providerId: string
  ): Promise<string> {
    this.ensureOpen()
    validateProviderId(providerId)
    let row: ProviderCredentialRow | undefined
    try {
      row = this.database
        .prepare(
          `SELECT user_id, provider_id, key_id, nonce, ciphertext, auth_tag,
                  created_at, updated_at
           FROM resume_agent_provider_credentials
           WHERE user_id = ? AND provider_id = ?`
        )
        .get(userId, providerId) as unknown as ProviderCredentialRow | undefined
    } catch {
      throw new AuthError('storage_failed')
    }
    if (!row) throw new AuthError('credential_not_found')
    const key = this.credentialEncryptionKeys.get(row.key_id)
    if (!key) throw new AuthError('credential_unavailable')
    try {
      const nonce = Buffer.from(row.nonce)
      const authTag = Buffer.from(row.auth_tag)
      if (nonce.byteLength !== 12 || authTag.byteLength !== 16) {
        throw new Error('Invalid encrypted credential envelope')
      }
      const decipher = createDecipheriv('aes-256-gcm', key, nonce, {
        authTagLength: 16,
      })
      decipher.setAAD(
        credentialAdditionalData(row.user_id, row.provider_id, row.key_id)
      )
      decipher.setAuthTag(authTag)
      return Buffer.concat([
        decipher.update(Buffer.from(row.ciphertext)),
        decipher.final(),
      ]).toString('utf8')
    } catch {
      throw new AuthError('credential_unavailable')
    }
  }

  async deleteProviderCredential(
    userId: string,
    providerId: string
  ): Promise<boolean> {
    this.ensureOpen()
    validateProviderId(providerId)
    try {
      const result = this.database
        .prepare(
          `DELETE FROM resume_agent_provider_credentials
           WHERE user_id = ? AND provider_id = ?`
        )
        .run(userId, providerId)
      return result.changes > 0
    } catch {
      throw new AuthError('storage_failed')
    }
  }

  async claimRun(userId: string, runId: string): Promise<void> {
    this.ensureOpen()
    if (!runId.trim() || runId.length > 128) {
      throw new AuthError('run_not_found')
    }
    try {
      this.database
        .prepare(
          `INSERT INTO resume_agent_run_owners (run_id, user_id, created_at)
           VALUES (?, ?, ?) ON CONFLICT(run_id) DO NOTHING`
        )
        .run(runId, userId, this.now().getTime())
      const row = this.database
        .prepare('SELECT user_id FROM resume_agent_run_owners WHERE run_id = ?')
        .get(runId) as { user_id: string } | undefined
      if (row?.user_id !== userId) throw new AuthError('run_not_found')
    } catch (error) {
      if (error instanceof AuthError) throw error
      throw new AuthError('storage_failed')
    }
  }

  async isRunOwner(userId: string, runId: string): Promise<boolean> {
    this.ensureOpen()
    if (!runId.trim() || runId.length > 128) return false
    try {
      const row = this.database
        .prepare(
          `SELECT 1 AS owned FROM resume_agent_run_owners
           WHERE run_id = ? AND user_id = ?`
        )
        .get(runId, userId) as { owned: number | bigint } | undefined
      return Number(row?.owned) === 1
    } catch {
      throw new AuthError('storage_failed')
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    try {
      this.database.close()
    } finally {
      for (const key of this.credentialEncryptionKeys.values()) key.fill(0)
    }
  }

  private issueSession(user: AuthUser): AuthSession {
    const token = randomBytes(32).toString('base64url')
    const createdAt = this.now().getTime()
    const expiresAt = createdAt + this.sessionTtlMs
    try {
      this.database
        .prepare(
          `INSERT INTO resume_agent_sessions (
             token_hash, user_id, created_at, expires_at
           ) VALUES (?, ?, ?, ?)`
        )
        .run(sessionTokenHash(token), user.id, createdAt, expiresAt)
    } catch {
      throw new AuthError('storage_failed')
    }
    return {
      user,
      token,
      expiresAt: new Date(expiresAt).toISOString(),
    }
  }

  private ensureLoginAllowed(email: string, now: number): void {
    try {
      const key = loginFailureKey(email)
      const row = this.database
        .prepare(
          `SELECT blocked_until FROM resume_agent_login_failures
           WHERE email_hash = ?`
        )
        .get(key) as { blocked_until: number | bigint | null } | undefined
      if (!row?.blocked_until) return
      if (Number(row.blocked_until) > now) {
        throw new AuthError('login_rate_limited')
      }
      this.database
        .prepare('DELETE FROM resume_agent_login_failures WHERE email_hash = ?')
        .run(key)
    } catch (error) {
      if (error instanceof AuthError) throw error
      throw new AuthError('storage_failed')
    }
  }

  private recordLoginFailure(email: string, now: number): void {
    try {
      this.database
        .prepare(
          `INSERT INTO resume_agent_login_failures (
             email_hash, failures, blocked_until
           ) VALUES (?, 1, NULL)
           ON CONFLICT(email_hash) DO UPDATE SET
             failures = failures + 1,
             blocked_until = CASE
               WHEN failures + 1 >= ? THEN COALESCE(blocked_until, ?)
               ELSE blocked_until
             END`
        )
        .run(loginFailureKey(email), LOGIN_FAILURE_LIMIT, now + LOGIN_BLOCK_MS)
    } catch {
      throw new AuthError('storage_failed')
    }
  }

  private clearLoginFailures(email: string): void {
    try {
      this.database
        .prepare('DELETE FROM resume_agent_login_failures WHERE email_hash = ?')
        .run(loginFailureKey(email))
    } catch {
      throw new AuthError('storage_failed')
    }
  }

  private ensureOpen(): void {
    if (this.closed) throw new AuthError('closed')
  }
}
