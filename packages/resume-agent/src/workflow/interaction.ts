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
import { ResumeSchema } from '@yamlresume/core'

import type {
  FollowUpQuestion,
  InteractionControl,
  InteractionRequest,
} from '@/contracts'
import { InteractionRequestSchema } from '@/contracts'

const FORBIDDEN_PATH_SEGMENTS = new Set([
  '__proto__',
  'prototype',
  'constructor',
])

export class InteractionValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InteractionValidationError'
  }
}

function fieldPrivacy(field: string): InteractionRequest['privacy'] {
  if (field === 'content.basics.email' || field === 'content.basics.phone') {
    return 'sensitive'
  }
  if (
    field.startsWith('content.basics.') ||
    field.startsWith('content.location.')
  ) {
    return 'personal'
  }
  return 'standard'
}

function defaultControl(field: string): InteractionControl {
  const normalized = field.toLowerCase()
  if (normalized.endsWith('.url')) {
    return { type: 'url', maxLength: 500 }
  }
  if (normalized.endsWith('.summary') || normalized.endsWith('.description')) {
    return { type: 'textarea', minLength: 1, maxLength: 5_000 }
  }
  // Resume dates may contain only a year or month. Without explicit precision
  // metadata, a text fallback avoids asking the user to invent a day.
  return { type: 'text', minLength: 1, maxLength: 500 }
}

export function createInteractionRequests(
  questions: FollowUpQuestion[]
): InteractionRequest[] {
  const severityRank: Record<FollowUpQuestion['severity'], number> = {
    blocking: 0,
    important: 1,
    optional: 2,
  }
  const interactions = questions.map(
    (question, index) =>
      InteractionRequestSchema.parse({
        id: `candidate-normalization:${index + 1}`,
        field: question.field,
        prompt: question.question,
        reason: question.reason,
        required: question.severity !== 'optional',
        severity: question.severity,
        privacy: fieldPrivacy(question.field),
        control: question.control ?? defaultControl(question.field),
      }) as InteractionRequest
  )
  return interactions.sort(
    (left, right) => severityRank[left.severity] - severityRank[right.severity]
  )
}

export function validateInteractionAnswer(
  interaction: InteractionRequest,
  value: unknown
): unknown {
  const { control } = interaction
  if (control.type === 'single_choice') {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new InteractionValidationError('Answer must select one value')
    }
    const normalized = value.trim()
    const isSuggested = control.options.some(
      (option) => option.value === normalized
    )
    if (!isSuggested && !control.allowCustom) {
      throw new InteractionValidationError(
        'Answer must use one of the suggested options'
      )
    }
    if (normalized.length > 500) {
      throw new InteractionValidationError('Answer is too long')
    }
    return normalized
  }

  if (control.type === 'multi_choice') {
    if (
      !Array.isArray(value) ||
      value.some((item) => typeof item !== 'string')
    ) {
      throw new InteractionValidationError('Answer must be a list of values')
    }
    const normalized = value.map((item) => item.trim())
    if (
      normalized.some((item) => item.length === 0 || item.length > 500) ||
      new Set(normalized).size !== normalized.length
    ) {
      throw new InteractionValidationError(
        'Answer selections must be unique, non-empty values'
      )
    }
    if (
      normalized.length < control.minSelections ||
      normalized.length > control.maxSelections
    ) {
      throw new InteractionValidationError(
        'Answer has an invalid number of selections'
      )
    }
    const suggested = new Set(control.options.map((option) => option.value))
    if (
      !control.allowCustom &&
      normalized.some((item) => !suggested.has(item))
    ) {
      throw new InteractionValidationError(
        'Answer must use the suggested options'
      )
    }
    return normalized
  }

  if (control.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new InteractionValidationError('Answer must be a finite number')
    }
    if (control.integer && !Number.isInteger(value)) {
      throw new InteractionValidationError('Answer must be an integer')
    }
    if (control.min !== undefined && value < control.min) {
      throw new InteractionValidationError('Answer is below the minimum')
    }
    if (control.max !== undefined && value > control.max) {
      throw new InteractionValidationError('Answer is above the maximum')
    }
    return value
  }

  if (control.type === 'date') {
    if (typeof value !== 'string' || !isIsoDate(value)) {
      throw new InteractionValidationError('Answer must be a valid ISO date')
    }
    if (control.min && value < control.min) {
      throw new InteractionValidationError('Answer is before the minimum date')
    }
    if (control.max && value > control.max) {
      throw new InteractionValidationError('Answer is after the maximum date')
    }
    return value
  }

  if (control.type === 'date_range') {
    const range = asMutableRecord(value)
    const start = range?.start
    const end = range?.end
    if (
      typeof start !== 'string' ||
      !isIsoDate(start) ||
      (end !== undefined && (typeof end !== 'string' || !isIsoDate(end)))
    ) {
      throw new InteractionValidationError(
        'Answer must be a valid ISO date range'
      )
    }
    if (end === undefined && control.allowOpenEnd === false) {
      throw new InteractionValidationError('Answer requires an end date')
    }
    if (typeof end === 'string' && end < start) {
      throw new InteractionValidationError(
        'Answer end date must not precede its start date'
      )
    }
    if (control.min && start < control.min) {
      throw new InteractionValidationError('Answer is before the minimum date')
    }
    if (control.max && (typeof end === 'string' ? end : start) > control.max) {
      throw new InteractionValidationError('Answer is after the maximum date')
    }
    return { start, ...(typeof end === 'string' ? { end } : {}) }
  }

  if (control.type === 'url') {
    if (typeof value !== 'string' || value.length > control.maxLength) {
      throw new InteractionValidationError('Answer must be a valid URL')
    }
    try {
      const url = new URL(value)
      if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        throw new InteractionValidationError(
          'Answer URL must use HTTP or HTTPS'
        )
      }
    } catch (error) {
      if (error instanceof InteractionValidationError) throw error
      throw new InteractionValidationError('Answer must be a valid URL')
    }
    return value
  }

  if (control.type === 'confirm') {
    if (typeof value !== 'boolean') {
      throw new InteractionValidationError('Answer must be true or false')
    }
    return value
  }

  if (control.type === 'file') {
    if (
      !Array.isArray(value) ||
      value.length > control.maxFiles ||
      (interaction.required && value.length === 0)
    ) {
      throw new InteractionValidationError(
        'Answer must contain the expected file references'
      )
    }
    const references = value.map((item) => {
      const reference = asMutableRecord(item)
      if (
        typeof reference?.fileId !== 'string' ||
        reference.fileId.length === 0 ||
        reference.fileId.length > 200 ||
        typeof reference.mediaType !== 'string' ||
        !control.acceptedMediaTypes.includes(reference.mediaType)
      ) {
        throw new InteractionValidationError('Answer file reference is invalid')
      }
      return {
        fileId: reference.fileId,
        mediaType: reference.mediaType,
      }
    })
    return references
  }

  if (typeof value !== 'string') {
    throw new InteractionValidationError('Answer must be text')
  }
  const normalized = value.trim()
  if (normalized.length < control.minLength) {
    throw new InteractionValidationError('Answer is required')
  }
  if (normalized.length > control.maxLength) {
    throw new InteractionValidationError('Answer is too long')
  }
  return normalized
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  )
}

function asMutableRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function arrayIndex(segment: string, length: number): number | undefined {
  if (!/^(0|[1-9]\d*)$/.test(segment)) return undefined
  const index = Number(segment)
  return index < length ? index : undefined
}

function getPathValue(root: unknown, segments: string[]): unknown {
  let current = root
  for (const segment of segments) {
    if (Array.isArray(current)) {
      const index = arrayIndex(segment, current.length)
      if (index === undefined) return undefined
      current = current[index]
      continue
    }
    const record = asMutableRecord(current)
    if (!record || !Object.hasOwn(record, segment)) return undefined
    current = record[segment]
  }
  return current
}

function equalAnswer(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (
    typeof left !== 'object' ||
    left === null ||
    typeof right !== 'object' ||
    right === null
  ) {
    return false
  }
  return JSON.stringify(left) === JSON.stringify(right)
}

export function applyInteractionAnswer(
  resume: Resume,
  interaction: InteractionRequest,
  value: unknown
): Resume {
  const segments = interaction.field.split('.')
  if (
    segments[0] !== 'content' ||
    segments.length < 3 ||
    segments.some((segment) => FORBIDDEN_PATH_SEGMENTS.has(segment))
  ) {
    throw new InteractionValidationError('Interaction field is not writable')
  }

  const answer = validateInteractionAnswer(interaction, value)
  const updated = structuredClone(resume) as unknown
  let current: unknown = updated

  for (const segment of segments.slice(0, -1)) {
    if (Array.isArray(current)) {
      const index = arrayIndex(segment, current.length)
      if (index === undefined) {
        throw new InteractionValidationError(
          'Interaction field array index does not exist'
        )
      }
      current = current[index]
      continue
    }
    const record = asMutableRecord(current)
    if (!record || !Object.hasOwn(record, segment)) {
      throw new InteractionValidationError('Interaction field does not exist')
    }
    const next = record[segment]
    if (typeof next !== 'object' || next === null) {
      throw new InteractionValidationError('Interaction field is not writable')
    }
    current = next
  }
  const leaf = segments.at(-1)
  if (!leaf) {
    throw new InteractionValidationError('Interaction field is not writable')
  }
  if (Array.isArray(current)) {
    const index = arrayIndex(leaf, current.length)
    if (index === undefined) {
      throw new InteractionValidationError(
        'Interaction field array index does not exist'
      )
    }
    current[index] = answer
  } else {
    const record = asMutableRecord(current)
    if (!record) {
      throw new InteractionValidationError('Interaction field is not writable')
    }
    record[leaf] = answer
  }

  const parsed = ResumeSchema.safeParse(updated)
  if (!parsed.success) {
    throw new InteractionValidationError(
      'Answer does not produce a valid candidate profile'
    )
  }
  if (!equalAnswer(getPathValue(parsed.data, segments), answer)) {
    throw new InteractionValidationError(
      'Interaction field is not part of the candidate schema'
    )
  }
  return parsed.data as Resume
}
