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

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { StatusBadge } from '@/components/ui/status-badge'
import type { InteractionRequest } from '@/lib/api/types'
import { cx } from '@/lib/cx'

export interface AnswerPayload {
  interactionId: string
  idempotencyKey: string
  value: unknown
}

export interface InteractionCardProps {
  request: InteractionRequest
  submitting: boolean
  answerError: string | null
  onSubmit: (payload: AnswerPayload) => void
  /**
   * Escape hatch for a question this frontend cannot answer. The backend only
   * puts required questions in the pending list, so an unanswerable control
   * would otherwise strand the run forever with no way forward.
   */
  onStartNew?: () => void
}

const PRIVACY_LABELS = {
  standard: null,
  personal: '这条会写入你的个人信息。',
  sensitive: '这条涉及敏感信息，只发送到后端，不保存在浏览器。',
} as const

/**
 * Shown when a question's control type cannot be answered from the browser.
 * Explains the situation in plain language and — critically — offers a way
 * out, because the run cannot resume without this answer.
 */
function UnanswerableNotice({
  title,
  body,
  onStartNew,
}: {
  title: string
  body: string
  onStartNew?: () => void
}) {
  return (
    <div className="bg-warning-subtle rounded-xs px-4 py-3">
      <p className="text-foreground-strong text-sm font-medium">{title}</p>
      <p className="text-foreground-muted mt-1 text-xs leading-relaxed">
        {body}
        这条运行会一直停在这里，等前端补齐这个控件。
      </p>
      {onStartNew ? (
        <button
          type="button"
          onClick={onStartNew}
          className="bg-primary text-primary-foreground mt-3 rounded-xs px-3 py-2 text-sm font-medium transition-colors hover:bg-primary-strong"
        >
          带上材料重新发起一次
        </button>
      ) : null}
    </div>
  )
}

/**
 * Renders one structured question per its `control.type`. Unknown control
 * types degrade to a read-only card instead of crashing — the backend can ship
 * new controls ahead of this frontend.
 */
