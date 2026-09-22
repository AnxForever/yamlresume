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

import { ProfileAccount } from '@/components/profile/profile-account'
import type { AuthUser } from '@/lib/api/client'

const USER: AuthUser = {
  id: 'u1',
  email: 'anx@example.com',
  createdAt: '2026-09-01T00:00:00.000Z',
}

function renderAccount(
  overrides: {
    user?: AuthUser | null
    createdAt?: string | undefined
    onLogout?: (() => void) | undefined
  } = {}
) {
  const onDelete = vi.fn()
  const onLogout = 'onLogout' in overrides ? overrides.onLogout : vi.fn()
  render(
    <ProfileAccount
      user={overrides.user === undefined ? USER : overrides.user}
      createdAt={
        'createdAt' in overrides
          ? overrides.createdAt
          : '2026-09-16T12:00:00.000Z'
      }
      onLogout={onLogout}
      deleting={false}
      onDelete={onDelete}
    />
  )
  return { onDelete, onLogout }
}

describe('ProfileAccount', () => {
  it('shows which account this profile belongs to', () => {
    renderAccount()

    expect(screen.getByText('anx@example.com')).toBeDefined()
    expect(screen.getByText('2026/09/16')).toBeDefined()
  })

  it('shows a dash rather than an invented date', () => {
    renderAccount({ createdAt: undefined })

    // "Never saved" must not be rendered as today.
    expect(screen.getByText('—')).toBeDefined()
  })

  it('offers sign-out when there is a session', () => {
    const onLogout = vi.fn()
    renderAccount({ onLogout })

    fireEvent.click(screen.getByRole('button', { name: '退出登录' }))

    expect(onLogout).toHaveBeenCalled()
  })

  it('hides sign-out on a server with accounts switched off', () => {
    // `/v1/auth/logout` 503s there, so the control must not exist.
    renderAccount({ onLogout: undefined })

    expect(screen.queryByRole('button', { name: '退出登录' })).toBeNull()
  })

  it('separates signing out from deleting, and says so', () => {
    // The two used to be one click apart, and signing out is not a data
    // decision — deleting is.
    renderAccount()

    expect(screen.getByText(/退出登录不会删除它/)).toBeDefined()
  })

  it('confirms before deleting, and says what deletion is not', async () => {
    const { onDelete } = renderAccount()

    fireEvent.click(screen.getByRole('button', { name: '删除档案' }))

    await waitFor(() => {
      expect(screen.getByText('删除档案？')).toBeDefined()
    })
    expect(screen.getByText(/不是注销账号/)).toBeDefined()

    // Nothing may happen until the confirmation is answered.
    expect(onDelete).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    expect(onDelete).toHaveBeenCalled()
  })

  it('can be backed out of without deleting', async () => {
    const { onDelete } = renderAccount()

    fireEvent.click(screen.getByRole('button', { name: '删除档案' }))
    await waitFor(() => {
      expect(screen.getByText('删除档案？')).toBeDefined()
    })
    fireEvent.click(screen.getByRole('button', { name: '取消' }))

    expect(onDelete).not.toHaveBeenCalled()
  })
})
