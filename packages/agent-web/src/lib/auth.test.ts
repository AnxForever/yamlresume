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

import { describe, expect, it } from 'vitest'

import {
  authErrorMessage,
  passwordStrength,
  validateEmail,
  validatePassword,
  validatePasswordConfirmation,
} from '@/lib/auth'

describe('validateEmail', () => {
  it('accepts an ordinary address', () => {
    expect(validateEmail('user@example.com')).toBeUndefined()
  })

  it('accepts surrounding whitespace and mixed case like the backend does', () => {
    expect(validateEmail('  User@Example.COM  ')).toBeUndefined()
  })

  it('rejects an empty value', () => {
    expect(validateEmail('')).toBe('请输入邮箱')
  })

  it('rejects a value with no @ or domain dot', () => {
    expect(validateEmail('nope')).toBeTruthy()
    expect(validateEmail('a@b')).toBeTruthy()
    expect(validateEmail('a@b.')).toBeTruthy()
  })

  it('rejects a value with internal whitespace', () => {
    expect(validateEmail('a b@example.com')).toBeTruthy()
  })
})

describe('validatePassword', () => {
  it('rejects anything shorter than the backend floor of 12', () => {
    expect(validatePassword('short')).toContain('至少 12 位')
    expect(validatePassword('12345678901')).toBeTruthy()
  })

  it('accepts exactly 12 characters', () => {
    expect(validatePassword('123456789012')).toBeUndefined()
  })

  it('rejects more than 128 characters', () => {
    expect(validatePassword('a'.repeat(129))).toContain('最多 128 位')
  })

  it('accepts exactly 128 characters', () => {
    expect(validatePassword('a'.repeat(128))).toBeUndefined()
  })

  it('rejects an empty value before length checks', () => {
    expect(validatePassword('')).toBe('请输入密码')
  })
})

describe('validatePasswordConfirmation', () => {
  it('passes when both match', () => {
    expect(
      validatePasswordConfirmation('correct horse', 'correct horse')
    ).toBeUndefined()
  })

  it('reports an empty confirmation', () => {
    expect(validatePasswordConfirmation('correct horse', '')).toBe(
      '请再输入一次密码'
    )
  })

  it('reports a mismatch', () => {
    expect(validatePasswordConfirmation('correct horse', 'correct hors')).toBe(
      '两次输入的密码不一致'
    )
  })
})

describe('passwordStrength', () => {
  it('flags anything below the backend minimum as too short', () => {
    expect(passwordStrength('short')).toBe('too-short')
    expect(passwordStrength('12345678901')).toBe('too-short')
  })

  it('treats a bare minimum-length single-class password as weak', () => {
    expect(passwordStrength('aaaaaaaaaaaa')).toBe('weak')
  })

  it('treats two character classes as fair', () => {
    expect(passwordStrength('aaaaaaaaaaa1')).toBe('fair')
  })

  it('treats three classes as strong', () => {
    expect(passwordStrength('Aaaaaaaaaaa1')).toBe('strong')
  })

  it('treats long passwords as strong regardless of variety', () => {
    expect(passwordStrength('aaaaaaaaaaaaaaaa')).toBe('strong')
  })
})

describe('authErrorMessage', () => {
  it('explains wrong credentials without leaking which half was wrong', () => {
    const message = authErrorMessage('invalid_credentials', 'x')
    expect(message).toContain('邮箱或密码不正确')
    // A first-time visitor clicks "log in" before realising they must register.
    expect(message).toContain('先注册')
  })

  it('tells an existing user to sign in instead', () => {
    expect(authErrorMessage('user_exists', 'x')).toContain('直接登录')
  })

  it('states the rate-limit wait, which the server message omits', () => {
    expect(authErrorMessage('login_rate_limited', 'x')).toContain('15 分钟')
  })

  it('explains the origin mismatch behind a network failure', () => {
    expect(authErrorMessage('network_error', 'x')).toContain('allowedOrigin')
  })

  it('explains a dead reset link', () => {
    expect(authErrorMessage('invalid_reset_token', 'x')).toContain('重新申请')
  })

  it('explains reset request throttling', () => {
    expect(authErrorMessage('reset_rate_limited', 'x')).toContain('过于频繁')
  })

  it('falls back to the server message for an unknown code', () => {
    expect(authErrorMessage('storage_failed', '磁盘炸了')).toBe('磁盘炸了')
  })
})
