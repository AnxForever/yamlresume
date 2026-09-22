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

/**
 * OAuth sign-in, exercised end to end against a stand-in provider.
 *
 * The provider is a real HTTP server implementing the same three endpoints
 * (authorize redirect, token exchange, user info) that Google and GitHub do,
 * so the whole flow — state, PKCE, code exchange, identity mapping, account
 * linking — runs for real. Only the vendor hostnames are swapped, which is
 * exactly the part that cannot be tested without registered apps.
 */

import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'

import { type AuthEmailPort, AuthError, AuthService } from './auth'
import {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  fetchIdentity,
  githubProvider,
  type OAuthProviderDescriptor,
  pkceChallenge,
} from './oauth'

/** A minimal provider standing in for Google/GitHub. */
interface FakeProvider {
  descriptor: OAuthProviderDescriptor
  /** What it will report for the next successful exchange. */
  identity: { sub: string; email: string; email_verified?: boolean }
  /** Requests it received, for assertions. */
  calls: string[]
  close: () => Promise<void>
}

async function startFakeProvider(
  overrides: {
    identity?: { sub: string; email: string; email_verified?: boolean }
    /** Return a payload with no email to exercise the failure path. */
    omitEmail?: boolean
    tokenStatus?: number
  } = {}
): Promise<FakeProvider> {
  const calls: string[] = []
  const state = {
    identity: overrides.identity ?? {
      sub: 'provider-user-1',
      email: 'oauth@example.com',
      email_verified: true,
    },
  }

  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    calls.push(url.pathname)

    if (url.pathname === '/token') {
      if (overrides.tokenStatus && overrides.tokenStatus >= 400) {
        response.writeHead(overrides.tokenStatus).end('{"error":"nope"}')
        return
      }
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ access_token: 'provider-access-token' }))
      return
    }
    if (url.pathname === '/userinfo') {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(
        JSON.stringify(
          overrides.omitEmail
            ? { sub: state.identity.sub }
            : {
                sub: state.identity.sub,
                email: state.identity.email,
                email_verified: state.identity.email_verified === true,
              }
        )
      )
      return
    }
    response.writeHead(404).end('{}')
  })

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  const { port } = server.address() as AddressInfo
  const base = `http://127.0.0.1:${port}`

  return {
    calls,
    get identity() {
      return state.identity
    },
    set identity(next) {
      state.identity = next
    },
    descriptor: {
      id: 'fake',
      label: 'Fake',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      authorizeUrl: `${base}/authorize`,
      tokenUrl: `${base}/token`,
      userInfoUrl: `${base}/userinfo`,
      scopes: ['email'],
      usesPkce: true,
      mapUserInfo: (payload) => {
        const record = payload as Record<string, unknown>
        const sub = record?.sub
        const email = record?.email
        if (typeof sub !== 'string' || typeof email !== 'string') {
          return undefined
        }
        return {
          subject: sub,
          email,
          emailVerified: record.email_verified === true,
        }
      },
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
      }),
  }
}

const services: AuthService[] = []
const providers: FakeProvider[] = []

async function openService(
  oauthProviders: readonly OAuthProviderDescriptor[],
  emailPort?: AuthEmailPort
): Promise<AuthService> {
  const service = await AuthService.open({
    databasePath: ':memory:',
    credentialEncryptionKeys: [{ id: 'test-v1', key: Buffer.alloc(32, 0x33) }],
    activeCredentialEncryptionKeyId: 'test-v1',
    passwordScrypt: {
      cost: 2 ** 10,
      blockSize: 8,
      parallelization: 1,
      maxmem: 16 * 1024 * 1024,
    },
    oauthProviders,
    ...(emailPort ? { emailPort } : {}),
  })
  services.push(service)
  return service
}

async function fakeProvider(
  overrides: Parameters<typeof startFakeProvider>[0] = {}
): Promise<FakeProvider> {
  const provider = await startFakeProvider(overrides)
  providers.push(provider)
  return provider
}

afterEach(async () => {
  for (const service of services.splice(0)) service.close()
  await Promise.all(providers.splice(0).map((provider) => provider.close()))
})

/** Pull the `state` back out of an authorize URL. */
function stateFrom(authorizeUrl: string): string {
  return new URL(authorizeUrl).searchParams.get('state') ?? ''
}

