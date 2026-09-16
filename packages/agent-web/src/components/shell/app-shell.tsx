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
import { AuthView } from '@/components/auth/auth-view'
import {
  type LauncherSubmitPayload,
  LauncherView,
} from '@/components/launcher/launcher'
import { RunHistoryView } from '@/components/launcher/run-history-view'
import {
  type BackendHealth,
  type ShellView,
  Sidebar,
} from '@/components/launcher/sidebar'
import { CapabilityPlaza } from '@/components/plaza/capability-plaza'
import { ProfileView } from '@/components/profile/profile-view'
import { SettingsDialog } from '@/components/settings/settings-dialog'
import { WorkbenchView } from '@/components/workbench/workbench'
import {
  AgentApiClient,
  type AgentCapabilities,
  type ApiFailure,
} from '@/lib/api/client'
import { loadRunIndex, upsertRunIndexEntry } from '@/lib/runs-index'
import {
  type AppSettings,
  defaultSettings,
  loadSettings,
  saveSettings,
} from '@/lib/settings'

const HEALTH_POLL_MS = 30_000

const SHELL_VIEWS: ShellView[] = ['new', 'plaza', 'runs', 'profile']

function viewFromHash(hash: string): ShellView | null {
  const value = hash.replace(/^#/, '')
  return (SHELL_VIEWS as string[]).includes(value) ? (value as ShellView) : null
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
  const [health, setHealth] = useState<BackendHealth>('checking')
  const [capabilities, setCapabilities] = useState<CapabilitiesState>({
    kind: 'loading',
  })
  const [recentRuns, setRecentRuns] = useState<
    Array<{ id: string; title: string; subtitle: string }>
  >([])
  const [authSession, setAuthSession] = useState<
    import('@/lib/api/client').AuthSession | null
  >(null)
  const [authChecked, setAuthChecked] = useState(false)
  const [profileResume, setProfileResume] = useState('')
  const clientRef = useRef<AgentApiClient | null>(null)

  // Settings live in localStorage, which is only available after mount.
  useEffect(() => {
    setSettings(loadSettings())
    setProfileResume(
      localStorage.getItem('career-agent:profile-resume:v1') ?? ''
    )
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

  const saveProfileResume = useCallback((value: string) => {
    setProfileResume(value)
    localStorage.setItem('career-agent:profile-resume:v1', value)
  }, [])

  const openRun = useCallback((runId: string) => {
    setActiveRunId(runId)
    if (typeof window !== 'undefined') {
      window.location.hash = `run/${encodeURIComponent(runId)}`
    }
  }, [])

  useEffect(() => {
    clientRef.current = new AgentApiClient({ baseUrl: settings.baseUrl })
    setAuthChecked(false)
    void clientRef.current.me().then((result) => {
      if (result.kind === 'ok') setAuthSession(result.data)
      setAuthChecked(true)
    })
  }, [settings.baseUrl])

  const checkHealth = useCallback(async () => {
    const client = clientRef.current
    if (!client) {
      return
    }
    setHealth('checking')
    const result = await client.health()
    setHealth(result.kind === 'ok' ? 'online' : 'offline')
  }, [])

  useEffect(() => {
    void checkHealth()
    const timer = setInterval(() => {
      void checkHealth()
    }, HEALTH_POLL_MS)
    return () => clearInterval(timer)
  }, [checkHealth])

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

  if (!authChecked || !clientRef.current) {
    return (
      <div className="text-foreground-muted flex min-h-screen items-center justify-center text-sm">
        正在连接账户…
      </div>
    )
  }
  if (!authSession) {
    return (
      <AuthView client={clientRef.current} onAuthenticated={setAuthSession} />
    )
  }

  return (
    <div className="flex h-screen gap-3 p-3">
      <Sidebar
        activeItem={activeRunId ? 'new' : view}
        recentRuns={recentRuns}
        health={health}
        onSelectItem={selectView}
        onSelectRun={openRun}
        onOpenSettings={() => setSettingsOpen(true)}
        onLogout={async () => {
          await clientRef.current?.logout()
          setAuthSession(null)
        }}
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
            initialResume={profileResume}
            onSave={saveProfileResume}
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
            profileResume={profileResume}
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
