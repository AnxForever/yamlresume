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
 * OAuth 2.0 sign-in.
 *
 * Providers are described by data rather than hard-coded flows, so a provider
 * is enabled purely by configuration and none of this code needs to know which
 * vendor it is talking to. A provider only appears in `/v1/capabilities` when
 * its client id and secret are present, which is what keeps the frontend from
 * rendering a sign-in button that could never work.
 *
 * Only providers that return an email address are supported. Accounts are
 * keyed by address, and a provider that identifies someone by an opaque id
 * alone (QQ Connect, for instance) would need an account model that can exist
 * without one. If that is ever added, this is the file to change.
 */

import { createHash, randomBytes } from 'node:crypto'

export interface OAuthIdentity {
  /** Provider-stable subject id. */
  readonly subject: string
  readonly email: string
  /**
   * Providers may return an address they have not verified. Linking those to
   * an existing account would let anyone claim it by typing the address, so
   * anything other than an explicit `true` is treated as unverified.
   *
   */
  readonly emailVerified: boolean
}

export interface OAuthProviderDescriptor {
  readonly id: string
  readonly label: string
  readonly clientId: string
  readonly clientSecret: string
  readonly authorizeUrl: string
  readonly tokenUrl: string
  readonly userInfoUrl: string
  readonly scopes: readonly string[]
  /** Google requires PKCE for web clients; GitHub ignores it harmlessly. */
  readonly usesPkce: boolean
  /** Extra headers the token endpoint needs (GitHub wants Accept: json). */
  readonly tokenHeaders?: Readonly<Record<string, string>>
  readonly mapUserInfo: (payload: unknown) => OAuthIdentity | undefined
}