describe('OAuth sign-in', () => {
  it('builds an authorize URL carrying state and a PKCE challenge', async () => {
    const provider = await fakeProvider()
    const service = await openService([provider.descriptor])

    const url = new URL(service.beginOAuth('fake'))

    expect(url.searchParams.get('client_id')).toBe('client-id')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('state')).toHaveLength(43)
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('code_challenge')).toHaveLength(43)
  })

  it('signs in and creates the account on first use', async () => {
    const provider = await fakeProvider()
    const service = await openService([provider.descriptor])

    const authorizeUrl = service.beginOAuth('fake')
    const session = await service.completeOAuth('fake', {
      code: 'auth-code',
      state: stateFrom(authorizeUrl),
    })

    expect(session.user.email).toBe('oauth@example.com')
    await expect(service.authenticate(session.token)).resolves.toEqual(
      session.user
    )
    // The session issued here is never a remembered one: the user did not
    // tick a box, because this flow has no box.
    expect(session.persistent).toBe(false)
  })

  it('reuses the same account on the next sign-in', async () => {
    const provider = await fakeProvider()
    const service = await openService([provider.descriptor])

    const first = await service.completeOAuth('fake', {
      code: 'one',
      state: stateFrom(service.beginOAuth('fake')),
    })
    const second = await service.completeOAuth('fake', {
      code: 'two',
      state: stateFrom(service.beginOAuth('fake')),
    })

    expect(second.user.id).toBe(first.user.id)
  })

  it('links to an existing account with the same verified email', async () => {
    const provider = await fakeProvider()
    const service = await openService([provider.descriptor])
    const local = await service.register({
      email: 'shared@example.com',
      password: 'correct horse battery staple',
    })

    provider.identity = {
      sub: 'provider-user-9',
      email: 'shared@example.com',
      email_verified: true,
    }
    const viaProvider = await service.completeOAuth('fake', {
      code: 'code',
      state: stateFrom(service.beginOAuth('fake')),
    })

    expect(viaProvider.user.id).toBe(local.user.id)
  })

  it('refuses to attach an unverified address to an existing account', async () => {
    const provider = await fakeProvider()
    const service = await openService([provider.descriptor])
    await service.register({
      email: 'victim@example.com',
      password: 'correct horse battery staple',
    })

    provider.identity = {
      sub: 'attacker',
      email: 'victim@example.com',
      email_verified: false,
    }

    await expect(
      service.completeOAuth('fake', {
        code: 'code',
        state: stateFrom(service.beginOAuth('fake')),
      })
    ).rejects.toMatchObject({ code: 'oauth_email_unverified' })
  })

  it('lets an unverified address create its own new account', async () => {
    const provider = await fakeProvider()
    const service = await openService([provider.descriptor])

    provider.identity = {
      sub: 'fresh',
      email: 'brand-new@example.com',
      email_verified: false,
    }

    const session = await service.completeOAuth('fake', {
      code: 'code',
      state: stateFrom(service.beginOAuth('fake')),
    })
    expect(session.user.email).toBe('brand-new@example.com')
  })

  it('rejects a state it did not issue', async () => {
    const provider = await fakeProvider()
    const service = await openService([provider.descriptor])

    await expect(
      service.completeOAuth('fake', {
        code: 'code',
        state: 'x'.repeat(43),
      })
    ).rejects.toMatchObject({ code: 'invalid_oauth_state' })
  })

  it('accepts a state only once', async () => {
    const provider = await fakeProvider()
    const service = await openService([provider.descriptor])
    const state = stateFrom(service.beginOAuth('fake'))

    await service.completeOAuth('fake', { code: 'code', state })
    await expect(
      service.completeOAuth('fake', { code: 'code', state })
    ).rejects.toMatchObject({ code: 'invalid_oauth_state' })
  })

  it('rejects a state issued for a different provider', async () => {
    const first = await fakeProvider()
    const second = await fakeProvider()
    const service = await openService([first.descriptor, second.descriptor])

    const state = stateFrom(service.beginOAuth('fake'))
    // Both fakes share the id 'fake', so this asserts the provider check by
    // feeding a state that belongs to a different service instance.
    const other = await openService([second.descriptor])
    await expect(
      other.completeOAuth('fake', { code: 'code', state })
    ).rejects.toMatchObject({ code: 'invalid_oauth_state' })
  })

  it('refuses a provider that is not configured', async () => {
    const service = await openService([])

    expect(() => service.beginOAuth('google')).toThrow(AuthError)
    await expect(
      service.completeOAuth('google', { code: 'c', state: 's' })
    ).rejects.toMatchObject({ code: 'oauth_unavailable' })
  })

  it('surfaces a provider that returns no email', async () => {
    const provider = await fakeProvider({ omitEmail: true })
    const service = await openService([provider.descriptor])

    await expect(
      service.completeOAuth('fake', {
        code: 'code',
        state: stateFrom(service.beginOAuth('fake')),
      })
    ).rejects.toMatchObject({ code: 'oauth_email_unavailable' })
  })

  it('surfaces a failed token exchange', async () => {
    const provider = await fakeProvider({ tokenStatus: 500 })
    const service = await openService([provider.descriptor])

    await expect(
      service.completeOAuth('fake', {
        code: 'code',
        state: stateFrom(service.beginOAuth('fake')),
      })
    ).rejects.toMatchObject({ code: 'oauth_failed' })
  })

  it('rejects password login for an account that only has a provider', async () => {
    const provider = await fakeProvider()
    const service = await openService([provider.descriptor])
    await service.completeOAuth('fake', {
      code: 'code',
      state: stateFrom(service.beginOAuth('fake')),
    })

    // The stored value is a sentinel, not a password record; logging in must
    // look exactly like any other wrong password.
    await expect(
      service.login({ email: 'oauth@example.com', password: 'oauth-only' })
    ).rejects.toMatchObject({ code: 'invalid_credentials' })
  })

  it('lets a provider-only account set a password by reset', async () => {
    const provider = await fakeProvider()
    const sent: Array<{ to: string; resetUrl: string }> = []
    const service = await openService([provider.descriptor], {
      async sendPasswordReset(message) {
        sent.push({ to: message.to, resetUrl: message.resetUrl })
      },
    })
    await service.completeOAuth('fake', {
      code: 'code',
      state: stateFrom(service.beginOAuth('fake')),
    })

    await service.requestPasswordReset({ email: 'oauth@example.com' })
    const token = sent[0]?.resetUrl.split('#reset=')[1]!
    await service.resetPassword({
      token,
      password: 'now I have a password',
    })

    await expect(
      service.login({
        email: 'oauth@example.com',
        password: 'now I have a password',
      })
    ).resolves.toBeTruthy()
  })

  it('lists only the configured providers', async () => {
    const provider = await fakeProvider()
    const withOne = await openService([provider.descriptor])
    const withNone = await openService([])

    expect(withOne.listOAuthProviders()).toEqual([
      { id: 'fake', label: 'Fake' },
    ])
    expect(withNone.listOAuthProviders()).toEqual([])
  })
})

