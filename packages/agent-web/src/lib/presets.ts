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

import type { LucideIcon } from 'lucide-react'
import {
  Columns2,
  Compass,
  FileText,
  GraduationCap,
  Languages,
  Layers,
  PenLine,
  Sparkles,
} from 'lucide-react'

import type { OutputFormat, StylePresetID } from '@/lib/api/types'

/**
 * Output preferences sent as `preferences` on `POST /v1/runs`.
 *
 * Every field here exists in the backend `TailorPreferencesSchema`. Nothing in
 * this file may invent an option: unknown styles or formats are rejected by
 * Zod before an LLM call, so a made-up preset would fail at submit time.
 */
export interface TailorPreferences {
  language?: string
  maxPages?: 1 | 2
  targetTitle?: string
  formats: OutputFormat[]
  styles: StylePresetID[]
}

export type PresetCategory =
  | 'recommended'
  | 'engineering'
  | 'product'
  | 'academic'

export interface ScenarioPreset {
  id: string
  icon: LucideIcon
  title: string
  description: string
  categories: PresetCategory[]
  preferences: TailorPreferences
  /** Marks the single visually highlighted card on the launcher. */
  featured?: boolean
}

export const PRESET_CATEGORIES: Array<{
  id: PresetCategory
  label: string
}> = [
  { id: 'recommended', label: '推荐' },
  { id: 'engineering', label: '技术岗' },
  { id: 'product', label: '产品设计' },
  { id: 'academic', label: '学术科研' },
]

export const SCENARIO_PRESETS: ScenarioPreset[] = [
  {
    id: 'ats-one-page',
    icon: FileText,
    title: '一页 ATS 友好简历',
    description:
      '单栏高密度排版，压到一页，优先命中 JD 关键词，适合投递有筛选系统的公司。',
    categories: ['recommended', 'engineering'],
    featured: true,
    preferences: {
      maxPages: 1,
      styles: ['ats-compact'],
      formats: ['yaml', 'html', 'pdf'],
    },
  },
  {
    id: 'developer-two-column',
    icon: Columns2,
    title: '双栏技术简历',
    description:
      '项目和技能占比高的双栏排版，适合技能栈丰富、作品集需要露出的研发岗。',
    categories: ['recommended', 'engineering'],
    preferences: {
      maxPages: 1,
      styles: ['developer-two-column'],
      formats: ['yaml', 'html', 'pdf'],
    },
  },
  {
    id: 'compare-styles',
    icon: Layers,
    title: '三种样式一起生成',
    description:
      '同一份内容同时出 ATS、稳重和双栏三个版本，直接对照挑最合适的那个。',
    categories: ['recommended'],
    preferences: {
      styles: ['ats-compact', 'modern-professional', 'developer-two-column'],
      formats: ['html', 'pdf'],
    },
  },
  {
    id: 'english-version',
    icon: Languages,
    title: '英文版简历',
    description:
      '按英文语境重写措辞，保留同一套事实与证据，适合外企和海外岗位投递。',
    categories: ['recommended', 'engineering', 'product'],
    preferences: {
      language: 'en',
      maxPages: 1,
      styles: ['ats-compact'],
      formats: ['yaml', 'html', 'pdf'],
    },
  },
  {
    id: 'product-professional',
    icon: Compass,
    title: '产品岗稳重版',
    description:
      '层级清晰的通用排版，突出业务结果和协作范围，适合产品、运营和设计岗。',
    categories: ['product'],
    preferences: {
      maxPages: 2,
      styles: ['modern-professional'],
      formats: ['yaml', 'html', 'pdf'],
    },
  },
  {
    id: 'academic-classic',
    icon: GraduationCap,
    title: '学术履历',
    description:
      '传统学术排版，允许两页，保留完整教育、论文与研究经历，适合科研与升学。',
    categories: ['academic'],
    preferences: {
      maxPages: 2,
      styles: ['modern-classic'],
      formats: ['yaml', 'latex', 'pdf'],
    },
  },
  {
    id: 'editable-handoff',
    icon: PenLine,
    title: '要能继续改的版本',
    description:
      '同时给出 YAML 和 Markdown，方便自己接着改措辞，再回来重新渲染。',
    categories: ['recommended', 'product'],
    preferences: {
      styles: ['ats-compact'],
      formats: ['yaml', 'markdown', 'html'],
    },
  },
  {
    id: 'creative-casual',
    icon: Sparkles,
    title: '有个性的版本',
    description:
      '表达感更强的排版，适合创意、内容和部分设计岗，不建议投强筛选公司。',
    categories: ['product'],
    preferences: {
      maxPages: 1,
      styles: ['modern-casual'],
      formats: ['html', 'pdf'],
    },
  },
]

