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
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { LlmClient } from '@yamlresume/resume-agent'
import { ResumeTailoringAgent } from '@yamlresume/resume-agent'
import { afterEach, describe, expect, it } from 'vitest'

import { AuthService } from './auth'
import type { OAuthProviderDescriptor } from './oauth'
import { createAgentApiServer, startAgentApiServer } from './server'

const services: AuthService[] = []
const servers: Server[] = []

function fakeAgent(): ResumeTailoringAgent {
  const llm: LlmClient = {
    async completeJson() {
      throw new Error('The authentication tests do not invoke the agent')
    },
  }
  return new ResumeTailoringAgent(llm)
}

async function withAuthServer<T>(
  callback: (baseUrl: string) => Promise<T>,
  options: { oauthProviders?: OAuthProviderDescriptor[] } = {}
): Promise<T> {
  const auth = await AuthService.open({
    databasePath: ':memory:',
    credentialEncryptionKeys: [{ id: 'test-v1', key: Buffer.alloc(32, 0x5a) }],
    activeCredentialEncryptionKeyId: 'test-v1',
    ...(options.oauthProviders
      ? { oauthProviders: options.oauthProviders }
      : {}),
    passwordScrypt: {
      cost: 2 ** 10,
      blockSize: 8,
      parallelization: 1,
      maxmem: 16 * 1024 * 1024,
    },
  })
  services.push(auth)
  const server = createAgentApiServer({
    agent: fakeAgent(),
    auth: {
      service: auth,
      allowedOrigin: 'http://localhost:5173',
      secureCookies: false,
    },
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, resolve))
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Server did not start')
  }
  return callback(`http://127.0.0.1:${address.port}`)
}

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve()))
          )
      )
  )
  for (const service of services.splice(0)) service.close()
})

function sessionCookie(response: Response): string {
  const setCookie = response.headers.get('set-cookie')
  if (!setCookie) throw new Error('Missing session cookie')
  return setCookie.split(';', 1)[0]
}

