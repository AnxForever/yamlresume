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

export interface ResumeSectionIdentity {
  keys: string[]
  factKeys: string[]
}

export const RESUME_SECTION_IDENTITIES: Record<string, ResumeSectionIdentity> =
  {
    awards: { keys: ['title', 'awarder'], factKeys: ['date'] },
    certificates: { keys: ['name', 'issuer'], factKeys: ['date'] },
    education: {
      keys: ['institution'],
      factKeys: ['startDate', 'endDate', 'degree', 'area'],
    },
    interests: { keys: ['name'], factKeys: [] },
    languages: { keys: ['language'], factKeys: ['fluency'] },
    profiles: { keys: ['network', 'username'], factKeys: ['url'] },
    projects: { keys: ['name'], factKeys: ['startDate', 'endDate'] },
    publications: { keys: ['name', 'publisher'], factKeys: ['releaseDate'] },
    references: {
      keys: ['name'],
      factKeys: ['relationship', 'email', 'phone'],
    },
    skills: { keys: ['name'], factKeys: ['level'] },
    volunteer: {
      keys: ['organization', 'position'],
      factKeys: ['startDate', 'endDate'],
    },
    work: { keys: ['name', 'position'], factKeys: ['startDate', 'endDate'] },
  }

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

export function asRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value
        .map(asRecord)
        .filter((item): item is Record<string, unknown> => item !== undefined)
    : []
}

export function getResumeEntryIdentity(
  item: Record<string, unknown>,
  keys: string[]
): string | undefined {
  const values = keys
    .map((key) => item[key])
    .filter(
      (value): value is string =>
        typeof value === 'string' && value.trim().length > 0
    )
  return values.length === keys.length ? values.join(' · ') : undefined
}