export class OAuthError extends Error {
  constructor(
    readonly code:
      | 'unknown_provider'
      | 'oauth_failed'
      | 'oauth_email_unavailable',
    message: string
  ) {
    super(message)
    this.name = 'OAuthError'
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function readString(
  source: Record<string, unknown>,
  key: string
): string | undefined {
  const value = source[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Google returns `sub` plus an `email` and an explicit `email_verified`.
 * The `hd` claim is deliberately ignored: a hosted-domain address is still an
 * address, and treating it as "more trusted" would be an unverified guess.
 */
export function mapGoogleUserInfo(payload: unknown): OAuthIdentity | undefined {
  const record = asRecord(payload)
  if (!record) return undefined
  const subject = readString(record, 'sub')
  const email = readString(record, 'email')
  if (!subject || !email) return undefined
  return {
    subject,
    email,
    emailVerified: record.email_verified === true,
  }
}

/**
 * GitHub's `/user` has no `email` when the address is private, and no
 * verification field at all — a verified address has to come from
 * `/user/emails`, which the caller folds into the same payload under
 * `verified_email`. Without one, sign-in fails loudly rather than guessing.
 */
export function mapGithubUserInfo(payload: unknown): OAuthIdentity | undefined {
  const record = asRecord(payload)
  if (!record) return undefined
  const id = record.id
  const subject =
    typeof id === 'number' || typeof id === 'string' ? String(id) : undefined
  if (!subject) return undefined
  const email =
    readString(record, 'verified_email') ?? readString(record, 'email')
  if (!email) return undefined
  return {
    subject,
    email,
    emailVerified: readString(record, 'verified_email') !== undefined,
  }
}

export function googleProvider(
  clientId: string,
  clientSecret: string
): OAuthProviderDescriptor {
  return {
    id: 'google',
    label: 'Google',
    clientId,
    clientSecret,
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
    scopes: ['openid', 'email', 'profile'],
    usesPkce: true,
    mapUserInfo: mapGoogleUserInfo,
  }
}

export function githubProvider(
  clientId: string,
  clientSecret: string
): OAuthProviderDescriptor {
  return {
    id: 'github',
    label: 'GitHub',
    clientId,
    clientSecret,
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userInfoUrl: 'https://api.github.com/user',
    scopes: ['read:user', 'user:email'],
    usesPkce: false,
    tokenHeaders: { Accept: 'application/json' },
    mapUserInfo: mapGithubUserInfo,
  }
}

/**
 * Build the provider list from the environment. A provider with only half a
 * credential pair is a misconfiguration and is skipped rather than exposed.
 */
export function readOAuthProviders(
  env: NodeJS.ProcessEnv
): OAuthProviderDescriptor[] {
  const providers: OAuthProviderDescriptor[] = []
  const pairs: Array<
    [string, (id: string, secret: string) => OAuthProviderDescriptor]
  > = [
    ['GOOGLE', googleProvider],
    ['GITHUB', githubProvider],
  ]
  for (const [name, build] of pairs) {
    const clientId = env[`RESUME_AGENT_OAUTH_${name}_CLIENT_ID`]?.trim()
    const clientSecret = env[`RESUME_AGENT_OAUTH_${name}_CLIENT_SECRET`]?.trim()
    if (!clientId || !clientSecret) {
      continue
    }
    const provider = build(clientId, clientSecret)
    // Endpoint overrides let an operator point a provider at a self-hosted
    // instance (or a stand-in) without a code change.
    const override = (key: string, fallback: string): string =>
      env[`RESUME_AGENT_OAUTH_${name}_${key}`]?.trim() || fallback
    providers.push({
      ...provider,
      authorizeUrl: override('AUTHORIZE_URL', provider.authorizeUrl),
      tokenUrl: override('TOKEN_URL', provider.tokenUrl),
      userInfoUrl: override('USERINFO_URL', provider.userInfoUrl),
    })
  }
  return providers
}

/** URL-safe random value used for both `state` and the PKCE verifier. */
export function randomUrlSafe(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

/** S256 challenge, per RFC 7636 §4.2. */
export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

export function buildAuthorizeUrl(
  provider: OAuthProviderDescriptor,
  options: {
    state: string
    redirectUri: string
    codeChallenge?: string
  }
): string {
  const url = new URL(provider.authorizeUrl)
  url.searchParams.set('client_id', provider.clientId)
  url.searchParams.set('redirect_uri', options.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', provider.scopes.join(' '))
  url.searchParams.set('state', options.state)
  if (provider.usesPkce && options.codeChallenge) {
    url.searchParams.set('code_challenge', options.codeChallenge)
    url.searchParams.set('code_challenge_method', 'S256')
  }
  return url.toString()
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  try {
    return JSON.parse(text)
  } catch {
    // GitHub's token endpoint answers form-encoded unless asked otherwise.
    return Object.fromEntries(new URLSearchParams(text))
  }
}

export interface OAuthHttpDeps {
  fetchImpl?: typeof fetch
}

export async function exchangeCodeForToken(
  provider: OAuthProviderDescriptor,
  options: { code: string; codeVerifier?: string; redirectUri: string },
  deps: OAuthHttpDeps = {}
): Promise<string> {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch.bind(globalThis)
  const body = new URLSearchParams({
    client_id: provider.clientId,
    client_secret: provider.clientSecret,
    code: options.code,
    grant_type: 'authorization_code',
    redirect_uri: options.redirectUri,
  })
  if (provider.usesPkce && options.codeVerifier) {
    body.set('code_verifier', options.codeVerifier)
  }
  const response = await fetchImpl(provider.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(provider.tokenHeaders ?? {}),
    },
    body: body.toString(),
  })
  const payload = asRecord(await readJson(response))
  const token = payload ? readString(payload, 'access_token') : undefined
  if (!response.ok || !token) {
    throw new OAuthError('oauth_failed', 'Token exchange failed')
  }
  return token
}

export async function fetchIdentity(
  provider: OAuthProviderDescriptor,
  accessToken: string,
  deps: OAuthHttpDeps = {}
): Promise<OAuthIdentity> {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch.bind(globalThis)
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
    'User-Agent': 'yamlresume-resume-agent',
  }

  const response = await fetchImpl(provider.userInfoUrl, { headers })
  if (!response.ok) {
    throw new OAuthError('oauth_failed', 'User info request failed')
  }
  const payload = asRecord(await readJson(response))
  if (!payload) {
    throw new OAuthError('oauth_failed', 'User info response was not an object')
  }

  // GitHub hides the address on `/user` when it is private; the verified
  // address lives on a second endpoint. Fetch it and fold it in so the mapper
  // sees one shape.
  if (provider.id === 'github' && readString(payload, 'email') === undefined) {
    const emailsResponse = await fetchImpl(`${provider.userInfoUrl}/emails`, {
      headers,
    })
    if (emailsResponse.ok) {
      const emails = await readJson(emailsResponse)
      if (Array.isArray(emails)) {
        const primary = emails
          .map((entry) => asRecord(entry))
          .find((entry) => entry?.primary === true && entry.verified === true)
        const verified = readString(primary ?? {}, 'email')
        if (verified) {
          payload.verified_email = verified
        }
      }
    }
  }

  const identity = provider.mapUserInfo(payload)
  if (!identity) {
    throw new OAuthError(
      'oauth_email_unavailable',
      'The provider did not return an email address for this account'
    )
  }
  return identity
}
