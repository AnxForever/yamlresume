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

import type {
  OutputFormat,
  ProfileMaterial,
  ProfileResponse,
  StylePresetID,
  TailorPreferences,
} from '@/lib/api/types'

/**
 * Where the base resume lived before it had an account-scoped home.
 *
 * Kept only so the migration can find and clear it: this key is not
 * confidential storage, is not cleared by signing out, and is shared by every
 * account that ever used this browser.
 */
export const LEGACY_PROFILE_KEY = 'career-agent:profile-resume:v1'

/** The editable half of a profile; timestamps are tracked separately. */
export interface ProfileDraft {
  resumeYaml: string
  preferences: TailorPreferences | null
  materials: ProfileMaterial[]
}

export const EMPTY_PROFILE: ProfileDraft = {
  resumeYaml: '',
  preferences: null,
  materials: [],
}

/**
 * What this backend currently offers, taken from `GET /v1/capabilities`.
 *
 * Passed in rather than hard-coded: the capability endpoint is the single
 * source of truth for styles and formats, and a stale list here would either
 * hide options the backend supports or offer ones it rejects.
 */
export interface SupportedOptions {
  formats: readonly string[]
  styles: readonly string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : []
}

/**
 * Repair a stored preferences object against what this backend offers.
 *
 * The server returns stored preferences loosely on purpose — a document an
 * older build wrote must survive a round trip — so the narrowing happens here,
 * at the point where the values are about to be rendered or sent to a run.
 * Unknown options are dropped; if that leaves a field empty, the backend's own
 * schema requires at least one style and one format, so the honest answer is
 * "no usable default" rather than an empty list that would be rejected later.
 */
export function normalizePreferences(
  raw: unknown,
  supported: SupportedOptions
): TailorPreferences | null {
  if (!isRecord(raw)) {
    return null
  }
  const formatIds = new Set(supported.formats)
  const styleIds = new Set(supported.styles)
  const formats = stringArray(raw.formats).filter((format) =>
    formatIds.has(format)
  ) as OutputFormat[]
  const styles = stringArray(raw.styles).filter((style) =>
    styleIds.has(style)
  ) as StylePresetID[]
  if (formats.length === 0 || styles.length === 0) {
    return null
  }
  const preferences: TailorPreferences = { formats, styles }
  if (typeof raw.language === 'string' && raw.language.trim().length > 0) {
    preferences.language = raw.language
  }
  if (raw.maxPages === 1 || raw.maxPages === 2) {
    preferences.maxPages = raw.maxPages
  }
  if (
    typeof raw.targetTitle === 'string' &&
    raw.targetTitle.trim().length > 0
  ) {
    preferences.targetTitle = raw.targetTitle
  }
  return preferences
}

/**
 * Keep the materials that can actually be rendered.
 *
 * An entry without a value, or with a kind this build does not know, cannot be
 * shown or edited — keeping it would put an empty row in the list. A missing
 * title falls back to the value's opening words, because the title is display
 * text and inventing a readable one loses nothing.
 */
export function normalizeMaterials(raw: unknown): ProfileMaterial[] {
  if (!Array.isArray(raw)) {
    return []
  }
  const materials: ProfileMaterial[] = []
  for (const entry of raw) {
    if (!isRecord(entry)) {
      continue
    }
    const { id, kind, title, value, createdAt } = entry
    if (typeof id !== 'string' || typeof value !== 'string') {
      continue
    }
    if (kind !== 'text' && kind !== 'link') {
      continue
    }
    materials.push({
      id,
      kind,
      title:
        typeof title === 'string' && title.trim().length > 0
          ? title
          : value.slice(0, 60),
      value,
      createdAt: typeof createdAt === 'string' ? createdAt : '',
    })
  }
  return materials
}

export function normalizeProfile(
  raw: ProfileResponse,
  supported: SupportedOptions
): ProfileDraft {
  return {
    resumeYaml: typeof raw.resumeYaml === 'string' ? raw.resumeYaml : '',
    preferences: normalizePreferences(raw.preferences, supported),
    materials: normalizeMaterials(raw.materials),
  }
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** The resume stranded in browser storage by the pre-account build, if any. */
export function readLegacyResume(): string | null {
  const store = storage()
  if (!store) {
    return null
  }
  try {
    const value = store.getItem(LEGACY_PROFILE_KEY)
    return value && value.trim().length > 0 ? value : null
  } catch {
    return null
  }
}

/**
 * Remove the legacy key once its contents are safely stored server-side — or
 * once the user declines to migrate them. Leaving it behind would keep a
 * readable copy of the user's resume in a browser shared by every account.
 */
export function clearLegacyResume(): void {
  const store = storage()
  if (!store) {
    return
  }
  try {
    store.removeItem(LEGACY_PROFILE_KEY)
  } catch {
    // Storage-disabled viewers have nothing to clear.
  }
}
