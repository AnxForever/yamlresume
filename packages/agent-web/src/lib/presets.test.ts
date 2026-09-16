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
  availablePresets,
  describePreferences,
  findPreset,
  presetsByCategory,
  presetsSupportedBy,
  SCENARIO_PRESETS,
} from '@/lib/presets'

describe('SCENARIO_PRESETS', () => {
  it('only uses backend-supported styles and formats', () => {
    const styles = new Set([
      'ats-compact',
      'modern-professional',
      'modern-classic',
      'modern-casual',
      'developer-two-column',
    ])
    const formats = new Set([
      'yaml',
      'json',
      'markdown',
      'html',
      'latex',
      'pdf',
      'docx',
    ])

    for (const preset of SCENARIO_PRESETS) {
      expect(preset.preferences.styles.length).toBeGreaterThan(0)
      expect(preset.preferences.formats.length).toBeGreaterThan(0)
      for (const style of preset.preferences.styles) {
        expect(styles.has(style)).toBe(true)
      }
      for (const format of preset.preferences.formats) {
        expect(formats.has(format)).toBe(true)
      }
    }
  })

  it('marks exactly one featured preset', () => {
    expect(SCENARIO_PRESETS.filter((preset) => preset.featured)).toHaveLength(1)
  })
})

describe('presetsByCategory', () => {
  it('returns every recommended preset', () => {
    const recommended = presetsByCategory('recommended')
    expect(recommended.length).toBeGreaterThan(0)
    expect(
      recommended.every((preset) => preset.categories.includes('recommended'))
    ).toBe(true)
  })
})

describe('findPreset', () => {
  it('finds a preset by id and returns undefined otherwise', () => {
    expect(findPreset('ats-one-page')?.title).toBe('一页 ATS 友好简历')
    expect(findPreset('does-not-exist')).toBeUndefined()
  })
})

describe('describePreferences', () => {
  it('summarises styles, pages, language and formats', () => {
    expect(
      describePreferences({
        language: 'en',
        maxPages: 1,
        styles: ['ats-compact'],
        formats: ['yaml', 'html', 'pdf'],
      })
    ).toBe('1 种样式 · 1 页 · 英文 · yaml · html · pdf')
  })
})

describe('capability-driven preset selection', () => {
  const caps = {
    output: {
      formats: ['yaml', 'json', 'markdown', 'html', 'latex', 'pdf', 'docx'],
      styles: [
        { id: 'ats-compact' },
        { id: 'modern-professional' },
        { id: 'modern-classic' },
        { id: 'modern-casual' },
        { id: 'developer-two-column' },
      ],
    },
  }

  it('keeps every preset when the backend supports all shipped options', () => {
    expect(presetsSupportedBy(caps).length).toBe(SCENARIO_PRESETS.length)
  })

  it('drops presets whose formats are unsupported', () => {
    const reduced = {
      output: { ...caps.output, formats: ['html', 'pdf'] },
    }
    const supported = presetsSupportedBy(reduced)
    // Only the two presets whose formats are a subset of {html, pdf} survive.
    expect(supported.map((preset) => preset.id).sort()).toEqual([
      'compare-styles',
      'creative-casual',
    ])
    expect(
      supported.every((preset) =>
        preset.preferences.formats.every(
          (format) => format === 'html' || format === 'pdf'
        )
      )
    ).toBe(true)
  })

  it('drops presets whose styles are unsupported', () => {
    const reduced = {
      output: {
        formats: caps.output.formats,
        styles: [{ id: 'ats-compact' }],
      },
    }
    const supported = presetsSupportedBy(reduced)
    expect(supported.length).toBeGreaterThan(0)
    expect(
      supported.every((preset) => preset.preferences.styles.length === 1)
    ).toBe(true)
  })

  it('falls back to a capability-derived preset when nothing matches', () => {
    const odd = {
      output: {
        formats: ['txt'],
        styles: [{ id: 'some-future-style' }],
      },
    }
    const available = availablePresets(odd)
    expect(available).toHaveLength(1)
    expect(available[0]?.id).toBe('capability-default')
    expect(available[0]?.preferences.styles).toEqual(['some-future-style'])
    expect(available[0]?.preferences.formats).toEqual(['txt'])
  })
})
