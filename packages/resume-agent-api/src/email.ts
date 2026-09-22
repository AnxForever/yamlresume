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
 * SMTP delivery for the password-reset link.
 *
 * The auth service talks to an `AuthEmailPort` and knows nothing about mail
 * transports; this is the adapter that turns that port into real email. When
 * no SMTP settings are present the service keeps its default logging port, so
 * a development or single-operator install still works — the link lands in the
 * server log instead of an inbox.
 */

import { createTransport, type Transporter } from 'nodemailer'

import type { AuthEmailPort } from './auth'

export interface SmtpConfig {
  readonly host: string
  readonly port: number
  readonly user: string
  readonly pass: string
  /** Defaults to the authenticated mailbox; providers usually reject others. */
  readonly from: string
  readonly secure: boolean
  /** How the app introduces itself in the subject line and body. */
  readonly appName: string
}

export class SmtpConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SmtpConfigError'
  }
}

function readTrimmed(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key]?.trim()
  return value ? value : undefined
}

/**
 * Read SMTP settings from the environment.
 *
 * Returns `undefined` when nothing is configured — that is a supported state,
 * not an error. A *partially* configured transport is an error: silently
 * falling back to the log port would mean password-reset mail quietly stops
 * being sent after a typo in one variable.
 */
export function readSmtpConfig(
  env: NodeJS.ProcessEnv = process.env
): SmtpConfig | undefined {
  const host = readTrimmed(env, 'RESUME_AGENT_SMTP_HOST')
  const user = readTrimmed(env, 'RESUME_AGENT_SMTP_USER')
  const pass = readTrimmed(env, 'RESUME_AGENT_SMTP_PASS')
  const portRaw = readTrimmed(env, 'RESUME_AGENT_SMTP_PORT')
  const from = readTrimmed(env, 'RESUME_AGENT_SMTP_FROM')
  const appName =
    readTrimmed(env, 'RESUME_AGENT_SMTP_APP_NAME') ?? 'Career Agent'

  const supplied = [host, user, pass, portRaw, from].filter(
    (value) => value !== undefined
  ).length
  if (supplied === 0) {
    return undefined
  }
  if (!host || !user || !pass) {
    throw new SmtpConfigError(
      'SMTP is partially configured: host, user and pass are all required'
    )
  }

  // 465 is implicit TLS; 587 and 25 negotiate STARTTLS. Defaulting on the port
  // rather than the host keeps this provider-agnostic.
  const port = portRaw === undefined ? 465 : Number(portRaw)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new SmtpConfigError('SMTP port must be a valid port number')
  }

  return {
    host,
    port,
    user,
    pass,
    from: from ?? user,
    secure: port === 465,
    appName,
  }
}

export interface SmtpEmailPortOptions {
  /** Injected so tests can assert on the message without a live server. */
  transportFactory?: (config: SmtpConfig) => Transporter
  /** Where delivery problems are reported. Never includes message bodies. */
  log?: (line: string) => void
}

export function createSmtpEmailPort(
  config: SmtpConfig,
  options: SmtpEmailPortOptions = {}
): AuthEmailPort {
  const log = options.log ?? ((line: string) => console.error(line))
  const transport =
    options.transportFactory?.(config) ??
    createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.user, pass: config.pass },
      // Bounded so a sick mail server cannot hold a request open. The reset
      // request itself already answered 204 by the time this runs.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    })

  return {
    async sendPasswordReset({ to, resetUrl, expiresAt }) {
      const minutes = Math.max(
        1,
        Math.round((Date.parse(expiresAt) - Date.now()) / 60_000)
      )
      try {
        await transport.sendMail({
          from: `"${config.appName}" <${config.from}>`,
          to,
          subject: `${config.appName} 密码重置`,
          text: [
            `有人请求重置这个 ${config.appName} 账户的密码。`,
            '',
            `重置链接（约 ${minutes} 分钟后失效，只能使用一次）：`,
            resetUrl,
            '',
            '如果你没有发起这次请求，忽略这封邮件即可，你的密码不会被改动。',
          ].join('\n'),
          html: [
            '<p>有人请求重置这个账户的密码。</p>',
            `<p><a href="${resetUrl}">点这里设置新密码</a></p>`,
            `<p style="color:#666">链接约 ${minutes} 分钟后失效，且只能使用一次。` +
              '设置成功后，之前登录过的设备都会退出。</p>',
            '<p style="color:#666">如果你没有发起这次请求，忽略这封邮件即可，你的密码不会被改动。</p>',
          ].join('\n'),
        })
      } catch (error) {
        // Report for operators, but say nothing about the recipient or the
        // link: this line is written whether or not the address has an account,
        // so it must not become an account oracle in the logs either.
        log(
          `[auth] password reset email could not be delivered via ${config.host}:${
            config.port
          }: ${error instanceof Error ? error.message : String(error)}`
        )
        throw error
      }
    },
  }
}
