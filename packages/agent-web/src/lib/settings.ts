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

/**
 * Per-viewer settings, persisted in localStorage.
 *
 * Every access is wrapped: localStorage can throw (private windows, blocked
 * site data) or be absent (SSR), and the app must render correctly with
 * defaults in that case. Only lightweight preferences live here — never resume
 * or JD content.
 */

import { DEFAULT_AGENT_API_BASE_URL } from '@/lib/api/client'

export interface AppSettings {
  baseUrl: string
}

export const SETTINGS_STORAGE_KEY = 'career-agent:settings:v1'
export const DRAFT_STORAGE_PREFIX = 'career-agent:draft:'
export const RUNS_STORAGE_KEY = 'career-agent:runs:v1'

export function defaultSettings(): AppSettings {
  return { baseUrl: DEFAULT_AGENT_API_BASE_URL }
}

function safeGetItem(key: string): string | null {
  try {
    if (typeof localStorage === 'undefined') {
      return null
    }
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSetItem(key: string, value: string): void {
  try {
    localStorage?.setItem(key, value)
  } catch {
    // Ignore: a viewer with storage disabled still gets a working session,
    // just without persistence.
  }
}

export function loadSettings(): AppSettings {
  const raw = safeGetItem(SETTINGS_STORAGE_KEY)
  if (!raw) {
    return defaultSettings()
  }
  try {
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    return {
      baseUrl:
        typeof parsed.baseUrl === 'string' && parsed.baseUrl.trim().length > 0
          ? parsed.baseUrl.trim()
          : DEFAULT_AGENT_API_BASE_URL,
    }
  } catch {
    return defaultSettings()
  }
}

export function saveSettings(settings: AppSettings): void {
  safeSetItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings))
}

export function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '')
  return trimmed.length > 0 ? trimmed : DEFAULT_AGENT_API_BASE_URL
}

/**
 * Remove every Career Agent key from localStorage: settings, input drafts and
 * the local run index. Used by the "clear local data" control.
 */
export function clearLocalData(): void {
  try {
    if (typeof localStorage === 'undefined') {
      return
    }
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i)
      if (
        key &&
        (key === SETTINGS_STORAGE_KEY ||
          key === RUNS_STORAGE_KEY ||
          key.startsWith(DRAFT_STORAGE_PREFIX))
      ) {
        keys.push(key)
      }
    }
    for (const key of keys) {
      localStorage.removeItem(key)
    }
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}
