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

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { AuthService, type CredentialEncryptionKey } from './auth'

const services: AuthService[] = []
const temporaryDirectories: string[] = []

async function openAuthService(
  options: {
    databasePath?: string
    credentialEncryptionKeys?: readonly CredentialEncryptionKey[]
    activeCredentialEncryptionKeyId?: string
    now?: () => Date
    sessionTtlMs?: number
  } = {}
): Promise<AuthService> {
  const service = await AuthService.open({
    databasePath: options.databasePath ?? ':memory:',
    credentialEncryptionKeys: options.credentialEncryptionKeys ?? [
      { id: 'test-v1', key: Buffer.alloc(32, 0x5a) },
    ],
    activeCredentialEncryptionKeyId:
      options.activeCredentialEncryptionKeyId ?? 'test-v1',
    passwordScrypt: {
      cost: 2 ** 10,
      blockSize: 8,
      parallelization: 1,
      maxmem: 16 * 1024 * 1024,
    },
    now: options.now,
    sessionTtlMs: options.sessionTtlMs,
  })
  services.push(service)
  return service
}

async function temporaryDatabasePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'yamlresume-auth-'))
  temporaryDirectories.push(directory)
  return join(directory, 'auth.sqlite')
}

afterEach(async () => {
  for (const service of services.splice(0)) service.close()
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('AuthService', () => {
  it('registers, logs in, and authenticates opaque sessions', async () => {
    const service = await openAuthService()
    const registration = await service.register({
      email: '  USER@example.com ',
      password: 'correct horse battery staple',
    })

    expect(registration.user).toMatchObject({
      email: 'user@example.com',
    })
    expect(registration.user).not.toHaveProperty('passwordHash')
    expect(registration.token).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    await expect(service.authenticate(registration.token)).resolves.toEqual(
      registration.user
    )

    const login = await service.login({
      email: 'user@example.com',
      password: 'correct horse battery staple',
    })

    expect(login.user).toEqual(registration.user)
    expect(login.token).not.toBe(registration.token)
    await expect(service.authenticate(login.token)).resolves.toEqual(
      registration.user
    )
  })

  it('rejects duplicate canonical emails and invalid registration data', async () => {
    const service = await openAuthService()
    await service.register({
      email: 'user@example.com',
      password: 'correct horse battery staple',
    })

    await expect(
      service.register({
        email: ' USER@example.com ',
        password: 'another correct horse battery staple',
      })
    ).rejects.toMatchObject({ code: 'user_exists' })
    await expect(
      service.register({
        email: 'not-an-email',
        password: 'correct horse battery staple',
      })
    ).rejects.toMatchObject({ code: 'invalid_registration' })
  })

  it('persistently throttles repeated failures without revealing user existence', async () => {
    let now = new Date('2026-09-16T12:00:00.000Z')
    const databasePath = await temporaryDatabasePath()
    let service = await openAuthService({ databasePath, now: () => now })

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        service.login({
          email: 'missing@example.com',
          password: 'definitely the wrong password',
        })
      ).rejects.toMatchObject({ code: 'invalid_credentials' })
    }
    service.close()
    service = await openAuthService({ databasePath, now: () => now })
    await expect(
      service.login({
        email: 'missing@example.com',
        password: 'definitely the wrong password',
      })
    ).rejects.toMatchObject({ code: 'login_rate_limited' })

    now = new Date('2026-09-16T12:16:00.000Z')
    await expect(
      service.login({
        email: 'missing@example.com',
        password: 'definitely the wrong password',
      })
    ).rejects.toMatchObject({ code: 'invalid_credentials' })
  })

  it('uses the same public error for unknown users and wrong passwords', async () => {
    const service = await openAuthService()
    await service.register({
      email: 'user@example.com',
      password: 'correct horse battery staple',
    })

    await expect(
      service.login({
        email: 'user@example.com',
        password: 'definitely the wrong password',
      })
    ).rejects.toMatchObject({
      code: 'invalid_credentials',
      message: 'Email or password is invalid',
    })
    await expect(
      service.login({
        email: 'missing@example.com',
        password: 'definitely the wrong password',
      })
    ).rejects.toMatchObject({
      code: 'invalid_credentials',
      message: 'Email or password is invalid',
    })
  })

  it('persists sessions across restart and revokes them on logout', async () => {
    const databasePath = await temporaryDatabasePath()
    const first = await openAuthService({ databasePath })
    const registration = await first.register({
      email: 'user@example.com',
      password: 'correct horse battery staple',
    })
    first.close()

    const reopened = await openAuthService({ databasePath })
    await expect(reopened.authenticate(registration.token)).resolves.toEqual(
      registration.user
    )

    await expect(reopened.logout(registration.token)).resolves.toBeUndefined()
    await expect(
      reopened.authenticate(registration.token)
    ).rejects.toMatchObject({ code: 'not_authenticated' })
  })

  it('never persists a raw password or session token', async () => {
    const databasePath = await temporaryDatabasePath()
    const service = await openAuthService({ databasePath })
    const password = 'correct horse battery staple'
    const registration = await service.register({
      email: 'user@example.com',
      password,
    })
    service.close()

    const stored = await readFile(databasePath)
    expect(stored.includes(Buffer.from(password))).toBe(false)
    expect(stored.includes(Buffer.from(registration.token))).toBe(false)
  })

  it('rejects a session at its absolute expiry', async () => {
    let now = new Date('2026-09-16T12:00:00.000Z')
    const service = await openAuthService({
      now: () => now,
      sessionTtlMs: 60_000,
    })
    const registration = await service.register({
      email: 'user@example.com',
      password: 'correct horse battery staple',
    })

    now = new Date('2026-09-16T12:00:59.999Z')
    await expect(service.authenticate(registration.token)).resolves.toEqual(
      registration.user
    )

    now = new Date('2026-09-16T12:01:00.000Z')
    await expect(
      service.authenticate(registration.token)
    ).rejects.toMatchObject({ code: 'not_authenticated' })
  })

  it('stores provider credentials without exposing secrets in listings', async () => {
    let now = new Date('2026-09-16T12:00:00.000Z')
    const service = await openAuthService({ now: () => now })
    const { user } = await service.register({
      email: 'user@example.com',
      password: 'correct horse battery staple',
    })

    const created = await service.putProviderCredential(user.id, {
      providerId: 'openai',
      apiKey: 'sk-test-super-secret',
    })
    expect(created).toEqual({
      providerId: 'openai',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    })
    expect(await service.listProviderCredentials(user.id)).toEqual([created])
    expect(JSON.stringify(created)).not.toContain('sk-test-super-secret')
    await expect(
      service.readProviderCredential(user.id, 'openai')
    ).resolves.toBe('sk-test-super-secret')

    now = new Date('2026-09-16T12:01:00.000Z')
    const replaced = await service.putProviderCredential(user.id, {
      providerId: 'openai',
      apiKey: 'sk-replaced-secret',
    })
    expect(replaced).toEqual({
      providerId: 'openai',
      createdAt: created.createdAt,
      updatedAt: now.toISOString(),
    })
    await expect(
      service.readProviderCredential(user.id, 'openai')
    ).resolves.toBe('sk-replaced-secret')

    await expect(
      service.deleteProviderCredential(user.id, 'openai')
    ).resolves.toBe(true)
    await expect(
      service.readProviderCredential(user.id, 'openai')
    ).rejects.toMatchObject({ code: 'credential_not_found' })
  })

  it('keeps provider credentials isolated by user', async () => {
    const service = await openAuthService()
    const first = await service.register({
      email: 'first@example.com',
      password: 'correct horse battery staple',
    })
    const second = await service.register({
      email: 'second@example.com',
      password: 'another correct horse battery staple',
    })

    await service.putProviderCredential(first.user.id, {
      providerId: 'openai',
      apiKey: 'first-user-secret',
    })
    await service.putProviderCredential(second.user.id, {
      providerId: 'openai',
      apiKey: 'second-user-secret',
    })

    await expect(
      service.readProviderCredential(first.user.id, 'openai')
    ).resolves.toBe('first-user-secret')
    await expect(
      service.readProviderCredential(second.user.id, 'openai')
    ).resolves.toBe('second-user-secret')
    expect(await service.listProviderCredentials(first.user.id)).toHaveLength(1)
  })

  it('keeps provider secrets encrypted at rest and rejects tampering', async () => {
    const databasePath = await temporaryDatabasePath()
    const service = await openAuthService({ databasePath })
    const { user } = await service.register({
      email: 'user@example.com',
      password: 'correct horse battery staple',
    })
    const secret = 'sk-plaintext-must-not-appear'
    await service.putProviderCredential(user.id, {
      providerId: 'openai',
      apiKey: secret,
    })
    service.close()

    expect((await readFile(databasePath)).includes(Buffer.from(secret))).toBe(
      false
    )
    const { DatabaseSync } = await import('node:sqlite')
    const database = new DatabaseSync(databasePath)
    const row = database
      .prepare(
        `SELECT ciphertext FROM resume_agent_provider_credentials
         WHERE user_id = ? AND provider_id = ?`
      )
      .get(user.id, 'openai') as { ciphertext: Uint8Array }
    const tampered = Buffer.from(row.ciphertext)
    tampered[0] ^= 0xff
    database
      .prepare(
        `UPDATE resume_agent_provider_credentials SET ciphertext = ?
         WHERE user_id = ? AND provider_id = ?`
      )
      .run(tampered, user.id, 'openai')
    database.close()

    const reopened = await openAuthService({ databasePath })
    await expect(
      reopened.readProviderCredential(user.id, 'openai')
    ).rejects.toMatchObject({ code: 'credential_unavailable' })
  })

  it('decrypts old credentials during key rotation and writes with the active key', async () => {
    const databasePath = await temporaryDatabasePath()
    const keyV1 = { id: 'test-v1', key: Buffer.alloc(32, 0x11) }
    const keyV2 = { id: 'test-v2', key: Buffer.alloc(32, 0x22) }
    const first = await openAuthService({
      databasePath,
      credentialEncryptionKeys: [keyV1],
      activeCredentialEncryptionKeyId: keyV1.id,
    })
    const { user } = await first.register({
      email: 'user@example.com',
      password: 'correct horse battery staple',
    })
    await first.putProviderCredential(user.id, {
      providerId: 'openai',
      apiKey: 'old-key-secret',
    })
    first.close()

    const rotating = await openAuthService({
      databasePath,
      credentialEncryptionKeys: [keyV1, keyV2],
      activeCredentialEncryptionKeyId: keyV2.id,
    })
    await expect(
      rotating.readProviderCredential(user.id, 'openai')
    ).resolves.toBe('old-key-secret')
    await rotating.putProviderCredential(user.id, {
      providerId: 'openai',
      apiKey: 'new-key-secret',
    })
    rotating.close()

    const rotated = await openAuthService({
      databasePath,
      credentialEncryptionKeys: [keyV2],
      activeCredentialEncryptionKeyId: keyV2.id,
    })
    await expect(
      rotated.readProviderCredential(user.id, 'openai')
    ).resolves.toBe('new-key-secret')
  })

  it('fails safely when an encrypted credential references a missing key', async () => {
    const databasePath = await temporaryDatabasePath()
    const keyV1 = { id: 'test-v1', key: Buffer.alloc(32, 0x11) }
    const keyV2 = { id: 'test-v2', key: Buffer.alloc(32, 0x22) }
    const first = await openAuthService({
      databasePath,
      credentialEncryptionKeys: [keyV1],
      activeCredentialEncryptionKeyId: keyV1.id,
    })
    const { user } = await first.register({
      email: 'user@example.com',
      password: 'correct horse battery staple',
    })
    await first.putProviderCredential(user.id, {
      providerId: 'openai',
      apiKey: 'old-key-secret',
    })
    first.close()

    const missingOldKey = await openAuthService({
      databasePath,
      credentialEncryptionKeys: [keyV2],
      activeCredentialEncryptionKeyId: keyV2.id,
    })
    await expect(
      missingOldKey.readProviderCredential(user.id, 'openai')
    ).rejects.toMatchObject({ code: 'credential_unavailable' })
  })

  it('persists run ownership and rejects cross-user claims', async () => {
    const databasePath = await temporaryDatabasePath()
    const firstService = await openAuthService({ databasePath })
    const first = await firstService.register({
      email: 'first@example.com',
      password: 'correct horse battery staple',
    })
    const second = await firstService.register({
      email: 'second@example.com',
      password: 'another correct horse battery staple',
    })
    const runId = '83fc6b25-b515-4c6f-a0df-033a4e5f4f70'

    await expect(
      firstService.claimRun(first.user.id, runId)
    ).resolves.toBeUndefined()
    await expect(firstService.isRunOwner(first.user.id, runId)).resolves.toBe(
      true
    )
    await expect(firstService.isRunOwner(second.user.id, runId)).resolves.toBe(
      false
    )
    await expect(
      firstService.claimRun(second.user.id, runId)
    ).rejects.toMatchObject({ code: 'run_not_found' })
    firstService.close()

    const reopened = await openAuthService({ databasePath })
    await expect(reopened.isRunOwner(first.user.id, runId)).resolves.toBe(true)
  })
})
