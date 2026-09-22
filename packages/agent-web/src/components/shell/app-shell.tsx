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

import { useCallback, useEffect, useRef, useState } from 'react'
import { AuthView, readResetToken } from '@/components/auth/auth-view'
import {
  type LauncherSubmitPayload,
  LauncherView,
} from '@/components/launcher/launcher'
import { RunHistoryView } from '@/components/launcher/run-history-view'
import { type ShellView, Sidebar } from '@/components/launcher/sidebar'
import { CapabilityPlaza } from '@/components/plaza/capability-plaza'
import { ProfileView } from '@/components/profile/profile-view'
import { SettingsDialog } from '@/components/settings/settings-dialog'
import { WorkbenchView } from '@/components/workbench/workbench'
import {
  AgentApiClient,
  type AgentCapabilities,
  type ApiFailure,
  type AuthUser,
} from '@/lib/api/client'
import {
  EMPTY_PROFILE,
  normalizeProfile,
  type ProfileDraft,
  type SupportedOptions,
} from '@/lib/profile'
import { loadRunIndex, upsertRunIndexEntry } from '@/lib/runs-index'
import {
  type AppSettings,
  defaultSettings,
  loadSettings,
  saveSettings,
} from '@/lib/settings'

const SHELL_VIEWS: ShellView[] = ['new', 'plaza', 'runs', 'profile']

