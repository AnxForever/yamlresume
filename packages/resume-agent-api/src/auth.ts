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
import {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  fetchIdentity,
  OAuthError,
  type OAuthHttpDeps,
  type OAuthIdentity,
  type OAuthProviderDescriptor,
  pkceChallenge,
  randomUrlSafe,
} from './oauth'

/**
 * Schema version, checked for *strict equality* after `migrate` runs — a
 * database written by a newer build is refused rather than silently used.
 *
 * New tables therefore go into the same idempotent `CREATE TABLE IF NOT
 * EXISTS` block below and leave this number alone: re-running the block adds
 * them to an existing file. Bump this only for a change that rewrites or
 * reinterprets existing rows, and bring real migration code with it.
 */
const AUTH_SCHEMA_VERSION = 1
const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1_000
/** Used when the user did not tick "remember me"; the cookie dies with the browser. */
const DEFAULT_TRANSIENT_SESSION_TTL_MS = 12 * 60 * 60 * 1_000
const LOGIN_FAILURE_LIMIT = 5
const LOGIN_BLOCK_MS = 15 * 60 * 1_000
const PASSWORD_DIGEST_BYTES = 64
/** How long a reset link stays usable. Short: it is a credential. */
const DEFAULT_PASSWORD_RESET_TTL_MS = 30 * 60 * 1_000
/** Requests accepted per address inside the window below. */
const PASSWORD_RESET_REQUEST_LIMIT = 5
const PASSWORD_RESET_WINDOW_MS = 60 * 60 * 1_000
/** How long a started sign-in may take to come back from the provider. */
const OAUTH_STATE_TTL_MS = 10 * 60 * 1_000
/**
 * Accounts created through a provider have no password. The stored value is a
 * marker that can never match a real password record, so `login` rejects it:
 * the account can only be entered through the provider, or by completing a
 * reset (which is how such a user sets a password for the first time).
 */
const OAUTH_ONLY_PASSWORD = 'oauth-only'
const PROVIDER_CREDENTIAL_SCHEMA = 'yamlresume-provider-credential-v1'
const PROFILE_SCHEMA = 'yamlresume-profile-v1'
/**
 * Ceiling on the plaintext profile payload. The resume, the tailor preferences
 * and the text materials all live in one document, so the cap is generous —
 * but it is a cap: the encrypted row is a single SQLite value, not a document
 * store, and an unbounded write here would be a memory and disk problem later.
 */
const MAX_PROFILE_BYTES = 1_048_576

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
  | 'invalid_profile'
  | 'profile_unavailable'
  | 'invalid_reset_token'
  | 'invalid_invite_code'
  | 'invalid_oauth_state'
  | 'oauth_email_unverified'
  | 'oauth_email_unavailable'
  | 'oauth_failed'
  | 'oauth_unavailable'
  | 'reset_rate_limited'
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
  /**
   * `true` when the client asked to be remembered: the cookie carries an
   * `Expires` date and survives a browser restart. `false` means a session
   * cookie that the browser discards when it closes, even though the
   * server-side row still expires on its own (shorter) schedule.
   */
  readonly persistent: boolean
}

export interface AuthCredentials {
  readonly email: string
  readonly password: string
  /** Keep the session across browser restarts. Defaults to `false`. */
  readonly remember?: boolean
}

export interface ProviderCredentialSummary {
  readonly providerId: string
  readonly createdAt: string
  readonly updatedAt: string
}

/** When a profile was first written and last replaced. Never its contents. */
export interface ProfileSummary {
  readonly createdAt: string
  readonly updatedAt: string
}

export interface StoredProfile extends ProfileSummary {
  /**
   * The decrypted payload, exactly as it was written.
   *
   * The service treats this as an opaque string: it enforces a size ceiling and
   * encrypts it, but it does not know — or need to know — that the bytes happen
   * to be the JSON document the HTTP layer validated. Keeping the seam there
   * means the profile shape can change without a storage migration.
   */
  readonly payload: string
}

