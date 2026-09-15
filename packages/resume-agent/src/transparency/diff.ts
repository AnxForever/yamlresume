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

import type { Resume } from '@yamlresume/core'

import type { ResumeChange, ResumeDiff } from '@/contracts'
import {
  asRecord,
  asRecords,
  getResumeEntryIdentity,
  RESUME_SECTION_IDENTITIES,
} from '@/resume-sections'

function isEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function comparableKeys(
  source: Record<string, unknown>,
  draft: Record<string, unknown>
): string[] {
  return [...new Set([...Object.keys(source), ...Object.keys(draft)])]
    .filter((key) => key !== 'computed')
    .sort()
}

function diffRecord(
  changes: ResumeChange[],
  source: Record<string, unknown>,
  draft: Record<string, unknown>,
  path: string,
  section: string
): void {
  for (const key of comparableKeys(source, draft)) {
    const before = source[key]
    const after = draft[key]
    if (isEqual(before, after)) {
      continue
    }

    const type =
      before === undefined
        ? 'added'
        : after === undefined
          ? 'removed'
          : 'changed'
    changes.push({ type, path: `${path}.${key}`, section, before, after })
  }
}

function diffObjectSection(
  changes: ResumeChange[],
  sourceContent: Record<string, unknown>,
  draftContent: Record<string, unknown>,
  section: string
): void {
  const source = asRecord(sourceContent[section]) ?? {}
  const draft = asRecord(draftContent[section]) ?? {}
  diffRecord(changes, source, draft, `content.${section}`, section)
}

function diffArraySection(
  changes: ResumeChange[],
  sourceContent: Record<string, unknown>,
  draftContent: Record<string, unknown>,
  section: string,
  identityKeys: string[]
): void {
  const sourceItems = asRecords(sourceContent[section])
  const draftItems = asRecords(draftContent[section])
  const sourceOrder = sourceItems
    .map((item) => getResumeEntryIdentity(item, identityKeys))
    .filter((value): value is string => value !== undefined)
  const draftOrder = draftItems
    .map((item) => getResumeEntryIdentity(item, identityKeys))
    .filter((value): value is string => value !== undefined)
  const sourceById = new Map(
    sourceItems
      .map(
        (item) => [getResumeEntryIdentity(item, identityKeys), item] as const
      )
      .filter(
        (entry): entry is readonly [string, Record<string, unknown>] =>
          entry[0] !== undefined
      )
  )
  const draftById = new Map(
    draftItems
      .map(
        (item) => [getResumeEntryIdentity(item, identityKeys), item] as const
      )
      .filter(
        (entry): entry is readonly [string, Record<string, unknown>] =>
          entry[0] !== undefined
      )
  )

  for (const id of sourceOrder) {
    const before = sourceById.get(id)
    const after = draftById.get(id)
    if (!before) {
      continue
    }
    if (!after) {
      changes.push({
        type: 'removed',
        path: `content.${section}[${id}]`,
        section,
        before,
      })
      continue
    }
    diffRecord(changes, before, after, `content.${section}[${id}]`, section)
  }

  for (const id of draftOrder) {
    if (!sourceById.has(id)) {
      changes.push({
        type: 'added',
        path: `content.${section}[${id}]`,
        section,
        after: draftById.get(id),
      })
    }
  }

  const sharedSourceOrder = sourceOrder.filter((id) => draftById.has(id))
  const sharedDraftOrder = draftOrder.filter((id) => sourceById.has(id))
  if (!isEqual(sharedSourceOrder, sharedDraftOrder)) {
    changes.push({
      type: 'reordered',
      path: `content.${section}`,
      section,
      before: sharedSourceOrder,
      after: sharedDraftOrder,
    })
  }
}

export function buildResumeDiff(source: Resume, draft: Resume): ResumeDiff {
  const changes: ResumeChange[] = []
  const sourceContent = asRecord(source.content) ?? {}
  const draftContent = asRecord(draft.content) ?? {}

  diffObjectSection(changes, sourceContent, draftContent, 'basics')
  diffObjectSection(changes, sourceContent, draftContent, 'location')

  for (const [section, config] of Object.entries(RESUME_SECTION_IDENTITIES)) {
    diffArraySection(changes, sourceContent, draftContent, section, config.keys)
  }

  return {
    changes,
    counts: {
      added: changes.filter((change) => change.type === 'added').length,
      removed: changes.filter((change) => change.type === 'removed').length,
      changed: changes.filter((change) => change.type === 'changed').length,
      reordered: changes.filter((change) => change.type === 'reordered').length,
    },
  }
}
