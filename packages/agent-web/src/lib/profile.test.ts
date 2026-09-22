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

import { afterEach, describe, expect, it } from 'vitest'

import {
  clearLegacyResume,
  LEGACY_PROFILE_KEY,
  normalizeMaterials,
  normalizePreferences,
  normalizeProfile,
  readLegacyResume,
} from '@/lib/profile'

/** What this server offers, as `GET /v1/capabilities` would report it. */
const SUPPORTED = {
  formats: ['yaml', 'html', 'pdf'],
  styles: ['ats-compact', 'developer-two-column'],
}

afterEach(() => {
  localStorage.clear()
})

describe('normalizePreferences', () => {
  it('keeps only options this backend actually offers', () => {
    expect(
      normalizePreferences(
        {
          language: 'en',
          maxPages: 2,
          targetTitle: 'Agent 开发',
          formats: ['pdf', 'docx', 'yaml'],
          styles: ['ats-compact', 'modern-casual'],
        },
        SUPPORTED
      )
    ).toEqual({
      language: 'en',
      maxPages: 2,
      targetTitle: 'Agent 开发',
      // `docx` and `modern-casual` are gone: this server does not render them.
      formats: ['pdf', 'yaml'],
      styles: ['ats-compact'],
    })
  })

  it('reports no usable default when nothing survives the filter', () => {
    // The backend schema requires at least one style and one format, so an
    // empty list would be rejected at submit time. `null` means "no default".
    expect(
      normalizePreferences(
        { formats: ['docx'], styles: ['modern-casual'] },
        SUPPORTED
      )
    ).toBeNull()
    expect(normalizePreferences({}, SUPPORTED)).toBeNull()
    expect(normalizePreferences(null, SUPPORTED)).toBeNull()
    expect(normalizePreferences('nope', SUPPORTED)).toBeNull()
  })

  it('ignores a page count the schema does not allow', () => {
    expect(
      normalizePreferences(
        { maxPages: 3, formats: ['pdf'], styles: ['ats-compact'] },
        SUPPORTED
      )
    ).toEqual({ formats: ['pdf'], styles: ['ats-compact'] })
  })

  it('drops values that are present but empty', () => {
    expect(
      normalizePreferences(
        {
          language: '   ',
          targetTitle: '',
          formats: ['pdf'],
          styles: ['ats-compact'],
        },
        SUPPORTED
      )
    ).toEqual({ formats: ['pdf'], styles: ['ats-compact'] })
  })

  it('ignores non-string entries rather than failing the whole list', () => {
    expect(
      normalizePreferences(
        { formats: ['pdf', 7, null], styles: ['ats-compact'] },
        SUPPORTED
      )
    ).toEqual({ formats: ['pdf'], styles: ['ats-compact'] })
  })
})

describe('normalizeMaterials', () => {
  const text = {
    id: 'm1',
    kind: 'text',
    title: '项目说明',
    value: '用 FastAPI 实现了…',
    createdAt: '2026-09-16T12:00:00.000Z',
  }

  it('keeps renderable entries in order', () => {
    expect(normalizeMaterials([text])).toEqual([text])
  })

  it('drops entries that cannot be shown or edited', () => {
    expect(
      normalizeMaterials([
        text,
        7,
        null,
        { ...text, id: 'm2', kind: 'file' },
        { ...text, id: 'm3', value: undefined },
        'a string',
      ])
    ).toEqual([text])
  })

  it('falls back to the value when a title is missing', () => {
    // The title is display text; deriving a readable one loses nothing, while
    // an empty row in the list would look like a rendering bug.
    const [material] = normalizeMaterials([{ ...text, title: '  ' }])

    expect(material?.title).toBe('用 FastAPI 实现了…')
  })

  it('tolerates a missing createdAt', () => {
    const [material] = normalizeMaterials([{ ...text, createdAt: undefined }])

    expect(material?.createdAt).toBe('')
  })

  it('returns an empty list for anything that is not an array', () => {
    expect(normalizeMaterials(null)).toEqual([])
    expect(normalizeMaterials({})).toEqual([])
  })
})

describe('normalizeProfile', () => {
  it('narrows a loose server response into the editable draft', () => {
    expect(
      normalizeProfile(
        {
          resumeYaml: 'name: Ada',
          preferences: {
            formats: ['pdf', 'docx'],
            styles: ['ats-compact'],
          },
          materials: [
            {
              id: 'm1',
              kind: 'link',
              title: 'GitHub',
              value: 'https://github.com/example',
              createdAt: '2026-09-16T12:00:00.000Z',
            },
          ],
          createdAt: '2026-09-16T12:00:00.000Z',
          updatedAt: '2026-09-16T12:00:00.000Z',
        },
        SUPPORTED
      )
    ).toEqual({
      resumeYaml: 'name: Ada',
      preferences: { formats: ['pdf'], styles: ['ats-compact'] },
      materials: [
        {
          id: 'm1',
          kind: 'link',
          title: 'GitHub',
          value: 'https://github.com/example',
          createdAt: '2026-09-16T12:00:00.000Z',
        },
      ],
    })
  })

  it('degrades to an empty draft rather than throwing on junk', () => {
    expect(normalizeProfile({} as never, SUPPORTED)).toEqual({
      resumeYaml: '',
      preferences: null,
      materials: [],
    })
  })
})

describe('legacy resume in browser storage', () => {
  it('reads a non-blank legacy resume', () => {
    localStorage.setItem(LEGACY_PROFILE_KEY, 'basics:\n  name: Ada\n')

    expect(readLegacyResume()).toBe('basics:\n  name: Ada\n')
  })

  it('treats a blank or absent value as nothing to migrate', () => {
    localStorage.setItem(LEGACY_PROFILE_KEY, '   ')
    expect(readLegacyResume()).toBeNull()

    localStorage.removeItem(LEGACY_PROFILE_KEY)
    expect(readLegacyResume()).toBeNull()
  })

  it('clears the key once the data is safely stored server-side', () => {
    localStorage.setItem(LEGACY_PROFILE_KEY, 'basics:\n  name: Ada\n')

    clearLegacyResume()

    // Leaving it behind would keep a readable copy of the resume in a browser
    // shared by every account that ever used it.
    expect(localStorage.getItem(LEGACY_PROFILE_KEY)).toBeNull()
  })
})