export function InteractionCard({
  request,
  submitting,
  answerError,
  onSubmit,
  onStartNew,
}: InteractionCardProps) {
  const control = request.control
  const [value, setValue] = useState<unknown>('')
  const [customChoice, setCustomChoice] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const keyRef = useRef(`answer-${request.id}-${Date.now()}`)
  const focusRef = useRef<HTMLFieldSetElement>(null)
  const promptId = useId()
  const errorId = useId()

  // One focused question at a time; move focus onto the card when it appears.
  useEffect(() => {
    focusRef.current?.focus()
  }, [])

  const canSubmit = useMemo(() => {
    if (control.type === 'text' || control.type === 'textarea') {
      const text = String(value)
      return (
        text.trim().length >= control.minLength &&
        text.length <= control.maxLength
      )
    }
    if (control.type === 'single_choice') {
      return value !== '' || customChoice.trim().length > 0
    }
    if (control.type === 'multi_choice') {
      return selected.length >= control.minSelections
    }
    if (control.type === 'number') {
      // An empty field must not pass: `Number('')` is 0, which would look
      // in-range for any control whose min is 0 and submit a bogus answer.
      if (String(value).trim().length === 0) {
        return false
      }
      const parsed = Number(value)
      if (!Number.isFinite(parsed)) {
        return false
      }
      if (control.integer && !Number.isInteger(parsed)) {
        return false
      }
      if (control.min !== undefined && parsed < control.min) {
        return false
      }
      if (control.max !== undefined && parsed > control.max) {
        return false
      }
      return true
    }
    if (
      control.type === 'date' ||
      control.type === 'date_range' ||
      control.type === 'url'
    ) {
      return String(value).trim().length > 0
    }
    if (control.type === 'confirm') {
      return false // only the explicit buttons submit
    }
    return false
  }, [control, value, selected, customChoice])

  function submit(payloadValue: unknown) {
    // The idempotency key stays stable across retries of the same question;
    // the backend rejects a different payload under the same key with a 409.
    onSubmit({
      interactionId: request.id,
      idempotencyKey: keyRef.current,
      value: payloadValue,
    })
  }

  function submitChoice(choiceValue: unknown) {
    setValue(choiceValue)
    submit(choiceValue)
  }

  return (
    // A real <fieldset> groups the prompt with its controls for assistive tech;
    // the default border/margin/padding are reset so it renders as before.
    <fieldset
      ref={focusRef}
      tabIndex={-1}
      aria-labelledby={promptId}
      className="bg-background shadow-xl ring-secondary-emphasis m-0 min-w-0 rounded-md border-0 p-5 ring-1 outline-none"
    >
      <div className="mb-3 flex items-center gap-2">
        <StatusBadge tone="accent">需要你确认</StatusBadge>
        {request.required ? null : (
          <StatusBadge tone="mute">可跳过</StatusBadge>
        )}
        <span className="text-foreground-subtle text-xs">{request.field}</span>
      </div>

      <p
        id={promptId}
        className="text-foreground-strong text-[15px] font-medium leading-relaxed"
      >
        {request.prompt}
      </p>
      {request.reason ? (
        <p className="text-foreground-muted mt-2 text-xs leading-relaxed">
          为什么问：{request.reason}
        </p>
      ) : null}
      {PRIVACY_LABELS[request.privacy] ? (
        <p className="text-foreground-muted mt-1 text-xs">
          {PRIVACY_LABELS[request.privacy]}
        </p>
      ) : null}

      <div className="mt-4">
        {control.type === 'text' ? (
          <TextControl
            value={String(value)}
            maxLength={control.maxLength}
            labelledBy={promptId}
            describedBy={answerError ? errorId : undefined}
            hint={
              control.minLength > 1 ? `至少 ${control.minLength} 字` : undefined
            }
            submitting={submitting}
            canSubmit={canSubmit}
            onChange={setValue}
            onSubmit={() => submit(String(value))}
          />
        ) : control.type === 'textarea' ? (
          <TextControl
            value={String(value)}
            maxLength={control.maxLength}
            labelledBy={promptId}
            describedBy={answerError ? errorId : undefined}
            multiline
            hint={
              control.minLength > 1 ? `至少 ${control.minLength} 字` : undefined
            }
            submitting={submitting}
            canSubmit={canSubmit}
            onChange={setValue}
            onSubmit={() => submit(String(value))}
          />
        ) : control.type === 'single_choice' ? (
          <ChoiceControl
            options={control.options}
            allowCustom={control.allowCustom}
            multi={false}
            selected={selected}
            custom={customChoice}
            submitting={submitting}
            onToggle={(option) => {
              setSelected([option.value])
              submitChoice(option.value)
            }}
            onCustomChange={setCustomChoice}
            onCustomSubmit={() => submit(customChoice)}
          />
        ) : control.type === 'multi_choice' ? (
          <ChoiceControl
            options={control.options}
            allowCustom={control.allowCustom}
            multi
            selected={selected}
            custom={customChoice}
            submitting={submitting}
            minSelections={control.minSelections}
            maxSelections={control.maxSelections}
            onToggle={(option) => {
              setSelected((prev) =>
                prev.includes(option.value)
                  ? prev.filter((entry) => entry !== option.value)
                  : [...prev, option.value]
              )
            }}
            onCustomChange={setCustomChoice}
            onCustomSubmit={() => submit([...selected, customChoice])}
            onFinish={() => submit(selected)}
          />
        ) : control.type === 'number' ? (
          <TextControl
            value={String(value)}
            maxLength={32}
            inputMode="numeric"
            labelledBy={promptId}
            describedBy={answerError ? errorId : undefined}
            hint={rangeHint(control) ?? '请输入数字'}
            submitting={submitting}
            canSubmit={canSubmit}
            onChange={setValue}
            onSubmit={() => submit(Number(value))}
          />
        ) : control.type === 'date' || control.type === 'date_range' ? (
          <TextControl
            value={String(value)}
            maxLength={32}
            inputMode="text"
            labelledBy={promptId}
            describedBy={answerError ? errorId : undefined}
            hint={
              control.type === 'date_range'
                ? '格式：2022-09 或 2022-09 ~ 至今'
                : '格式：2022-09'
            }
            submitting={submitting}
            canSubmit={canSubmit}
            onChange={setValue}
            onSubmit={() => submit(String(value))}
          />
        ) : control.type === 'url' ? (
          <TextControl
            value={String(value)}
            maxLength={control.maxLength}
            inputMode="url"
            labelledBy={promptId}
            describedBy={answerError ? errorId : undefined}
            hint="以 http:// 或 https:// 开头"
            submitting={submitting}
            canSubmit={canSubmit}
            onChange={setValue}
            onSubmit={() => submit(String(value))}
          />
        ) : control.type === 'confirm' ? (
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={submitting}
              onClick={() => submit(true)}
              className="bg-primary text-primary-foreground rounded-xs px-4 py-2 text-sm font-medium transition-colors hover:bg-primary-strong disabled:opacity-50"
            >
              {control.confirmLabel ?? '确认'}
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => submit(false)}
              className="text-foreground hover:bg-[var(--overlay-hover)] rounded-xs px-4 py-2 text-sm transition-colors"
            >
              {control.cancelLabel ?? '取消'}
            </button>
          </div>
        ) : control.type === 'file' ? (
          <UnanswerableNotice
            title="这个问题需要上传文件，当前版本还回答不了"
            body={`后端允许的类型：${control.acceptedMediaTypes.join('、')}。`}
            onStartNew={onStartNew}
          />
        ) : (
          <UnanswerableNotice
            title={`这个问题用了新控件（${(control as { type: string }).type}），当前版本还回答不了`}
            body="后端已经支持它，前端还没跟上。"
            onStartNew={onStartNew}
          />
        )}
      </div>

      {answerError ? (
        <p
          id={errorId}
          role="alert"
          className="text-error-emphasis mt-3 text-xs leading-relaxed"
        >
          {answerError}
        </p>
      ) : null}
      {/* No skip control: the backend filters `optional` questions out of the
          pending list (run.ts filters severity !== 'optional'), so every
          question the snapshot exposes must be answered for the run to
          resume. Re-introduce a skip action if a backend skip endpoint lands. */}
    </fieldset>
  )
}