export interface WorkRateLimitPolicy {
  readonly limit: number
  readonly windowMs: number
}

export interface WorkRateLimitDecision {
  readonly allowed: boolean
  readonly limit: number
  readonly remaining: number
  readonly resetAt: string
  readonly retryAfterSeconds: number
}

export interface PasswordScryptParameters {
  readonly cost: number
  readonly blockSize: number
  readonly parallelization: number
  readonly maxmem: number
}

/**
 * Where a reset link is sent. The service never delivers mail itself: it hands
 * the raw link to this port, so tests can capture it and a deployment can plug
 * in SMTP or a transactional email API. The default adapter writes to the
 * server log, which is enough to complete a reset on a development machine.
 */
export interface AuthEmailPort {
  sendPasswordReset(message: {
    readonly to: string
    readonly resetUrl: string
    readonly expiresAt: string
  }): Promise<void>
}

export function createLoggingEmailPort(
  log: (line: string) => void = (line) => console.log(line)
): AuthEmailPort {
  return {
    async sendPasswordReset({ to, resetUrl, expiresAt }) {
      log(`[auth] password reset for ${to} (expires ${expiresAt}): ${resetUrl}`)
    },
  }
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
  /**
   * Lifetime used when `remember` is not set. Deliberately much shorter than
   * `sessionTtlMs`: the cookie dies with the browser anyway, and a short
   * server-side expiry bounds how long a leaked token stays usable.
   */
  readonly transientSessionTtlMs?: number
  readonly passwordResetTtlMs?: number
  readonly emailPort?: AuthEmailPort
  /** Public base URL used to build the link the user clicks. */
  readonly resetUrlBase?: string
  /** Providers with credentials configured. Empty means social sign-in is off. */
  readonly oauthProviders?: readonly OAuthProviderDescriptor[]
  readonly oauthRedirectBase?: string
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

interface ProfileRow {
  readonly user_id: string
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
    case 'invalid_reset_token':
      return 'The password reset link is invalid or has expired'
    case 'invalid_invite_code':
      return 'A valid invitation code is required to register'
    case 'invalid_oauth_state':
      return 'The sign-in attempt expired or did not match; start again'
    case 'oauth_email_unverified':
      return 'The provider did not verify this email address'
    case 'oauth_email_unavailable':
      return 'The provider did not return an email address'
    case 'oauth_failed':
      return 'Sign-in with that provider failed'
    case 'oauth_unavailable':
      return 'That sign-in provider is not configured'
    case 'reset_rate_limited':
      return 'Too many reset requests; try again later'
    case 'not_authenticated':
      return 'Authentication is required'
    case 'invalid_provider_credential':
      return 'Provider credential data is invalid'
    case 'credential_not_found':
      return 'Provider credential not found'
    case 'credential_unavailable':
      return 'Provider credential is unavailable'
    case 'invalid_profile':
      return 'Profile data is invalid'
    case 'profile_unavailable':
      return 'Profile is unavailable'
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
        options.sessionTtlMs < 60_000)) ||
    (options.transientSessionTtlMs !== undefined &&
      (!Number.isSafeInteger(options.transientSessionTtlMs) ||
        options.transientSessionTtlMs < 60_000)) ||
    (options.passwordResetTtlMs !== undefined &&
      (!Number.isSafeInteger(options.passwordResetTtlMs) ||
        options.passwordResetTtlMs < 60_000))
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
      CREATE TABLE IF NOT EXISTS resume_agent_password_resets (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        used_at INTEGER,
        FOREIGN KEY (user_id) REFERENCES resume_agent_users(id) ON DELETE CASCADE
      ) STRICT;
      CREATE INDEX IF NOT EXISTS resume_agent_password_resets_user
      ON resume_agent_password_resets (user_id, expires_at);
      CREATE TABLE IF NOT EXISTS resume_agent_oauth_states (
        state_hash TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        code_verifier TEXT,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        used_at INTEGER
      ) STRICT;
      CREATE TABLE IF NOT EXISTS resume_agent_oauth_identities (
        provider_id TEXT NOT NULL,
        subject TEXT NOT NULL,
        user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (provider_id, subject),
        FOREIGN KEY (user_id) REFERENCES resume_agent_users(id) ON DELETE CASCADE
      ) STRICT;
      CREATE TABLE IF NOT EXISTS resume_agent_reset_requests (
        email_hash TEXT PRIMARY KEY,
        requests INTEGER NOT NULL CHECK (requests >= 1),
        window_started_at INTEGER NOT NULL
      ) STRICT;
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
      CREATE TABLE IF NOT EXISTS resume_agent_profiles (
        user_id TEXT PRIMARY KEY,
        key_id TEXT NOT NULL,
        nonce BLOB NOT NULL,
        ciphertext BLOB NOT NULL,
        auth_tag BLOB NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES resume_agent_users(id) ON DELETE CASCADE
      ) STRICT;
      CREATE TABLE IF NOT EXISTS resume_agent_work_rate_limits (
        user_id TEXT PRIMARY KEY,
        requests INTEGER NOT NULL CHECK (requests >= 1),
        window_started_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES resume_agent_users(id) ON DELETE CASCADE
      ) STRICT;
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

