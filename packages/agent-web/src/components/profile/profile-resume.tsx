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

import { Button } from '@appica/ui-react/button'
import { Download, Upload } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  readResumeText,
  resumeReminders,
  summarizeResume,
} from '@/lib/resume-overview'

/** The shape of a parsed issue, from `@yamlresume/core`'s zod schema. */
interface SchemaIssue {
  path: PropertyKey[]
  message: string
}

interface ResumeSchema {
  safeParse: (value: unknown) => {
    success: boolean
    error?: { issues: SchemaIssue[] }
  }
}

export interface ProfileResumeProps {
  resumeYaml: string
  onChange: (value: string) => void
}

/** Text formats only — a PDF cannot be read back into the editor. */
const ACCEPTED_IMPORT = '.yml,.yaml,.md,.markdown,.txt,.json'

export function ProfileResume({ resumeYaml, onChange }: ProfileResumeProps) {
  const [mode, setMode] = useState<'overview' | 'edit'>('overview')
  const [schema, setSchema] = useState<ResumeSchema | null>(null)
  const [schemaUnavailable, setSchemaUnavailable] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const parsed = useMemo(() => readResumeText(resumeYaml), [resumeYaml])
  const overview = parsed.content ? summarizeResume(parsed.content) : null
  const hasSummary = useMemo(() => {
    const basics = parsed.content?.basics
    if (typeof basics !== 'object' || basics === null) {
      return false
    }
    const summary = (basics as Record<string, unknown>).summary
    return typeof summary === 'string' && summary.trim().length > 0
  }, [parsed.content])
  const reminders = useMemo(
    () =>
      parsed.content && overview
        ? resumeReminders(parsed.content, overview)
        : [],
    [parsed.content, overview]
  )

  /**
   * The real `ResumeSchema` is 74 KB gzipped, so it is fetched only once the
   * user actually opens the editor — the overview they land on is built from
   * the YAML parse alone. When the chunk cannot be fetched the editor still
   * works; it just cannot offer field-level schema errors, and says so rather
   * than pretending the document is clean.
   */
  useEffect(() => {
    if (mode !== 'edit' || schema || schemaUnavailable) {
      return undefined
    }
    let cancelled = false
    void import('@yamlresume/core/schema')
      .then((module) => {
        if (!cancelled) {
          setSchema(module.ResumeSchema as unknown as ResumeSchema)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSchemaUnavailable(true)
        }
      })
    return () => {
      cancelled = true
    }
  }, [mode, schema, schemaUnavailable])

  const schemaIssues = useMemo(() => {
    if (!schema || !parsed.document) {
      return []
    }
    const result = schema.safeParse(parsed.document)
    return result.success ? [] : (result.error?.issues ?? [])
  }, [schema, parsed.document])

  const yamlIssues = parsed.issues

  function handleImport(list: FileList | null) {
    const file = list?.[0]
    if (!file) {
      return
    }
    void file.text().then((text) => {
      onChange(text)
      setMode('edit')
    })
  }

  function handleExport() {
    const blob = new Blob([resumeYaml], { type: 'text/yaml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'resume.yml'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <section id="profile-resume" aria-labelledby="profile-resume-title">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2
          id="profile-resume-title"
          className="text-foreground-strong text-[17px] font-semibold tracking-tight"
        >
          基础简历
        </h2>
        <div className="flex items-center gap-1">
          <Button
            variant={mode === 'overview' ? 'secondary' : 'ghost'}
            size="sm"
            aria-pressed={mode === 'overview'}
            onClick={() => setMode('overview')}
          >
            概览
          </Button>
          <Button
            variant={mode === 'edit' ? 'secondary' : 'ghost'}
            size="sm"
            aria-pressed={mode === 'edit'}
            onClick={() => setMode('edit')}
          >
            编辑
          </Button>
        </div>
      </div>

      {mode === 'overview' ? (
        overview ? (
          <>
            <ResumeOverviewCard overview={overview} />
            {/* The point of the overview is not to show the user their own
                resume back, but to show what the Agent has to work with. */}
            <div className="bg-background shadow-md mt-3 rounded-md px-5 py-4">
              <p className="text-foreground-strong text-sm font-medium">
                Agent 能用上什么
              </p>
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
                {(
                  [
                    ['基本信息', overview.name.length > 0],
                    ['个人简介', hasSummary],
                    ['工作经历', overview.counts.work > 0],
                    ['项目', overview.counts.projects > 0],
                    ['教育', overview.counts.education > 0],
                    ['技能关键词', overview.keywords.length > 0],
                  ] as const
                ).map(([label, present]) => (
                  <li
                    key={label}
                    className={
                      present
                        ? 'text-foreground flex items-center gap-1.5 text-xs'
                        : 'text-foreground-subtle flex items-center gap-1.5 text-xs'
                    }
                  >
                    <span aria-hidden="true">{present ? '✓' : '○'}</span>
                    {label}
                  </li>
                ))}
              </ul>
              {reminders.length > 0 ? (
                <ul className="border-border mt-3 flex flex-col gap-2 border-t pt-3">
                  {reminders.map((reminder) => (
                    <li
                      key={reminder.path}
                      className="text-foreground-muted flex gap-2 text-xs leading-relaxed"
                    >
                      <span
                        className="text-foreground-subtle mt-1.5 size-1 shrink-0 rounded-full bg-current"
                        aria-hidden="true"
                      />
                      <span className="break-anywhere min-w-0">
                        {reminder.message}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-foreground-subtle border-border mt-3 border-t pt-3 text-xs leading-relaxed">
                  没有发现缺失的常用字段。
                </p>
              )}
            </div>
          </>
        ) : (
          <div className="bg-background shadow-md mt-3 rounded-md px-5 py-6">
            <p className="text-foreground-strong text-sm font-medium">
              {resumeYaml.trim().length === 0
                ? '还没有基础简历'
                : '这份内容不是 YAMLResume 文档'}
            </p>
            <p className="text-foreground-muted mt-2 text-sm leading-relaxed">
              {resumeYaml.trim().length === 0
                ? '粘贴或导入一份 YAMLResume，Agent 每次定制都会以它为证据来源。'
                : '纯文本也能保存，Agent 读得到；但没有结构化字段，下面这些提醒和统计就不会出现。'}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                size="sm"
                onClick={() => setMode('edit')}
              >
                {resumeYaml.trim().length === 0 ? '粘贴简历' : '去编辑'}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => fileInput.current?.click()}
              >
                导入文件
              </Button>
            </div>
          </div>
        )
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          <div className="bg-background shadow-md rounded-md px-5 py-4">
            <label
              htmlFor="profile-resume-text"
              className="text-foreground-muted text-xs font-medium"
            >
              YAMLResume 文档，或直接粘贴纯文本
            </label>
            <textarea
              id="profile-resume-text"
              value={resumeYaml}
              spellCheck={false}
              onChange={(event) => onChange(event.target.value)}
              rows={20}
              placeholder={'content:\n  basics:\n    name: 你的名字\n'}
              className="text-foreground-strong bg-background-muted mt-2 w-full resize-y rounded-xs px-3 py-3 font-mono text-[13px] leading-relaxed outline-none"
            />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => fileInput.current?.click()}
              >
                <Upload size={15} /> 导入文件
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={resumeYaml.trim().length === 0}
                onClick={handleExport}
              >
                <Download size={15} /> 导出 YAML
              </Button>
              <span className="text-foreground-subtle text-xs">
                {resumeYaml.length.toLocaleString('zh-CN')} 字符
              </span>
            </div>
          </div>

          {yamlIssues.length > 0 ? (
            <IssueList
              title="YAML 语法"
              issues={yamlIssues.map((issue) => ({
                key: `${issue.line}:${issue.column}:${issue.message}`,
                where:
                  issue.line === null
                    ? null
                    : `${issue.line}:${issue.column ?? 1}`,
                message: issue.message,
                severity: issue.severity,
              }))}
            />
          ) : null}

          {schemaIssues.length > 0 ? (
            <IssueList
              title="不符合 ResumeSchema"
              issues={schemaIssues.slice(0, 20).map((issue) => ({
                key: `${issue.path.join('.')}:${issue.message}`,
                where: issue.path.length > 0 ? issue.path.join('.') : null,
                message: issue.message,
                severity: 'error' as const,
              }))}
            />
          ) : null}

          {yamlIssues.length === 0 && schema && schemaIssues.length === 0 ? (
            <p className="text-foreground-muted text-xs leading-relaxed">
              通过 ResumeSchema 校验。
            </p>
          ) : null}

          {schemaUnavailable ? (
            <p className="text-foreground-subtle text-xs leading-relaxed">
              没能加载 Schema 校验模块，本次只做 YAML 语法检查。
            </p>
          ) : null}
        </div>
      )}

      <input
        ref={fileInput}
        type="file"
        accept={ACCEPTED_IMPORT}
        hidden
        onChange={(event) => {
          handleImport(event.target.files)
          event.target.value = ''
        }}
      />
    </section>
  )
}

function ResumeOverviewCard({
  overview,
}: {
  overview: ReturnType<typeof summarizeResume>
}) {
  return (
    <div className="bg-background shadow-md mt-3 rounded-md px-5 py-5">
      <p className="text-foreground-strong text-lg font-semibold">
        {overview.name || '（未填写姓名）'}
      </p>
      {overview.headline ? (
        <p className="text-foreground-muted mt-0.5 text-sm">
          {overview.headline}
        </p>
      ) : null}
      <p className="text-foreground-subtle mt-2 text-xs">
        {[overview.email, overview.location].filter(Boolean).join(' · ') ||
          '未填写联系方式'}
      </p>

      <dl className="border-border mt-4 grid grid-cols-2 gap-x-6 gap-y-3 border-t pt-4 sm:grid-cols-5">
        {(
          [
            ['工作经历', overview.counts.work],
            ['项目', overview.counts.projects],
            ['教育', overview.counts.education],
            ['技能', overview.counts.skills],
            ['获奖', overview.counts.awards],
          ] as const
        ).map(([label, count]) => (
          <div key={label}>
            <dt className="text-foreground-muted text-xs">{label}</dt>
            <dd className="text-foreground-strong mt-0.5 text-lg font-semibold tabular-nums">
              {count}
            </dd>
          </div>
        ))}
      </dl>

      {overview.latest ? (
        <p className="text-foreground mt-4 text-sm">
          <span className="text-foreground-muted">最近一段：</span>
          {overview.latest}
        </p>
      ) : null}

      {overview.keywords.length > 0 ? (
        <ul className="mt-4 flex flex-wrap gap-2">
          {overview.keywords.slice(0, 16).map((keyword) => (
            <li
              key={keyword}
              className="bg-secondary-subtle text-secondary-emphasis rounded-full px-2.5 py-1 text-xs"
            >
              {keyword}
            </li>
          ))}
          {overview.keywords.length > 16 ? (
            <li className="text-foreground-subtle px-1 py-1 text-xs">
              等 {overview.keywords.length} 个关键词
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  )
}

function IssueList({
  title,
  issues,
}: {
  title: string
  issues: Array<{
    key: string
    where: string | null
    message: string
    severity: 'error' | 'warning'
  }>
}) {
  return (
    <div className="bg-background shadow-md rounded-md px-5 py-4">
      <p className="text-foreground-strong text-sm font-medium">{title}</p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {issues.map((issue) => (
          <li key={issue.key} className="flex gap-3 text-xs leading-relaxed">
            <span
              className={
                issue.severity === 'error'
                  ? 'text-error-emphasis font-mono tabular-nums'
                  : 'text-foreground-subtle font-mono tabular-nums'
              }
            >
              {issue.where ?? '—'}
            </span>
            <span className="text-foreground break-anywhere min-w-0">
              {issue.message}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