export function presetsByCategory(
  category: PresetCategory,
  presets: ScenarioPreset[] = SCENARIO_PRESETS
): ScenarioPreset[] {
  return presets.filter((preset) => preset.categories.includes(category))
}

export function findPreset(
  id: string,
  presets: ScenarioPreset[] = SCENARIO_PRESETS
): ScenarioPreset | undefined {
  return presets.find((preset) => preset.id === id)
}

/**
 * Summarise a preset for the launcher's selector, e.g. `ATS · 1 页 · pdf`.
 */
export function describePreferences(preferences: TailorPreferences): string {
  const parts: string[] = []
  parts.push(`${preferences.styles.length} 种样式`)
  if (preferences.maxPages) {
    parts.push(`${preferences.maxPages} 页`)
  }
  if (preferences.language) {
    parts.push(preferences.language === 'en' ? '英文' : preferences.language)
  }
  parts.push(preferences.formats.join(' · '))
  return parts.join(' · ')
}

/**
 * Capability shape the launcher needs. The full `AgentCapabilities` from the
 * API client is assignable to this; only the output options are read here so
 * tests stay small.
 */
export interface PresetCapabilities {
  output: {
    formats: string[]
    styles: Array<{ id: string }>
  }
}

/**
 * Keep only presets whose styles and formats the backend actually supports.
 *
 * The capability endpoint is the single source of truth for formats and
 * styles (integration rule #2); preset files must never be allowed to smuggle
 * an unsupported value into a request, because the backend rejects it before
 * any LLM call.
 */
export function presetsSupportedBy(
  capabilities: PresetCapabilities,
  presets: ScenarioPreset[] = SCENARIO_PRESETS
): ScenarioPreset[] {
  const formatIds = new Set(capabilities.output.formats)
  const styleIds = new Set(capabilities.output.styles.map((style) => style.id))
  return presets.filter((preset) => {
    const formatsSupported = preset.preferences.formats.every((format) =>
      formatIds.has(format)
    )
    const stylesSupported = preset.preferences.styles.every((style) =>
      styleIds.has(style)
    )
    return formatsSupported && stylesSupported
  })
}

const FALLBACK_FORMATS = ['yaml', 'html', 'pdf'] as const

/**
 * When the backend supports none of the shipped presets, derive one minimal
 * preset from its actual capabilities instead of showing an empty selector.
 */
export function fallbackPresetFor(
  capabilities: PresetCapabilities
): ScenarioPreset {
  const formats = capabilities.output.formats
  const styles = capabilities.output.styles.map((style) => style.id)
  const preferred = FALLBACK_FORMATS.filter((format) =>
    formats.includes(format)
  ) as OutputFormat[]
  const chosenFormats: OutputFormat[] =
    preferred.length > 0
      ? preferred
      : formats.length > 0
        ? ([formats[0]] as OutputFormat[])
        : ['yaml']
  return {
    id: 'capability-default',
    icon: FileText,
    title: '默认组合',
    description: '根据后端当前支持能力自动生成的最小组合。',
    categories: ['recommended'],
    preferences: {
      styles:
        styles.length > 0 ? [styles[0] as StylePresetID] : ['ats-compact'],
      formats: chosenFormats,
    },
  }
}

/**
 * Presets to render in the launcher: the shipped set filtered by real backend
 * capabilities, falling back to a minimal capability-derived preset.
 */
export function availablePresets(
  capabilities: PresetCapabilities,
  presets: ScenarioPreset[] = SCENARIO_PRESETS
): ScenarioPreset[] {
  const supported = presetsSupportedBy(capabilities, presets)
  if (supported.length > 0) {
    return supported
  }
  return [fallbackPresetFor(capabilities)]
}
