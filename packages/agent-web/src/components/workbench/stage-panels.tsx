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

import { StatusBadge } from '@/components/ui/status-badge'
import type {
  JobSpec,
  MatchReport,
  QualityReport,
  ResumeDiff,
} from '@/lib/api/types'
import { cx } from '@/lib/cx'

function Section({
  title,
  children,
  aside,
}: {
  title: string
  children: React.ReactNode
  aside?: React.ReactNode
}) {
  return (
    <section className="bg-background shadow-md rounded-md p-5">
      <header className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-foreground-strong text-[15px] font-semibold">
          {title}
        </h2>
        {aside}
      </header>
      {children}
    </section>
  )
}

export function JobSpecPanel({ jobSpec }: { jobSpec: JobSpec }) {
  return (
    <Section
      title="岗位分析"
      aside={
        <span className="text-foreground-subtle text-xs">
          {jobSpec.seniority}
        </span>
      }
    >
      <p className="text-foreground-strong text-base font-medium">
        {jobSpec.targetTitle}
        {jobSpec.company ? (
          <span className="text-foreground-muted font-normal">
            {' '}
            · {jobSpec.company}
          </span>
        ) : null}
      </p>
      <p className="text-foreground mt-2 text-sm leading-relaxed">
        {jobSpec.summary}
      </p>
      {jobSpec.requirements.length > 0 ? (
        <ul className="mt-4 flex flex-col gap-2">
          {jobSpec.requirements.map((requirement) => (
            <li key={requirement.id} className="flex gap-2 text-sm">
              <StatusBadge
                tone={
                  requirement.importance === 'must-have' ? 'accent' : 'mute'
                }
                className="shrink-0"
              >
                {requirement.importance === 'must-have' ? '必须' : '加分'}
              </StatusBadge>
              <span className="text-foreground leading-relaxed">
                {requirement.text}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {jobSpec.keywords.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {jobSpec.keywords.map((keyword) => (
            <span
              key={keyword}
              className="bg-[rgba(26,26,25,0.05)] text-foreground-muted rounded-full px-2.5 py-1 text-xs"
            >
              {keyword}
            </span>
          ))}
        </div>
      ) : null}
    </Section>
  )
}

const MATCH_STATUS_META = {
  matched: { label: '已匹配', tone: 'done' },
  partial: { label: '部分匹配', tone: 'warn' },
  missing: { label: '缺失', tone: 'fail' },
} as const

export function MatchPanel({ match }: { match: MatchReport }) {
  const items = [...match.matchedRequirements, ...match.missingRequirements]
  return (
    <Section
      title="需求 → 证据映射"
      aside={
        <span className="text-foreground-muted text-sm tabular-nums">
          评分 {match.score}
        </span>
      }
    >
      {items.length === 0 ? (
        <p className="text-foreground-muted text-sm">暂无匹配结果。</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => {
            const meta = MATCH_STATUS_META[item.status]
            return (
              <li key={item.requirementId} className="flex flex-col gap-1.5">
                <div className="flex items-start justify-between gap-3">
                  <span className="text-foreground-strong text-sm leading-relaxed">
                    {item.requirement}
                  </span>
                  <StatusBadge tone={meta.tone as 'done'} className="shrink-0">
                    {meta.label}
                  </StatusBadge>
                </div>
                {item.evidenceIds.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {item.evidenceIds.map((evidenceId) => (
                      <code
                        key={evidenceId}
                        className="break-anywhere bg-[rgba(26,26,25,0.04)] text-foreground-muted rounded-xs px-1.5 py-0.5 font-mono text-[11px]"
                      >
                        {evidenceId}
                      </code>
                    ))}
                  </div>
                ) : null}
                {item.rationale ? (
                  <p className="text-foreground-muted text-xs leading-relaxed">
                    {item.rationale}
                  </p>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </Section>
  )
}

const DIFF_SYMBOLS: Record<string, string> = {
  added: '+',
  removed: '−',
  changed: '~',
  reordered: '↕',
}

/** Spoken form of each change type, for the screen-reader-only prefix. */
const DIFF_LABELS: Record<string, string> = {
  added: '新增',
  removed: '删除',
  changed: '修改',
  reordered: '移动',
}

const DIFF_TONES = {
  added: 'text-success-emphasis',
  removed: 'text-error-emphasis',
  changed: 'text-warning-emphasis',
  reordered: 'text-secondary-emphasis',
} as const

export function DiffPanel({ diff }: { diff: ResumeDiff }) {
  return (
    <Section
      title="源简历 → 定制简历"
      aside={
        <span className="text-foreground-muted text-xs tabular-nums">
          {Object.entries(diff.counts)
            .filter(([, count]) => count > 0)
            .map(([type, count]) => `${DIFF_SYMBOLS[type]}${count}`)
            .join(' ')}
        </span>
      }
    >
      {diff.changes.length === 0 ? (
        <p className="text-foreground-muted text-sm">
          与源简历一致，没有变更。
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {diff.changes.map((change, index) => (
            // Type + path + position: same-path changes (e.g. multiple edits
            // in one section) still need distinct list keys.
            <li
              key={`${change.type}:${change.path}:${index}`}
              className="flex flex-col gap-1"
            >
              <div className="flex items-start gap-2">
                <span
                  className={cx(
                    'w-5 shrink-0 text-center font-mono text-sm font-semibold',
                    DIFF_TONES[change.type]
                  )}
                  aria-hidden="true"
                >
                  {DIFF_SYMBOLS[change.type]}
                </span>
                {/* The glyph and its color are the only visible signal for the
                    change type, so the meaning is spelled out for screen
                    readers instead of being conveyed by color alone. */}
                <span className="sr-only">{DIFF_LABELS[change.type]}：</span>
                <span className="min-w-0 flex-1">
                  <code className="text-foreground-muted break-anywhere text-xs">
                    {change.section} · {change.path}
                  </code>
                  {change.type === 'changed' &&
                  change.before !== undefined &&
                  change.after !== undefined ? (
                    <span className="text-foreground mt-1 block text-xs leading-relaxed">
                      <span className="text-error-emphasis line-through decoration-[1.5px]">
                        {String(change.before)}
                      </span>
                      <span className="text-success-emphasis">
                        {' '}
                        → {String(change.after)}
                      </span>
                    </span>
                  ) : null}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

function coverageLabel(value: number): string {
  return `${Math.round(value * 100)}%`
}

export function QualityPanel({ quality }: { quality: QualityReport }) {
  return (
    <Section title="质量报告">
      <dl className="grid grid-cols-3 gap-3">
        {(
          [
            ['必须项覆盖', quality.mustHaveCoverage],
            ['需求覆盖', quality.requirementCoverage],
            ['关键词覆盖', quality.keywordCoverage],
          ] as const
        ).map(([label, value]) => (
          <div
            key={label}
            className="bg-[rgba(26,26,25,0.03)] rounded-xs px-3 py-2.5"
          >
            <dt className="text-foreground-muted text-xs">{label}</dt>
            <dd className="text-foreground-strong mt-0.5 text-lg font-semibold tabular-nums">
              {coverageLabel(value)}
            </dd>
          </div>
        ))}
      </dl>

      {quality.missingMustHave.length > 0 ? (
        <div className="mt-4">
          <p className="text-foreground-muted text-xs font-medium">
            缺失的必须项
          </p>
          <ul className="mt-1.5 flex flex-col gap-1">
            {quality.missingMustHave.map((item) => (
              <li key={item} className="text-error-emphasis text-sm">
                {item}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {quality.missingKeywords.length > 0 ? (
        <div className="mt-4">
          <p className="text-foreground-muted text-xs font-medium">
            缺失关键词
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {quality.missingKeywords.map((keyword) => (
              <span
                key={keyword}
                className="bg-warning-subtle text-warning-emphasis rounded-full px-2.5 py-1 text-xs"
              >
                {keyword}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {quality.warnings.length > 0 ? (
        <ul className="mt-4 flex flex-col gap-1.5">
          {quality.warnings.map((warning) => (
            <li
              key={warning.code}
              className="flex items-start gap-2 text-xs leading-relaxed"
            >
              <StatusBadge
                tone={warning.severity === 'warning' ? 'warn' : 'mute'}
                className="shrink-0"
              >
                {warning.severity}
              </StatusBadge>
              <span className="text-foreground-muted">{warning.message}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </Section>
  )
}

export function StageSkeleton({ label }: { label: string }) {
  return (
    <div className="bg-background shadow-md rounded-md p-5" aria-hidden="true">
      <p className="text-foreground-strong mb-4 text-[15px] font-semibold">
        {label}
      </p>
      <div className="flex flex-col gap-2">
        {[0.9, 0.7, 0.8, 0.5].map((width) => (
          <div
            key={width}
            className="bg-[rgba(26,26,25,0.05)] animate-pulse rounded-full"
            style={{ height: 12, width: `${Math.round(width * 100)}%` }}
          />
        ))}
      </div>
    </div>
  )
}
