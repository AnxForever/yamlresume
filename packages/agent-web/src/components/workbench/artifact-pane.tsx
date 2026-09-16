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

import { Download, Eye, FileCode2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { OutputArtifact, RenderedVariant } from '@/lib/api/types'
import { cx } from '@/lib/cx'

const FORMAT_LABELS: Record<string, string> = {
  yaml: 'YAML',
  json: 'JSON',
  markdown: 'MD',
  html: 'HTML',
  latex: 'LaTeX',
  pdf: 'PDF',
  docx: 'DOCX',
  txt: 'TXT',
  rtf: 'RTF',
  odt: 'ODT',
}

export function downloadArtifact(artifact: OutputArtifact): void {
  const blob =
    artifact.encoding === 'base64'
      ? base64Blob(artifact.content, artifact.mediaType)
      : new Blob([artifact.content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = artifact.filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function base64Blob(content: string, mediaType: string): Blob {
  const binary = atob(content)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new Blob([bytes], { type: mediaType })
}

function htmlArtifact(variant: RenderedVariant): OutputArtifact | undefined {
  return variant.artifacts.find((artifact) => artifact.format === 'html')
}

function textArtifact(
  variant: RenderedVariant,
  format: string
): OutputArtifact | undefined {
  return variant.artifacts.find((artifact) => artifact.format === format)
}

export interface ArtifactPaneProps {
  variants: RenderedVariant[]
}

export function ArtifactPane({ variants }: ArtifactPaneProps) {
  const [styleIndex, setStyleIndex] = useState(0)
  const [view, setView] = useState<'preview' | 'source'>('preview')
  const variant = variants[Math.min(styleIndex, variants.length - 1)]

  const html = useMemo(
    () => (variant ? htmlArtifact(variant) : undefined),
    [variant]
  )

  if (!variant) {
    return (
      <div className="bg-background shadow-md rounded-md p-5">
        <p className="text-foreground-muted text-sm">
          渲染完成后产物会显示在这里。
        </p>
      </div>
    )
  }

  const failures = variant.failures
  const hasFailures = failures.length > 0

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="bg-background shadow-md rounded-md p-4">
        <div className="flex items-center justify-between gap-3">
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-foreground-muted text-xs">样式</span>
            <select
              value={styleIndex}
              onChange={(event) => setStyleIndex(Number(event.target.value))}
              className="bg-background text-foreground-strong w-full rounded-xs border-0 bg-[rgba(26,26,25,0.03)] px-2 py-2 text-sm outline-none"
            >
              {variants.map((entry, index) => (
                <option key={entry.style} value={index}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-1 rounded-full bg-[rgba(26,26,25,0.05)] p-1">
            <button
              type="button"
              onClick={() => setView('preview')}
              aria-pressed={view === 'preview'}
              className={cx(
                'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                view === 'preview'
                  ? 'bg-background text-foreground-strong shadow-md'
                  : 'text-foreground-muted'
              )}
            >
              <Eye size={14} />
              预览
            </button>
            <button
              type="button"
              onClick={() => setView('source')}
              aria-pressed={view === 'source'}
              className={cx(
                'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                view === 'source'
                  ? 'bg-background text-foreground-strong shadow-md'
                  : 'text-foreground-muted'
              )}
            >
              <FileCode2 size={14} />
              源码
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {variant.artifacts.map((artifact) => (
            <button
              key={`${artifact.format}-${artifact.style}`}
              type="button"
              onClick={() => downloadArtifact(artifact)}
              className="bg-secondary-subtle text-secondary-emphasis flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors hover:bg-secondary-soft"
            >
              <Download size={13} />
              {FORMAT_LABELS[artifact.format] ?? artifact.format}
            </button>
          ))}
          {variant.failures.map((failure) => (
            <span
              key={`${failure.format}-${failure.style}`}
              title={failure.message}
              className="bg-error-subtle text-error-emphasis flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium"
            >
              {FORMAT_LABELS[failure.format] ?? failure.format} 失败
            </span>
          ))}
        </div>

        {hasFailures ? (
          <p className="text-foreground-muted mt-2 text-xs leading-relaxed">
            有 {failures.length} 个格式渲染失败，其余产物不受影响，仍可下载。
          </p>
        ) : null}
      </div>

      <div className="bg-background shadow-md min-h-0 flex-1 overflow-hidden rounded-md">
        {view === 'preview' && html ? (
          <iframe
            title="简历预览"
            srcDoc={html.content}
            className="h-full w-full border-0"
            sandbox=""
          />
        ) : view === 'preview' ? (
          <div className="flex h-full items-center justify-center p-6">
            <p className="text-foreground-muted max-w-[280px] text-center text-sm leading-relaxed">
              这个样式没有 HTML 产物。可以下载 PDF 查看，或切到源码视图。
            </p>
          </div>
        ) : (
          <pre className="break-anywhere text-foreground-muted h-full overflow-auto p-4 font-mono text-xs leading-relaxed">
            {textArtifact(variant, 'yaml')?.content ??
              textArtifact(variant, 'markdown')?.content ??
              textArtifact(variant, 'latex')?.content ??
              '（这个样式没有可展示的文本源码）'}
          </pre>
        )}
      </div>

      {variant.template ? (
        <p className="text-foreground-subtle px-1 text-xs">
          LaTeX 模板：{variant.template}
        </p>
      ) : null}
    </div>
  )
}
