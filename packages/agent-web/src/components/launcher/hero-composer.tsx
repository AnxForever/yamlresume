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

import { ArrowUp, FileText, LoaderCircle, Paperclip, X } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import { PresetSelect } from '@/components/launcher/preset-select'
import type { ChatMessage } from '@/lib/api/client'
import { cx } from '@/lib/cx'
import type { AttachedFile } from '@/lib/draft'
import type { ScenarioPreset } from '@/lib/presets'
import { useAutoGrow } from '@/lib/use-auto-grow'

const JD_MAX_CHARS = 100_000
const JD_MAX_HEIGHT = 280
const YAML_MAX_HEIGHT = 220

function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

interface FileChipsProps {
  files: AttachedFile[]
  onRemove: (id: string) => void
}

function FileChips({ files, onRemove }: FileChipsProps) {
  if (files.length === 0) {
    return null
  }
  return (
    <ul className="flex flex-wrap gap-2 px-1 pb-1">
      {files.map((file) => (
        <li
          key={file.id}
          className="bg-[var(--overlay-subtle)] text-foreground flex items-center gap-2 rounded-full py-1 pl-3 pr-2 text-xs"
        >
          <FileText size={14} className="text-foreground-muted" />
          <span className="max-w-[160px] truncate">{file.name}</span>
          <span className="text-foreground-subtle">
            {formatSize(file.size)}
          </span>
          <button
            type="button"
            onClick={() => onRemove(file.id)}
            aria-label={`移除 ${file.name}`}
            className="text-foreground-muted hover:text-foreground-strong hover:bg-[var(--overlay-hover)] flex size-4 items-center justify-center rounded-full transition-colors"
          >
            <X size={12} />
          </button>
        </li>
      ))}
    </ul>
  )
}

export interface HeroComposerProps {
  jobDescription: string
  onJobDescriptionChange: (value: string) => void
  candidateYaml: string
  onCandidateYamlChange: (value: string) => void
  files: AttachedFile[]
  onAddFiles: (files: FileList, role: 'job' | 'candidate') => void
  onRemoveFile: (id: string) => void
  presets: ScenarioPreset[]
  presetId: string
  onPresetChange: (id: string) => void
  blockers: string[]
  submitting: boolean
  onSubmit: () => void
  chatInput: string
  onChatInputChange: (value: string) => void
  chatMessages: ChatMessage[]
  chatBusy: boolean
  chatError: string | null
  onChat: () => void
  chatReady: boolean
  onGenerateFromChat: () => void
}