function viewFromHash(hash: string): ShellView | null {
  const value = hash.replace(/^#/, '')
  return (SHELL_VIEWS as string[]).includes(value) ? (value as ShellView) : null
}

/**
 * A `#reset=<token>` link is handled before anything else: it must reach the
 * reset form even while the app is still resolving the session, and even for a
 * signed-in user who is resetting a password on a shared machine.
 */
function resetTokenFromHash(hash: string): string | null {
  return readResetToken(hash)
}

function runIdFromHash(hash: string): string | null {
  const match = hash.match(/^#run\/([^/]+)$/)
  return match?.[1] ? decodeURIComponent(match[1]) : null
}

type CapabilitiesState =
  | { kind: 'loading' }
  | { kind: 'ready'; data: AgentCapabilities }
  | { kind: 'error'; message: string }

/**
 * Discriminated on `kind`, not `ok`: this package inherits `strict: false`
 * from the repository tsconfig, which turns off `strictNullChecks` and with it
 * boolean-literal narrowing.
 */
export type SubmitRunResult =
  | { kind: 'ok'; runId: string }
  | { kind: 'error'; error: ApiFailure }

export function AppShell() {
  const [view, setView] = useState<ShellView>('new')
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [settings, setSettings] = useState<AppSettings>(defaultSettings)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [capabilities, setCapabilities] = useState<CapabilitiesState>({
    kind: 'loading',
  })
  const [recentRuns, setRecentRuns] = useState<
    Array<{ id: string; title: string; subtitle: string }>
  >([])
  const [authUser, setAuthUser] = useState<AuthUser | null>(null)
  /**
   * `pending` until `/v1/auth/me` answers, then either the resolved identity
   * or `disabled` when this server has no auth configured. Treating a disabled
   * server as "not signed in" would strand every user on a login form whose
   * every request 503s, with no way past it.
   */
  const [authState, setAuthState] = useState<
    'pending' | 'anonymous' | 'authenticated' | 'disabled'
  >('pending')
  const [resetToken, setResetToken] = useState<string | null>(null)
  const [profileDraft, setProfileDraft] = useState<ProfileDraft>(EMPTY_PROFILE)
  const clientRef = useRef<AgentApiClient | null>(null)
  /**
   * Every profile report — a load on the profile page, or a save — bumps this
   * counter. A `GET` that was already in flight when a report arrived must
   * not overwrite it: the draft the user is looking at, possibly one they
   * just saved, is newer than any fetch started before it.
   */
  const profileReportGeneration = useRef(0)
  const reportProfile = useCallback((draft: ProfileDraft) => {
    profileReportGeneration.current += 1
    setProfileDraft(draft)
  }, [])

  // Settings live in localStorage, which is only available after mount.
  useEffect(() => {
    setSettings(loadSettings())
  }, [])

  // Restore the local run index. Without this the sidebar always claimed "还
  // 没有运行记录" on every reload even though the index was being written —
  // the UI promised local persistence it never read back.
  useEffect(() => {
    setRecentRuns(
      loadRunIndex().map((entry) => ({
        id: entry.id,
        title: entry.title,
        subtitle: `${new Date(entry.createdAt).toLocaleString('zh-CN')} · ${entry.lastStatus}`,
      }))
    )
  }, [])

  // Deep-link the active view via the URL hash so a refresh keeps the view and
  // #plaza / #runs / #run/<id> are shareable.
  useEffect(() => {
    const applyHash = () => {
      setResetToken(resetTokenFromHash(window.location.hash))
      const runId = runIdFromHash(window.location.hash)
      if (runId) {
        setActiveRunId(runId)
        return
      }
      const next = viewFromHash(window.location.hash)
      if (next) {
        setView(next)
      }
    }
    applyHash()
    window.addEventListener('hashchange', applyHash)
    return () => window.removeEventListener('hashchange', applyHash)
  }, [])

  const selectView = useCallback((next: ShellView) => {
    setView(next)
    setActiveRunId(null)
    if (typeof window !== 'undefined') {
      window.location.hash = next === 'new' ? '' : next
    }
  }, [])

  const openRun = useCallback((runId: string) => {
    setActiveRunId(runId)
    if (typeof window !== 'undefined') {
      window.location.hash = `run/${encodeURIComponent(runId)}`
    }
  }, [])

  useEffect(() => {
    clientRef.current = new AgentApiClient({ baseUrl: settings.baseUrl })
    // Re-resolve the identity whenever the backend address changes; the cached
    // session belongs to the previous server.
    setAuthState('pending')
    void clientRef.current.me().then((result) => {
      if (result.kind === 'ok') {
        setAuthUser(result.data)
        setAuthState('authenticated')
        return
      }
      // A server with auth switched off answers 503 on every /v1/auth route.
      // That is "no accounts here", not "you are signed out" — showing the
      // login screen would be a dead end no credentials could pass.
      if (result.error.code === 'authentication_disabled') {
        setAuthUser(null)
        setAuthState('disabled')
        return
      }
      setAuthUser(null)
      setAuthState('anonymous')
    })
  }, [settings.baseUrl])

  // Capabilities drive every launcher option: styles, formats and file limits
  // come from the backend, never from hard-coded lists (integration rule #1).
  // `settings.baseUrl` is an intentional dependency: the effect must re-fetch
  // capabilities when the backend address changes, even though it reads the
  // client from a ref rather than from `settings` directly.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refetch on baseUrl change
  useEffect(() => {
    const client = clientRef.current
    if (!client) {
      return undefined
    }
    let cancelled = false
    const fetchCapabilities = async () => {
      setCapabilities({ kind: 'loading' })
      const result = await client.capabilities()
      if (cancelled) {
        return
      }
      if (result.kind === 'ok') {
        setCapabilities({ kind: 'ready', data: result.data })
      } else {
        setCapabilities({ kind: 'error', message: result.error.message })
      }
    }
    void fetchCapabilities()
    return () => {
      cancelled = true
    }
  }, [settings.baseUrl])

  /**
   * Manual retry after a capabilities failure. Uses a generation counter so
   * an effect-driven fetch and a button-driven retry can both run without
   * clobbering each other.
   */
  const capabilitiesRetry = useRef(0)
  const retryCapabilities = useCallback(() => {
    const client = clientRef.current
    if (!client) {
      return
    }
    const generation = capabilitiesRetry.current + 1
    capabilitiesRetry.current = generation
    setCapabilities({ kind: 'loading' })
    void client.capabilities().then((result) => {
      if (capabilitiesRetry.current !== generation) {
        return
      }
      if (result.kind === 'ok') {
        setCapabilities({ kind: 'ready', data: result.data })
      } else {
        setCapabilities({ kind: 'error', message: result.error.message })
      }
    })
  }, [])

  const capabilitiesReady =
    capabilities.kind === 'ready' && clientRef.current !== null

  /**
   * The profile block of the capability payload. Its absence means this
   * deployment predates `/v1/profile`, which the page has to say out loud
   * rather than offer an editor whose saves would go nowhere.
   */
  const profileCapability =
    capabilities.kind === 'ready' ? (capabilities.data.profile ?? null) : null

  /**
   * Fetch the saved profile as soon as the session resolves.
   *
   * The launcher used to claim "档案里还没有基础简历" until the user first
   * opened the profile page, because only `ProfileView` ever fetched the
   * profile: a run started directly after login went out with an empty
   * candidate input even though the account already had a resume. The
   * feature's core promise is that the profile is the default input of
   * every run, so the shell — which owns the run submission — has to know
   * about it from the moment there is a session.
   *
   * A GET in flight when the profile page reports its own load or save is
   * dropped rather than applied: the newer draft wins.
   */
  useEffect(() => {
    if (authState !== 'authenticated' || profileCapability === null) {
      return undefined
    }
    const client = clientRef.current
    if (!client) {
      return undefined
    }
    let cancelled = false
    const generation = profileReportGeneration.current
    const supported: SupportedOptions = {
      formats:
        capabilities.kind === 'ready'
          ? (capabilities.data.output?.formats ?? [])
          : [],
      styles:
        capabilities.kind === 'ready'
          ? (capabilities.data.output?.styles ?? []).map((style) => style.id)
          : [],
    }
    void client.getProfile().then((result) => {
      if (cancelled || result.kind !== 'found') {
        return
      }
      if (profileReportGeneration.current !== generation) {
        return
      }
      setProfileDraft(normalizeProfile(result.profile, supported))
    })
    return () => {
      cancelled = true
    }
  }, [authState, profileCapability, capabilities])

  /**
   * Signing out must not touch the profile: it belongs to the account and
   * survives the session, which is why deleting it is its own explicit action.
   */
  const logout = useCallback(async () => {
    await clientRef.current?.logout()
    setAuthUser(null)
    setAuthState('anonymous')
    // The profile belongs to the account, not the session: after signing
    // out, the next account must not inherit the previous one's draft —
    // it would be submitted as that run's candidate input.
    setProfileDraft(EMPTY_PROFILE)
  }, [])

  const submitRun = useCallback(
    async (payload: LauncherSubmitPayload): Promise<SubmitRunResult> => {
      const client = clientRef.current
      if (!client) {
        return {
          kind: 'error',
          error: {
            code: 'network_error',
            message: '客户端未初始化',
            requestId: 'local',
          },
        }
      }
      const result = await client.createRunMultipart({
        jobDescription: payload.jobDescription,
        candidateYaml: payload.candidateYaml,
        preferences: payload.preferences,
        jobFiles: payload.jobFiles,
        candidateFiles: payload.candidateFiles,
      })
      if (result.kind !== 'ok') {
        return { kind: 'error', error: result.error }
      }
      const run = result.data
      const index = upsertRunIndexEntry({
        id: run.id,
        title: payload.title,
        createdAt: run.createdAt,
        lastStatus: run.status,
      })
      // Re-read the whole index so an earlier run is not pushed off the list.
      setRecentRuns(
        index.map((entry) => ({
          id: entry.id,
          title: entry.title,
          subtitle: `${new Date(entry.createdAt).toLocaleString('zh-CN')} · ${entry.lastStatus}`,
        }))
      )
      return { kind: 'ok', runId: run.id }
    },
    []
  )

  function handleSaveSettings(next: AppSettings) {
    setSettings(next)
    saveSettings(next)
  }

  const launcherKey = activeRunId ?? view

  if (resetToken && clientRef.current) {
    return (
      <AuthView
        client={clientRef.current}
        resetToken={resetToken}
        oauthProviders={
          capabilities.kind === 'ready'
            ? (capabilities.data.runtime?.oauthProviders ?? [])
            : []
        }
        registration={
          capabilities.kind === 'ready'
            ? (capabilities.data.runtime?.registration ?? 'open')
            : 'open'
        }
        onAuthenticated={(user) => {
          setAuthUser(user)
          setAuthState('authenticated')
        }}
      />
    )
  }
  if (authState === 'pending' || !clientRef.current) {
    return (
      <div className="bg-background-muted text-foreground-muted flex min-h-screen items-center justify-center text-sm">
        正在连接账户…
      </div>
    )
  }
  if (authState === 'anonymous') {
    return (
      <AuthView
        client={clientRef.current}
        oauthProviders={
          capabilities.kind === 'ready'
            ? (capabilities.data.runtime?.oauthProviders ?? [])
            : []
        }
        registration={
          capabilities.kind === 'ready'
            ? (capabilities.data.runtime?.registration ?? 'open')
            : 'open'
        }
        onAuthenticated={(user) => {
          setAuthUser(user)
          setAuthState('authenticated')
        }}
      />
    )
  }

  return (
    <div className="flex h-screen gap-3 p-3">
      <Sidebar
        activeItem={activeRunId ? 'new' : view}
        recentRuns={recentRuns}
        onSelectItem={selectView}
        onSelectRun={openRun}
        onOpenSettings={() => setSettingsOpen(true)}
        userEmail={authUser?.email}
        // Absent unless there is a session: `/v1/auth/logout` 503s on a server
        // with auth disabled, so the control must not exist there.
        onLogout={
          authState === 'authenticated' ? () => void logout() : undefined
        }
      />

      <main className="bg-background-subtle shadow-xl flex min-w-0 flex-1 flex-col overflow-y-auto rounded-xl">
        {activeRunId ? (
          clientRef.current ? (
            <WorkbenchView
              runId={activeRunId}
              client={clientRef.current}
              onBack={() => selectView('runs')}
              onStartNew={() => selectView('new')}
            />
          ) : null
        ) : view === 'profile' ? (
          <ProfileView
            client={clientRef.current}
            user={authUser}
            // The capability payload is the only thing that says whether this
            // deployment serves the profile routes at all; without it the page
            // would offer an editor whose saves silently go nowhere.
            supportsProfile={capabilitiesReady && profileCapability !== null}
            styleOptions={
              capabilities.kind === 'ready'
                ? (capabilities.data.output?.styles ?? [])
                : []
            }
            formatOptions={
              capabilities.kind === 'ready'
                ? (capabilities.data.output?.formats ?? [])
                : []
            }
            maxMaterials={profileCapability?.materials ?? 0}
            onProfileChange={reportProfile}
            onLogout={logout}
          />
        ) : view === 'new' ? (
          <LauncherView
            key={launcherKey}
            capabilities={capabilities}
            onSubmitRun={submitRun}
            onSubmitted={(runId) => openRun(runId)}
            onRetryCapabilities={retryCapabilities}
            onOpenSettings={() => setSettingsOpen(true)}
            client={clientRef.current}
            profileResume={profileDraft.resumeYaml}
            profilePreferences={profileDraft.preferences}
            onOpenProfile={() => selectView('profile')}
          />
        ) : view === 'plaza' ? (
          <CapabilityPlaza onOpenCapability={() => selectView('new')} />
        ) : (
          <RunHistoryView runs={recentRuns} onOpenRun={openRun} />
        )}
      </main>

      <SettingsDialog
        open={settingsOpen}
        settings={settings}
        onClose={() => setSettingsOpen(false)}
        onSave={handleSaveSettings}
      />
    </div>
  )
}
