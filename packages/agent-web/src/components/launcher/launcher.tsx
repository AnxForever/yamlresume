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

import { useEffect, useMemo, useState } from 'react'
import { LogoMark } from '@/components/brand/logo'
import { HeroComposer } from '@/components/launcher/hero-composer'
import type { SubmitRunResult } from '@/components/shell/app-shell'
import type { AgentApiClient, ChatMessage } from '@/lib/api/client'
import {
  type AttachedFile,
  loadDraft,
  saveDraft,
  submitBlockers,
} from '@/lib/draft'
import {
  availablePresets,
  SCENARIO_PRESETS,
  type TailorPreferences,
} from '@/lib/presets'

let fileCounter = 0

function attachFiles(
  list: FileList,
  role: 'job' | 'candidate'
): AttachedFile[] {
  return Array.from(list).map((file) => {
    fileCounter += 1
    return {
      id: `file-${fileCounter}`,
      name: file.name,
      size: file.size,
      role,
      file,
    }
  })
}

export interface LauncherSubmitPayload {
  jobDescription: string
  candidateYaml: string
  preferences: TailorPreferences
  jobFiles: AttachedFile[]
  candidateFiles: AttachedFile[]
  title: string
}

export interface LauncherViewProps {
  capabilities:
    | { kind: 'loading' }
    | { kind: 'ready'; data: unknown }
    | { kind: 'error'; message: string }
  onSubmitRun: (payload: LauncherSubmitPayload) => Promise<SubmitRunResult>
  onSubmitted: (runId: string) => void
  onRetryCapabilities: () => void
  onOpenSettings: () => void
  client: AgentApiClient
}

interface CapabilityView {
  output: {
    formats: string[]
    styles: Array<{ id: string }>
  }
  input?: {
    limits?: {
      fileBytes?: number
      jobFiles?: number
      candidateFiles?: number
    }
  }
}

function asCapabilityView(data: unknown): CapabilityView | null {
  const candidate = data as CapabilityView
  if (
    candidate &&
    typeof candidate === 'object' &&
    candidate.output &&
    Array.isArray(candidate.output.formats) &&
    Array.isArray(candidate.output.styles)
  ) {
    return candidate
  }
  return null
}

