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

import { afterEach, describe, expect, it, vi } from 'vitest'

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
  configuredBaseUrl,
  LOCAL_DEV_AGENT_API_BASE_URL,
} from '@/lib/api/client'
import {
  clearLocalData,
  DRAFT_STORAGE_PREFIX,
  defaultSettings,
  loadSettings,
  normalizeBaseUrl,
  RUNS_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
  saveSettings,
} from '@/lib/settings'

describe('settings persistence', () => {
  it('returns defaults when nothing is stored', () => {
    store.clear()
    expect(loadSettings()).toEqual(defaultSettings())
  })

  it('round-trips a saved base url', () => {
    store.clear()
    saveSettings({ baseUrl: 'http://192.168.1.9:8787' })
    expect(loadSettings().baseUrl).toBe('http://192.168.1.9:8787')
  })

  it('falls back to the default when stored json is corrupt', () => {
    store.clear()
    store.set(SETTINGS_STORAGE_KEY, '{ not json')
    expect(loadSettings()).toEqual(defaultSettings())
  })

  it('ignores an empty stored base url', () => {
    store.clear()
    store.set(SETTINGS_STORAGE_KEY, JSON.stringify({ baseUrl: '   ' }))
    expect(loadSettings()).toEqual(defaultSettings())
  })

  it('migrates a development loopback address in production', () => {
    store.clear()
    vi.stubEnv('NODE_ENV', 'production')
    store.set(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ baseUrl: 'http://localhost:8787' })
    )

    expect(loadSettings().baseUrl).toBe('')
  })

  it('keeps an explicitly configured remote address in production', () => {
    store.clear()
    vi.stubEnv('NODE_ENV', 'production')
    store.set(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ baseUrl: 'https://api.example.com' })
    )

    expect(loadSettings().baseUrl).toBe('https://api.example.com')
  })
})

describe('normalizeBaseUrl', () => {
  it('strips trailing slashes', () => {
    expect(normalizeBaseUrl('http://localhost:8787///')).toBe(
      'http://localhost:8787'
    )
  })

  it('falls back to the default for empty input', () => {
    expect(normalizeBaseUrl('   ')).toBe(defaultSettings().baseUrl)
  })
})

describe('clearLocalData', () => {
  it('removes only Career Agent keys', () => {
    store.clear()
    store.set(SETTINGS_STORAGE_KEY, '{}')
    store.set(RUNS_STORAGE_KEY, '[]')
    store.set(`${DRAFT_STORAGE_PREFIX}abc`, 'draft')
    store.set('unrelated-app-key', 'keep me')

    clearLocalData()

    expect(store.has(SETTINGS_STORAGE_KEY)).toBe(false)
    expect(store.has(RUNS_STORAGE_KEY)).toBe(false)
    expect(store.has(`${DRAFT_STORAGE_PREFIX}abc`)).toBe(false)
    expect(store.get('unrelated-app-key')).toBe('keep me')
  })
})

describe('base URL resolution', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('talks to the same origin in a production build by default', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_AGENT_API_BASE_URL', '')

    // A deployment must not need anyone to type an address into a settings
    // dialog: relative URLs against whatever served the page.
    expect(configuredBaseUrl()).toBe('')
  })

  it('talks to the local API on its own port in development', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('NEXT_PUBLIC_AGENT_API_BASE_URL', '')

    expect(configuredBaseUrl()).toBe(LOCAL_DEV_AGENT_API_BASE_URL)
  })

  it('honours an explicitly configured address in any environment', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_AGENT_API_BASE_URL', 'https://api.example.com/')

    expect(configuredBaseUrl()).toBe('https://api.example.com')
  })

  it('keeps an empty value as "same origin" instead of defaulting to localhost', () => {
    expect(normalizeBaseUrl('')).toBe('')
    expect(normalizeBaseUrl('   ')).toBe('')
  })

  it('still trims a real address', () => {
    expect(normalizeBaseUrl('  https://api.example.com//  ')).toBe(
      'https://api.example.com'
    )
  })
})