function TextControl({
  value,
  maxLength,
  multiline = false,
  inputMode,
  submitting,
  canSubmit,
  hint,
  labelledBy,
  describedBy,
  onChange,
  onSubmit,
}: {
  value: string
  maxLength: number
  multiline?: boolean
  inputMode?: 'text' | 'numeric' | 'url'
  submitting: boolean
  canSubmit: boolean
  /**
   * Why submit is blocked, in the user's words (e.g. "至少 10 字"). Shown next
   * to the disabled button so it never just sits there greyed out.
   */
  hint?: string
  /** The prompt element that names this control for assistive tech. */
  labelledBy?: string
  describedBy?: string
  onChange: (value: string) => void
  onSubmit: () => void
}) {
  const shared = {
    value,
    maxLength,
    inputMode,
    disabled: submitting,
    'aria-labelledby': labelledBy,
    'aria-describedby': describedBy,
    onChange: (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
    ) => onChange(event.target.value),
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === 'Enter' && !multiline && canSubmit) {
        event.preventDefault()
        onSubmit()
      }
    },
    className:
      'border-border focus:border-secondary-emphasis text-foreground-strong w-full rounded-xs border bg-transparent px-3 py-2 text-sm outline-none transition-colors',
  }
  const blocked = !canSubmit && !submitting
  return (
    <div className="flex flex-col gap-2">
      {multiline ? (
        <textarea rows={3} {...shared} />
      ) : (
        <input type="text" {...shared} />
      )}
      <div className="flex items-center justify-between gap-3">
        <span
          className={
            blocked
              ? 'text-warning-emphasis text-xs font-medium'
              : 'text-foreground-subtle text-xs tabular-nums'
          }
          aria-live="polite"
        >
          {blocked && hint ? hint : `${value.length}/${maxLength}`}
        </span>
        <button
          type="button"
          disabled={!canSubmit || submitting}
          onClick={onSubmit}
          className="bg-primary text-primary-foreground rounded-xs px-4 py-2 text-sm font-medium transition-colors hover:bg-primary-strong disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting ? '提交中…' : '提交'}
        </button>
      </div>
    </div>
  )
}

