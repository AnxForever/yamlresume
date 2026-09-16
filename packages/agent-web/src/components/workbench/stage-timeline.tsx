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

import { Check, LoaderCircle } from 'lucide-react'
import { cx } from '@/lib/cx'
import type { StageProgress } from '@/lib/run/state'

export const STAGE_LABELS: Record<string, string> = {
  ingesting_inputs: '读取输入',
  normalizing_candidate: '归一化档案',
  analyzing_jd: '分析 JD',
  matching_evidence: '证据匹配',
  drafting: '生成草稿',
  validating: '校验',
  rendering: '渲染产物',
}

function formatDuration(durationMs: number | undefined): string {
  if (durationMs === undefined) {
    return ''
  }
  if (durationMs < 1000) {
    return `${Math.round(durationMs)}ms`
  }
  return `${(durationMs / 1000).toFixed(1)}s`
}

export interface StageTimelineProps {
  stages: StageProgress[]
  needsInput: boolean
}

export function StageTimeline({ stages, needsInput }: StageTimelineProps) {
  return (
    <ol className="flex flex-col gap-1">
      {stages.map((stage) => {
        const isRunning = stage.state === 'running'
        const isDone = stage.state === 'done'
        return (
          <li key={stage.stage}>
            <div
              className={cx(
                'flex items-center gap-3 rounded-xs px-3 py-2.5 text-sm transition-colors',
                isRunning
                  ? 'bg-secondary-subtle text-foreground-strong'
                  : isDone
                    ? 'text-foreground-strong'
                    : 'text-foreground-subtle'
              )}
              aria-current={isRunning ? 'step' : undefined}
            >
              <span
                className={cx(
                  'flex size-5 shrink-0 items-center justify-center rounded-full',
                  isDone
                    ? 'bg-success text-success-foreground'
                    : isRunning
                      ? 'bg-secondary-emphasis text-primary-foreground'
                      : 'bg-[rgba(26,26,25,0.08)] text-foreground-subtle'
                )}
              >
                {isDone ? (
                  <Check size={12} strokeWidth={3} />
                ) : isRunning ? (
                  <LoaderCircle
                    size={12}
                    className="animate-spin"
                    aria-hidden="true"
                  />
                ) : null}
              </span>
              <span className="min-w-0 flex-1">
                {STAGE_LABELS[stage.stage] ?? stage.stage}
              </span>
              {isDone && stage.durationMs !== undefined ? (
                <span className="text-foreground-subtle text-xs tabular-nums">
                  {formatDuration(stage.durationMs)}
                </span>
              ) : null}
            </div>
          </li>
        )
      })}
      {needsInput ? (
        <li>
          <div className="bg-warning-subtle text-warning-emphasis flex items-center gap-3 rounded-xs px-3 py-2.5 text-sm font-medium">
            <span className="bg-warning-emphasis size-2 rounded-full" />
            等待你的回答
          </div>
        </li>
      ) : null}
    </ol>
  )
}