export function LauncherView({
  capabilities,
  onSubmitRun,
  onSubmitted,
  onRetryCapabilities,
  onOpenSettings,
  client,
}: LauncherViewProps) {
  const [jobDescription, setJobDescription] = useState('')
  const [candidateYaml, setCandidateYaml] = useState('')
  const [files, setFiles] = useState<AttachedFile[]>([])
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [draftRestored, setDraftRestored] = useState(false)
  const [presetId, setPresetId] = useState('')
  const [chatInput, setChatInput] = useState('')
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatBusy, setChatBusy] = useState(false)
  const [chatError, setChatError] = useState<string | null>(null)

  const capabilityView =
    capabilities.kind === 'ready' ? asCapabilityView(capabilities.data) : null
  const presets = useMemo(
    () =>
      capabilityView ? availablePresets(capabilityView) : SCENARIO_PRESETS,
    [capabilityView]
  )
  const limits = useMemo(() => {
    const backend = capabilityView?.input?.limits
    return {
      fileBytes: backend?.fileBytes ?? 12 * 1024 * 1024,
      jobFiles: backend?.jobFiles ?? 8,
      candidateFiles: backend?.candidateFiles ?? 12,
    }
  }, [capabilityView])

  // Restore the previously typed draft on mount. Only the text survives —
  // attached files cannot be serialized, so the user is told when they were
  // dropped rather than silently losing them.
  useEffect(() => {
    const stored = loadDraft()
    if (!stored) {
      return
    }
    setJobDescription(stored.jobDescription)
    setCandidateYaml(stored.candidateYaml)
    if (stored.presetId) {
      setPresetId(stored.presetId)
    }
    setDraftRestored(true)
  }, [])

  // Persist text as it is typed (the writes are tiny and idempotent), so a
  // failed run or a refresh never costs the user the paste again.
  useEffect(() => {
    saveDraft({ jobDescription, candidateYaml, presetId })
  }, [jobDescription, candidateYaml, presetId])

  // Once the presets are known, make sure the selected one still exists (the
  // backend may not support it) and otherwise fall back to the featured one.
  const effectivePresetId = useMemo(() => {
    if (presetId && presets.some((entry) => entry.id === presetId)) {
      return presetId
    }
    return presets.find((entry) => entry.featured)?.id ?? presets[0]?.id ?? ''
  }, [presetId, presets])

  const draft = useMemo(
    () => ({ jobDescription, candidateYaml, files }),
    [jobDescription, candidateYaml, files]
  )
  const blockers = useMemo(() => submitBlockers(draft, limits), [draft, limits])
  const capabilitiesReady = capabilityView !== null

  function handleAddFiles(list: FileList, role: 'job' | 'candidate') {
    setFiles((prev) => [...prev, ...attachFiles(list, role)])
  }

  function handleRemoveFile(id: string) {
    setFiles((prev) => prev.filter((file) => file.id !== id))
  }

  async function handleSubmit() {
    if (blockers.length > 0 || submitting || !capabilitiesReady) {
      return
    }
    const preset =
      presets.find((entry) => entry.id === effectivePresetId) ?? presets[0]
    if (!preset) {
      return
    }
    setSubmitError(null)
    setSubmitting(true)
    try {
      const result = await onSubmitRun({
        jobDescription,
        candidateYaml,
        preferences: preset.preferences,
        jobFiles: files.filter((file) => file.role === 'job'),
        candidateFiles: files.filter((file) => file.role === 'candidate'),
        title: preset.title,
      })
      if (result.kind === 'ok') {
        onSubmitted(result.runId)
      } else {
        setSubmitError(friendlySubmitError(result.error))
      }
    } finally {
      setSubmitting(false)
    }
  }

  async function handleChat() {
    const message = chatInput.trim()
    if (!message || chatBusy) return
    setChatInput('')
    setChatError(null)
    setChatBusy(true)
    const result = await client.chat(message, chatMessages)
    setChatBusy(false)
    if (result.kind === 'error') {
      setChatError(result.error.message)
      return
    }
    setChatMessages((current) => [
      ...current,
      { role: 'user', content: message },
      { role: 'assistant', content: result.data.reply },
    ])
  }

  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col px-8 pt-[14vh] pb-12">
      <header className="mb-8 flex items-center gap-4">
        <LogoMark size={48} />
        <div>
          <h1 className="text-foreground-strong text-[24px] font-semibold tracking-tight">
            为这份岗位定制简历
          </h1>
          <p className="text-foreground mt-1.5 text-[15px]">
            粘贴 JD 和你的简历，生成可追溯、能过 ATS 的定制版本。
          </p>
        </div>
      </header>

      {draftRestored ? (
        <p className="text-foreground-muted bg-background shadow-md mb-4 rounded-md px-4 py-3 text-sm leading-relaxed">
          已恢复上次输入的内容。带过的文件不会保存，需要的话请重新拖进来。
        </p>
      ) : null}

      {capabilities.kind === 'error' ? (
        <div
          role="alert"
          className="bg-background shadow-md mb-4 rounded-md px-4 py-4"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-foreground-strong text-sm font-medium">
                还差一步：需要先在本机启动后端
              </p>
              <p className="text-foreground-muted mt-1.5 text-sm leading-relaxed">
                Career Agent
                的简历处理跑在一个本机后端服务上（它保管你的材料，不经过第三方）。
                在项目目录打开终端运行：
              </p>
              <code className="text-foreground-strong bg-background-muted mt-2 block rounded-xs px-3 py-2 font-mono text-xs">
                pnpm agent-api dev
              </code>
              <p className="text-foreground-muted mt-2 text-xs leading-relaxed">
                启动后点「重试」。地址不对就打开设置改。当前地址连不上：
                <span className="text-foreground-subtle">
                  {capabilities.message}
                </span>
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-stretch gap-2">
              <button
                type="button"
                onClick={onRetryCapabilities}
                className="bg-primary text-primary-foreground rounded-xs px-3 py-2 text-sm font-medium transition-colors hover:bg-primary-strong"
              >
                重试
              </button>
              <button
                type="button"
                onClick={onOpenSettings}
                className="text-foreground hover:bg-[var(--overlay-hover)] rounded-xs px-3 py-2 text-sm transition-colors"
              >
                打开设置
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {submitError ? (
        <p
          role="alert"
          className="text-error-emphasis bg-error-subtle mb-4 rounded-md px-4 py-3 text-sm leading-relaxed"
        >
          {submitError}
        </p>
      ) : null}

      <HeroComposer
        jobDescription={jobDescription}
        onJobDescriptionChange={setJobDescription}
        candidateYaml={candidateYaml}
        onCandidateYamlChange={setCandidateYaml}
        files={files}
        onAddFiles={handleAddFiles}
        onRemoveFile={handleRemoveFile}
        presets={presets}
        presetId={effectivePresetId}
        onPresetChange={setPresetId}
        blockers={
          capabilities.kind === 'loading'
            ? ['正在读取后端能力，请稍候…']
            : capabilities.kind === 'error'
              ? ['连不上后端：重试或到设置里检查后端地址']
              : blockers
        }
        submitting={submitting}
        onSubmit={handleSubmit}
        chatInput={chatInput}
        onChatInputChange={setChatInput}
        chatMessages={chatMessages}
        chatBusy={chatBusy}
        chatError={chatError}
        onChat={() => void handleChat()}
      />
    </div>
  )
}

function friendlySubmitError(error: {
  code: string
  message: string
  requestId?: string
  status?: number
}): string {
  const requestSuffix = error.requestId
    ? `（requestId: ${error.requestId}）`
    : ''
  if (error.code === 'network_error') {
    return `无法连接到后端。请确认 resume-agent-api 已启动，且设置里的地址正确。${requestSuffix}`
  }
  if (error.status === 422 || error.code === 'invalid_request') {
    return `请求未通过后端校验：${error.message}${requestSuffix}`
  }
  return `提交失败：${error.message}${requestSuffix}`
}
