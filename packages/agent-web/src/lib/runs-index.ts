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

import { RUNS_STORAGE_KEY } from '@/lib/settings'

/**
 * Local run index: only enough metadata to list and reopen runs.
 *
 * Deliberately NOT the run results — full resumes, evidence and artifacts live
 * on the backend snapshot, and are never persisted in the browser (the
 * in-memory `RunStore` already drops them on restart; the frontend must not
 * create its own result history behind the product's retention story).
 */
export interface RunIndexEntry {
  id: string
  title: string
  createdAt: string
  lastStatus: string
}

function safeGetItem(): string | null {
  try {
    if (typeof localStorage === 'undefined') {
      return null
    }
    return localStorage.getItem(RUNS_STORAGE_KEY)
  } catch {
    return null
  }
}

function safeSetItem(value: string): void {
  try {
    localStorage?.setItem(RUNS_STORAGE_KEY, value)
  } catch {
    // Storage-disabled viewers get an in-memory-only list.
  }
}

export function loadRunIndex(): RunIndexEntry[] {
  const raw = safeGetItem()
  if (!raw) {
    return []
  }
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed.filter(
      (entry): entry is RunIndexEntry =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as RunIndexEntry).id === 'string' &&
        typeof (entry as RunIndexEntry).createdAt === 'string'
    )
  } catch {
    return []
  }
}

export function upsertRunIndexEntry(
  entry: RunIndexEntry,
  existing: RunIndexEntry[] = loadRunIndex()
): RunIndexEntry[] {
  const next = [
    entry,
    ...existing.filter((current) => current.id !== entry.id),
  ].slice(0, 50)
  safeSetItem(JSON.stringify(next))
  return next
}

export function updateRunStatus(
  id: string,
  lastStatus: string,
  existing: RunIndexEntry[] = loadRunIndex()
): RunIndexEntry[] {
  const next = existing.map((entry) =>
    entry.id === id ? { ...entry, lastStatus } : entry
  )
  safeSetItem(JSON.stringify(next))
  return next
}
