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

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { AuthView, readResetToken } from '@/components/auth/auth-view'
import type { AgentApiClient, ApiResult, AuthSession } from '@/lib/api/client'

const GOOD_EMAIL = 'user@example.com'
const GOOD_PASSWORD = 'correct horse battery staple'

function session(): AuthSession {
  return {
    user: {
      id: 'u1',
      email: GOOD_EMAIL,
      createdAt: '2026-09-16T00:00:00.000Z',
    },
    expiresAt: '2026-09-23T00:00:00.000Z',
  }
}

/**
 * A stand-in client. `me` is unused by this view but keeps the stub honest
 * about the surface it replaces.
 */
function stubClient(
  overrides: {
    login?: (
      email: string,
      password: string,
      remember: boolean
    ) => Promise<ApiResult<AuthSession>>
    requestPasswordReset?: (email: string) => Promise<ApiResult<null>>
    confirmPasswordReset?: (
      token: string,
      password: string
    ) => Promise<ApiResult<null>>
    register?: (
      email: string,
      password: string,
      remember: boolean,
      inviteCode?: string
    ) => Promise<ApiResult<AuthSession>>
  } = {}
): AgentApiClient {
  return {
    oauthStartUrl: (id: string) => `http://api.test/v1/auth/oauth/${id}/start`,
    requestPasswordReset:
      overrides.requestPasswordReset ??
      (async () => ({ kind: 'ok' as const, data: null })),
    confirmPasswordReset:
      overrides.confirmPasswordReset ??
      (async () => ({ kind: 'ok' as const, data: null })),
    login: overrides.login ?? (async () => ({ kind: 'ok', data: session() })),
    register:
      overrides.register ?? (async () => ({ kind: 'ok', data: session() })),
  } as unknown as AgentApiClient
}

function fill(id: string, value: string) {
  fireEvent.change(screen.getByLabelText(id), { target: { value } })
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: /登录$|创建账户/ }))
}

