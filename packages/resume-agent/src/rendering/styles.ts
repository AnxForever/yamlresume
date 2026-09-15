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

import type { HtmlLayout, LatexLayout, Resume } from '@yamlresume/core'

import type { StylePresetID } from '@/contracts'

export interface StylePreset {
  id: StylePresetID
  label: string
  description: string
  template: NonNullable<LatexLayout['template']>
  htmlTemplate: NonNullable<HtmlLayout['template']>
  fontSize: '10pt' | '11pt' | '12pt'
  margins: {
    top: string
    right: string
    bottom: string
    left: string
  }
  lineSpacing: 'tight' | 'snug' | 'normal' | 'relaxed' | 'loose'
}

export const STYLE_PRESETS: Record<StylePresetID, StylePreset> = {
  'ats-compact': {
    id: 'ats-compact',
    label: 'ATS Compact',
    description: 'Single-column, dense, conservative, and keyword-friendly.',
    template: 'jake',
    htmlTemplate: 'calm',
    fontSize: '10pt',
    margins: { top: '1.2cm', right: '1.2cm', bottom: '1.2cm', left: '1.2cm' },
    lineSpacing: 'tight',
  },
  'modern-professional': {
    id: 'modern-professional',
    label: 'Modern Professional',
    description:
      'Balanced hierarchy and comfortable reading for general roles.',
    template: 'moderncv-banking',
    htmlTemplate: 'calm',
    fontSize: '10pt',
    margins: { top: '1.5cm', right: '1.5cm', bottom: '1.5cm', left: '1.5cm' },
    lineSpacing: 'normal',
  },
  'modern-classic': {
    id: 'modern-classic',
    label: 'Modern Classic',
    description: 'Traditional academic and research-oriented presentation.',
    template: 'moderncv-classic',
    htmlTemplate: 'calm',
    fontSize: '11pt',
    margins: { top: '1.6cm', right: '1.6cm', bottom: '1.6cm', left: '1.6cm' },
    lineSpacing: 'relaxed',
  },
  'modern-casual': {
    id: 'modern-casual',
    label: 'Modern Casual',
    description: 'More expressive presentation for product and creative roles.',
    template: 'moderncv-casual',
    htmlTemplate: 'vscode',
    fontSize: '10pt',
    margins: { top: '1.4cm', right: '1.4cm', bottom: '1.4cm', left: '1.4cm' },
    lineSpacing: 'normal',
  },
  'developer-two-column': {
    id: 'developer-two-column',
    label: 'Developer Two Column',
    description:
      'High-density two-column layout for technical projects and skills.',
    template: 'deedy',
    htmlTemplate: 'calm',
    fontSize: '10pt',
    margins: { top: '1.0cm', right: '1.0cm', bottom: '1.0cm', left: '1.0cm' },
    lineSpacing: 'tight',
  },
}

export function getStylePreset(style: StylePresetID): StylePreset {
  return STYLE_PRESETS[style]
}

function latexLayoutFor(resume: Resume): LatexLayout | undefined {
  return resume.layouts?.find(
    (layout): layout is LatexLayout => layout.engine === 'latex'
  )
}

function htmlLayoutFor(resume: Resume): HtmlLayout | undefined {
  return resume.layouts?.find(
    (layout): layout is HtmlLayout => layout.engine === 'html'
  )
}

export function applyStylePreset(resume: Resume, style: StylePresetID): Resume {
  const preset = getStylePreset(style)
  const sourceLatex = latexLayoutFor(resume)
  const sourceHtml = htmlLayoutFor(resume)
  const latex: LatexLayout = {
    ...(sourceLatex ?? {}),
    engine: 'latex',
    template: preset.template,
    page: {
      ...(sourceLatex?.page ?? {}),
      margins: preset.margins,
      paperSize: sourceLatex?.page?.paperSize ?? 'a4',
      showPageNumbers: sourceLatex?.page?.showPageNumbers ?? false,
    },
    typography: {
      ...(sourceLatex?.typography ?? {}),
      fontSize: preset.fontSize,
      lineSpacing: preset.lineSpacing,
    },
    advanced: {
      ...(sourceLatex?.advanced ?? {}),
      showSkillLevels: false,
    },
  }
  const html: HtmlLayout = {
    ...(sourceHtml ?? {}),
    engine: 'html',
    template: preset.htmlTemplate,
    typography: {
      ...(sourceHtml?.typography ?? {}),
      fontSize: '14px',
      lineSpacing: preset.lineSpacing,
    },
    advanced: {
      ...(sourceHtml?.advanced ?? {}),
      showSkillLevels: false,
      showIcons: sourceHtml?.advanced?.showIcons ?? true,
    },
  }
  const markdown = { engine: 'markdown' as const }

  return {
    ...resume,
    layouts: [latex, html, markdown],
  }
}

export function resolveStyleIDs(preferences: {
  styles?: StylePresetID[]
  template?: StylePreset['template']
}): StylePresetID[] {
  if (preferences.styles && preferences.styles.length > 0) {
    return [...new Set(preferences.styles)]
  }
  if (preferences.template) {
    const match = Object.values(STYLE_PRESETS).find(
      (preset) => preset.template === preferences.template
    )
    if (match) return [match.id]
  }
  return ['ats-compact']
}
