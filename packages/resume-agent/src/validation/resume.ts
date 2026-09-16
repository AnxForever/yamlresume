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
import { ResumeSchema } from '@yamlresume/core'
import { parse } from 'yaml'

import type { CandidateInput, TailorPreferences } from '@/contracts'
import {
  asRecord,
  asRecords,
  getResumeEntryIdentity,
  RESUME_SECTION_IDENTITIES,
} from '@/resume-sections'

export type AgentValidationStage =
  | 'candidate_input'
  | 'candidate_normalization'
  | 'draft_validation'

export class CandidateValidationError extends Error {
  readonly stage: AgentValidationStage

  constructor(
    message: string,
    stage: 'candidate_input' | 'candidate_normalization' = 'candidate_input'
  ) {
    super(message)
    this.name = 'CandidateValidationError'
    this.stage = stage
  }
}

export class DraftValidationError extends Error {
  readonly stage = 'draft_validation' as const

  constructor(message: string) {
    super(message)
    this.name = 'DraftValidationError'
  }
}

export function parseCandidateResume(input: CandidateInput): Resume {
  if (input.yaml !== undefined && input.resume !== undefined) {
    throw new CandidateValidationError(
      'Provide either candidate.yaml or candidate.resume, not both'
    )
  }

  let value: unknown = input.resume

  if (input.yaml !== undefined) {
    try {
      value = parse(input.yaml)
    } catch (error) {
      throw new CandidateValidationError(
        `Candidate YAML could not be parsed: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  if (value === undefined) {
    throw new CandidateValidationError('Candidate resume is required')
  }

  const result = ResumeSchema.safeParse(value)
  if (!result.success) {
    const issue = result.error.issues[0]
    const path = issue?.path.length ? ` (${issue.path.join('.')})` : ''
    throw new CandidateValidationError(
      `Candidate resume does not match YAMLResume schema${path}: ${issue?.message ?? 'unknown validation error'}`
    )
  }

  return result.data as Resume
}

function assertImmutableFacts(source: Resume, draft: Resume): void {
  const sourceContent = asRecord(source.content)
  const draftContent = asRecord(draft.content)
  if (!sourceContent || !draftContent) {
    throw new DraftValidationError('Resume content must be an object')
  }

  const sourceBasics = asRecord(sourceContent.basics)
  const draftBasics = asRecord(draftContent.basics)
  for (const key of ['name', 'email', 'phone', 'url']) {
    const sourceValue = sourceBasics?.[key]
    const draftValue = draftBasics?.[key]
    if (
      typeof sourceValue === 'string' &&
      typeof draftValue === 'string' &&
      sourceValue !== draftValue
    ) {
      throw new DraftValidationError(
        `Generated resume changed candidate basics.${key}`
      )
    }
  }

  const sourceLocation = asRecord(sourceContent.location)
  const draftLocation = asRecord(draftContent.location)
  for (const key of ['city', 'region', 'country', 'postalCode']) {
    const sourceValue = sourceLocation?.[key]
    const draftValue = draftLocation?.[key]
    if (
      typeof sourceValue === 'string' &&
      typeof draftValue === 'string' &&
      sourceValue !== draftValue
    ) {
      throw new DraftValidationError(
        `Generated resume changed candidate location.${key}`
      )
    }
  }

  for (const [section, config] of Object.entries(RESUME_SECTION_IDENTITIES)) {
    const sourceItems = asRecords(sourceContent[section])
    const draftItems = asRecords(draftContent[section])
    const sourceByIdentity = new Map(
      sourceItems
        .map(
          (item) => [getResumeEntryIdentity(item, config.keys), item] as const
        )
        .filter(
          (entry): entry is readonly [string, Record<string, unknown>] =>
            entry[0] !== undefined
        )
    )

    for (const item of draftItems) {
      const itemIdentity = getResumeEntryIdentity(item, config.keys)
      const original = itemIdentity
        ? sourceByIdentity.get(itemIdentity)
        : undefined
      if (!original) {
        throw new DraftValidationError(
          `Generated resume added an unsupported ${section} entry`
        )
      }

      for (const key of config.factKeys) {
        const generatedValue = item[key]
        const originalValue = original[key]
        if (
          typeof generatedValue === 'string' &&
          typeof originalValue === 'string' &&
          generatedValue !== originalValue
        ) {
          throw new DraftValidationError(
            `Generated resume changed candidate ${section}.${key}`
          )
        }
      }
    }
  }
}

function getLatexLayout(resume: Resume): LatexLayout | undefined {
  return resume.layouts?.find(
    (layout): layout is LatexLayout => layout.engine === 'latex'
  )
}

function getHtmlLayout(resume: Resume): HtmlLayout | undefined {
  return resume.layouts?.find(
    (layout): layout is HtmlLayout => layout.engine === 'html'
  )
}

export function validateNormalizationFacts(
  source: Resume,
  normalized: Resume
): void {
  const sourceContent = asRecord(source.content) ?? {}
  const normalizedContent = asRecord(normalized.content) ?? {}
  const sourceBasics = asRecord(sourceContent.basics) ?? {}
  const normalizedBasics = asRecord(normalizedContent.basics) ?? {}
  for (const key of ['name', 'email', 'phone', 'url']) {
    const before = sourceBasics[key]
    const after = normalizedBasics[key]
    if (
      typeof before === 'string' &&
      typeof after === 'string' &&
      before !== after
    ) {
      throw new DraftValidationError(
        `Candidate normalization changed basics.${key}`
      )
    }
  }

  for (const [section, config] of Object.entries(RESUME_SECTION_IDENTITIES)) {
    const sourceItems = asRecords(sourceContent[section])
    const normalizedItems = asRecords(normalizedContent[section])
    const sourceById = new Map(
      sourceItems
        .map(
          (item) => [getResumeEntryIdentity(item, config.keys), item] as const
        )
        .filter(
          (entry): entry is readonly [string, Record<string, unknown>] =>
            entry[0] !== undefined
        )
    )
    for (const item of normalizedItems) {
      const itemId = getResumeEntryIdentity(item, config.keys)
      const original = itemId ? sourceById.get(itemId) : undefined
      if (!original) continue
      for (const key of config.factKeys) {
        const before = original[key]
        const after = item[key]
        if (
          typeof before === 'string' &&
          typeof after === 'string' &&
          before !== after
        ) {
          throw new DraftValidationError(
            `Candidate normalization changed ${section}.${key}`
          )
        }
      }
    }
  }
}

export function prepareDraftResume(
  value: unknown,
  source: Resume,
  preferences: TailorPreferences = {}
): Resume {
  const draftRecord = asRecord(value)
  const draftContent = asRecord(draftRecord?.content)
  const normalizedValue =
    draftRecord && draftContent && !('education' in draftContent)
      ? {
          ...draftRecord,
          content: { ...draftContent, education: [] },
        }
      : value
  const result = ResumeSchema.safeParse(normalizedValue)
  if (!result.success) {
    const issue = result.error.issues[0]
    const path = issue?.path.length ? ` (${issue.path.join('.')})` : ''
    throw new DraftValidationError(
      `Generated resume does not match YAMLResume schema${path}: ${issue?.message ?? 'unknown validation error'}`
    )
  }

  const draft = result.data as Resume
  assertImmutableFacts(source, draft)
  const sourceLatex = getLatexLayout(source)
  const sourceHtml = getHtmlLayout(source)
  const latexTemplate = preferences.template ?? sourceLatex?.template ?? 'jake'

  const latexLayout: LatexLayout = {
    ...(sourceLatex ?? {}),
    engine: 'latex',
    template: latexTemplate,
  }
  const htmlLayout: HtmlLayout = {
    ...(sourceHtml ?? {}),
    engine: 'html',
    template: sourceHtml?.template ?? 'calm',
  }

  return {
    ...draft,
    layouts: [latexLayout, htmlLayout],
  }
}