describe('AuthView', () => {
  it('starts in login mode and can switch to register', () => {
    render(<AuthView client={stubClient()} onAuthenticated={vi.fn()} />)

    expect(
      screen.getByRole('heading', { name: '登录 Career Agent' })
    ).toBeTruthy()
    expect(screen.queryByLabelText('确认密码')).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: '注册' }))

    expect(screen.getByRole('heading', { name: '创建你的账户' })).toBeTruthy()
    expect(screen.getByLabelText('确认密码')).toBeTruthy()
  })

  it('exposes the mode switch as tabs', () => {
    render(<AuthView client={stubClient()} onAuthenticated={vi.fn()} />)

    const loginTab = screen.getByRole('tab', { name: '登录' })
    expect(loginTab.getAttribute('aria-selected')).toBe('true')
    expect(
      screen.getByRole('tab', { name: '注册' }).getAttribute('aria-selected')
    ).toBe('false')
  })

  it('reports a bad email next to the field without calling the server', async () => {
    const login = vi.fn(async () => ({ kind: 'ok' as const, data: session() }))
    render(
      <AuthView client={stubClient({ login })} onAuthenticated={vi.fn()} />
    )

    fill('邮箱', 'not-an-email')
    fill('密码', GOOD_PASSWORD)
    submit()

    expect(await screen.findByText(/邮箱格式不正确/)).toBeTruthy()
    expect(login).not.toHaveBeenCalled()
  })

  it('explains the 12-character floor before calling the server', async () => {
    const login = vi.fn(async () => ({ kind: 'ok' as const, data: session() }))
    render(
      <AuthView client={stubClient({ login })} onAuthenticated={vi.fn()} />
    )

    fill('邮箱', GOOD_EMAIL)
    fill('密码', 'short')
    submit()

    expect(await screen.findByText(/密码至少 12 位（当前 5 位）/)).toBeTruthy()
    expect(login).not.toHaveBeenCalled()
  })

  it('requires the confirmation to match on register', async () => {
    const register = vi.fn(async () => ({
      kind: 'ok' as const,
      data: session(),
    }))
    render(
      <AuthView
        client={stubClient({ register })}
        onAuthenticated={vi.fn()}
        initialMode="register"
      />
    )

    fill('邮箱', GOOD_EMAIL)
    fill('密码', GOOD_PASSWORD)
    fill('确认密码', 'something else entirely')
    fireEvent.click(screen.getByRole('button', { name: /创建账户/ }))

    expect(await screen.findByText('两次输入的密码不一致')).toBeTruthy()
    expect(register).not.toHaveBeenCalled()
  })

  it('hands the signed-in user back on success', async () => {
    const onAuthenticated = vi.fn()
    render(<AuthView client={stubClient()} onAuthenticated={onAuthenticated} />)

    fill('邮箱', GOOD_EMAIL)
    fill('密码', GOOD_PASSWORD)
    submit()

    await waitFor(() => {
      expect(onAuthenticated).toHaveBeenCalledWith(session().user)
    })
  })

  it('trims the email before sending it', async () => {
    const login = vi.fn(async () => ({ kind: 'ok' as const, data: session() }))
    render(
      <AuthView client={stubClient({ login })} onAuthenticated={vi.fn()} />
    )

    fill('邮箱', `  ${GOOD_EMAIL}  `)
    fill('密码', GOOD_PASSWORD)
    submit()

    await waitFor(() => {
      expect(login).toHaveBeenCalledWith(GOOD_EMAIL, GOOD_PASSWORD, false)
    })
  })

  it('translates wrong credentials instead of showing the server string', async () => {
    const login = async () => ({
      kind: 'error' as const,
      error: {
        code: 'invalid_credentials',
        message: 'Invalid email or password',
      },
    })
    render(
      <AuthView client={stubClient({ login })} onAuthenticated={vi.fn()} />
    )

    fill('邮箱', GOOD_EMAIL)
    fill('密码', GOOD_PASSWORD)
    submit()

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      expect.stringContaining('邮箱或密码不正确')
    )
  })

  it('tells an existing user to sign in rather than showing a raw conflict', async () => {
    const register = async () => ({
      kind: 'error' as const,
      error: { code: 'user_exists', message: 'Account exists' },
    })
    render(
      <AuthView
        client={stubClient({ register })}
        onAuthenticated={vi.fn()}
        initialMode="register"
      />
    )

    fill('邮箱', GOOD_EMAIL)
    fill('密码', GOOD_PASSWORD)
    fill('确认密码', GOOD_PASSWORD)
    fireEvent.click(screen.getByRole('button', { name: /创建账户/ }))

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      expect.stringContaining('直接登录')
    )
  })

  it('explains an origin mismatch behind a network failure', async () => {
    const login = async () => ({
      kind: 'error' as const,
      error: { code: 'network_error', message: 'Failed to fetch' },
    })
    render(
      <AuthView client={stubClient({ login })} onAuthenticated={vi.fn()} />
    )

    fill('邮箱', GOOD_EMAIL)
    fill('密码', GOOD_PASSWORD)
    submit()

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      expect.stringContaining('allowedOrigin')
    )
  })

  it('marks the password field invalid and describes it by the error', async () => {
    render(<AuthView client={stubClient()} onAuthenticated={vi.fn()} />)

    fill('邮箱', GOOD_EMAIL)
    fill('密码', 'short')
    submit()

    const password = screen.getByLabelText('密码')
    await waitFor(() => {
      expect(password.getAttribute('aria-invalid')).toBe('true')
    })
    const describedBy = password.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(
      document.getElementById(describedBy as string)?.textContent
    ).toContain('密码至少 12 位')
  })

  it('toggles password visibility', () => {
    render(<AuthView client={stubClient()} onAuthenticated={vi.fn()} />)

    const password = screen.getByLabelText('密码')
    expect(password.getAttribute('type')).toBe('password')

    fireEvent.click(screen.getByRole('button', { name: '显示密码' }))
    expect(password.getAttribute('type')).toBe('text')

    fireEvent.click(screen.getByRole('button', { name: '隐藏密码' }))
    expect(password.getAttribute('type')).toBe('password')
  })

  it('shows the strength hint only while registering', () => {
    render(<AuthView client={stubClient()} onAuthenticated={vi.fn()} />)

    fill('密码', GOOD_PASSWORD)
    expect(screen.queryByText(/密码强度/)).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: '注册' }))
    fill('密码', GOOD_PASSWORD)
    expect(screen.getByText(/密码强度/)).toBeTruthy()
  })

  it('clears a stale form error when switching modes', async () => {
    const login = async () => ({
      kind: 'error' as const,
      error: { code: 'invalid_credentials', message: 'nope' },
    })
    render(
      <AuthView client={stubClient({ login })} onAuthenticated={vi.fn()} />
    )

    fill('邮箱', GOOD_EMAIL)
    fill('密码', GOOD_PASSWORD)
    submit()
    await screen.findByRole('alert')

    fireEvent.click(screen.getByRole('tab', { name: '注册' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('defaults to a session-only login', async () => {
    const login = vi.fn(async (_e: string, _p: string, _r: boolean) => ({
      kind: 'ok' as const,
      data: session(),
    }))
    render(
      <AuthView client={stubClient({ login })} onAuthenticated={vi.fn()} />
    )

    const box = screen.getByRole('checkbox', { name: /记住我/ })
    expect((box as HTMLInputElement).checked).toBe(false)

    fill('邮箱', GOOD_EMAIL)
    fill('密码', GOOD_PASSWORD)
    submit()

    await waitFor(() => {
      expect(login).toHaveBeenCalledWith(GOOD_EMAIL, GOOD_PASSWORD, false)
    })
  })

  it('asks the server to remember when the box is ticked', async () => {
    const login = vi.fn(async (_e: string, _p: string, _r: boolean) => ({
      kind: 'ok' as const,
      data: session(),
    }))
    render(
      <AuthView client={stubClient({ login })} onAuthenticated={vi.fn()} />
    )

    fireEvent.click(screen.getByRole('checkbox', { name: /记住我/ }))
    fill('邮箱', GOOD_EMAIL)
    fill('密码', GOOD_PASSWORD)
    submit()

    await waitFor(() => {
      expect(login).toHaveBeenCalledWith(GOOD_EMAIL, GOOD_PASSWORD, true)
    })
  })

  it('does not offer social sign-in, which the API has no concept of', () => {
    render(<AuthView client={stubClient()} onAuthenticated={vi.fn()} />)

    expect(screen.queryByText(/Google|GitHub/)).toBeNull()
    // Password reset, by contrast, is implemented end to end.
    expect(screen.getByRole('button', { name: '忘记密码？' })).toBeTruthy()
  })
  it('clears a stale field error once the input becomes valid', async () => {
    render(<AuthView client={stubClient()} onAuthenticated={vi.fn()} />)

    fill('邮箱', GOOD_EMAIL)
    fill('密码', 'short')
    submit()
    expect(await screen.findByText(/密码至少 12 位/)).toBeTruthy()

    // Fixing the field must take the message away immediately. Leaving it up
    // would contradict the strength meter rendered right below it.
    fill('密码', GOOD_PASSWORD)
    await waitFor(() => {
      expect(screen.queryByText(/密码至少 12 位/)).toBeNull()
    })
    expect(
      screen.getByLabelText('密码').getAttribute('aria-invalid')
    ).toBeNull()
  })

  it('re-checks the confirmation when the password side changes', async () => {
    render(
      <AuthView
        client={stubClient()}
        onAuthenticated={vi.fn()}
        initialMode="register"
      />
    )

    fill('邮箱', GOOD_EMAIL)
    fill('密码', GOOD_PASSWORD)
    fill('确认密码', 'mismatched value here')
    fireEvent.click(screen.getByRole('button', { name: /创建账户/ }))
    expect(await screen.findByText('两次输入的密码不一致')).toBeTruthy()

    // Editing the password can make the pair agree, so the mismatch message
    // has to be recomputed rather than left standing.
    fill('密码', 'mismatched value here')
    await waitFor(() => {
      expect(screen.queryByText('两次输入的密码不一致')).toBeNull()
    })
  })
})

describe('readResetToken', () => {
  it('extracts a well-formed token from the hash', () => {
    const token = 'a'.repeat(43)
    expect(readResetToken(`#reset=${token}`)).toBe(token)
  })

  it('ignores anything that is not a 43-char token', () => {
    expect(readResetToken('#reset=short')).toBeNull()
    expect(readResetToken('#plaza')).toBeNull()
    expect(readResetToken('')).toBeNull()
  })
})

describe('AuthView password reset', () => {
  const TOKEN = 'b'.repeat(43)

  it('offers a way to reach the reset request from the login form', () => {
    render(<AuthView client={stubClient()} onAuthenticated={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '忘记密码？' }))

    expect(screen.getByRole('heading', { name: '重置密码' })).toBeTruthy()
    expect(screen.getByLabelText('注册邮箱')).toBeTruthy()
    // The login/register submit must not also be on screen.
    expect(screen.queryByRole('button', { name: /^登录$/ })).toBeNull()
  })

  it('sends the reset request and never says whether the account exists', async () => {
    const requestPasswordReset = vi.fn(async () => ({
      kind: 'ok' as const,
      data: null,
    }))
    render(
      <AuthView
        client={stubClient({ requestPasswordReset })}
        onAuthenticated={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '忘记密码？' }))
    fill('注册邮箱', 'user@example.com')
    fireEvent.click(screen.getByRole('button', { name: /发送重置链接/ }))

    await waitFor(() => {
      expect(requestPasswordReset).toHaveBeenCalledWith('user@example.com')
    })
    expect(await screen.findByText(/已注册/)).toBeTruthy()
    expect(screen.queryByText(/不存在的邮箱|未注册/)).toBeNull()
  })

  it('validates the address before asking the server', async () => {
    const requestPasswordReset = vi.fn(async () => ({
      kind: 'ok' as const,
      data: null,
    }))
    render(
      <AuthView
        client={stubClient({ requestPasswordReset })}
        onAuthenticated={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '忘记密码？' }))
    fill('注册邮箱', 'nope')
    fireEvent.click(screen.getByRole('button', { name: /发送重置链接/ }))

    expect(await screen.findByText(/邮箱格式不正确/)).toBeTruthy()
    expect(requestPasswordReset).not.toHaveBeenCalled()
  })

  it('opens the reset form directly when a token is present', () => {
    render(
      <AuthView
        client={stubClient()}
        resetToken={TOKEN}
        onAuthenticated={vi.fn()}
      />
    )

    expect(screen.getByRole('heading', { name: '设置新密码' })).toBeTruthy()
    expect(screen.getByLabelText('确认密码')).toBeTruthy()
  })

  it('confirms the new password and confirms success', async () => {
    const confirmPasswordReset = vi.fn(async () => ({
      kind: 'ok' as const,
      data: null,
    }))
    render(
      <AuthView
        client={stubClient({ confirmPasswordReset })}
        resetToken={TOKEN}
        onAuthenticated={vi.fn()}
      />
    )

    fill('密码', 'correct horse battery staple')
    fill('确认密码', 'correct horse battery staple')
    fireEvent.click(screen.getByRole('button', { name: /更新密码|设置|确认/ }))

    await waitFor(() => {
      expect(confirmPasswordReset).toHaveBeenCalledWith(
        TOKEN,
        'correct horse battery staple'
      )
    })
  })

  it('explains an expired or already-used token', async () => {
    const confirmPasswordReset = async () => ({
      kind: 'error' as const,
      error: {
        code: 'invalid_reset_token',
        message: 'The password reset link is invalid or has expired',
      },
    })
    render(
      <AuthView
        client={stubClient({ confirmPasswordReset })}
        resetToken={TOKEN}
        onAuthenticated={vi.fn()}
      />
    )

    fill('密码', 'correct horse battery staple')
    fill('确认密码', 'correct horse battery staple')
    fireEvent.click(screen.getByRole('button', { name: /更新密码|设置|确认/ }))

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      expect.stringContaining('无效或已过期')
    )
  })

  it('says so when the link carries no usable token', () => {
    render(
      <AuthView
        client={stubClient()}
        resetToken={null}
        initialMode="reset"
        onAuthenticated={vi.fn()}
      />
    )

    expect(screen.getByRole('alert')).toHaveProperty(
      'textContent',
      expect.stringContaining('不完整')
    )
  })
})