/** Lowercases without throwing, for cleanup paths that must not fail. */
function canonicalEmailSafe(email: string): string {
  try {
    return canonicalEmail(email)
  } catch {
    return email.trim().toLocaleLowerCase('en-US')
  }
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

/**
 * Binds the ciphertext to the account it belongs to and to the key that sealed
 * it, so a row copied between users — or decrypted under the wrong key id —
 * fails authentication instead of returning someone else's resume.
 */
function profileAdditionalData(userId: string, keyId: string): Buffer {
  return Buffer.from(
    JSON.stringify({ schema: PROFILE_SCHEMA, userId, keyId }),
    'utf8'
  )
}

function validateProfilePayload(payload: string): void {
  if (
    payload.length === 0 ||
    payload.includes('\0') ||
    Buffer.byteLength(payload, 'utf8') > MAX_PROFILE_BYTES
  ) {
    throw new AuthError('invalid_profile')
  }
}

function toProfileSummary(
  row: Pick<ProfileRow, 'created_at' | 'updated_at'>
): ProfileSummary {
  const createdAt = Number(row.created_at)
  const updatedAt = Number(row.updated_at)
  if (!Number.isSafeInteger(createdAt) || !Number.isSafeInteger(updatedAt)) {
    throw new AuthError('storage_failed')
  }
  return {
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
    private readonly transientSessionTtlMs: number,
    private readonly passwordResetTtlMs: number,
    private readonly emailPort: AuthEmailPort,
    private readonly resetUrlBase: string,
    private readonly oauthProviders: readonly OAuthProviderDescriptor[],
    private readonly oauthRedirectBase: string,
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
        options.transientSessionTtlMs ?? DEFAULT_TRANSIENT_SESSION_TTL_MS,
        options.passwordResetTtlMs ?? DEFAULT_PASSWORD_RESET_TTL_MS,
        options.emailPort ?? createLoggingEmailPort(),
        options.resetUrlBase ?? 'http://localhost:3100',
        options.oauthProviders ?? [],
        options.oauthRedirectBase ?? 'http://localhost:8790',
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

  async register(input: AuthCredentials): Promise<AuthSession> {
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
    return this.issueSession(toUser(row), input.remember === true)
  }

  async login(input: AuthCredentials): Promise<AuthSession> {
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
    // An account created through a provider stores a sentinel instead of a
    // password record. Parsing it would throw a raw error (and a 500 that
    // reveals the account exists), so it is treated as "wrong credentials"
    // and hashed against the dummy record like any other unknown address.
    let record: PasswordRecord
    try {
      record = row
        ? parsePasswordRecord(row.password_hash)
        : this.dummyPasswordRecord
    } catch {
      record = this.dummyPasswordRecord
    }
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
    return this.issueSession(toUser(row), input.remember === true)
  }

  /** Providers exposed to clients; empty when none are configured. */
  listOAuthProviders(): Array<{ id: string; label: string }> {
    return this.oauthProviders.map(({ id, label }) => ({ id, label }))
  }

  /**
   * Begin a sign-in. Returns the URL to send the browser to; the `state` and
   * the PKCE verifier are kept server-side, so a callback can only complete a
   * flow this server actually started.
   */
  beginOAuth(
    providerId: string,
    options: { redirectBase?: string } = {}
  ): string {
    this.ensureOpen()
    const provider = this.oauthProviders.find(
      (entry) => entry.id === providerId
    )
    if (!provider) {
      throw new AuthError('oauth_unavailable')
    }
    const state = randomUrlSafe()
    const codeVerifier = provider.usesPkce ? randomUrlSafe() : undefined
    const now = this.now().getTime()
    try {
      // Drop anything already expired so the table cannot grow without bound.
      this.database
        .prepare('DELETE FROM resume_agent_oauth_states WHERE expires_at <= ?')
        .run(now)
      this.database
        .prepare(
          `INSERT INTO resume_agent_oauth_states (
             state_hash, provider_id, code_verifier, created_at, expires_at, used_at
           ) VALUES (?, ?, ?, ?, ?, NULL)`
        )
        .run(
          sessionTokenHash(state),
          provider.id,
          codeVerifier ?? null,
          now,
          now + OAUTH_STATE_TTL_MS
        )
    } catch {
      throw new AuthError('storage_failed')
    }
    return buildAuthorizeUrl(provider, {
      state,
      redirectUri: this.oauthRedirectUri(provider.id, options.redirectBase),
      ...(codeVerifier ? { codeChallenge: pkceChallenge(codeVerifier) } : {}),
    })
  }

  /**
   * Finish a sign-in. The account is linked by the provider's own subject id,
   * never by email alone: an address the provider has not verified could
   * otherwise be used to take over an existing account.
   */
  async completeOAuth(
    providerId: string,
    options: { code: string; state: string; redirectBase?: string },
    deps: OAuthHttpDeps = {}
  ): Promise<AuthSession> {
    this.ensureOpen()
    const provider = this.oauthProviders.find(
      (entry) => entry.id === providerId
    )
    if (!provider) {
      throw new AuthError('oauth_unavailable')
    }
    const now = this.now().getTime()

    let stateRow:
      | {
          provider_id: string
          code_verifier: string | null
          expires_at: number
          used_at: number | null
        }
      | undefined
    try {
      stateRow = this.database
        .prepare(
          `SELECT provider_id, code_verifier, expires_at, used_at
           FROM resume_agent_oauth_states WHERE state_hash = ?`
        )
        .get(sessionTokenHash(options.state)) as unknown as
        | {
            provider_id: string
            code_verifier: string | null
            expires_at: number
            used_at: number | null
          }
        | undefined
    } catch {
      throw new AuthError('storage_failed')
    }
    if (
      !stateRow ||
      stateRow.provider_id !== provider.id ||
      stateRow.used_at !== null ||
      Number(stateRow.expires_at) <= now
    ) {
      throw new AuthError('invalid_oauth_state')
    }

    let identity: OAuthIdentity
    try {
      const token = await exchangeCodeForToken(
        provider,
        {
          code: options.code,
          redirectUri: this.oauthRedirectUri(provider.id, options.redirectBase),
          ...(stateRow.code_verifier
            ? { codeVerifier: stateRow.code_verifier }
            : {}),
        },
        deps
      )
      identity = await fetchIdentity(provider, token, deps)
    } catch (error) {
      if (
        error instanceof OAuthError &&
        error.code === 'oauth_email_unavailable'
      ) {
        throw new AuthError('oauth_email_unavailable')
      }
      throw new AuthError('oauth_failed')
    }

    try {
      this.database
        .prepare(
          'UPDATE resume_agent_oauth_states SET used_at = ? WHERE state_hash = ?'
        )
        .run(now, sessionTokenHash(options.state))
    } catch {
      throw new AuthError('storage_failed')
    }

    const user = this.linkOAuthIdentity(provider.id, identity, now)
    return this.issueSession(user, false)
  }

  /**
   * Find or create the account behind an identity.
   *
   * A known (provider, subject) pair wins outright. Otherwise the first
   * verified address claims an existing account with that email, or creates
   * one; an unverified address may only ever create a *new* account, so it can
   * never be used to reach somebody else's.
   */
  private linkOAuthIdentity(
    providerId: string,
    identity: OAuthIdentity,
    now: number
  ): AuthUser {
    let email: string
    try {
      email = canonicalEmail(identity.email)
    } catch {
      throw new AuthError('oauth_email_unavailable')
    }
    try {
      const known = this.database
        .prepare(
          `SELECT users.id, users.email, users.created_at
           FROM resume_agent_oauth_identities AS identities
           JOIN resume_agent_users AS users ON users.id = identities.user_id
           WHERE identities.provider_id = ? AND identities.subject = ?`
        )
        .get(providerId, identity.subject) as unknown as
        | Pick<UserRow, 'id' | 'email' | 'created_at'>
        | undefined
      if (known) {
        return toUser(known)
      }

      const existing = this.database
        .prepare(
          'SELECT id, email, created_at FROM resume_agent_users WHERE email = ?'
        )
        .get(email) as unknown as
        | Pick<UserRow, 'id' | 'email' | 'created_at'>
        | undefined

      if (existing && !identity.emailVerified) {
        // Refuse rather than silently creating a second account for the same
        // address: the user would end up with two logins and no explanation.
        throw new AuthError('oauth_email_unverified')
      }

      const row =
        existing ??
        (() => {
          const id = randomUUID()
          this.database
            .prepare(
              'INSERT INTO resume_agent_users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)'
            )
            .run(id, email, OAUTH_ONLY_PASSWORD, now)
          return { id, email, created_at: now }
        })()

      this.database
        .prepare(
          `INSERT INTO resume_agent_oauth_identities (
             provider_id, subject, user_id, created_at
           ) VALUES (?, ?, ?, ?)`
        )
        .run(providerId, identity.subject, row.id, now)
      return toUser(row)
    } catch (error) {
      if (error instanceof AuthError) throw error
      throw new AuthError('storage_failed')
    }
  }

  /**
   * The callback URL the provider will send the browser back to. `redirectBase`
   * comes from the request that started the flow, so the value always matches
   * the host the browser actually reached; the configured default is only a
   * fallback for callers that have no request context.
   */
  private oauthRedirectUri(providerId: string, redirectBase?: string): string {
    const base = (redirectBase ?? this.oauthRedirectBase).replace(/\/+$/, '')
    return `${base}/v1/auth/oauth/${providerId}/callback`
  }

  /**
   * Start a password reset.
   *
   * Always resolves, and never reveals whether the address has an account:
   * a caller cannot tell "sent" from "no such user". Rate limiting is applied
   * per address so the endpoint cannot be used to spray reset mail.
   */
  async requestPasswordReset(input: { email: string }): Promise<void> {
    this.ensureOpen()
    let email: string
    try {
      email = canonicalEmail(input.email)
    } catch {
      // A malformed address cannot belong to anyone; nothing to do.
      return
    }
    const now = this.now().getTime()
    if (!this.allowResetRequest(email, now)) {
      return
    }

    let row: Pick<UserRow, 'id' | 'email'> | undefined
    try {
      row = this.database
        .prepare('SELECT id, email FROM resume_agent_users WHERE email = ?')
        .get(email) as unknown as Pick<UserRow, 'id' | 'email'> | undefined
    } catch {
      throw new AuthError('storage_failed')
    }
    if (!row) {
      return
    }

    const token = randomBytes(32).toString('base64url')
    const expiresAt = now + this.passwordResetTtlMs
    try {
      // Issuing a new link retires any earlier unused one for this account.
      this.database
        .prepare(
          `UPDATE resume_agent_password_resets SET used_at = ?
           WHERE user_id = ? AND used_at IS NULL`
        )
        .run(now, row.id)
      this.database
        .prepare(
          `INSERT INTO resume_agent_password_resets (
             token_hash, user_id, created_at, expires_at, used_at
           ) VALUES (?, ?, ?, ?, NULL)`
        )
        .run(sessionTokenHash(token), row.id, now, expiresAt)
    } catch {
      throw new AuthError('storage_failed')
    }

    const resetUrl = `${this.resetUrlBase.replace(/\/+$/, '')}/#reset=${token}`
    try {
      await this.emailPort.sendPasswordReset({
        to: row.email,
        resetUrl,
        expiresAt: new Date(expiresAt).toISOString(),
      })
    } catch {
      // The token stays valid; a transport failure is the operator's problem
      // and must not be reported back as "this email does not exist".
    }
  }

  /**
   * Finish a reset. The token is single-use, and every existing session is
   * dropped: whoever held the old password must not keep a live session.
   */
  async resetPassword(input: {
    token: string
    password: string
  }): Promise<void> {
    this.ensureOpen()
    if (!/^[A-Za-z0-9_-]{43}$/u.test(input.token)) {
      throw new AuthError('invalid_reset_token')
    }
    try {
      validatePassword(input.password)
    } catch {
      throw new AuthError('invalid_registration')
    }
    const now = this.now().getTime()

    let row:
      | { user_id: string; expires_at: number; used_at: number | null }
      | undefined
    try {
      row = this.database
        .prepare(
          `SELECT user_id, expires_at, used_at
           FROM resume_agent_password_resets WHERE token_hash = ?`
        )
        .get(sessionTokenHash(input.token)) as unknown as
        | { user_id: string; expires_at: number; used_at: number | null }
        | undefined
    } catch {
      throw new AuthError('storage_failed')
    }
    if (!row || row.used_at !== null || Number(row.expires_at) <= now) {
      throw new AuthError('invalid_reset_token')
    }

    const record = await passwordRecord(input.password, this.passwordScrypt)
    try {
      this.database
        .prepare('UPDATE resume_agent_users SET password_hash = ? WHERE id = ?')
        .run(record, row.user_id)
      this.database
        .prepare(
          'UPDATE resume_agent_password_resets SET used_at = ? WHERE token_hash = ?'
        )
        .run(now, sessionTokenHash(input.token))
      this.database
        .prepare('DELETE FROM resume_agent_sessions WHERE user_id = ?')
        .run(row.user_id)
    } catch {
      throw new AuthError('storage_failed')
    }
    // A successful reset clears any lockout so the new password can be used.
    this.clearLoginFailuresForUser(row.user_id)
  }

  /** False once the address has asked too often inside the window. */
  private allowResetRequest(email: string, now: number): boolean {
    const key = loginFailureKey(email)
    try {
      const row = this.database
        .prepare(
          `SELECT requests, window_started_at
           FROM resume_agent_reset_requests WHERE email_hash = ?`
        )
        .get(key) as
        | { requests: number | bigint; window_started_at: number | bigint }
        | undefined
      if (
        !row ||
        now - Number(row.window_started_at) >= PASSWORD_RESET_WINDOW_MS
      ) {
        this.database
          .prepare(
            `INSERT INTO resume_agent_reset_requests (
               email_hash, requests, window_started_at
             ) VALUES (?, 1, ?)
             ON CONFLICT(email_hash) DO UPDATE SET requests = 1, window_started_at = ?`
          )
          .run(key, now, now)
        return true
      }
      if (Number(row.requests) >= PASSWORD_RESET_REQUEST_LIMIT) {
        return false
      }
      this.database
        .prepare(
          `UPDATE resume_agent_reset_requests SET requests = requests + 1
           WHERE email_hash = ?`
        )
        .run(key)
      return true
    } catch {
      throw new AuthError('storage_failed')
    }
  }

  private clearLoginFailuresForUser(userId: string): void {
    try {
      const user = this.database
        .prepare('SELECT email FROM resume_agent_users WHERE id = ?')
        .get(userId) as { email?: string } | undefined
      if (user?.email) {
        this.clearLoginFailures(canonicalEmailSafe(user.email))
      }
    } catch {
      // Best effort: a stale lockout expires on its own.
    }
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

  /**
   * Read the caller's profile, or `null` when they have never saved one.
   *
   * `null` rather than a thrown `profile_not_found`: having no profile yet is
   * the normal state of every new account, and an exception would push every
   * caller into a try/catch around the common path.
   */
  async readProfile(userId: string): Promise<StoredProfile | null> {
    this.ensureOpen()
    let row: ProfileRow | undefined
    try {
      row = this.database
        .prepare(
          `SELECT user_id, key_id, nonce, ciphertext, auth_tag,
                  created_at, updated_at
           FROM resume_agent_profiles
           WHERE user_id = ?`
        )
        .get(userId) as unknown as ProfileRow | undefined
    } catch {
      throw new AuthError('storage_failed')
    }
    if (!row) return null
    // Decrypt under the key the row was written with, not the active one: a
    // rotation must not strand profiles that have not been saved since.
    const key = this.credentialEncryptionKeys.get(row.key_id)
    if (!key) throw new AuthError('profile_unavailable')
    try {
      const nonce = Buffer.from(row.nonce)
      const authTag = Buffer.from(row.auth_tag)
      if (nonce.byteLength !== 12 || authTag.byteLength !== 16) {
        throw new Error('Invalid encrypted profile envelope')
      }
      const decipher = createDecipheriv('aes-256-gcm', key, nonce, {
        authTagLength: 16,
      })
      decipher.setAAD(profileAdditionalData(row.user_id, row.key_id))
      decipher.setAuthTag(authTag)
      const payload = Buffer.concat([
        decipher.update(Buffer.from(row.ciphertext)),
        decipher.final(),
      ]).toString('utf8')
      return { ...toProfileSummary(row), payload }
    } catch (error) {
      if (error instanceof AuthError) throw error
      throw new AuthError('profile_unavailable')
    }
  }

  /**
   * Replace the caller's profile. Writes under the active encryption key, so a
   * save is also the moment a rotated profile moves to the new key.
   */
  async putProfile(userId: string, payload: string): Promise<ProfileSummary> {
    this.ensureOpen()
    validateProfilePayload(payload)
    const key = this.credentialEncryptionKeys.get(
      this.activeCredentialEncryptionKeyId
    )
    if (!key) throw new AuthError('invalid_configuration')
    const nonce = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, nonce, {
      authTagLength: 16,
    })
    cipher.setAAD(
      profileAdditionalData(userId, this.activeCredentialEncryptionKeyId)
    )
    const ciphertext = Buffer.concat([
      cipher.update(payload, 'utf8'),
      cipher.final(),
    ])
    const authTag = cipher.getAuthTag()
    const now = this.now().getTime()
    try {
      // `created_at` is deliberately absent from the update set: "档案建立于"
      // must keep meaning the first save, not the most recent one.
      this.database
        .prepare(
          `INSERT INTO resume_agent_profiles (
             user_id, key_id, nonce, ciphertext, auth_tag, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id) DO UPDATE SET
             key_id = excluded.key_id,
             nonce = excluded.nonce,
             ciphertext = excluded.ciphertext,
             auth_tag = excluded.auth_tag,
             updated_at = excluded.updated_at`
        )
        .run(
          userId,
          this.activeCredentialEncryptionKeyId,
          nonce,
          ciphertext,
          authTag,
          now,
          now
        )
      const row = this.database
        .prepare(
          `SELECT created_at, updated_at FROM resume_agent_profiles
           WHERE user_id = ?`
        )
        .get(userId) as unknown as
        | Pick<ProfileRow, 'created_at' | 'updated_at'>
        | undefined
      if (!row) throw new AuthError('storage_failed')
      return toProfileSummary(row)
    } catch (error) {
      if (error instanceof AuthError) throw error
      throw new AuthError('storage_failed')
    }
  }

  /** `true` when a profile was there to delete. */
  async deleteProfile(userId: string): Promise<boolean> {
    this.ensureOpen()
    try {
      const result = this.database
        .prepare('DELETE FROM resume_agent_profiles WHERE user_id = ?')
        .run(userId)
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

  async consumeWorkQuota(
    userId: string,
    policy: WorkRateLimitPolicy
  ): Promise<WorkRateLimitDecision> {
    this.ensureOpen()
    if (
      !Number.isSafeInteger(policy.limit) ||
      policy.limit < 1 ||
      policy.limit > 1_000 ||
      !Number.isSafeInteger(policy.windowMs) ||
      policy.windowMs < 1_000 ||
      policy.windowMs > 24 * 60 * 60 * 1_000
    ) {
      throw new AuthError('invalid_configuration')
    }

    const now = this.now().getTime()
    let transactionOpen = false
    try {
      this.database.exec('BEGIN IMMEDIATE')
      transactionOpen = true
      const row = this.database
        .prepare(
          `SELECT requests, window_started_at
           FROM resume_agent_work_rate_limits WHERE user_id = ?`
        )
        .get(userId) as
        | { requests: number | bigint; window_started_at: number | bigint }
        | undefined
      const previousStart = Number(row?.window_started_at)
      const expired =
        !row ||
        !Number.isSafeInteger(previousStart) ||
        now - previousStart >= policy.windowMs
      const windowStartedAt = expired ? now : previousStart
      const previousRequests = expired ? 0 : Number(row?.requests)
      if (!Number.isSafeInteger(previousRequests) || previousRequests < 0) {
        throw new AuthError('storage_failed')
      }

      const allowed = previousRequests < policy.limit
      const requests = allowed ? previousRequests + 1 : previousRequests
      if (expired) {
        this.database
          .prepare(
            `INSERT INTO resume_agent_work_rate_limits (
               user_id, requests, window_started_at
             ) VALUES (?, ?, ?)
             ON CONFLICT(user_id) DO UPDATE SET
               requests = excluded.requests,
               window_started_at = excluded.window_started_at`
          )
          .run(userId, requests, windowStartedAt)
      } else if (allowed) {
        this.database
          .prepare(
            `UPDATE resume_agent_work_rate_limits
             SET requests = ? WHERE user_id = ?`
          )
          .run(requests, userId)
      }

      this.database.exec('COMMIT')
      transactionOpen = false
      const resetAtMs = windowStartedAt + policy.windowMs
      return {
        allowed,
        limit: policy.limit,
        remaining: Math.max(0, policy.limit - requests),
        resetAt: new Date(resetAtMs).toISOString(),
        retryAfterSeconds: allowed
          ? 0
          : Math.max(1, Math.ceil((resetAtMs - now) / 1_000)),
      }
    } catch (error) {
      if (transactionOpen) {
        try {
          this.database.exec('ROLLBACK')
        } catch {
          // Preserve the stable storage/configuration error below.
        }
      }
      if (error instanceof AuthError) throw error
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

  private issueSession(user: AuthUser, remember = false): AuthSession {
    const token = randomBytes(32).toString('base64url')
    const createdAt = this.now().getTime()
    const ttl = remember ? this.sessionTtlMs : this.transientSessionTtlMs
    const expiresAt = createdAt + ttl
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
      persistent: remember,
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
