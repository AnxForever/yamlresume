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

import { describe, expect, it, vi } from 'vitest'

import {
  createSmtpEmailPort,
  readSmtpConfig,
  type SmtpConfig,
  SmtpConfigError,
} from './email'

const BASE_ENV = {
  RESUME_AGENT_SMTP_HOST: 'smtp.example.com',
  RESUME_AGENT_SMTP_USER: 'user@example.com',
  RESUME_AGENT_SMTP_PASS: 'authorization-code',
}

describe('readSmtpConfig', () => {
  it('returns undefined when nothing is configured', () => {
    expect(readSmtpConfig({})).toBeUndefined()
  })

  it('reads a complete configuration', () => {
    expect(readSmtpConfig(BASE_ENV)).toEqual({
      host: 'smtp.example.com',
      port: 465,
      user: 'user@example.com',
      pass: 'authorization-code',
      from: 'user@example.com',
      secure: true,
      appName: 'Career Agent',
    })
  })

  it('treats 587 as STARTTLS rather than implicit TLS', () => {
    const config = readSmtpConfig({
      ...BASE_ENV,
      RESUME_AGENT_SMTP_PORT: '587',
    })
    expect(config?.secure).toBe(false)
  })

  it('lets the from address differ, for an alias or display domain', () => {
    const config = readSmtpConfig({
      ...BASE_ENV,
      RESUME_AGENT_SMTP_FROM: 'no-reply@example.com',
    })
    expect(config?.from).toBe('no-reply@example.com')
  })

  it('refuses a half-configured transport instead of silently logging', () => {
    // A typo in one variable must fail loudly: falling back to the log port
    // would mean reset mail quietly stops being sent.
    expect(() =>
      readSmtpConfig({ RESUME_AGENT_SMTP_HOST: 'smtp.example.com' })
    ).toThrow(SmtpConfigError)
    expect(() =>
      readSmtpConfig({ ...BASE_ENV, RESUME_AGENT_SMTP_USER: '  ' })
    ).toThrow(SmtpConfigError)
  })

  it('refuses a nonsense port', () => {
    expect(() =>
      readSmtpConfig({ ...BASE_ENV, RESUME_AGENT_SMTP_PORT: 'abc' })
    ).toThrow(SmtpConfigError)
    expect(() =>
      readSmtpConfig({ ...BASE_ENV, RESUME_AGENT_SMTP_PORT: '70000' })
    ).toThrow(SmtpConfigError)
  })
})

describe('createSmtpEmailPort', () => {
  const config: SmtpConfig = readSmtpConfig(BASE_ENV)!

  function port(sendMail: ReturnType<typeof vi.fn>, log = vi.fn()) {
    return {
      log,
      instance: createSmtpEmailPort(config, {
        log,
        transportFactory: () => ({ sendMail }) as never,
      }),
    }
  }

  it('sends the reset link to the requested address with both bodies', async () => {
    const sendMail = vi.fn(async () => undefined)
    const { instance } = port(sendMail)

    await instance.sendPasswordReset({
      to: 'person@example.com',
      resetUrl: 'https://app.example.com/#reset=abc',
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    })

    const message = sendMail.mock.calls[0]?.[0] as Record<string, string>
    expect(message.to).toBe('person@example.com')
    expect(message.from).toBe('"Career Agent" <user@example.com>')
    expect(message.subject).toContain('密码重置')
    expect(message.text).toContain('https://app.example.com/#reset=abc')
    expect(message.html).toContain('https://app.example.com/#reset=abc')
    // The single-use and expiry semantics are stated in the mail itself.
    expect(message.text).toContain('只能使用一次')
  })

  it('reports a delivery failure without leaking the recipient', async () => {
    const sendMail = vi.fn(async () => {
      throw new Error('550 mailbox unavailable')
    })
    const { instance, log } = port(sendMail)

    await expect(
      instance.sendPasswordReset({
        to: 'person@example.com',
        resetUrl: 'https://app.example.com/#reset=abc',
        expiresAt: new Date().toISOString(),
      })
    ).rejects.toThrow()

    const line = log.mock.calls[0]?.[0] as string
    expect(line).toContain('could not be delivered')
    expect(line).not.toContain('person@example.com')
    expect(line).not.toContain('#reset=abc')
  })
})
