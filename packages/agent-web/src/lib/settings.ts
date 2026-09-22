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

import { configuredBaseUrl } from '@/lib/api/client'

export interface AppSettings {
  baseUrl: string
}

export const SETTINGS_STORAGE_KEY = 'career-agent:settings:v1'
export const DRAFT_STORAGE_PREFIX = 'career-agent:draft:'
export const RUNS_STORAGE_KEY = 'career-agent:runs:v1'

export function defaultSettings(): AppSettings {
  // Empty means same-origin, which is the correct default for a deployment and
  // a perfectly usable one (relative URLs) anywhere the API is proxied.
  return { baseUrl: configuredBaseUrl() }
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
    const storedBaseUrl =
      typeof parsed.baseUrl === 'string' ? parsed.baseUrl.trim() : ''

    // A browser can retain the development setting (localhost:8787) when the
    // same profile later opens the deployed app. In production that points at
    // the viewer's machine and looks like a refresh-time backend disconnect.
    // Keep explicitly configured remote URLs, but migrate loopback addresses
    // back to the deployment's same-origin default.
    if (storedBaseUrl && process.env.NODE_ENV === 'production') {
      try {
        const hostname = new URL(storedBaseUrl).hostname
        if (
          hostname === 'localhost' ||
          hostname === '127.0.0.1' ||
          hostname === '::1'
        ) {
          return { baseUrl: configuredBaseUrl() }
        }
      } catch {
        // Invalid persisted values are handled by the default below.
      }
    }

    return { baseUrl: storedBaseUrl || configuredBaseUrl() }
  } catch {
    return defaultSettings()
  }
}

export function saveSettings(settings: AppSettings): void {
  safeSetItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings))
}

/**
 * Trailing slashes are dropped. An empty value is preserved as "same origin"
 * rather than being replaced by a localhost address that would be meaningless
 * on a server.
 */
export function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '')
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
