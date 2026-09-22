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

import { Alert, AlertDescription, AlertTitle } from '@appica/ui-react/alert'
import { Avatar, AvatarFallback } from '@appica/ui-react/avatar'
import { Button } from '@appica/ui-react/button'
import { Toc, TocItem, TocLink, TocList } from '@appica/ui-react/toc'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ProfileAccount } from '@/components/profile/profile-account'
import { ProfileMaterials } from '@/components/profile/profile-materials'
import { ProfilePreferences } from '@/components/profile/profile-preferences'
import { ProfileResume } from '@/components/profile/profile-resume'
import type { AgentApiClient, AuthUser } from '@/lib/api/client'
import type { ProfileSummary } from '@/lib/api/types'
import {
  clearLegacyResume,
  EMPTY_PROFILE,
  normalizeProfile,
  type ProfileDraft,
  readLegacyResume,
} from '@/lib/profile'

const SECTIONS = [
  { id: 'profile-resume', label: '档案' },
  { id: 'profile-preferences', label: '偏好' },
  { id: 'profile-materials', label: '材料' },
  { id: 'profile-account', label: '账户' },
] as const

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'error'; message: string; requestId?: string }

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export interface ProfileViewProps {
  client: AgentApiClient
  user: AuthUser | null
  /**
   * Whether this deployment serves the profile routes. An older API answers
   * 404 to all three verbs, and the page must say so instead of offering an
   * editor whose saves silently go nowhere.
   */
  supportsProfile: boolean
  /** Styles and formats from `GET /v1/capabilities`; never a hard-coded list. */
  styleOptions: Array<{ id: string; label: string; description: string }>
  formatOptions: string[]
  maxMaterials: number
  /** Lifted so the launcher can use the saved profile as a run's default. */
  onProfileChange: (draft: ProfileDraft) => void
  onLogout?: (() => void) | undefined
}

function initialsOf(user: AuthUser | null): string {
  const email = user?.email ?? ''
  const name = email.split('@')[0] ?? ''
  return name.slice(0, 1).toLocaleUpperCase('en-US') || '?'
}

