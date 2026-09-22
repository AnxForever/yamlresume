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

'use client'

import {
  AlertCircle,
  ArrowRight,
  Eye,
  EyeOff,
  KeyRound,
  Layers,
  LoaderCircle,
  Lock,
  Mail,
  ScanSearch,
  ShieldCheck,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { LogoMark } from '@/components/brand/logo'
import type { AgentApiClient, AuthUser } from '@/lib/api/client'
import {
  authErrorMessage,
  PASSWORD_STRENGTH_LABEL,
  type PasswordStrength,
  passwordStrength,
  validateEmail,
  validatePassword,
  validatePasswordConfirmation,
} from '@/lib/auth'
import { cx } from '@/lib/cx'

type AuthMode = 'login' | 'register' | 'forgot' | 'reset'

/**
 * Reads the reset token out of the URL the email linked to
 * (`<origin>/#reset=<token>`). Kept in the hash rather than a query string so
 * the token never reaches a server log on the way in.
 */
export function readResetToken(hash: string): string | null {
  const match = /[#&]reset=([A-Za-z0-9_-]{43})/u.exec(hash)
  return match?.[1] ?? null
}

/** Clears the reset token from the address bar once it has been consumed. */
export function clearResetToken(): void {
  if (typeof window === 'undefined') {
    return
  }
  const next = window.location.hash.replace(/[#&]?reset=[A-Za-z0-9_-]{43}/u, '')
  window.history.replaceState(null, '', `${window.location.pathname}${next}`)
}

interface FieldErrors {
  email?: string
  password?: string
  confirmation?: string
  inviteCode?: string
}

/**
 * Sign-in / sign-up screen.
 *
 * Layout follows the split-screen pattern from StyleKit's auth template — a
 * decorative brand panel beside a focused form column — rebuilt on this app's
 * design tokens rather than the template's hard-coded palette.
 *
 * Everything offered here exists on the server: password reset, provider
 * sign-in, and invitation-gated registration are all driven by what
 * `/v1/capabilities` reports, so no control is ever rendered for a capability
 * the deployment does not have.
 */
export function AuthView({
  client,
  onAuthenticated,
  initialMode,
  resetToken: resetTokenProp,
  oauthProviders = [],
  registration = 'open',
}: {
  client: AgentApiClient
  onAuthenticated: (user: AuthUser) => void
  initialMode?: AuthMode
  /** Present when AppShell routed here from a `#reset=` link. */
  resetToken?: string | null
  /**
   * Providers this server has credentials for. Empty means the whole section
   * is absent — a sign-in button that cannot work is worse than no button.
   */
  oauthProviders?: Array<{ id: string; label: string }>
  /** Told by the server: when `invite`, registration needs a code. */
  registration?: 'open' | 'invite'
}) {
  const [mode, setMode] = useState<AuthMode>(
    initialMode ?? (resetTokenProp ? 'reset' : 'login')
  )
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [remember, setRemember] = useState(false)
  const [inviteCode, setInviteCode] = useState('')
  const [resetToken] = useState(resetTokenProp ?? null)
  const [resetSent, setResetSent] = useState(false)
  const [resetDone, setResetDone] = useState(false)
  /**
   * Set when the provider callback bounced the browser back with
   * `#auth_error=`.
   */
  const [oauthError] = useState<string | null>(() => {
    if (typeof window === 'undefined') {
      return null
    }
    const match = /[#&]auth_error=([a-z_]+)/u.exec(window.location.hash)
    return match?.[1] ?? null
  })
  const emailRef = useRef<HTMLInputElement>(null)

  // Put the caret in the first field on load. This screen exists only to be
  // filled in, so starting focus here saves two tabs past the mode switch and
  // matches what people expect of a sign-in page. Written as an explicit
  // effect rather than the `autoFocus` attribute, which Biome rightly flags as
  // a hazard on pages that are not single-purpose like this one.
  useEffect(() => {
    emailRef.current?.focus()
  }, [])

  function switchMode(next: AuthMode) {
    setMode(next)
    setErrors({})
    setFormError(null)
    setConfirmation('')
  }

  /**
   * Once a field has been rejected, re-check it on every keystroke so the
   * message disappears the moment the input becomes valid. Without this the
   * form contradicts itself: a fixed password still shows "至少 12 位" while
   * the strength meter beside it already reads "强度很好".
   */
  function changeEmail(next: string) {
    setEmail(next)
    if (errors.email) {
      setErrors((prev) => ({ ...prev, email: validateEmail(next) }))
    }
  }

  function changePassword(next: string) {
    setPassword(next)
    if (errors.password) {
      setErrors((prev) => ({ ...prev, password: validatePassword(next) }))
    }
    // The confirmation is only ever wrong relative to the password, so it has
    // to be re-checked when this side of the pair changes.
    if (errors.confirmation) {
      setErrors((prev) => ({
        ...prev,
        confirmation: validatePasswordConfirmation(next, confirmation),
      }))
    }
  }

  function changeConfirmation(next: string) {
    setConfirmation(next)
    if (errors.confirmation) {
      setErrors((prev) => ({
        ...prev,
        confirmation: validatePasswordConfirmation(password, next),
      }))
    }
  }

  /**
   * Validate on submit rather than disabling the button, so a grey button
   * never has to explain itself — the problem is always shown next to the
   * field that caused it.
   */
  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (busy) {
      return
    }
    const nextErrors: FieldErrors = {
      email: validateEmail(email),
      password: validatePassword(password),
    }
    if (mode === 'register') {
      nextErrors.confirmation = validatePasswordConfirmation(
        password,
        confirmation
      )
      if (registration === 'invite' && inviteCode.trim().length === 0) {
        nextErrors.inviteCode = '请输入邀请码'
      }
    }
    setErrors(nextErrors)
    setFormError(null)
    if (
      nextErrors.email ||
      nextErrors.password ||
      nextErrors.confirmation ||
      nextErrors.inviteCode
    ) {
      emailRef.current?.focus()
      return
    }

    setBusy(true)
    const result =
      mode === 'login'
        ? await client.login(email.trim(), password, remember)
        : await client.register(
            email.trim(),
            password,
            remember,
            registration === 'invite' ? inviteCode.trim() : undefined
          )
    setBusy(false)

    if (result.kind === 'error') {
      setFormError(authErrorMessage(result.error.code, result.error.message))
      return
    }
    onAuthenticated(result.data.user)
  }

  async function handleForgot(event: React.FormEvent) {
    event.preventDefault()
    if (busy) {
      return
    }
    const emailError = validateEmail(email)
    setErrors({ email: emailError })
    setFormError(null)
    if (emailError) {
      emailRef.current?.focus()
      return
    }
    setBusy(true)
    const result = await client.requestPasswordReset(email.trim())
    setBusy(false)
    if (result.kind === 'error') {
      setFormError(authErrorMessage(result.error.code, result.error.message))
      return
    }
    // The server answers identically for known and unknown addresses, so the
    // confirmation must stay conditional-free too.
    setResetSent(true)
  }

  async function handleReset(event: React.FormEvent) {
    event.preventDefault()
    if (busy || !resetToken) {
      return
    }
    const nextErrors: FieldErrors = {
      password: validatePassword(password),
      confirmation: validatePasswordConfirmation(password, confirmation),
    }
    setErrors(nextErrors)
    setFormError(null)
    if (nextErrors.password || nextErrors.confirmation) {
      return
    }
    setBusy(true)
    const result = await client.confirmPasswordReset(resetToken, password)
    setBusy(false)
    if (result.kind === 'error') {
      setFormError(authErrorMessage(result.error.code, result.error.message))
      return
    }
    clearResetToken()
    setResetDone(true)
  }

  const strength = passwordStrength(password)

  return (
    <main className="bg-background-muted flex min-h-screen">
      <BrandPanel />

      <div className="flex flex-1 items-center justify-center px-6 py-10 md:px-10 lg:px-14">
        <div className="w-full max-w-[420px]">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <LogoMark size={36} />
            <span className="text-foreground-strong text-lg font-semibold tracking-tight">
              Career Agent
            </span>
          </div>

          {/* Mode switch. Hidden for the reset flows, which are entered from a
              link or an email rather than by switching tabs. */}
          {mode === 'login' || mode === 'register' ? (
            <div
              role="tablist"
              aria-label="登录或注册"
              className="bg-[var(--overlay-subtle)] mb-8 flex gap-1 rounded-xl p-1"
            >
              {(
                [
                  ['login', '登录'],
                  ['register', '注册'],
                ] as const
              ).map(([value, label]) => {
                const selected = mode === value
                return (
                  <button
                    key={value}
                    role="tab"
                    type="button"
                    id={`auth-tab-${value}`}
                    aria-selected={selected}
                    aria-controls="auth-panel"
                    onClick={() => switchMode(value)}
                    className={cx(
                      'flex-1 rounded-lg py-2 text-sm font-medium transition-all',
                      selected
                        ? 'bg-background text-foreground-strong shadow-md'
                        : 'text-foreground-muted hover:text-foreground'
                    )}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          ) : null}

          <form
            id="auth-panel"
            role="tabpanel"
            aria-labelledby={
              mode === 'login' || mode === 'register'
                ? `auth-tab-${mode}`
                : undefined
            }
            aria-label={mode === 'forgot' ? '重置密码' : undefined}
            onSubmit={
              mode === 'forgot'
                ? handleForgot
                : mode === 'reset'
                  ? handleReset
                  : handleSubmit
            }
            noValidate
            className="bg-background shadow-xl border-border rounded-xl border p-8"
          >
            <header className="mb-6">
              <h1 className="text-foreground-strong text-[22px] font-semibold tracking-tight">
                {mode === 'login'
                  ? '登录 Career Agent'
                  : mode === 'register'
                    ? '创建你的账户'
                    : mode === 'forgot'
                      ? '重置密码'
                      : '设置新密码'}
              </h1>
              <p className="text-foreground-muted mt-2 text-sm leading-relaxed">
                {mode === 'login'
                  ? '登录后继续你上次的定制，草稿和运行记录都会保留。'
                  : mode === 'register'
                    ? '账户用来保存你的简历、对话和生成记录。'
                    : mode === 'forgot'
                      ? '填注册时用的邮箱，我们会把重置链接发过去。'
                      : '设置好之后，之前登录过的设备都会退出。'}
              </p>
            </header>

            <div className="flex flex-col gap-5">
              {oauthProviders.length > 0 &&
              (mode === 'login' || mode === 'register') ? (
                <>
                  <div className="flex flex-col gap-2">
                    {oauthProviders.map((provider) => (
                      <a
                        key={provider.id}
                        href={client.oauthStartUrl(provider.id)}
                        className="border-border text-foreground-strong hover:bg-[var(--overlay-hover)] flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors"
                      >
                        使用 {provider.label} 继续
                      </a>
                    ))}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="bg-border h-px flex-1" />
                    <span className="text-foreground-subtle text-xs">
                      或使用邮箱
                    </span>
                    <span className="bg-border h-px flex-1" />
                  </div>
                </>
              ) : null}

              {mode !== 'forgot' ? (
                <AuthField
                  ref={emailRef}
                  id="auth-email"
                  label="邮箱"
                  icon={Mail}
                  type="email"
                  value={email}
                  onChange={changeEmail}
                  error={errors.email}
                  placeholder="you@example.com"
                  autoComplete="email"
                />
              ) : null}

              {mode !== 'forgot' ? (
                <div>
                  <AuthField
                    id="auth-password"
                    label="密码"
                    icon={Lock}
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={changePassword}
                    error={errors.password}
                    placeholder={
                      mode === 'register' ? '至少 12 位' : '你的密码'
                    }
                    autoComplete={
                      mode === 'login' ? 'current-password' : 'new-password'
                    }
                    trailing={
                      <button
                        type="button"
                        onClick={() => setShowPassword((shown) => !shown)}
                        aria-label={showPassword ? '隐藏密码' : '显示密码'}
                        aria-pressed={showPassword}
                        className="text-foreground-muted hover:text-foreground-strong flex size-6 items-center justify-center rounded-full transition-colors"
                      >
                        {showPassword ? (
                          <EyeOff size={15} />
                        ) : (
                          <Eye size={15} />
                        )}
                      </button>
                    }
                  />
                  {(mode === 'register' || mode === 'reset') &&
                  password.length > 0 ? (
                    <PasswordStrengthMeter strength={strength} />
                  ) : null}
                </div>
              ) : null}

              {mode === 'register' && registration === 'invite' ? (
                <AuthField
                  id="auth-invite"
                  label="邀请码"
                  icon={KeyRound}
                  value={inviteCode}
                  onChange={setInviteCode}
                  error={errors.inviteCode}
                  placeholder="向发给你链接的人索取"
                  autoComplete="off"
                />
              ) : null}

              {mode === 'register' || mode === 'reset' ? (
                <AuthField
                  id="auth-confirmation"
                  label="确认密码"
                  icon={Lock}
                  type={showPassword ? 'text' : 'password'}
                  value={confirmation}
                  onChange={changeConfirmation}
                  error={errors.confirmation}
                  placeholder="再输入一次"
                  autoComplete="new-password"
                />
              ) : null}

              {mode === 'forgot' ? (
                <>
                  {resetSent ? (
                    <p className="text-foreground bg-success-subtle rounded-md px-3 py-3 text-sm leading-relaxed">
                      如果 <strong>{email.trim()}</strong>{' '}
                      已注册，重置链接已经发出。链接 30
                      分钟内有效，只能使用一次。
                      <br />
                      <span className="text-foreground-muted text-xs">
                        本机开发时没有邮件服务，链接会打印在后端日志里。
                      </span>
                    </p>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => switchMode('login')}
                    className="text-secondary-emphasis hover:text-secondary-strong self-start text-sm font-medium transition-colors"
                  >
                    ← 返回登录
                  </button>
                </>
              ) : null}

              {mode === 'reset' && resetDone ? (
                <>
                  <p className="text-foreground bg-success-subtle rounded-md px-3 py-3 text-sm leading-relaxed">
                    密码已更新，之前的登录都已退出。请用新密码登录。
                  </p>
                  <button
                    type="button"
                    onClick={() => switchMode('login')}
                    className="bg-primary text-primary-foreground hover:bg-primary-strong flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all"
                  >
                    去登录
                    <ArrowRight size={16} />
                  </button>
                </>
              ) : null}

              {mode === 'reset' && !resetDone && !resetToken ? (
                <p
                  role="alert"
                  className="text-error-emphasis bg-error-subtle rounded-md px-3 py-3 text-sm leading-relaxed"
                >
                  这个重置链接不完整或已被使用。请重新申请一封重置邮件。
                </p>
              ) : null}

              {mode === 'forgot' ? (
                <>
                  <AuthField
                    id="forgot-email"
                    label="注册邮箱"
                    icon={Mail}
                    type="email"
                    value={email}
                    onChange={changeEmail}
                    error={errors.email}
                    placeholder="you@example.com"
                    autoComplete="email"
                  />
                  <button
                    type="submit"
                    disabled={busy}
                    aria-busy={busy}
                    className="bg-primary text-primary-foreground hover:bg-primary-strong flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold shadow-lg transition-all disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {busy ? (
                      <>
                        <LoaderCircle size={16} className="animate-spin" />
                        正在发送…
                      </>
                    ) : (
                      <>
                        发送重置链接
                        <ArrowRight size={16} />
                      </>
                    )}
                  </button>
                </>
              ) : null}

              {mode === 'reset' && !resetDone && resetToken ? (
                <button
                  type="submit"
                  disabled={busy}
                  aria-busy={busy}
                  className="bg-primary text-primary-foreground hover:bg-primary-strong flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold shadow-lg transition-all disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {busy ? (
                    <>
                      <LoaderCircle size={16} className="animate-spin" />
                      正在更新…
                    </>
                  ) : (
                    <>
                      更新密码
                      <ArrowRight size={16} />
                    </>
                  )}
                </button>
              ) : null}

              {mode === 'login' ? (
                <button
                  type="button"
                  onClick={() => switchMode('forgot')}
                  className="text-secondary-emphasis hover:text-secondary-strong self-start text-sm font-medium transition-colors"
                >
                  忘记密码？
                </button>
              ) : null}

              {mode === 'login' || mode === 'register' ? (
                <label className="flex cursor-pointer items-center gap-2 select-none">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(event) => setRemember(event.target.checked)}
                    className="accent-primary size-4 rounded"
                  />
                  <span className="text-foreground text-sm">记住我</span>
                  <span className="text-foreground-subtle text-xs">
                    （不勾选则关闭浏览器后需要重新登录）
                  </span>
                </label>
              ) : null}

              {oauthError && !formError ? (
                <p
                  role="alert"
                  className="text-error-emphasis bg-error-subtle rounded-md px-3 py-2.5 text-sm leading-relaxed"
                >
                  {authErrorMessage(oauthError, '使用第三方账号登录失败')}
                </p>
              ) : null}

              {formError ? (
                <p
                  role="alert"
                  className="text-error-emphasis bg-error-subtle flex items-start gap-2 rounded-md px-3 py-2.5 text-sm leading-relaxed"
                >
                  <AlertCircle size={16} className="mt-0.5 shrink-0" />
                  <span>{formError}</span>
                </p>
              ) : null}

              {/* The reset flows bring their own submit button above. */}
              {mode === 'login' || mode === 'register' ? (
                <button
                  type="submit"
                  disabled={busy}
                  aria-busy={busy}
                  className="bg-primary text-primary-foreground hover:bg-primary-strong flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold shadow-lg transition-all disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {busy ? (
                    <>
                      <LoaderCircle size={16} className="animate-spin" />
                      {mode === 'login' ? '正在登录…' : '正在创建…'}
                    </>
                  ) : (
                    <>
                      {mode === 'login' ? '登录' : '创建账户'}
                      <ArrowRight size={16} />
                    </>
                  )}
                </button>
              ) : null}
            </div>
          </form>

          <p className="text-foreground-subtle mt-6 text-center text-xs leading-relaxed">
            密码用 scrypt 加盐哈希后存储，会话通过 HttpOnly cookie
            维持。你的简历内容不会离开这台后端。
          </p>
        </div>
      </div>
    </main>
  )
}

/**
 * Decorative half. Hidden below `lg`, where the form takes the full width.
 */
function BrandPanel() {
  return (
    <div className="bg-background-inverse relative hidden overflow-hidden p-12 lg:flex lg:w-[46%] lg:flex-col lg:justify-between">
      {/* Accent glow, echoing the app's single blue accent. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[radial-gradient(ellipse_at_18%_12%,var(--secondary-soft),transparent_55%)]"
      />

      {/* Concentric rings + drifting dots: quiet texture, no motion. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="border-foreground-inverse/10 absolute right-14 top-20 size-40 rounded-full border" />
        <div className="border-foreground-inverse/[0.06] absolute right-24 top-32 size-64 rounded-full border" />
        <div className="bg-secondary-muted absolute right-32 top-28 size-2 rounded-full" />
        <div className="bg-foreground-inverse/40 absolute right-16 top-52 size-1.5 rounded-full" />
        <div className="bg-foreground-inverse/25 absolute right-40 top-72 size-1 rounded-full" />
      </div>

      {/* Layered arcs along the bottom. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="bg-foreground-inverse/[0.04] absolute -bottom-28 -left-24 right-[-20%] h-72 rounded-[100%]" />
        <div className="bg-foreground-inverse/[0.05] absolute -bottom-40 left-[15%] right-[-30%] h-72 rounded-[100%]" />
        <div className="bg-foreground-inverse/[0.06] absolute -bottom-52 left-[45%] right-[-40%] h-72 rounded-[100%]" />
      </div>

      <div className="relative z-10 flex items-center gap-2.5">
        <span className="border-background flex size-9 items-center justify-center rounded-xl border">
          <LogoMark size={22} />
        </span>
        <span className="text-foreground-inverse text-xl font-semibold tracking-tight">
          Career Agent
        </span>
      </div>

      <div className="relative z-10">
        <h2 className="text-foreground-inverse text-[32px] font-bold leading-tight tracking-tight">
          把一份 JD，
          <br />
          变成一份说得清来由的简历。
        </h2>
        <p className="text-foreground-inverse/70 mt-4 max-w-[22rem] text-[15px] leading-relaxed">
          它会逐条对照岗位要求和你自己的经历，改了什么、凭什么改，都能追回原文。
        </p>

        <ul className="mt-8 flex flex-col gap-3">
          {(
            [
              [
                ScanSearch,
                '每条改写都能追到出处',
                '需求与证据逐条对照，缺失的必须项直接列出来。',
              ],
              [
                Layers,
                '五种排版一次生成',
                'ATS 友好、双栏技术版、学术版等，可对比后挑一个下载。',
              ],
              [
                ShieldCheck,
                '材料只进本机后端',
                '不经过第三方服务，密钥也只在后端环境变量里。',
              ],
            ] as const
          ).map(([Icon, title, body]) => (
            <li
              key={title}
              className="border-foreground-inverse/10 bg-foreground-inverse/5 flex items-start gap-3 rounded-xl border p-4"
            >
              <span className="bg-foreground-inverse/10 flex size-8 shrink-0 items-center justify-center rounded-lg">
                <Icon size={16} className="text-foreground-inverse" />
              </span>
              <span>
                <span className="text-foreground-inverse block text-sm font-semibold">
                  {title}
                </span>
                <span className="text-foreground-inverse/60 mt-1 block text-xs leading-relaxed">
                  {body}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <p className="text-foreground-inverse/40 relative z-10 text-xs">
        Resume as Code · 你的简历和经历始终属于你自己
      </p>
    </div>
  )
}

/**
 * One labelled input with a leading icon, optional trailing control, and an
 * inline error that is wired to the input via `aria-describedby`.
 */
function AuthField({
  ref,
  id,
  label,
  icon: Icon,
  type = 'text',
  value,
  onChange,
  error,
  placeholder,
  autoComplete,
  trailing,
}: {
  ref?: React.Ref<HTMLInputElement>
  id: string
  label: string
  icon: React.ElementType
  type?: string
  value: string
  onChange: (value: string) => void
  error?: string
  placeholder?: string
  autoComplete?: string
  trailing?: React.ReactNode
}) {
  const errorId = `${id}-error`
  return (
    <div>
      <label
        htmlFor={id}
        className="text-foreground-strong mb-2 block text-sm font-medium"
      >
        {label}
      </label>
      <div className="relative">
        <span className="text-foreground-subtle pointer-events-none absolute inset-y-0 left-3 flex items-center">
          <Icon size={16} />
        </span>
        <input
          ref={ref}
          id={id}
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className={cx(
            'text-foreground-strong placeholder:text-foreground-subtle w-full rounded-xl border bg-transparent py-2.5 pl-10 text-sm transition-colors outline-none',
            trailing ? 'pr-10' : 'pr-3',
            error
              ? 'border-error-emphasis bg-error-subtle/40'
              : 'border-border hover:border-border-strong focus:border-secondary-emphasis'
          )}
        />
        {trailing ? (
          <span className="absolute inset-y-0 right-2 flex items-center">
            {trailing}
          </span>
        ) : null}
      </div>
      {error ? (
        <p
          id={errorId}
          className="text-error-emphasis mt-2 flex items-center gap-1.5 text-xs"
        >
          <AlertCircle size={14} className="shrink-0" />
          {error}
        </p>
      ) : null}
    </div>
  )
}

/**
 * Length guidance only. `resume-agent-api` enforces a 12–128 character length
 * and no character-class rule, so the meter never claims variety is required —
 * it just shows how far past the floor the password is.
 */
function PasswordStrengthMeter({ strength }: { strength: PasswordStrength }) {
  const filled = strength === 'strong' ? 3 : strength === 'fair' ? 2 : 1
  const tone =
    strength === 'fair'
      ? 'text-secondary-emphasis'
      : strength === 'strong'
        ? 'text-success-emphasis'
        : 'text-warning-emphasis'
  const barTone =
    strength === 'fair'
      ? 'bg-secondary-emphasis'
      : strength === 'strong'
        ? 'bg-success-emphasis'
        : 'bg-warning-emphasis'
  return (
    <div className="mt-2">
      <div className="flex gap-1.5" aria-hidden="true">
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            className={cx(
              'h-1.5 flex-1 rounded-full transition-all',
              index < filled ? barTone : 'bg-[var(--overlay-active)]'
            )}
          />
        ))}
      </div>
      <p className={cx('mt-2 text-xs font-medium', tone)}>
        密码强度：{PASSWORD_STRENGTH_LABEL[strength]}
      </p>
    </div>
  )
}
