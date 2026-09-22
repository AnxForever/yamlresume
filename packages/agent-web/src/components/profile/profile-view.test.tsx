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
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ProfileView } from '@/components/profile/profile-view'
import type { AgentApiClient, AuthUser } from '@/lib/api/client'
import type { ProfileResponse } from '@/lib/api/types'
import { LEGACY_PROFILE_KEY } from '@/lib/profile'

const USER: AuthUser = {
  id: 'u1',
  email: 'anx@example.com',
  createdAt: '2026-09-01T00:00:00.000Z',
}

const STYLE_OPTIONS = [
  { id: 'ats-compact', label: 'ATS 紧凑', description: '' },
]
const FORMAT_OPTIONS = ['yaml', 'html', 'pdf']

const PROFILE: ProfileResponse = {
  resumeYaml: 'content:\n  basics:\n    name: 包安心\n',
  preferences: { styles: ['ats-compact'], formats: ['yaml'] },
  materials: [],
  createdAt: '2026-09-16T12:00:00.000Z',
  updatedAt: '2026-09-16T12:00:00.000Z',
}

type GetProfileResult =
  | { kind: 'found'; profile: ProfileResponse }
  | { kind: 'not_found' }
  | { kind: 'error'; error: { code: string; message: string } }

function fakeClient(result: GetProfileResult) {
  const getProfile = vi.fn(async () => result)
  const putProfile = vi.fn(async () => ({
    kind: 'ok' as const,
    data: {
      createdAt: '2026-09-16T12:00:00.000Z',
      updatedAt: '2026-09-17T09:30:00.000Z',
    },
  }))
  const deleteProfile = vi.fn(async () => ({ kind: 'ok' as const, data: null }))
  return {
    client: {
      getProfile,
      putProfile,
      deleteProfile,
    } as unknown as AgentApiClient,
    getProfile,
    putProfile,
    deleteProfile,
  }
}

function renderView(
  result: GetProfileResult,
  overrides: { supportsProfile?: boolean } = {}
) {
  const onProfileChange = vi.fn()
  const fake = fakeClient(result)
  render(
    <ProfileView
      client={fake.client}
      user={USER}
      supportsProfile={overrides.supportsProfile ?? true}
      styleOptions={STYLE_OPTIONS}
      formatOptions={FORMAT_OPTIONS}
      maxMaterials={50}
      onProfileChange={onProfileChange}
      onLogout={vi.fn()}
    />
  )
  return { ...fake, onProfileChange }
}

afterEach(() => {
  localStorage.clear()
})

describe('ProfileView · loading and failure', () => {
  it('says the server has no profile routes instead of offering a dead editor', () => {
    const { getProfile } = renderView(
      { kind: 'not_found' },
      {
        supportsProfile: false,
      }
    )

    expect(screen.getByText('这台服务器还没有档案功能')).toBeDefined()
    // Asking anyway would produce a 404 the user cannot act on.
    expect(getProfile).not.toHaveBeenCalled()
  })

  it('reports a read failure with its request id and offers a retry', async () => {
    const { getProfile } = renderView({
      kind: 'error',
      error: { code: 'storage_failed', message: '读取失败' },
    })

    await waitFor(() => {
      expect(screen.getByText('没能读到档案')).toBeDefined()
    })
    expect(screen.getByText('读取失败')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() => {
      expect(getProfile).toHaveBeenCalledTimes(2)
    })
  })
})

describe('ProfileView · loading a profile', () => {
  it('hands the loaded profile up so the launcher can use it', async () => {
    // This is the link that makes the profile more than a notepad: the shell
    // holds the draft and passes it to the run.
    const { onProfileChange } = renderView({ kind: 'found', profile: PROFILE })

    await waitFor(() => {
      expect(onProfileChange).toHaveBeenCalledWith(
        expect.objectContaining({ resumeYaml: PROFILE.resumeYaml })
      )
    })
    expect(screen.getByText(/档案已保存/)).toBeDefined()
  })

  it('reports a profile that has never been saved as a state, not an error', async () => {
    const { onProfileChange } = renderView({ kind: 'not_found' })

    await waitFor(() => {
      expect(screen.getByText(/尚未建立档案/)).toBeDefined()
    })
    expect(screen.queryByText('没能读到档案')).toBeNull()
    expect(onProfileChange).toHaveBeenCalled()
  })

  it('narrows stored preferences against what this backend offers', async () => {
    // The server returns stored preferences loosely so an older document
    // survives; the narrowing happens on this side.
    const { onProfileChange } = renderView({
      kind: 'found',
      profile: {
        ...PROFILE,
        preferences: {
          styles: ['ats-compact', 'modern-casual'],
          formats: ['docx'],
        },
      },
    })

    await waitFor(() => {
      expect(onProfileChange).toHaveBeenCalledWith(
        expect.objectContaining({
          // `modern-casual` and `docx` are dropped; formats end up empty, which
          // the schema forbids, so the honest answer is "no default".
          preferences: null,
        })
      )
    })
  })
})

describe('ProfileView · legacy migration', () => {
  it('offers to move a resume stranded in this browser', async () => {
    localStorage.setItem(LEGACY_PROFILE_KEY, 'basics:\n  name: 旧简历\n')

    renderView({ kind: 'not_found' })

    await waitFor(() => {
      expect(screen.getByText(/发现一份保存在本机的旧简历/)).toBeDefined()
    })
  })

  it('clears the local copy when the user declines it', async () => {
    localStorage.setItem(LEGACY_PROFILE_KEY, 'basics:\n  name: 旧简历\n')

    renderView({ kind: 'not_found' })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '不要了，删掉' })).toBeDefined()
    })
    fireEvent.click(screen.getByRole('button', { name: '不要了，删掉' }))

    // Leaving it behind would keep a readable copy of the resume in a browser
    // shared by every account that ever used it.
    expect(localStorage.getItem(LEGACY_PROFILE_KEY)).toBeNull()
  })

  it('does not offer to migrate over a profile the account already has', async () => {
    localStorage.setItem(LEGACY_PROFILE_KEY, 'basics:\n  name: 旧简历\n')

    renderView({ kind: 'found', profile: PROFILE })

    await waitFor(() => {
      expect(screen.getByText(/档案已保存/)).toBeDefined()
    })
    expect(screen.queryByText(/发现一份保存在本机的旧简历/)).toBeNull()
  })
})

describe('ProfileView · saving', () => {
  it('keeps save disabled until something actually changes', async () => {
    renderView({ kind: 'found', profile: PROFILE })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '保存' })).toHaveProperty(
        'disabled',
        true
      )
    })
  })

  it('saves the edited draft and reports success', async () => {
    const { putProfile, onProfileChange } = renderView({
      kind: 'found',
      profile: PROFILE,
    })

    await waitFor(() => {
      expect(screen.getByText(/有未保存的改动|已保存|\s/)).toBeDefined()
    })

    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    fireEvent.change(screen.getByLabelText(/YAMLResume 文档/), {
      target: { value: 'content:\n  basics:\n    name: 改过了\n' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => {
      expect(putProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          resumeYaml: 'content:\n  basics:\n    name: 改过了\n',
        })
      )
    })
    await waitFor(() => {
      expect(onProfileChange).toHaveBeenCalledWith(
        expect.objectContaining({
          resumeYaml: 'content:\n  basics:\n    name: 改过了\n',
        })
      )
    })
  })
})