describe('AuthView social sign-in', () => {
  const PROVIDERS = [
    { id: 'google', label: 'Google' },
    { id: 'github', label: 'GitHub' },
  ]

  it('renders nothing when the server has no providers configured', () => {
    render(<AuthView client={stubClient()} onAuthenticated={vi.fn()} />)

    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.queryByText('或使用邮箱')).toBeNull()
  })

  it('links each configured provider to its start URL', () => {
    render(
      <AuthView
        client={stubClient()}
        oauthProviders={PROVIDERS}
        onAuthenticated={vi.fn()}
      />
    )

    expect(
      screen.getByRole('link', { name: '使用 Google 继续' })
    ).toHaveProperty('href', 'http://api.test/v1/auth/oauth/google/start')
    expect(
      screen.getByRole('link', { name: '使用 GitHub 继续' })
    ).toHaveProperty('href', 'http://api.test/v1/auth/oauth/github/start')
    expect(screen.getByText('或使用邮箱')).toBeTruthy()
  })

  it('offers the provider buttons on register too', () => {
    render(
      <AuthView
        client={stubClient()}
        oauthProviders={PROVIDERS}
        initialMode="register"
        onAuthenticated={vi.fn()}
      />
    )

    expect(screen.getByRole('link', { name: '使用 Google 继续' })).toBeTruthy()
  })

  it('hides them on the reset flows', () => {
    render(
      <AuthView
        client={stubClient()}
        oauthProviders={PROVIDERS}
        resetToken={'c'.repeat(43)}
        onAuthenticated={vi.fn()}
      />
    )

    expect(screen.queryByRole('link')).toBeNull()
  })
})