export function HeroComposer({
  jobDescription,
  onJobDescriptionChange,
  candidateYaml,
  onCandidateYamlChange,
  files,
  onAddFiles,
  onRemoveFile,
  presets,
  presetId,
  onPresetChange,
  blockers,
  submitting,
  onSubmit,
  chatInput,
  onChatInputChange,
  chatMessages,
  chatBusy,
  chatError,
  onChat,
  chatReady,
  onGenerateFromChat,
}: HeroComposerProps) {
  const jobFileInput = useRef<HTMLInputElement>(null)
  const candidateFileInput = useRef<HTMLInputElement>(null)
  const candidateFieldId = useId()
  const jobFieldId = useId()
  const jobHintId = useId()
  const candidateHintId = useId()
  const jobRequirementId = useId()
  const candidateRequirementId = useId()
  const blockerId = useId()
  const [dragTarget, setDragTarget] = useState<'job' | 'candidate' | null>(null)

  const jobTextRef = useAutoGrow<HTMLTextAreaElement>(
    jobDescription,
    JD_MAX_HEIGHT
  )
  const yamlTextRef = useAutoGrow<HTMLTextAreaElement>(
    candidateYaml,
    YAML_MAX_HEIGHT
  )

  const jobFiles = files.filter((file) => file.role === 'job')
  const candidateFiles = files.filter((file) => file.role === 'candidate')
  const canSubmit = blockers.length === 0 && !submitting

  // A draft has two mandatory halves: the JD and the candidate materials.
  // Each missing half gets a visible call-out instead of only a footer hint,
  // so a disabled send button always explains itself next to what is missing.
  const jobMissing = jobDescription.trim().length < 20 && jobFiles.length === 0
  const candidateMissing =
    candidateYaml.trim().length === 0 && candidateFiles.length === 0

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (
      (event.metaKey || event.ctrlKey) &&
      event.key === 'Enter' &&
      canSubmit
    ) {
      event.preventDefault()
      onSubmit()
    }
  }

  function makeDropHandlers(role: 'job' | 'candidate') {
    return {
      onDragOver: (event: React.DragEvent) => {
        if (event.dataTransfer.types.includes('Files')) {
          event.preventDefault()
          setDragTarget(role)
        }
      },
      onDragLeave: (event: React.DragEvent) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) {
          setDragTarget(null)
        }
      },
      onDrop: (event: React.DragEvent) => {
        event.preventDefault()
        setDragTarget(null)
        if (event.dataTransfer.files?.length) {
          onAddFiles(event.dataTransfer.files, role)
        }
      },
    }
  }

  return (
    <div className="w-full">
      <section
        className="bg-background shadow-md mb-4 rounded-md p-5"
        aria-label="Agent 输入"
      >
        <div className="mb-3">
          <h2 className="text-foreground-strong text-sm font-medium">
            告诉我你要做什么
          </h2>
          <p className="text-foreground-muted mt-1 text-xs">
            可以直接聊天，也可以在同一个输入框里附加简历或 JD 文件。
          </p>
        </div>
        <div className="mb-3 flex max-h-48 flex-col gap-2 overflow-y-auto">
          {chatMessages.map((entry, index) => (
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
        {chatError ? (
          <p role="alert" className="text-error-emphasis mb-2 text-xs">
            {chatError}
          </p>
        ) : null}
        <div className="flex gap-2">
          <input
            value={chatInput}
            onChange={(event) => onChatInputChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void onChat()
            }}
            placeholder="例如：我想做一份后端工程师简历"
            className="text-foreground-strong placeholder:text-foreground-muted min-w-0 flex-1 rounded-md bg-background-muted px-3 py-2 text-sm outline-none"
          />
          <button
            type="button"
            onClick={onChat}
            disabled={chatBusy || chatInput.trim().length === 0}
            className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {chatBusy ? '发送中…' : '发送'}
          </button>
        </div>
        {chatReady ? (
          <button
            type="button"
            onClick={onGenerateFromChat}
            disabled={submitting}
            className="bg-secondary-emphasis text-secondary-foreground mt-3 rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            根据这段对话生成简历
          </button>
        ) : null}
      </section>
      {/* Hero card: the job description is the primary "task". */}
      <div
        {...makeDropHandlers('job')}
        className={cx(
          'bg-background rounded-md p-5 transition-all',
          dragTarget === 'job'
            ? 'ring-secondary-emphasis shadow-xl ring-2'
            : jobMissing
              ? 'ring-warning-emphasis shadow-md ring-1'
              : 'shadow-md'
        )}
      >
        <div className="mb-2 flex items-center justify-between">
          <label
            htmlFor={jobFieldId}
            className="text-foreground-muted text-xs font-medium"
          >
            岗位 JD
          </label>
          {jobMissing ? (
            <span
              id={jobRequirementId}
              className="text-warning-emphasis text-xs font-medium"
            >
              必填：粘贴 JD 或上传岗位文件
            </span>
          ) : null}
        </div>
        <textarea
          id={jobFieldId}
          ref={jobTextRef}
          value={jobDescription}
          onChange={(event) =>
            onJobDescriptionChange(event.target.value.slice(0, JD_MAX_CHARS))
          }
          onKeyDown={handleKeyDown}
          rows={4}
          aria-describedby={`${jobHintId}${jobMissing ? ` ${jobRequirementId}` : ''}${canSubmit ? '' : ` ${blockerId}`}`}
          placeholder="粘贴目标岗位 JD，交给我来帮你定制简历"
          className="text-foreground-strong placeholder:text-foreground-muted min-h-[112px] w-full resize-none bg-transparent text-[15px] leading-relaxed outline-none"
        />
        <p id={jobHintId} className="sr-only">
          必填。粘贴岗位描述原文，或上传岗位文件。至少 20 个字符。
        </p>

        <FileChips files={jobFiles} onRemove={onRemoveFile} />

        <div className="mt-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <input
              ref={jobFileInput}
              type="file"
              multiple
              hidden
              onChange={(event) => {
                if (event.target.files?.length) {
                  onAddFiles(event.target.files, 'job')
                }
                event.target.value = ''
              }}
            />
            <button
              type="button"
              onClick={() => jobFileInput.current?.click()}
              className="text-foreground hover:bg-[var(--overlay-hover)] flex items-center gap-2 rounded-full px-3 py-2 text-sm transition-colors"
            >
              <Paperclip size={16} />
              岗位文件
            </button>
            {jobDescription.length > 0 ? (
              <span className="text-foreground-subtle text-xs tabular-nums">
                {jobDescription.length.toLocaleString()} 字
              </span>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            <PresetSelect
              presets={presets}
              value={presetId}
              onChange={onPresetChange}
            />
            <button
              type="button"
              onClick={onSubmit}
              disabled={!canSubmit}
              aria-label={submitting ? '正在提交' : '开始定制'}
              aria-busy={submitting}
              aria-describedby={canSubmit ? undefined : blockerId}
              className={cx(
                'flex size-10 items-center justify-center rounded-full transition-all',
                submitting
                  ? 'bg-primary text-primary-foreground cursor-wait'
                  : canSubmit
                    ? 'bg-primary text-primary-foreground hover:scale-105 hover:bg-primary-strong active:scale-95'
                    : 'bg-[var(--overlay-active)] text-foreground-subtle cursor-not-allowed'
              )}
            >
              {submitting ? (
                <LoaderCircle size={18} className="animate-spin" />
              ) : (
                <ArrowUp size={18} />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Candidate materials: a lighter strip below the hero. */}
      <div
        {...makeDropHandlers('candidate')}
        className={cx(
          'mt-4 rounded-md p-5 transition-all',
          dragTarget === 'candidate'
            ? 'ring-secondary-emphasis bg-secondary-subtle ring-2'
            : candidateMissing
              ? 'bg-warning-subtle ring-warning-emphasis ring-1'
              : 'bg-background-subtle'
        )}
      >
        <div className="mb-3 flex items-center justify-between">
          <label
            htmlFor={candidateFieldId}
            className="text-foreground text-sm font-medium"
          >
            你的材料
          </label>
          {candidateMissing ? (
            <span
              id={candidateRequirementId}
              className="text-warning-emphasis text-xs font-medium"
            >
              必填：上传简历，或粘贴文本
            </span>
          ) : null}
          <div>
            <input
              ref={candidateFileInput}
              type="file"
              multiple
              hidden
              onChange={(event) => {
                if (event.target.files?.length) {
                  onAddFiles(event.target.files, 'candidate')
                }
                event.target.value = ''
              }}
            />
            <button
              type="button"
              onClick={() => candidateFileInput.current?.click()}
              className="bg-secondary-subtle text-secondary-emphasis hover:bg-secondary-soft flex items-center gap-2 rounded-full px-3 py-2 text-sm font-medium transition-colors"
            >
              <Paperclip size={16} />
              上传简历文件
            </button>
          </div>
        </div>
        <textarea
          id={candidateFieldId}
          ref={yamlTextRef}
          value={candidateYaml}
          onChange={(event) => onCandidateYamlChange(event.target.value)}
          rows={3}
          aria-describedby={`${candidateHintId}${candidateMissing ? ` ${candidateRequirementId}` : ''}${canSubmit ? '' : ` ${blockerId}`}`}
          placeholder="有现成的简历就点右上角上传 PDF / Word；也可以直接粘贴简历文本或 YAMLResume 内容"
          className="text-foreground-strong placeholder:text-foreground-muted break-anywhere min-h-[72px] w-full resize-none bg-transparent text-[13px] leading-relaxed outline-none"
        />
        <p
          id={candidateHintId}
          className="text-foreground-subtle mt-2 text-xs leading-relaxed"
        >
          必填。支持 PDF、Word、Markdown、纯文本和
          YAMLResume；项目说明、作品集、证书也可以一起传。
        </p>
        <FileChips files={candidateFiles} onRemove={onRemoveFile} />
      </div>

      {submitting ? (
        <p
          className="text-foreground mt-3 px-1 text-sm leading-relaxed"
          aria-live="polite"
        >
          正在创建运行…这一步可能要几十秒，先别关页面。
        </p>
      ) : blockers.length > 0 ? (
        <p
          id={blockerId}
          className="text-warning-emphasis mt-3 px-1 text-sm font-medium leading-relaxed"
          aria-live="polite"
        >
          还不能发送：{blockers[0]}
        </p>
      ) : (
        <p id={blockerId} className="text-foreground-subtle mt-3 px-1 text-xs">
          ⌘/Ctrl + Enter 开始 · 可直接把文件拖到卡片上 · 材料只发送到本地后端
        </p>
      )}
    </div>
  )
}