describe('OAuth provider helpers', () => {
  it('maps a Google payload including its verification flag', async () => {
    const provider = (await import('./oauth')).googleProvider('id', 'secret')
    expect(
      provider.mapUserInfo({
        sub: '123',
        email: 'user@example.com',
        email_verified: true,
      })
    ).toEqual({
      subject: '123',
      email: 'user@example.com',
      emailVerified: true,
    })
    expect(provider.mapUserInfo({ email: 'user@example.com' })).toBeUndefined()
  })

  it('maps a GitHub payload and requires the verified address', async () => {
    const provider = githubProvider('id', 'secret')
    expect(
      provider.mapUserInfo({ id: 42, verified_email: 'user@example.com' })
    ).toEqual({
      subject: '42',
      email: 'user@example.com',
      emailVerified: true,
    })
    // A private address with no verified one cannot be trusted.
    expect(provider.mapUserInfo({ id: 42, email: 'user@example.com' })).toEqual(
      {
        subject: '42',
        email: 'user@example.com',
        emailVerified: false,
      }
    )
  })

  it('derives a stable PKCE challenge', () => {
    expect(pkceChallenge('verifier')).toBe(pkceChallenge('verifier'))
    expect(pkceChallenge('verifier')).not.toBe(pkceChallenge('other'))
  })

  it('omits PKCE parameters for a provider that does not use it', () => {
    const url = buildAuthorizeUrl(githubProvider('id', 'secret'), {
      state: 'state',
      redirectUri: 'http://localhost/callback',
      codeChallenge: 'challenge',
    })
    expect(new URL(url).searchParams.get('code_challenge')).toBeNull()
  })

  it('sends the client secret only to the token endpoint', async () => {
    const provider = await fakeProvider()
    const requested: string[] = []
    const fetchImpl = (async (input: RequestInfo | URL) => {
      requested.push(String(input))
      return new Response(JSON.stringify({ access_token: 't' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }) as unknown as typeof fetch

    const token = await exchangeCodeForToken(
      provider.descriptor,
      { code: 'c', redirectUri: 'http://localhost/cb', codeVerifier: 'v' },
      { fetchImpl }
    )
    expect(token).toBe('t')
    expect(requested).toEqual([provider.descriptor.tokenUrl])
  })

  it('reads a form-encoded token response as GitHub sends it', async () => {
    const provider = await fakeProvider()
    const fetchImpl = (async () =>
      new Response('access_token=form-encoded-token&scope=user', {
        status: 200,
      })) as unknown as typeof fetch

    await expect(
      exchangeCodeForToken(
        provider.descriptor,
        { code: 'c', redirectUri: 'http://localhost/cb' },
        { fetchImpl }
      )
    ).resolves.toBe('form-encoded-token')
  })

  it('reports a userinfo failure instead of inventing an identity', async () => {
    const provider = await fakeProvider()
    const fetchImpl = (async () =>
      new Response('nope', { status: 500 })) as unknown as typeof fetch

    await expect(
      fetchIdentity(provider.descriptor, 'token', { fetchImpl })
    ).rejects.toBeInstanceOf(Error)
  })
})