function rangeHint(control: {
  min?: number
  max?: number
  integer?: boolean
}): string | undefined {
  const { min, max } = control
  if (min !== undefined && max !== undefined) {
    return `请输入 ${min}–${max}${control.integer ? ' 的整数' : ''}`
  }
  if (min !== undefined) {
    return `不能小于 ${min}`
  }
  if (max !== undefined) {
    return `不能大于 ${max}`
  }
  return undefined
}

function ChoiceControl({
  options,
  allowCustom,
  multi,
  selected,
  custom,
  submitting,
  minSelections = 1,
  maxSelections = 1,
  onToggle,
  onCustomChange,
  onCustomSubmit,
  onFinish,
}: {
  options: Array<{
    value: string
    label: string
    description?: string
    recommended?: boolean
  }>
  allowCustom: boolean
  multi: boolean
  selected: string[]
  custom: string
  submitting: boolean
  minSelections?: number
  maxSelections?: number
  onToggle: (option: { value: string; label: string }) => void
  onCustomChange: (value: string) => void
  onCustomSubmit: () => void
  onFinish?: () => void
}) {
  const customUsed = custom.trim().length > 0
  const finished = multi && selected.length >= minSelections
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-2">
        {options.map((option) => {
          const active = selected.includes(option.value)
          return (
            <button
              key={option.value}
              type="button"
              disabled={submitting}
              onClick={() => onToggle(option)}
              aria-pressed={active}
              className={cx(
                'flex items-start justify-between gap-3 rounded-xs border px-3 py-3 text-left transition-colors',
                active
                  ? 'border-secondary-emphasis bg-secondary-subtle'
                  : 'border-border hover:border-border-strong'
              )}
            >
              <span className="min-w-0">
                <span className="text-foreground-strong block text-sm font-medium">
                  {option.label}
                  {option.recommended ? (
                    <span className="text-secondary-emphasis ml-2 text-xs font-normal">
                      推荐
                    </span>
                  ) : null}
                </span>
                {option.description ? (
                  <span className="text-foreground-muted mt-1 block text-xs leading-relaxed">
                    {option.description}
                  </span>
                ) : null}
              </span>
              <span
                className={cx(
                  'mt-1 flex size-4 shrink-0 items-center justify-center rounded-full border',
                  active
                    ? 'border-secondary-emphasis bg-secondary-emphasis'
                    : 'border-border-strong'
                )}
              >
                {active ? (
                  <span className="bg-primary-foreground size-2 rounded-full" />
                ) : null}
              </span>
            </button>
          )
        })}
      </div>

      {allowCustom ? (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={custom}
            disabled={submitting}
            onChange={(event) => onCustomChange(event.target.value)}
            placeholder="或者自己填写"
            className="border-border focus:border-secondary-emphasis text-foreground-strong w-full rounded-xs border bg-transparent px-3 py-2 text-sm outline-none transition-colors"
          />
          <button
            type="button"
            disabled={!customUsed || submitting}
            onClick={onCustomSubmit}
            className="bg-primary text-primary-foreground rounded-xs px-4 py-2 text-sm font-medium transition-colors hover:bg-primary-strong disabled:cursor-not-allowed disabled:opacity-40"
          >
            {multi ? '添加' : '提交'}
          </button>
        </div>
      ) : null}

      {multi ? (
        <div className="flex items-center justify-between gap-3">
          <span
            className={
              finished
                ? 'text-foreground-subtle text-xs tabular-nums'
                : 'text-warning-emphasis text-xs font-medium'
            }
            aria-live="polite"
          >
            {finished
              ? `已选 ${selected.length} / ${maxSelections}`
              : `至少选 ${minSelections} 项（已选 ${selected.length}）`}
          </span>
          <button
            type="button"
            disabled={!finished || submitting}
            onClick={onFinish}
            className="bg-primary text-primary-foreground rounded-xs px-4 py-2 text-sm font-medium transition-colors hover:bg-primary-strong disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? '提交中…' : '提交'}
          </button>
        </div>
      ) : null}
    </div>
  )
}