export function ProfileView({
  client,
  user,
  supportsProfile,
  styleOptions,
  formatOptions,
  maxMaterials,
  onProfileChange,
  onLogout,
}: ProfileViewProps) {
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' })
  const [draft, setDraft] = useState<ProfileDraft>(EMPTY_PROFILE)
  const [saved, setSaved] = useState<ProfileDraft>(EMPTY_PROFILE)
  const [summary, setSummary] = useState<ProfileSummary | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [legacy, setLegacy] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const supported = {
    formats: formatOptions,
    styles: styleOptions.map((style) => style.id),
  }
  /**
   * `supported` is a fresh object every render, so the loader reads it through
   * a ref instead of taking it as a dependency. Listing the arrays directly
   * would re-fetch the profile every time the parent passed a new array —
   * and the narrowing only matters for the one normalization at load time.
   */
  const supportedRef = useRef(supported)
  useEffect(() => {
    supportedRef.current = supported
  })

  const loadProfile = useCallback(async () => {
    setLoad({ kind: 'loading' })
    const result = await client.getProfile()
    if (result.kind === 'error') {
      setLoad({
        kind: 'error',
        message: result.error.message,
        ...(result.error.requestId
          ? { requestId: result.error.requestId }
          : {}),
      })
      return
    }
    if (result.kind === 'not_found') {
      setDraft(EMPTY_PROFILE)
      setSaved(EMPTY_PROFILE)
      setSummary(null)
      setLoad({ kind: 'ready' })
      onProfileChange(EMPTY_PROFILE)
      // Only offer to migrate when there is something to migrate, and only
      // while this account has nothing of its own to overwrite.
      setLegacy(readLegacyResume())
      return
    }
    const next = normalizeProfile(result.profile, supportedRef.current)
    setDraft(next)
    setSaved(next)
    setSummary({
      createdAt: result.profile.createdAt,
      updatedAt: result.profile.updatedAt,
    })
    setLegacy(null)
    setLoad({ kind: 'ready' })
    onProfileChange(next)
  }, [client, onProfileChange])

  useEffect(() => {
    if (!supportsProfile) {
      setLoad({ kind: 'ready' })
      return
    }
    void loadProfile()
  }, [loadProfile, supportsProfile])

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(saved),
    [draft, saved]
  )

  async function handleSave() {
    setSaveState('saving')
    setSaveError(null)
    const result = await client.putProfile({
      resumeYaml: draft.resumeYaml,
      preferences: draft.preferences,
      materials: draft.materials,
    })
    if (result.kind === 'error') {
      setSaveState('error')
      setSaveError(
        result.error.requestId
          ? `${result.error.message}（requestId: ${result.error.requestId}）`
          : result.error.message
      )
      return
    }
    setSummary(result.data)
    setSaved(draft)
    setSaveState('saved')
    setLegacy(null)
    onProfileChange(draft)
  }

  async function handleDelete() {
    setDeleting(true)
    const result = await client.deleteProfile()
    setDeleting(false)
    if (result.kind === 'error') {
      setSaveState('error')
      setSaveError(result.error.message)
      return
    }
    setDraft(EMPTY_PROFILE)
    setSaved(EMPTY_PROFILE)
    setSummary(null)
    setSaveState('idle')
    onProfileChange(EMPTY_PROFILE)
  }

  function handleMigrate() {
    if (!legacy) {
      return
    }
    setDraft({ ...draft, resumeYaml: legacy })
    setLegacy(null)
  }

  if (!supportsProfile) {
    return (
      <main className="mx-auto w-full max-w-[860px] px-8 pt-[8vh] pb-16">
        <h1 className="text-foreground-strong text-[24px] font-semibold tracking-tight">
          个人主页
        </h1>
        <Alert className="mt-4">
          <AlertTitle>这台服务器还没有档案功能</AlertTitle>
          <AlertDescription>
            它响应不了
            `/v1/profile`，所以这里暂时没有可以保存的东西。升级后端之后这个页面就会可用。
          </AlertDescription>
        </Alert>
      </main>
    )
  }

  return (
    <main className="mx-auto w-full max-w-[860px] px-8 pt-[8vh] pb-16">
      <header className="flex items-center gap-4">
        <Avatar size="lg" shape="circle">
          <AvatarFallback>{initialsOf(user)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <h1 className="text-foreground-strong text-[24px] font-semibold tracking-tight">
            个人主页
          </h1>
          <p className="text-foreground-muted mt-0.5 truncate text-sm">
            {user?.email ?? '未登录'}
            {summary ? ' · 档案已保存' : ' · 尚未建立档案'}
          </p>
        </div>
        {load.kind === 'ready' ? (
          <div className="flex shrink-0 items-center gap-2">
            <span aria-live="polite" className="text-foreground-muted text-xs">
              {saveState === 'saving'
                ? '正在保存…'
                : saveState === 'saved' && !dirty
                  ? '已保存'
                  : dirty
                    ? '有未保存的改动'
                    : ''}
            </span>
            <Button
              variant="primary"
              size="sm"
              disabled={!dirty || saveState === 'saving'}
              onClick={() => void handleSave()}
            >
              保存
            </Button>
          </div>
        ) : null}
      </header>

      {load.kind === 'ready' ? (
        <Toc
          className="border-border mt-5 flex gap-5 border-b pb-0"
          rootMargin="-80px 0px -60% 0px"
        >
          <TocList className="flex gap-5">
            {SECTIONS.map((section) => (
              <TocItem key={section.id}>
                <TocLink
                  href={`#${section.id}`}
                  className="text-foreground-muted data-[active]:text-foreground-strong inline-block border-b-2 border-transparent pb-2 text-sm data-[active]:border-current"
                >
                  {section.label}
                </TocLink>
              </TocItem>
            ))}
          </TocList>
        </Toc>
      ) : null}

      {load.kind === 'loading' ? (
        <p className="text-foreground-muted mt-8 text-sm">正在读取档案…</p>
      ) : null}

      {load.kind === 'error' ? (
        <Alert variant="error" className="mt-6">
          <AlertTitle>没能读到档案</AlertTitle>
          <AlertDescription>
            {load.message}
            {load.requestId ? `（requestId: ${load.requestId}）` : ''}
          </AlertDescription>
          <div className="mt-3">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void loadProfile()}
            >
              重试
            </Button>
          </div>
        </Alert>
      ) : null}

      {load.kind === 'ready' ? (
        <>
          {legacy ? (
            <Alert className="mt-6">
              <AlertTitle>发现一份保存在本机的旧简历</AlertTitle>
              <AlertDescription>
                它来自还没有账户档案的版本，只存在这台浏览器里、退出登录也不会清除。
                搬进账户后会写入服务器并删掉本机那份。
              </AlertDescription>
              <div className="mt-3 flex gap-2">
                <Button variant="primary" size="sm" onClick={handleMigrate}>
                  搬进档案
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    clearLegacyResume()
                    setLegacy(null)
                  }}
                >
                  不要了，删掉
                </Button>
              </div>
            </Alert>
          ) : null}

          {saveState === 'error' && saveError ? (
            <Alert variant="error" className="mt-6">
              <AlertTitle>保存失败</AlertTitle>
              <AlertDescription>{saveError}</AlertDescription>
            </Alert>
          ) : null}

          <div className="mt-8 flex flex-col gap-10">
            <ProfileResume
              resumeYaml={draft.resumeYaml}
              onChange={(resumeYaml) => setDraft({ ...draft, resumeYaml })}
            />
            <ProfilePreferences
              preferences={draft.preferences}
              styleOptions={styleOptions}
              formatOptions={formatOptions}
              onChange={(preferences) => setDraft({ ...draft, preferences })}
            />
            <ProfileMaterials
              materials={draft.materials}
              maxMaterials={maxMaterials}
              onChange={(materials) => setDraft({ ...draft, materials })}
            />
            <ProfileAccount
              user={user}
              createdAt={summary?.createdAt}
              onLogout={onLogout}
              deleting={deleting}
              onDelete={() => void handleDelete()}
            />
          </div>
        </>
      ) : null}
    </main>
  )
}
