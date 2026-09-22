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

import { TailorPreferencesSchema } from '@yamlresume/resume-agent'
import { z } from 'zod'

/**
 * The stored profile document.
 *
 * This is the contract the *write* path enforces. The read path deliberately
 * never rejects it (see `parseStoredProfile`): a profile that no longer matches
 * today's schema is still the user's own data, and refusing to return it would
 * look exactly like data loss.
 */

const MATERIAL_ID_MAX = 64
const MATERIAL_TITLE_MAX = 200
/** Long enough for a pasted project write-up, short enough to stay a memo. */
const MATERIAL_TEXT_MAX = 20_000
const MATERIAL_LINK_MAX = 500
/** Beyond this the profile stops being a profile and becomes a file store. */
export const PROFILE_MATERIAL_LIMIT = 50
/**
 * A resume is a few KB. The ceiling is generous but finite because the whole
 * document is encrypted into a single SQLite row.
 */
const PROFILE_RESUME_MAX = 200_000

/**
 * Only these two kinds persist. Uploaded files (PDF, DOCX) are *not* stored:
 * they arrive with each tailoring run instead. Promising to keep them and then
 * dropping them would be worse than saying so up front.
 */
export const PROFILE_MATERIAL_KINDS = ['text', 'link'] as const

export const ProfileMaterialSchema = z
  .object({
    id: z.string().min(1).max(MATERIAL_ID_MAX),
    kind: z.enum(PROFILE_MATERIAL_KINDS),
    title: z.string().min(1).max(MATERIAL_TITLE_MAX),
    value: z.string().min(1).max(MATERIAL_TEXT_MAX),
    createdAt: z.string().min(1).max(64),
  })
  .superRefine((material, context) => {
    if (material.kind !== 'link') {
      return
    }
    if (material.value.length > MATERIAL_LINK_MAX) {
      context.addIssue({
        code: 'custom',
        path: ['value'],
        message: `Link must be at most ${MATERIAL_LINK_MAX} characters`,
      })
      return
    }
    // The protocol check is not cosmetic: this value is rendered as an anchor
    // href on the profile page, so a stored `javascript:` URL would be stored
    // XSS. Rejecting it here means no client has to remember to.
    let url: URL
    try {
      url = new URL(material.value)
    } catch {
      context.addIssue({
        code: 'custom',
        path: ['value'],
        message: 'Link must be a valid URL',
      })
      return
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      context.addIssue({
        code: 'custom',
        path: ['value'],
        message: 'Link must use HTTP or HTTPS',
      })
    }
  })

export const ProfilePayloadSchema = z.object({
  resumeYaml: z.string().max(PROFILE_RESUME_MAX).default(''),
  /**
   * The same shape `POST /v1/runs` accepts, so a saved default can be sent as
   * a run's preferences without translation. `null` means "no default set".
   */
  preferences: TailorPreferencesSchema.nullable().default(null),
  materials: z
    .array(ProfileMaterialSchema)
    .max(PROFILE_MATERIAL_LIMIT)
    .default([]),
})

export type ProfilePayload = z.infer<typeof ProfilePayloadSchema>
export type ProfileMaterial = z.infer<typeof ProfileMaterialSchema>

export interface ProfileSummary {
  readonly createdAt: string
  readonly updatedAt: string
}

/**
 * What `GET /v1/profile` returns: the stored document plus when it was first
 * written and last replaced.
 *
 * `preferences` and `materials` are intentionally loose. A build always writes
 * the schema above, but it must be able to read a document an older build
 * wrote, and narrowing here would throw that data away on the way out.
 */
export interface ProfileResponse extends ProfileSummary {
  readonly resumeYaml: string
  readonly preferences: Record<string, unknown> | null
  readonly materials: Array<Record<string, unknown>>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function serializeProfile(payload: ProfilePayload): string {
  return JSON.stringify(payload)
}

/**
 * Read a stored document back. Never throws and never fails: an unreadable or
 * unrecognised payload degrades to empty fields while keeping the timestamps,
 * because showing "you have no profile" is recoverable and showing an error
 * over data the user did write is not.
 */
export function parseStoredProfile(
  payload: string,
  summary: ProfileSummary
): ProfileResponse {
  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    parsed = null
  }
  const record = isRecord(parsed) ? parsed : {}
  return {
    resumeYaml: typeof record.resumeYaml === 'string' ? record.resumeYaml : '',
    preferences: isRecord(record.preferences) ? record.preferences : null,
    materials: Array.isArray(record.materials)
      ? record.materials.filter(isRecord)
      : [],
    ...summary,
  }
}
