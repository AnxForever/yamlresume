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

import { describe, expect, it, vi } from 'vitest'

const store = new Map<string, string>()

vi.stubGlobal('localStorage', {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => {
    store.set(key, value)
  },
  removeItem: (key: string) => {
    store.delete(key)
  },
  key: (index: number) => [...store.keys()][index] ?? null,
  get length() {
    return store.size
  },
})

import {
  loadRunIndex,
  type RunIndexEntry,
  updateRunStatus,
  upsertRunIndexEntry,
} from '@/lib/runs-index'
import { RUNS_STORAGE_KEY } from '@/lib/settings'

function entry(
  id: string,
  overrides: Partial<RunIndexEntry> = {}
): RunIndexEntry {
  return {
    id,
    title: `Run ${id}`,
    createdAt: '2026-09-16T00:00:00.000Z',
    lastStatus: 'queued',
    ...overrides,
  }
}

describe('run index', () => {
  it('starts empty when nothing is stored', () => {
    store.clear()
    expect(loadRunIndex()).toEqual([])
  })

  it('returns an empty list for corrupt storage', () => {
    store.set(RUNS_STORAGE_KEY, '{ nope')
    expect(loadRunIndex()).toEqual([])
  })

  it('drops non-entry values from a stored array', () => {
    store.set(RUNS_STORAGE_KEY, JSON.stringify([42, 'x', entry('a')]))
    expect(loadRunIndex()).toEqual([entry('a')])
  })

  it('puts the newest run first and dedupes by id', () => {
    store.clear()
    const first = upsertRunIndexEntry(entry('a'))
    const second = upsertRunIndexEntry(
      entry('a', { lastStatus: 'completed' }),
      first
    )
    const third = upsertRunIndexEntry(entry('b'), second)

    expect(third.map((run) => run.id)).toEqual(['b', 'a'])
    expect(third[1]?.lastStatus).toBe('completed')
    expect(loadRunIndex()).toEqual(third)
  })

  it('updates a run status in place', () => {
    store.clear()
    const index = upsertRunIndexEntry(entry('a'))
    const updated = updateRunStatus('a', 'failed', index)

    expect(updated).toEqual([{ ...entry('a'), lastStatus: 'failed' }])
    expect(loadRunIndex()[0]?.lastStatus).toBe('failed')
  })

  it('leaves unknown run ids untouched', () => {
    store.clear()
    const index = upsertRunIndexEntry(entry('a'))
    expect(updateRunStatus('missing', 'failed', index)).toEqual(index)
  })
})