describe('AuthView invitation-gated registration', () => {
  it('hides the invite field when the server allows open registration', () => {
    render(
      <AuthView
        client={stubClient()}
        initialMode="register"
        onAuthenticated={vi.fn()}
      />
    )

    expect(screen.queryByLabelText('邀请码')).toBeNull()
  })

  it('asks for a code when the server requires one', () => {
    render(
      <AuthView
        client={stubClient()}
        registration="invite"
        initialMode="register"
        onAuthenticated={vi.fn()}
      />
    )

    expect(screen.getByLabelText('邀请码')).toBeTruthy()
  })

  it('refuses to submit a registration with no code', async () => {
    const register = vi.fn(async () => ({
      kind: 'ok' as const,
      data: session(),
    }))
    render(
      <AuthView
        client={stubClient({ register })}
        registration="invite"
        initialMode="register"
        onAuthenticated={vi.fn()}
      />
    )

    fill('邮箱', GOOD_EMAIL)
    fill('密码', GOOD_PASSWORD)
    fill('确认密码', GOOD_PASSWORD)
    fireEvent.click(screen.getByRole('button', { name: /创建账户/ }))

    expect(await screen.findByText('请输入邀请码')).toBeTruthy()
    expect(register).not.toHaveBeenCalled()
  })

  it('sends the code with the registration', async () => {
    const register = vi.fn(async () => ({
      kind: 'ok' as const,
      data: session(),
    }))
    render(
      <AuthView
        client={stubClient({ register })}
        registration="invite"
        initialMode="register"
        onAuthenticated={vi.fn()}
      />
    )

    fill('邮箱', GOOD_EMAIL)
    fill('密码', GOOD_PASSWORD)
    fill('确认密码', GOOD_PASSWORD)
    fill('邀请码', 'let-me-in')
    fireEvent.click(screen.getByRole('button', { name: /创建账户/ }))

    await waitFor(() => {
      expect(register).toHaveBeenCalledWith(
        GOOD_EMAIL,
        GOOD_PASSWORD,
        false,
        'let-me-in'
      )
    })
  })

  it('does not ask for a code when signing in', () => {
    render(
      <AuthView
        client={stubClient()}
        registration="invite"
        onAuthenticated={vi.fn()}
      />
    )

    expect(screen.queryByLabelText('邀请码')).toBeNull()
  })
})
