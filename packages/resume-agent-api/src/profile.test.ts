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

import { describe, expect, it } from 'vitest'

import {
  PROFILE_MATERIAL_LIMIT,
  ProfilePayloadSchema,
  parseStoredProfile,
  serializeProfile,
} from './profile'

const SUMMARY = {
  createdAt: '2026-09-16T12:00:00.000Z',
  updatedAt: '2026-09-17T09:30:00.000Z',
}

function link(value: string) {
  return {
    id: 'm1',
    kind: 'link' as const,
    title: 'GitHub',
    value,
    createdAt: '2026-09-16T12:00:00.000Z',
  }
}

/** The first issue's path, joined the way the HTTP layer reports it. */
function rejectionPath(payload: unknown): string | undefined {
  const parsed = ProfilePayloadSchema.safeParse(payload)
  if (parsed.success) throw new Error('Expected the payload to be rejected')
  return parsed.error.issues[0]?.path.join('.')
}

describe('ProfilePayloadSchema', () => {
  it('fills every unset field so a blank save is well-formed', () => {
    expect(ProfilePayloadSchema.parse({})).toEqual({
      resumeYaml: '',
      preferences: null,
      materials: [],
    })
  })

  it('accepts a fully specified profile unchanged', () => {
    const payload = ProfilePayloadSchema.parse({
      resumeYaml: 'basics:\n  name: Ada Lovelace\n',
      preferences: { styles: ['ats-compact'], formats: ['pdf'] },
      materials: [link('https://example.com/a')],
    })

    expect(payload.resumeYaml).toBe('basics:\n  name: Ada Lovelace\n')
    expect(payload.materials).toHaveLength(1)
  })

  it('refuses a link scheme that would become stored XSS once rendered', () => {
    // The profile page renders materials as anchors, so the scheme is a
    // security boundary, not a formatting preference.
    expect(rejectionPath({ materials: [link('javascript:alert(1)')] })).toBe(
      'materials.0.value'
    )
    expect(
      rejectionPath({ materials: [link('data:text/html,<script>')] })
    ).toBe('materials.0.value')
    expect(rejectionPath({ materials: [link('not a url')] })).toBe(
      'materials.0.value'
    )
  })

  it('accepts both HTTP and HTTPS links', () => {
    for (const value of [
      'https://example.com/a',
      'http://example.com/a?b=c#d',
    ]) {
      expect(
        ProfilePayloadSchema.safeParse({ materials: [link(value)] }).success
      ).toBe(true)
    }
  })

  it('caps link length separately from free text', () => {
    const longLink = `https://example.com/${'x'.repeat(600)}`
    expect(rejectionPath({ materials: [link(longLink)] })).toBe(
      'materials.0.value'
    )
  })

  it('caps the number of standing materials', () => {
    const materials = Array.from(
      { length: PROFILE_MATERIAL_LIMIT + 1 },
      (_, i) => link(`https://example.com/${i}`).valueOf()
    )
    expect(rejectionPath({ materials })).toBe('materials')
  })

  it('rejects preferences the backend would refuse on a run', () => {
    // A saved default is sent straight to `POST /v1/runs`, so an unknown style
    // must fail here rather than at submit time days later.
    expect(rejectionPath({ preferences: { styles: ['nope'] } })).toBe(
      'preferences.styles.0'
    )
  })

  it('rejects a mistyped field rather than coercing it', () => {
    expect(rejectionPath({ resumeYaml: 42 })).toBe('resumeYaml')
    expect(rejectionPath({ materials: 'not-an-array' })).toBe('materials')
  })
})

describe('parseStoredProfile', () => {
  it('round-trips what serializeProfile wrote', () => {
    const payload = ProfilePayloadSchema.parse({
      resumeYaml: 'name: Ada',
      materials: [link('https://example.com/a')],
    })

    expect(parseStoredProfile(serializeProfile(payload), SUMMARY)).toEqual({
      resumeYaml: 'name: Ada',
      preferences: null,
      materials: [link('https://example.com/a')],
      ...SUMMARY,
    })
  })

  it('keeps the timestamps when the payload cannot be parsed at all', () => {
    // Showing an empty profile is recoverable; showing an error over data the
    // user did write is not.
    expect(parseStoredProfile('{not json', SUMMARY)).toEqual({
      resumeYaml: '',
      preferences: null,
      materials: [],
      ...SUMMARY,
    })
    expect(parseStoredProfile('"a bare string"', SUMMARY)).toMatchObject(
      SUMMARY
    )
  })

  it('returns a shape an older build wrote instead of discarding it', () => {
    const stored = JSON.stringify({
      resumeYaml: 'name: Ada',
      preferences: { styles: ['ats-compact'] },
      materials: [link('https://example.com/a')],
    })

    expect(parseStoredProfile(stored, SUMMARY)).toMatchObject({
      resumeYaml: 'name: Ada',
      preferences: { styles: ['ats-compact'] },
      materials: [{ value: 'https://example.com/a' }],
    })
  })

  it('drops array entries that are not objects at all', () => {
    const stored = JSON.stringify({
      materials: [link('https://example.com/a'), 7, null, 'text'],
    })

    expect(parseStoredProfile(stored, SUMMARY).materials).toEqual([
      link('https://example.com/a'),
    ])
  })

  it('treats a null or array preferences field as unset', () => {
    expect(
      parseStoredProfile(JSON.stringify({ preferences: null }), SUMMARY)
        .preferences
    ).toBeNull()
    expect(
      parseStoredProfile(JSON.stringify({ preferences: [] }), SUMMARY)
        .preferences
    ).toBeNull()
  })
})