async function registerUser(
  baseUrl: string,
  email: string,
  password = 'correct horse battery staple'
): Promise<string> {
  const response = await fetch(`${baseUrl}/v1/auth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost:5173',
    },
    body: JSON.stringify({ email, password }),
  })
  expect(response.status).toBe(201)
  return sessionCookie(response)
}

describe('authenticated agent API', () => {
  it('registers, identifies, logs out, and logs a user back in with an HttpOnly cookie', async () => {
    await withAuthServer(async (baseUrl) => {
      const headers = {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:5173',
      }
      const registration = await fetch(`${baseUrl}/v1/auth/register`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          email: ' USER@example.com ',
          password: 'correct horse battery staple',
        }),
      })
      expect(registration.status).toBe(201)
      expect(registration.headers.get('access-control-allow-origin')).toBe(
        'http://localhost:5173'
      )
      expect(registration.headers.get('access-control-allow-credentials')).toBe(
        'true'
      )
      expect(registration.headers.get('set-cookie')).toMatch(
        /^yamlresume_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Lax/u
      )
      const cookie = sessionCookie(registration)
      const registered = (await registration.json()) as {
        data?: { user?: { email?: string }; token?: string }
      }
      expect(registered.data?.user?.email).toBe('user@example.com')
      expect(registered.data).not.toHaveProperty('token')

      const me = await fetch(`${baseUrl}/v1/auth/me`, {
        headers: { Cookie: cookie, Origin: 'http://localhost:5173' },
      })
      expect(me.status).toBe(200)
      expect((await me.json()) as unknown).toMatchObject({
        data: { email: 'user@example.com' },
      })
      const duplicateCookie = await fetch(`${baseUrl}/v1/auth/me`, {
        headers: { Cookie: `${cookie}; ${cookie}` },
      })
      expect(duplicateCookie.status).toBe(401)

      const logout = await fetch(`${baseUrl}/v1/auth/logout`, {
        method: 'POST',
        headers: { Cookie: cookie, Origin: 'http://localhost:5173' },
      })
      expect(logout.status).toBe(204)
      expect(logout.headers.get('set-cookie')).toContain('Max-Age=0')
      expect(
        await fetch(`${baseUrl}/v1/auth/me`, { headers: { Cookie: cookie } })
      ).toMatchObject({ status: 401 })

      const login = await fetch(`${baseUrl}/v1/auth/login`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          email: 'user@example.com',
          password: 'correct horse battery staple',
        }),
      })
      expect(login.status).toBe(200)
      expect(sessionCookie(login)).not.toBe(cookie)
    })
  })

  it('stores and deletes provider API keys without returning plaintext', async () => {
    await withAuthServer(async (baseUrl) => {
      const cookie = await registerUser(baseUrl, 'user@example.com')
      const headers = {
        Cookie: cookie,
        'Content-Type': 'application/json',
        Origin: 'http://localhost:5173',
      }
      const secret = 'sk-provider-secret'
      const put = await fetch(`${baseUrl}/v1/provider-credentials/openai`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ apiKey: secret }),
      })
      expect(put.status).toBe(200)
      expect(await put.text()).not.toContain(secret)

      const list = await fetch(`${baseUrl}/v1/provider-credentials`, {
        headers: { Cookie: cookie, Origin: 'http://localhost:5173' },
      })
      expect(list.status).toBe(200)
      const listed = await list.text()
      expect(listed).toContain('openai')
      expect(listed).not.toContain(secret)

      const deleted = await fetch(`${baseUrl}/v1/provider-credentials/openai`, {
        method: 'DELETE',
        headers,
      })
      expect(deleted.status).toBe(204)
      const empty = await fetch(`${baseUrl}/v1/provider-credentials`, {
        headers: { Cookie: cookie },
      })
      expect(await empty.json()).toMatchObject({ data: [] })
    })
  })

  it('accepts only the configured browser origin for credentialed mutations', async () => {
    await withAuthServer(async (baseUrl) => {
      const preflight = await fetch(`${baseUrl}/v1/auth/login`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:5173',
          'Access-Control-Request-Method': 'POST',
        },
      })
      expect(preflight.status).toBe(204)
      expect(preflight.headers.get('access-control-allow-origin')).toBe(
        'http://localhost:5173'
      )
      expect(preflight.headers.get('access-control-allow-credentials')).toBe(
        'true'
      )

      const rejected = await fetch(`${baseUrl}/v1/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://evil.example',
        },
        body: JSON.stringify({
          email: 'user@example.com',
          password: 'correct horse battery staple',
        }),
      })
      expect(rejected.status).toBe(403)
      expect(rejected.headers.get('access-control-allow-origin')).toBeNull()
    })
  })

  it('returns stable client errors for malformed authentication and credential bodies', async () => {
    await withAuthServer(async (baseUrl) => {
      const malformedRegistration = await fetch(`${baseUrl}/v1/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{',
      })
      expect(malformedRegistration.status).toBe(400)
      expect(await malformedRegistration.json()).toMatchObject({
        error: { code: 'invalid_registration' },
      })

      const cookie = await registerUser(baseUrl, 'user@example.com')
      const malformedCredential = await fetch(
        `${baseUrl}/v1/provider-credentials/openai`,
        {
          method: 'PUT',
          headers: {
            Cookie: cookie,
            'Content-Type': 'application/json',
          },
          body: '{',
        }
      )
      expect(malformedCredential.status).toBe(400)
      expect(await malformedCredential.json()).toMatchObject({
        error: { code: 'invalid_provider_credential' },
      })
    })
  })

  it('requires authentication and isolates asynchronous runs by owner', async () => {
    await withAuthServer(async (baseUrl) => {
      const request = {
        jobDescription:
          'We need a TypeScript Engineer to build reliable systems.',
        candidate: {
          resume: {
            content: {
              basics: { name: 'Ada Lovelace' },
              education: [],
            },
            layouts: [{ engine: 'html', template: 'calm' }],
          },
        },
      }
      const anonymous = await fetch(`${baseUrl}/v1/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })
      expect(anonymous.status).toBe(401)

      const firstCookie = await registerUser(baseUrl, 'first@example.com')
      const secondCookie = await registerUser(
        baseUrl,
        'second@example.com',
        'another correct horse battery staple'
      )
      const create = await fetch(`${baseUrl}/v1/runs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: firstCookie,
        },
        body: JSON.stringify(request),
      })
      expect(create.status).toBe(202)
      const created = (await create.json()) as { data: { id: string } }

      const crossUser = await fetch(`${baseUrl}/v1/runs/${created.data.id}`, {
        headers: { Cookie: secondCookie },
      })
      expect(crossUser.status).toBe(404)
      const owner = await fetch(`${baseUrl}/v1/runs/${created.data.id}`, {
        headers: { Cookie: firstCookie },
      })
      expect(owner.status).toBe(200)
    })
  })

  it('fails closed without an encryption key and persists login in an enabled runtime', async () => {
    await expect(
      startAgentApiServer({
        agent: fakeAgent(),
        env: { RESUME_AGENT_RUN_STORE: 'memory' },
        port: 0,
      })
    ).rejects.toMatchObject({ code: 'invalid_configuration' })

    const directory = await mkdtemp(join(tmpdir(), 'yamlresume-auth-runtime-'))
    const env = {
      RESUME_AGENT_RUN_STORE: 'memory',
      RESUME_AGENT_AUTH_MODE: 'enabled',
      RESUME_AGENT_AUTH_DB_PATH: join(directory, 'auth.sqlite'),
      RESUME_AGENT_CREDENTIAL_KEYS: JSON.stringify({
        'local-v1': Buffer.alloc(32, 0x7b).toString('base64'),
      }),
      RESUME_AGENT_CREDENTIAL_ACTIVE_KEY_ID: 'local-v1',
      RESUME_AGENT_ALLOWED_ORIGIN: 'http://localhost:5173',
      RESUME_AGENT_SECURE_COOKIES: 'false',
    }
    try {
      const first = await startAgentApiServer({
        agent: fakeAgent(),
        env,
        port: 0,
      })
      expect(first.authentication).toBe('enabled')
      const cookie = await registerUser(first.url, 'user@example.com')
      await first.close()

      const second = await startAgentApiServer({
        agent: fakeAgent(),
        env,
        port: 0,
      })
      try {
        const login = await fetch(`${second.url}/v1/auth/login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'http://localhost:5173',
          },
          body: JSON.stringify({
            email: 'user@example.com',
            password: 'correct horse battery staple',
          }),
        })
        expect(login.status).toBe(200)
        expect(sessionCookie(login)).not.toBe(cookie)

        const capabilities = await fetch(`${second.url}/v1/capabilities`)
        expect(await capabilities.json()).toMatchObject({
          data: { runtime: { authentication: 'enabled' } },
        })
      } finally {
        await second.close()
      }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})

