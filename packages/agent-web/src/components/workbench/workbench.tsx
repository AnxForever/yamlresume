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

import { ArrowLeft, Gauge } from 'lucide-react'
import { useState } from 'react'
import { StatusBadge } from '@/components/ui/status-badge'
import { ArtifactPane } from '@/components/workbench/artifact-pane'
import {
  type AnswerPayload,
  InteractionCard,
} from '@/components/workbench/interaction-card'
import {
  DiffPanel,
  JobSpecPanel,
  MatchPanel,
  QualityPanel,
  StageSkeleton,
} from '@/components/workbench/stage-panels'
import {
  STAGE_LABELS,
  StageTimeline,
} from '@/components/workbench/stage-timeline'
import { useRunStream } from '@/components/workbench/use-run-stream'
import type { AgentApiClient } from '@/lib/api/client'

const STATUS_META: Record<
  string,
  { label: string; tone: 'accent' | 'done' | 'warn' | 'fail' | 'mute' }
> = {
  idle: { label: '等待中', tone: 'mute' },
  running: { label: '运行中', tone: 'accent' },
  needs_input: { label: '等待回答', tone: 'warn' },
  completed: { label: '已完成', tone: 'done' },
  failed: { label: '失败', tone: 'fail' },
  lost: { label: '记录丢失', tone: 'fail' },
}

export interface WorkbenchViewProps {
  runId: string
  client: AgentApiClient
  onBack: () => void
  /** Escape hatch when a question cannot be answered here. */
  onStartNew: () => void
}

