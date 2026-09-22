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
 * Client-side mirror of the backend's credential rules.
 *
 * These are copied from `packages/resume-agent-api/src/auth.ts`
 * (`canonicalEmail` / `validatePassword`) so the form can reject bad input
 * before a round-trip and explain the rule next to the field. The backend
 * remains the authority — anything that slips through is still rejected there
 * with `invalid_registration`.
 */

export const EMAIL_MIN_LENGTH = 3
export const EMAIL_MAX_LENGTH = 320
export const PASSWORD_MIN_LENGTH = 12
export const PASSWORD_MAX_LENGTH = 128

/** The exact pattern the backend applies after trimming and lowercasing. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u

/** Returns an error message, or `undefined` when the value is acceptable. */
export function validateEmail(value: string): string | undefined {
  const canonical = value.trim()
  if (canonical.length === 0) {
    return '请输入邮箱'
  }
  if (
    canonical.length < EMAIL_MIN_LENGTH ||
    canonical.length > EMAIL_MAX_LENGTH
  ) {
    return `邮箱长度需要在 ${EMAIL_MIN_LENGTH}–${EMAIL_MAX_LENGTH} 个字符之间`
  }
  if (!EMAIL_PATTERN.test(canonical)) {
    return '邮箱格式不正确，例如 you@example.com'
  }
  return undefined
}

/** Returns an error message, or `undefined` when the value is acceptable. */
export function validatePassword(value: string): string | undefined {
  if (value.length === 0) {
    return '请输入密码'
  }
  if (value.length < PASSWORD_MIN_LENGTH) {
    return `密码至少 ${PASSWORD_MIN_LENGTH} 位（当前 ${value.length} 位）`
  }
  if (value.length > PASSWORD_MAX_LENGTH) {
    return `密码最多 ${PASSWORD_MAX_LENGTH} 位`
  }
  return undefined
}

export function validatePasswordConfirmation(
  password: string,
  confirmation: string
): string | undefined {
  if (confirmation.length === 0) {
    return '请再输入一次密码'
  }
  if (password !== confirmation) {
    return '两次输入的密码不一致'
  }
  return undefined
}

export type PasswordStrength = 'too-short' | 'weak' | 'fair' | 'strong'

/**
 * A hint, not a gate: the backend enforces length only (12–128) and has no
 * character-class requirement, so the meter never *blocks* on variety — it
 * just tells the user how much longer their password is than the floor.
 */
export function passwordStrength(value: string): PasswordStrength {
  if (value.length < PASSWORD_MIN_LENGTH) {
    return 'too-short'
  }
  const classes =
    Number(/[a-z]/u.test(value)) +
    Number(/[A-Z]/u.test(value)) +
    Number(/\d/u.test(value)) +
    Number(/[^A-Za-z0-9]/u.test(value))
  if (value.length >= 16 || classes >= 3) {
    return 'strong'
  }
  return classes >= 2 ? 'fair' : 'weak'
}

export const PASSWORD_STRENGTH_LABEL: Record<PasswordStrength, string> = {
  'too-short': `还需 ${PASSWORD_MIN_LENGTH} 位以上`,
  weak: '强度一般',
  fair: '强度尚可',
  strong: '强度很好',
}

/**
 * Map a backend `AuthErrorCode` to something a person can act on.
 *
 * `packages/resume-agent-api/src/auth.ts` emits these codes; the messages it
 * sends are English and, in the rate-limit case, omit the wait. Unknown codes
 * fall back to the server's own message rather than inventing a reason.
 */
export function authErrorMessage(code: string, fallback: string): string {
  switch (code) {
    case 'invalid_credentials':
      // Shown for every failed sign-in, so it cannot leak whether the address
      // has an account — but a first-time user who opens this page and clicks
      // "log in" out of habit needs the nudge.
      return '邮箱或密码不正确。第一次使用请先注册。'
    case 'invalid_registration':
      return `邮箱或密码不符合要求：邮箱需有效，密码需 ${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} 位`
    case 'user_exists':
      return '这个邮箱已经注册过了，直接登录即可'
    case 'login_rate_limited':
      return '尝试次数过多，请约 15 分钟后再试'
    case 'invalid_invite_code':
      return '邀请码不正确，或者没有填写'
    case 'invalid_reset_token':
      return '这个重置链接无效或已过期，请重新申请一封'
    case 'reset_rate_limited':
      return '申请过于频繁，请过一会儿再试'
    case 'oauth_unavailable':
      return '这个登录方式当前后端没有配置'
    case 'oauth_email_unverified':
      return '该平台没有验证这个邮箱，无法用它登录已有账户'
    case 'oauth_email_unavailable':
      return '该平台没有返回邮箱，无法用它登录'
    case 'invalid_oauth_state':
      return '这次登录已超时或被中断，请重新点击登录'
    case 'oauth_failed':
      return '第三方登录失败，请重试或改用邮箱登录'
    case 'not_authenticated':
      return '登录状态已失效，请重新登录'
    case 'authentication_disabled':
      return '后端当前关闭了账号功能，无需登录即可使用'
    case 'network_error':
      return '连不上后端。请确认后端已启动，且它的允许来源（allowedOrigin）与当前页面地址一致'
    case 'timeout':
      return '后端响应超时，请稍后重试'
    default:
      return fallback
  }
}
