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
import { beforeEach, describe, expect, it, vi } from 'vitest'

const CAPABILITIES = {
  output: {
    formats: ['yaml', 'html', 'pdf'],
    styles: [
      {
        id: 'ats-compact',
        label: 'ATS',
        description: '',
        template: 'jake',
      },
    ],
  },
  runtime: { authentication: 'enabled' },
  profile: { materials: 50 },
}

const PROFILE = {
  resumeYaml: 'content:\n  basics:\n    name: 包安心\n',
  preferences: {},
  materials: [],
  createdAt: '2026-09-17T12:00:00.000Z',
  updatedAt: '2026-09-17T12:00:00.000Z',
  payload: '{}',
}

const getProfile = vi.fn(async () => ({
  kind: 'found' as const,
  profile: PROFILE,
}))

const NEW_YAML =
  'content:\n  basics:\n    name: 包安心\n  education:\n    - institution: 某大学\n'

const putProfile = vi.fn(async () => ({
  kind: 'ok' as const,
  data: {
    createdAt: '2026-09-17T12:00:00.000Z',
    updatedAt: '2026-09-17T13:00:00.000Z',
  },
}))

vi.mock('@/lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/client')>()
  class FakeAgentApiClient {
    me = vi.fn(async () => ({
      kind: 'ok' as const,
      data: {
        id: 'u1',
        email: 'shell@example.com',
        createdAt: '2026-09-17T12:00:00.000Z',
      },
    }))
    capabilities = vi.fn(async () => ({
      kind: 'ok' as const,
      data: CAPABILITIES,
    }))
    getProfile = getProfile
    putProfile = putProfile
    deleteProfile = vi.fn(async () => ({ kind: 'ok' as const, data: null }))
    chat = vi.fn()
    logout = vi.fn(async () => ({ kind: 'ok' as const, data: null }))
  }
  return { ...actual, AgentApiClient: FakeAgentApiClient }
})

const { AppShell } = await import('@/components/shell/app-shell')

describe('AppShell · profile wiring', () => {
  beforeEach(() => {
    getProfile.mockClear()
    putProfile.mockClear()
    localStorage.clear()
  })

  it('shows the saved profile as the run input right after login', async () => {
    // The launcher used to claim "档案里还没有基础简历" until the user visited
    // the profile page, because only ProfileView ever fetched the profile. A
    // run started directly after login therefore silently ran without the
    // resume the account already had.
    render(<AppShell />)

    await waitFor(() => {
      expect(screen.getByText(/本次会以个人主页的基础简历/)).toBeTruthy()
    })
    expect(getProfile).toHaveBeenCalled()
  })

  it('follows the profile page: a save updates what the launcher submits', async () => {
    // The profile page reports every load and save; the launcher must see
    // the newest one, including a GET that is still in flight when the
    // report arrives.
    render(<AppShell />)
    await waitFor(() => {
      expect(screen.getByText(/本次会以个人主页的基础简历/)).toBeTruthy()
    })

    fireEvent.click(screen.getByLabelText('个人主页'))
    await screen.findByRole('button', { name: '编辑' })
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    fireEvent.change(screen.getByPlaceholderText(/content:/), {
      target: { value: NEW_YAML },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => {
      expect(putProfile).toHaveBeenCalled()
    })

    fireEvent.click(screen.getByRole('button', { name: '新建定制' }))
    await waitFor(() => {
      expect(
        screen.getByText(
          new RegExp(
            `基础简历（${NEW_YAML.trim().length.toLocaleString('zh-CN')}`
          )
        )
      ).toBeTruthy()
    })
  })
})