export function WorkbenchView({
  runId,
  client,
  onBack,
  onStartNew,
}: WorkbenchViewProps) {
  const { state, stop } = useRunStream(runId, client)
  const [telemetryOpen, setTelemetryOpen] = useState(false)
  const [answerSubmitting, setAnswerSubmitting] = useState(false)
  const [answerError, setAnswerError] = useState<string | null>(null)

  const statusMeta = STATUS_META[state.status] ?? STATUS_META.idle
  const runningStage = state.stages.find((stage) => stage.state === 'running')
  const pending = state.pendingInteractions[0]
  const result = state.result

  async function handleAnswer(payload: AnswerPayload) {
    setAnswerSubmitting(true)
    setAnswerError(null)
    const response = await client.answerRun(runId, payload)
    if (response.kind === 'error') {
      setAnswerError(
        response.error.code === 'stale_interaction'
          ? '这个问题已经过期，正在刷新最新状态…'
          : response.error.code === 'idempotency_conflict'
            ? '这个回答的幂等键已用于其他内容，请重新提交。'
            : `回答失败：${response.error.message}`
      )
    }
    setAnswerSubmitting(false)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-border border-b px-6 py-4">
        <button
          type="button"
          onClick={onBack}
          aria-label="返回运行记录"
          className="text-foreground-muted hover:text-foreground-strong hover:bg-[rgba(26,26,25,0.04)] flex size-8 items-center justify-center rounded-full transition-colors"
        >
          <ArrowLeft size={17} />
        </button>
        <h1 className="text-foreground-strong min-w-0 flex-1 truncate text-[15px] font-semibold">
          运行{' '}
          <span className="text-foreground-muted font-normal">{runId}</span>
        </h1>
        <StatusBadge tone={statusMeta.tone} dot>
          {statusMeta.label}
        </StatusBadge>
        <button
          type="button"
          onClick={() => setTelemetryOpen((open) => !open)}
          aria-expanded={telemetryOpen}
          aria-label="遥测"
          className="text-foreground-muted hover:text-foreground-strong hover:bg-[rgba(26,26,25,0.04)] flex size-8 items-center justify-center rounded-full transition-colors"
        >
          <Gauge size={17} />
        </button>
      </header>

      {/* Stage changes are announced for assistive tech; never rely on color
          or a spinner alone. */}
      <p aria-live="polite" className="sr-only">
        {state.status === 'needs_input'
          ? '运行暂停，等待你的回答'
          : runningStage
            ? `正在${STAGE_LABELS[runningStage.stage] ?? '执行'}`
            : state.status === 'completed'
              ? '运行完成'
              : state.status === 'failed'
                ? '运行失败'
                : state.status === 'lost'
                  ? '运行记录已丢失'
                  : ''}
      </p>

      {telemetryOpen ? (
        <div className="border-border bg-background border-b px-6 py-4">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {(
              [
                ['模型调用', String(state.telemetry.modelCalls)],
                ['Repair', String(state.telemetry.repairAttempts)],
                ['传输重试', String(state.telemetry.transportAttempts)],
                [
                  '输入 token',
                  state.telemetry.inputTokens?.toLocaleString() ?? '—',
                ],
                [
                  '输出 token',
                  state.telemetry.outputTokens?.toLocaleString() ?? '—',
                ],
              ] as const
            ).map(([label, value]) => (
              <div key={label}>
                <dt className="text-foreground-muted text-xs">{label}</dt>
                <dd className="text-foreground-strong mt-0.5 font-mono text-sm tabular-nums">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
          <p className="text-foreground-subtle mt-3 text-xs leading-relaxed">
            遥测只包含调用次数、token 与耗时等安全聚合，不含
            JD、简历或模型原文。
          </p>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 gap-4 px-4 py-4">
        <aside className="w-[200px] shrink-0">
          <StageTimeline
            stages={state.stages}
            needsInput={state.status === 'needs_input'}
          />
        </aside>

        <section className="min-w-0 flex-1 overflow-y-auto">
          <div className="flex flex-col gap-4">
            {pending ? (
              // `key` is load-bearing: without it React reuses the same
              // InteractionCard instance for the next question, so the answer
              // text, the multi-select state, and — worst — the idempotency
              // key from the previous question all survive into the new one.
              // The backend then sees an old key with new content and answers
              // 409 forever.
              <InteractionCard
                key={pending.id}
                request={pending}
                submitting={answerSubmitting}
                answerError={answerError}
                onSubmit={handleAnswer}
                onStartNew={onStartNew}
              />
            ) : null}

            {state.status === 'lost' ? (
              <div className="bg-background shadow-md rounded-md p-6">
                <h2 className="text-foreground-strong text-[15px] font-semibold">
                  服务已重启，运行记录丢失
                </h2>
                <p className="text-foreground-muted mt-2 text-sm leading-relaxed">
                  后端使用内存存储，重启后运行本身会丢失。你输入的文本已经保留下来了
                  ——
                  回到新建页就能看到，重新发起即可（带过的文件需要重新添加）。
                </p>
                <button
                  type="button"
                  onClick={onStartNew}
                  className="bg-primary text-primary-foreground mt-4 rounded-xs px-4 py-2 text-sm font-medium transition-colors hover:bg-primary-strong"
                >
                  用保留的内容重新发起
                </button>
              </div>
            ) : null}

            {state.status === 'failed' ? (
              <div
                role="alert"
                className="bg-background shadow-md rounded-md p-6"
              >
                <h2 className="text-foreground-strong text-[15px] font-semibold">
                  运行失败
                </h2>
                {state.error ? (
                  <p className="text-foreground-muted mt-2 text-sm leading-relaxed">
                    <code className="text-error-emphasis font-mono text-xs">
                      {state.error.code}
                    </code>
                    {'　'}
                    {state.error.message}
                  </p>
                ) : null}
                <p className="text-foreground-muted mt-3 text-xs leading-relaxed">
                  模型偶尔会产出不符合约定的结构，重跑一次通常就能通过。输入内容已经保留。
                </p>
                <button
                  type="button"
                  onClick={onStartNew}
                  className="bg-primary text-primary-foreground mt-4 rounded-xs px-4 py-2 text-sm font-medium transition-colors hover:bg-primary-strong"
                >
                  用同一份材料重试
                </button>
              </div>
            ) : null}

            {result ? (
              <>
                <JobSpecPanel jobSpec={result.jobSpec} />
                <MatchPanel match={result.matchReport} />
                <DiffPanel diff={result.diff} />
                <QualityPanel quality={result.quality} />
              </>
            ) : (
              <StageSkeleton
                label={
                  state.status === 'needs_input'
                    ? '回答后继续执行'
                    : runningStage
                      ? (STAGE_LABELS[runningStage.stage] ?? '执行中')
                      : state.status === 'running'
                        ? '等待后端开始'
                        : '暂无内容'
                }
              />
            )}

            {stop?.reason === 'unreachable' ? (
              <div
                role="alert"
                className="bg-background shadow-md rounded-md p-6"
              >
                <h2 className="text-foreground-strong text-[15px] font-semibold">
                  与后端的连接已断开
                </h2>
                <p className="text-foreground-muted mt-2 text-sm leading-relaxed">
                  运行可能仍在后端执行，只是当前无法查询。刷新页面可以重新连接。
                </p>
              </div>
            ) : null}
          </div>
        </section>

        <aside className="flex w-[340px] shrink-0 flex-col overflow-y-auto">
          <ArtifactPane variants={result?.variants ?? []} />
        </aside>
      </div>
    </div>
  )
}
