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

import { ArrowUp, LoaderCircle, Paperclip, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { SubmitRunResult } from '@/components/shell/app-shell'
import type { AgentApiClient, ChatMessage } from '@/lib/api/client'
import { type AttachedFile, loadPresetId, savePresetId } from '@/lib/draft'
import {
  availablePresets,
  SCENARIO_PRESETS,
  type TailorPreferences,
} from '@/lib/presets'

/**
 * Development-only affordances (the "start your backend" instructions) are
 * compiled out of a production bundle rather than shown to end users.
 */
const isDevelopment = process.env.NODE_ENV === 'development'

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
  /** The saved base resume; sent as the run's candidate input. */
  profileResume: string
  /** The saved default output preferences, or null to follow the preset. */
  profilePreferences: TailorPreferences | null
  onOpenProfile: () => void
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
  profileResume,
  profilePreferences,
  onOpenProfile,
}: LauncherViewProps) {
  const [files, setFiles] = useState<AttachedFile[]>([])
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [presetId, setPresetId] = useState('')
  const [chatInput, setChatInput] = useState('')
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatBusy, setChatBusy] = useState(false)
  const [chatError, setChatError] = useState<string | null>(null)
  const [chatReady, setChatReady] = useState(false)
  /** Opting out is a per-session choice; the profile itself is not touched. */
  const [useProfileResume, setUseProfileResume] = useState(true)

  const capabilityView =
    capabilities.kind === 'ready' ? asCapabilityView(capabilities.data) : null
  const presets = useMemo(
    () =>
      capabilityView ? availablePresets(capabilityView) : SCENARIO_PRESETS,
    [capabilityView]
  )
  // Only the chosen preset survives a reload. The job text and candidate YAML
  // used to be persisted here as well, but nothing has rendered those fields
  // since the input area became a single box — they were written and read back
  // without ever reaching a run.
  useEffect(() => {
    const stored = loadPresetId()
    if (stored) {
      setPresetId(stored)
    }
  }, [])

  useEffect(() => {
    savePresetId(presetId)
  }, [presetId])

  // Once the presets are known, make sure the selected one still exists (the
  // backend may not support it) and otherwise fall back to the featured one.
  const effectivePresetId = useMemo(() => {
    if (presetId && presets.some((entry) => entry.id === presetId)) {
      return presetId
    }
    return presets.find((entry) => entry.featured)?.id ?? presets[0]?.id ?? ''
  }, [presetId, presets])

  const capabilitiesReady = capabilityView !== null

  function handleAddFiles(list: FileList, role: 'job' | 'candidate') {
    setFiles((prev) => [...prev, ...attachFiles(list, role)])
  }

  function handleRemoveFile(id: string) {
    setFiles((prev) => prev.filter((file) => file.id !== id))
  }

  async function handleChat() {
    const message = chatInput.trim()
    if (!message || chatBusy) return
    setChatInput('')
    setChatError(null)
    setChatBusy(true)
    const fileContext = files.map((file) => file.name).join(', ')
    const context = [
      profileResume ? `个人主页简历:\n${profileResume}` : '',
      fileContext ? `已添加文件: ${fileContext}` : '',
    ]
      .filter(Boolean)
      .join('\n\n')
    const result = await client.chat(
      message,
      chatMessages,
      context || undefined
    )
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
    setChatReady(result.data.readyToGenerate)
  }

  async function handleGenerateFromChat() {
    if (!chatReady || submitting || !capabilitiesReady) return
    const preset =
      presets.find((entry) => entry.id === effectivePresetId) ?? presets[0]
    if (!preset) return
    const transcript = chatMessages
      .map((entry) => `${entry.role}: ${entry.content}`)
      .join('\n')
    const file = new File([transcript], 'conversation.txt', {
      type: 'text/plain',
    })
    setSubmitting(true)
    setSubmitError(null)
    try {
      const result = await onSubmitRun({
        jobDescription: transcript,
        // The saved profile is the candidate input. This is what makes the
        // profile page more than a notepad: before this, the resume stored
        // there reached the chat call and nothing else, so every run started
        // from the conversation alone.
        candidateYaml: useProfileResume ? profileResume : '',
        // Saved defaults win over the preset; the preset still names the run.
        preferences: profilePreferences ?? preset.preferences,
        jobFiles: [],
        candidateFiles: [
          ...files.filter((entry) => entry.role === 'candidate'),
          {
            id: 'conversation',
            name: file.name,
            size: file.size,
            role: 'candidate',
            file,
          },
        ],
        title: preset.title,
      })
      if (result.kind === 'ok') onSubmitted(result.runId)
      else setSubmitError(friendlySubmitError(result.error))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-[960px] flex-1 flex-col justify-center px-6 py-12 sm:px-10">
      {capabilities.kind === 'error' ? (
        <div
          role="alert"
          className="bg-background shadow-md mb-4 rounded-md px-4 py-4"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              {isDevelopment ? (
                <>
                  <p className="text-foreground-strong text-sm font-medium">
                    还差一步：需要先在本机启动后端
                  </p>
                  <p className="text-foreground-muted mt-2 text-sm leading-relaxed">
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
                </>
              ) : (
                <>
                  <p className="text-foreground-strong text-sm font-medium">
                    服务暂时不可用
                  </p>
                  <p className="text-foreground-muted mt-2 text-sm leading-relaxed">
                    没能连上后端服务。稍后重试；如果持续如此，请联系部署这个站点的人。
                  </p>
                  <p className="text-foreground-subtle mt-2 text-xs leading-relaxed">
                    {capabilities.message}
                  </p>
                </>
              )}
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

      <p
        className={
          useProfileResume && profileResume.trim().length > 0
            ? 'text-foreground-muted mx-auto mb-3 w-full max-w-[760px] px-1 text-xs leading-relaxed'
            : 'text-foreground-subtle mx-auto mb-3 w-full max-w-[760px] px-1 text-xs leading-relaxed'
        }
      >
        {profileResume.trim().length === 0 ? (
          <>
            档案里还没有基础简历，这次运行只会用对话内容。
            <button
              type="button"
              onClick={onOpenProfile}
              className="text-secondary-emphasis ml-1 underline underline-offset-2"
            >
              去个人主页添加
            </button>
          </>
        ) : useProfileResume ? (
          <>
            本次会以个人主页的基础简历（
            {profileResume.trim().length.toLocaleString('zh-CN')}{' '}
            字符）作为你的材料。
            <button
              type="button"
              onClick={() => setUseProfileResume(false)}
              className="text-secondary-emphasis ml-1 underline underline-offset-2"
            >
              这次不用
            </button>
          </>
        ) : (
          <>
            本次不使用档案里的基础简历。若对话里没有你的经历，Agent
            将没有可引用的证据。
            <button
              type="button"
              onClick={() => setUseProfileResume(true)}
              className="text-secondary-emphasis ml-1 underline underline-offset-2"
            >
              改回使用
            </button>
          </>
        )}
      </p>

      <UnifiedAgentInput
        input={chatInput}
        onInputChange={setChatInput}
        messages={chatMessages}
        files={files}
        onAddFiles={handleAddFiles}
        onRemoveFile={handleRemoveFile}
        busy={chatBusy || submitting}
        error={chatError ?? submitError}
        ready={chatReady}
        onSend={() => void handleChat()}
        onGenerate={() => void handleGenerateFromChat()}
      />
    </div>
  )
}

export function UnifiedAgentInput({
  input,
  onInputChange,
  messages,
  files,
  onAddFiles,
  onRemoveFile,
  busy,
  error,
  ready,
  onSend,
  onGenerate,
}: {
  input: string
  onInputChange: (value: string) => void
  messages: ChatMessage[]
  files: AttachedFile[]
  onAddFiles: (files: FileList, role: 'job' | 'candidate') => void
  onRemoveFile: (id: string) => void
  busy: boolean
  error: string | null
  ready: boolean
  onSend: () => void
  onGenerate: () => void
}) {
  const fileInput = useRef<HTMLInputElement>(null)
  return (
    <section className="mx-auto w-full max-w-[760px]" aria-label="Agent 输入">
      {files.length > 0 ? (
        <ul className="mb-3 flex flex-wrap gap-2 px-1">
          {files.map((file) => (
            <li
              key={file.id}
              className="bg-background text-foreground-muted border-border flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs shadow-sm"
            >
              <span className="max-w-48 truncate">{file.name}</span>
              <button
                type="button"
                onClick={() => onRemoveFile(file.id)}
                aria-label={`移除 ${file.name}`}
                className="text-foreground-subtle hover:text-foreground-strong -mr-1 flex size-4 items-center justify-center rounded-full transition-colors"
              >
                <X size={13} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mb-3 flex max-h-56 flex-col gap-2 overflow-y-auto px-1">
        {messages.map((entry, index) => (
          <p
            key={`${entry.role}-${index}`}
            className={
              entry.role === 'user'
                ? 'text-foreground-strong self-end rounded-md bg-secondary-subtle px-3 py-2 text-sm'
                : 'text-foreground rounded-md bg-background-muted px-3 py-2 text-sm'
            }
          >
            {entry.content}
          </p>
        ))}
      </div>
      {error ? (
        <p
          role="alert"
          className="text-error-emphasis bg-error-subtle mb-3 rounded-lg px-3 py-2 text-xs"
        >
          {error}
        </p>
      ) : null}
      <div className="bg-background focus-within:border-primary/50 focus-within:ring-primary/10 rounded-2xl border border-[var(--border-subtle)] p-3 shadow-[0_8px_30px_oklch(0.3_0.02_250/8%)] transition-[border-color,box-shadow] focus-within:ring-4 sm:p-4">
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            if (event.target.files?.length)
              onAddFiles(event.target.files, 'candidate')
            event.target.value = ''
          }}
        />
        <textarea
          value={input}
          onChange={(event) => onInputChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              onSend()
            }
          }}
          rows={5}
          aria-label="输入消息"
          placeholder="请输入文字"
          className="text-foreground-strong placeholder:text-foreground-subtle min-h-[7.5rem] w-full resize-none bg-transparent px-2 py-2 text-[15px] leading-relaxed outline-none sm:min-h-[8.5rem]"
        />
        <div className="mt-2 flex items-center justify-between px-1">
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="text-foreground-muted hover:text-foreground-strong hover:bg-[var(--overlay-hover)] flex size-9 items-center justify-center rounded-full transition-colors"
            aria-label="添加文件"
            title="添加文件"
          >
            <Paperclip size={18} strokeWidth={1.8} />
          </button>
          <button
            type="button"
            onClick={onSend}
            disabled={busy || input.trim().length === 0}
            aria-label={busy ? '处理中' : '发送消息'}
            className="bg-primary text-primary-foreground hover:bg-primary-strong flex size-9 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-35"
          >
            {busy ? (
              <LoaderCircle size={17} className="animate-spin" />
            ) : (
              <ArrowUp size={18} strokeWidth={2.2} />
            )}
          </button>
        </div>
      </div>
      {ready ? (
        <button
          type="button"
          onClick={onGenerate}
          disabled={busy}
          className="bg-secondary-emphasis text-secondary-foreground mt-3 rounded-full px-4 py-2 text-sm font-medium transition-opacity disabled:opacity-50"
        >
          根据对话生成简历
        </button>
      ) : null}
    </section>
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
