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

import { FileText, History } from 'lucide-react'

export interface RunHistoryItem {
  id: string
  title: string
  subtitle: string
}

export interface RunHistoryViewProps {
  runs: RunHistoryItem[]
  onOpenRun: (runId: string) => void
}

export function RunHistoryView({ runs, onOpenRun }: RunHistoryViewProps) {
  if (runs.length === 0) {
    return (
      <div className="mx-auto flex w-full max-w-[720px] flex-1 flex-col items-center justify-center px-6 py-10 text-center">
        <span className="bg-[var(--overlay-subtle)] text-foreground-muted mb-4 flex size-14 items-center justify-center rounded-full">
          <History size={26} />
        </span>
        <h1 className="text-foreground-strong text-xl font-semibold tracking-tight">
          还没有运行记录
        </h1>
        <p className="text-foreground mt-2 max-w-[420px] text-sm leading-relaxed">
          完成第一次简历定制后，运行会出现在这里。记录只保存在本机浏览器，
          后端重启不影响本地列表，但当时的运行本身会在内存里丢失。
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-[720px] px-8 pt-[10vh] pb-12">
      <h1 className="text-foreground-strong mb-6 text-[24px] font-semibold tracking-tight">
        运行记录
      </h1>
      <ul className="flex flex-col gap-3">
        {runs.map((run) => (
          <li key={run.id}>
            <button
              type="button"
              onClick={() => onOpenRun(run.id)}
              className="bg-background shadow-md hover:shadow-xl flex w-full items-center gap-4 rounded-md px-5 py-4 text-left transition-shadow"
            >
              <span className="bg-secondary-subtle text-secondary-emphasis flex size-10 shrink-0 items-center justify-center rounded-xs">
                <FileText size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="text-foreground-strong block truncate text-[15px] font-medium">
                  {run.title}
                </span>
                <span className="text-foreground-muted block truncate text-xs">
                  {run.subtitle}
                </span>
              </span>
              <span className="break-anywhere text-foreground-subtle text-xs">
                {run.id}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="text-foreground-subtle mt-6 text-xs leading-relaxed">
        列表只保存运行元数据；后端使用内存存储，重启后运行本身会丢失。
      </p>
    </div>
  )
}
