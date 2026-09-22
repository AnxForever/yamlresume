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
 * Client-side checks that mirror the backend Zod constraints closely enough
 * to disable the send button with a reason, before a round-trip.
 *
 * Limits that come from `GET /v1/capabilities` are passed in rather than
 * hard-coded, so a backend change does not require a frontend release.
 */

import { DRAFT_STORAGE_PREFIX } from '@/lib/settings'

export interface AttachedFile {
  id: string
  name: string
  size: number
  role: 'job' | 'candidate'
  file: File
}

export interface LauncherDraft {
  jobDescription: string
  candidateYaml: string
  files: AttachedFile[]
}

export interface DraftLimits {
  fileBytes: number
  jobFiles: number
  candidateFiles: number
}

export const DEFAULT_DRAFT_LIMITS: DraftLimits = {
  fileBytes: 12 * 1024 * 1024,
  jobFiles: 8,
  candidateFiles: 12,
}

export function submitBlockers(
  draft: LauncherDraft,
  limits: DraftLimits = DEFAULT_DRAFT_LIMITS
): string[] {
  const blockers: string[] = []
  const jobFiles = draft.files.filter((file) => file.role === 'job')
  const candidateFiles = draft.files.filter((file) => file.role === 'candidate')
  const hasJob = draft.jobDescription.trim().length >= 20 || jobFiles.length > 0
  const hasCandidate =
    draft.candidateYaml.trim().length > 0 || candidateFiles.length > 0

  if (!hasJob) {
    blockers.push('还需要岗位 JD（至少 20 个字符，或上传一份岗位文件）')
  }
  if (!hasCandidate) {
    blockers.push('还需要你的材料（YAML 文本或一份简历文件）')
  }
  if (jobFiles.length > limits.jobFiles) {
    blockers.push(`岗位文件最多 ${limits.jobFiles} 个`)
  }
  if (candidateFiles.length > limits.candidateFiles) {
    blockers.push(`候选人文件最多 ${limits.candidateFiles} 个`)
  }
  const oversized = draft.files.find((file) => file.size > limits.fileBytes)
  if (oversized) {
    blockers.push(`${oversized.name} 超过单文件大小限制`)
  }
  return blockers
}

/**
 * Persisted draft: the text the user typed, so a failed run, a reload, or the
 * "运行记录丢失" path does not force them to paste everything again.
 *
 * Files are deliberately NOT persisted — `File` objects cannot be serialized,
 * and silently keeping resume PDFs in browser storage is a privacy choice the
 * product has not made. Only the pasted text survives; the launcher tells the
 * user when attached files were dropped.
 */
export interface PersistedDraft {
  jobDescription: string
  candidateYaml: string
  presetId: string
}

export const DRAFT_STORAGE_KEY = `${DRAFT_STORAGE_PREFIX}current`
/**
 * The launcher's chosen scenario preset.
 *
 * It needs its own key: `saveDraft` deletes the record when both texts are
 * empty, so storing a selection inside it would mean a user who only picked a
 * preset silently lost it on the next reload.
 */
export const PRESET_STORAGE_KEY = `${DRAFT_STORAGE_PREFIX}preset`

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function loadDraft(): PersistedDraft | null {
  const store = storage()
  if (!store) {
    return null
  }
  try {
    const raw = store.getItem(DRAFT_STORAGE_KEY)
    if (!raw) {
      return null
    }
    const parsed = JSON.parse(raw) as Partial<PersistedDraft>
    if (
      typeof parsed.jobDescription !== 'string' ||
      typeof parsed.candidateYaml !== 'string'
    ) {
      return null
    }
    return {
      jobDescription: parsed.jobDescription,
      candidateYaml: parsed.candidateYaml,
      presetId: typeof parsed.presetId === 'string' ? parsed.presetId : '',
    }
  } catch {
    return null
  }
}

export function saveDraft(draft: PersistedDraft): void {
  const store = storage()
  if (!store) {
    return
  }
  try {
    const isEmpty =
      draft.jobDescription.trim().length === 0 &&
      draft.candidateYaml.trim().length === 0
    if (isEmpty) {
      store.removeItem(DRAFT_STORAGE_KEY)
      return
    }
    store.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft))
  } catch {
    // Storage-disabled viewers just lose the convenience, not the session.
  }
}

export function loadPresetId(): string {
  const store = storage()
  if (!store) {
    return ''
  }
  try {
    return store.getItem(PRESET_STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

export function savePresetId(presetId: string): void {
  const store = storage()
  if (!store) {
    return
  }
  try {
    if (presetId) {
      store.setItem(PRESET_STORAGE_KEY, presetId)
    } else {
      store.removeItem(PRESET_STORAGE_KEY)
    }
  } catch {
    // Storage-disabled viewers just lose the convenience, not the session.
  }
}