describe('OAuth HTTP routes', () => {
  /** A provider descriptor whose endpoints are never actually reached: these
   * tests cover the two server routes, not the exchange itself. */
  function descriptor(): OAuthProviderDescriptor {
    return {
      id: 'fake',
      label: 'Fake',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      authorizeUrl: 'https://provider.test/authorize',
      tokenUrl: 'https://provider.test/token',
      userInfoUrl: 'https://provider.test/userinfo',
      scopes: ['email'],
      usesPkce: true,
      mapUserInfo: () => undefined,
    }
  }

  it('announces configured providers in capabilities', async () => {
    await withAuthServer(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/v1/capabilities`)
        const body = (await response.json()) as {
          data: { runtime: { oauthProviders: unknown } }
        }
        expect(body.data.runtime.oauthProviders).toEqual([
          { id: 'fake', label: 'Fake' },
        ])
      },
      { oauthProviders: [descriptor()] }
    )
  })

  it('announces none when nothing is configured', async () => {
    await withAuthServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/capabilities`)
      const body = (await response.json()) as {
        data: { runtime: { oauthProviders: unknown } }
      }
      expect(body.data.runtime.oauthProviders).toEqual([])
    })
  })

  it('redirects a start request to the provider with state', async () => {
    await withAuthServer(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/v1/auth/oauth/fake/start`, {
          redirect: 'manual',
        })
        expect(response.status).toBe(302)
        const location = new URL(response.headers.get('location') ?? '')
        expect(location.origin + location.pathname).toBe(
          'https://provider.test/authorize'
        )
        expect(location.searchParams.get('state')).toHaveLength(43)
        expect(location.searchParams.get('redirect_uri')).toBe(
          `http://127.0.0.1:${new URL(baseUrl).port}/v1/auth/oauth/fake/callback`
        )
      },
      { oauthProviders: [descriptor()] }
    )
  })

  it('rejects a start request for an unconfigured provider', async () => {
    await withAuthServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/auth/oauth/google/start`, {
        redirect: 'manual',
      })
      expect(response.status).toBe(400)
      const body = (await response.json()) as { error: { code: string } }
      expect(body.error.code).toBe('oauth_unavailable')
    })
  })

  it('sends a failed callback back to the app instead of a JSON error', async () => {
    await withAuthServer(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/v1/auth/oauth/fake/callback?code=x&state=${'z'.repeat(43)}`,
          { redirect: 'manual' }
        )
        expect(response.status).toBe(302)
        expect(response.headers.get('location')).toBe(
          'http://localhost:5173/#auth_error=invalid_oauth_state'
        )
      },
      { oauthProviders: [descriptor()] }
    )
  })

  it('reports a callback with no parameters as a failure redirect', async () => {
    await withAuthServer(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/v1/auth/oauth/fake/callback`, {
          redirect: 'manual',
        })
        expect(response.status).toBe(302)
        expect(response.headers.get('location')).toContain('auth_error=')
      },
      { oauthProviders: [descriptor()] }
    )
  })
})

describe('invitation-gated registration', () => {
  function withCodes<T>(
    codes: string,
    callback: (baseUrl: string) => Promise<T>
  ): Promise<T> {
    const previous = process.env.RESUME_AGENT_INVITE_CODES
    process.env.RESUME_AGENT_INVITE_CODES = codes
    return withAuthServer(callback).finally(() => {
      if (previous === undefined) {
        delete process.env.RESUME_AGENT_INVITE_CODES
      } else {
        process.env.RESUME_AGENT_INVITE_CODES = previous
      }
    })
  }

  function register(baseUrl: string, body: Record<string, unknown>) {
    return fetch(`${baseUrl}/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  it('reports an open policy when no codes are configured', async () => {
    await withAuthServer(async (baseUrl) => {
      const body = (await (
        await fetch(`${baseUrl}/v1/capabilities`)
      ).json()) as {
        data: { runtime: { registration: string } }
      }
      expect(body.data.runtime.registration).toBe('open')
    })
  })

  it('declares an invite policy and enforces it', async () => {
    await withCodes('let-me-in', async (baseUrl) => {
      const capabilities = (await (
        await fetch(`${baseUrl}/v1/capabilities`)
      ).json()) as { data: { runtime: { registration: string } } }
      expect(capabilities.data.runtime.registration).toBe('invite')

      const withoutCode = await register(baseUrl, {
        email: 'a@example.com',
        password: 'correct horse battery staple',
      })
      expect(withoutCode.status).toBe(403)

      const wrongCode = await register(baseUrl, {
        email: 'b@example.com',
        password: 'correct horse battery staple',
        inviteCode: 'not-it',
      })
      expect(wrongCode.status).toBe(403)
      const wrongBody = (await wrongCode.json()) as { error: { code: string } }
      // The same answer whether the code was absent or wrong.
      expect(wrongBody.error.code).toBe('invalid_invite_code')

      const accepted = await register(baseUrl, {
        email: 'c@example.com',
        password: 'correct horse battery staple',
        inviteCode: 'let-me-in',
      })
      expect(accepted.status).toBe(201)
    })
  })

  it('accepts any of several configured codes', async () => {
    await withCodes('one, two ,three', async (baseUrl) => {
      const response = await register(baseUrl, {
        email: 'd@example.com',
        password: 'correct horse battery staple',
        inviteCode: 'two',
      })
      expect(response.status).toBe(201)
    })
  })

  it('leaves login unaffected by the invitation policy', async () => {
    await withCodes('let-me-in', async (baseUrl) => {
      await register(baseUrl, {
        email: 'e@example.com',
        password: 'correct horse battery staple',
        inviteCode: 'let-me-in',
      })
      const login = await fetch(`${baseUrl}/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'e@example.com',
          password: 'correct horse battery staple',
        }),
      })
      // No invite code needed to sign in to an account that already exists.
      expect(login.status).toBe(200)
    })
  })
})

const PROFILE_ORIGIN = 'http://localhost:5173'

function profileHeaders(cookie?: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Origin: PROFILE_ORIGIN,
    ...(cookie ? { Cookie: cookie } : {}),
  }
}

function material(id: string, kind: 'text' | 'link', value: string) {
  return {
    id,
    kind,
    title: `${kind}-${id}`,
    value,
    createdAt: '2026-09-16T12:00:00.000Z',
  }
}

describe('career profile over HTTP', () => {
  it('refuses every profile route without a session', async () => {
    await withAuthServer(async (baseUrl) => {
      for (const method of ['GET', 'PUT', 'DELETE']) {
        const response = await fetch(`${baseUrl}/v1/profile`, {
          method,
          headers: profileHeaders(),
          ...(method === 'PUT' ? { body: JSON.stringify({}) } : {}),
        })
        expect(response.status).toBe(401)
      }
    })
  })

  it('separates "never saved" from "saved", then round-trips and deletes', async () => {
    await withAuthServer(async (baseUrl) => {
      const cookie = await registerUser(baseUrl, 'profile@example.com')
      const headers = profileHeaders(cookie)

      // A missing profile is a 404, distinct from a saved-but-empty document:
      // the page must be able to tell "you have not set this up" from "yours
      // is blank", or it will show an empty editor to someone with no profile.
      const absent = await fetch(`${baseUrl}/v1/profile`, { headers })
      expect(absent.status).toBe(404)
      expect(await absent.json()).toMatchObject({
        error: { code: 'profile_not_found' },
      })

      const written = await fetch(`${baseUrl}/v1/profile`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          resumeYaml: 'basics:\n  name: Ada Lovelace\n',
          preferences: { styles: ['ats-compact'], formats: ['pdf'] },
          materials: [
            material('m1', 'text', '用 FastAPI 实现了…'),
            material('m2', 'link', 'https://github.com/example'),
          ],
        }),
      })
      expect(written.status).toBe(200)
      const summary = (await written.json()) as {
        data: { createdAt: string; updatedAt: string }
      }
      expect(summary.data.createdAt).toBe(summary.data.updatedAt)

      const read = await fetch(`${baseUrl}/v1/profile`, { headers })
      expect(read.status).toBe(200)
      expect(await read.json()).toMatchObject({
        data: {
          resumeYaml: 'basics:\n  name: Ada Lovelace\n',
          preferences: { styles: ['ats-compact'], formats: ['pdf'] },
          createdAt: summary.data.createdAt,
          updatedAt: summary.data.updatedAt,
        },
      })
      const body = (await (
        await fetch(`${baseUrl}/v1/profile`, { headers })
      ).json()) as { data: { materials: unknown[] } }
      expect(body.data.materials).toHaveLength(2)

      const removed = await fetch(`${baseUrl}/v1/profile`, {
        method: 'DELETE',
        headers,
      })
      expect(removed.status).toBe(204)
      expect((await fetch(`${baseUrl}/v1/profile`, { headers })).status).toBe(
        404
      )
      // Idempotent: deleting nothing is still a success.
      expect(
        (
          await fetch(`${baseUrl}/v1/profile`, {
            method: 'DELETE',
            headers,
          })
        ).status
      ).toBe(204)
    })
  })

  it('keeps one account’s profile invisible to another', async () => {
    await withAuthServer(async (baseUrl) => {
      const first = await registerUser(baseUrl, 'first@example.com')
      const second = await registerUser(baseUrl, 'second@example.com')

      await fetch(`${baseUrl}/v1/profile`, {
        method: 'PUT',
        headers: profileHeaders(first),
        body: JSON.stringify({ resumeYaml: 'first-only' }),
      })

      const other = await fetch(`${baseUrl}/v1/profile`, {
        headers: profileHeaders(second),
      })
      expect(other.status).toBe(404)

      const mine = await fetch(`${baseUrl}/v1/profile`, {
        headers: profileHeaders(first),
      })
      expect(await mine.json()).toMatchObject({
        data: { resumeYaml: 'first-only' },
      })
    })
  })

  it('rejects a bad payload with a field path, and stores nothing', async () => {
    await withAuthServer(async (baseUrl) => {
      const cookie = await registerUser(baseUrl, 'invalid@example.com')
      const headers = profileHeaders(cookie)

      const rejected = async (payload: unknown) => {
        const response = await fetch(`${baseUrl}/v1/profile`, {
          method: 'PUT',
          headers,
          body: JSON.stringify(payload),
        })
        expect(response.status).toBe(400)
        const body = (await response.json()) as {
          error: { code: string; details?: Array<{ path?: string }> }
        }
        expect(body.error.code).toBe('invalid_profile')
        return body
      }

      // A `javascript:` href would be stored XSS the moment the profile page
      // renders materials, so the scheme is refused at the boundary.
      const scripted = await rejected({
        materials: [material('m1', 'link', 'javascript:alert(1)')],
      })
      expect(scripted.error.details?.[0]?.path).toBe('materials.0.value')

      await rejected({
        materials: [material('m1', 'link', 'ftp://example.com/x')],
      })
      await rejected({
        materials: [material('m1', 'text', 'x')].concat(
          Array.from({ length: 50 }, (_, index) =>
            material(`extra-${index}`, 'text', 'x')
          )
        ),
      })
      await rejected({ preferences: { styles: ['not-a-style'] } })
      await rejected({ resumeYaml: 42 })

      // Nothing above may have landed: a rejected write is not a partial one.
      expect((await fetch(`${baseUrl}/v1/profile`, { headers })).status).toBe(
        404
      )
    })
  })

  it('accepts a profile with only the fields the client actually filled', async () => {
    await withAuthServer(async (baseUrl) => {
      const cookie = await registerUser(baseUrl, 'minimal@example.com')
      const headers = profileHeaders(cookie)

      // Every field is optional, so a blank save is a save — it must not be
      // mistaken for "no profile".
      const response = await fetch(`${baseUrl}/v1/profile`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({}),
      })
      expect(response.status).toBe(200)

      const read = await fetch(`${baseUrl}/v1/profile`, { headers })
      expect(read.status).toBe(200)
      expect(await read.json()).toMatchObject({
        data: { resumeYaml: '', preferences: null, materials: [] },
      })
    })
  })
})
