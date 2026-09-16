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

import { InteractionControlSchema, type InteractionRequest } from '@/contracts'
import {
  applyInteractionAnswer,
  createInteractionRequests,
  InteractionValidationError,
  validateInteractionAnswer,
} from '@/workflow/interaction'

const candidate = {
  content: {
    basics: { name: 'Ada Lovelace' },
    education: [],
  },
  layouts: [
    { engine: 'latex', template: 'jake' },
    { engine: 'html', template: 'calm' },
  ],
}

describe('structured human interaction', () => {
  it('converts a normalization question into a stable text interaction', () => {
    const interactions = createInteractionRequests([
      {
        field: 'content.basics.name',
        question: 'What is your full name?',
        reason: 'A resume requires the candidate name.',
        severity: 'important',
      },
    ])

    expect(interactions).toEqual([
      {
        id: 'candidate-normalization:1',
        field: 'content.basics.name',
        prompt: 'What is your full name?',
        reason: 'A resume requires the candidate name.',
        required: true,
        severity: 'important',
        privacy: 'personal',
        control: {
          type: 'text',
          minLength: 1,
          maxLength: 500,
        },
      },
    ])
  })

  it('rejects a single-choice value outside the suggested options', () => {
    const interaction = {
      id: 'candidate-normalization:1',
      field: 'content.basics.name',
      prompt: 'Which name spelling is correct?',
      reason: 'The source contains multiple possible role descriptions.',
      required: true,
      severity: 'important',
      privacy: 'standard',
      control: {
        type: 'single_choice',
        options: [
          { value: 'Ada Lovelace', label: 'Ada Lovelace' },
          { value: 'Augusta Ada King', label: 'Augusta Ada King' },
        ],
        allowCustom: false,
      },
    } as unknown as InteractionRequest

    expect(() =>
      applyInteractionAnswer(candidate, interaction, 'Ada Lovelace')
    ).not.toThrow()
    expect(() =>
      applyInteractionAnswer(candidate, interaction, 'Ada King')
    ).toThrow(InteractionValidationError)
  })

  it('allows custom single-choice input only when explicitly enabled', () => {
    const interaction = {
      id: 'candidate-normalization:2',
      field: 'content.basics.name',
      prompt: 'Which name spelling is correct?',
      reason: 'The source contains multiple spellings.',
      required: true,
      severity: 'important',
      privacy: 'personal',
      control: {
        type: 'single_choice',
        options: [
          { value: 'Ada Lovelace', label: 'Ada Lovelace' },
          { value: 'Augusta Ada King', label: 'Augusta Ada King' },
        ],
        allowCustom: true,
      },
    } as unknown as InteractionRequest

    expect(validateInteractionAnswer(interaction, 'Ada King')).toBe('Ada King')
  })

  it('enforces number, date, URL, and confirmation value types', () => {
    const base = {
      id: 'candidate-normalization:typed',
      field: 'content.basics.name',
      prompt: 'Provide a value',
      reason: 'The value is required.',
      required: true,
      severity: 'important',
      privacy: 'standard',
    }
    const numberInteraction = {
      ...base,
      control: { type: 'number', min: 0, max: 50, integer: true },
    } as unknown as InteractionRequest
    const dateInteraction = {
      ...base,
      control: { type: 'date' },
    } as unknown as InteractionRequest
    const urlInteraction = {
      ...base,
      control: { type: 'url', maxLength: 500 },
    } as unknown as InteractionRequest
    const confirmInteraction = {
      ...base,
      control: { type: 'confirm' },
    } as unknown as InteractionRequest

    expect(validateInteractionAnswer(numberInteraction, 12)).toBe(12)
    expect(() => validateInteractionAnswer(numberInteraction, '12')).toThrow(
      InteractionValidationError
    )
    expect(validateInteractionAnswer(dateInteraction, '2026-09-16')).toBe(
      '2026-09-16'
    )
    expect(() =>
      validateInteractionAnswer(dateInteraction, '2026-02-30')
    ).toThrow(InteractionValidationError)
    expect(
      validateInteractionAnswer(urlInteraction, 'https://example.com/profile')
    ).toBe('https://example.com/profile')
    expect(() =>
      validateInteractionAnswer(urlInteraction, 'javascript:alert(1)')
    ).toThrow(InteractionValidationError)
    expect(validateInteractionAnswer(confirmInteraction, true)).toBe(true)
    expect(() => validateInteractionAnswer(confirmInteraction, 'yes')).toThrow(
      InteractionValidationError
    )
  })

  it('validates multi-choice, textarea, date-range, and file-reference answers', () => {
    const base = {
      id: 'candidate-normalization:compound',
      field: 'content.basics.name',
      prompt: 'Provide a value',
      reason: 'The value is required.',
      required: true,
      severity: 'important',
      privacy: 'standard',
    }
    const multiChoice = {
      ...base,
      control: {
        type: 'multi_choice',
        options: [
          { value: 'TypeScript', label: 'TypeScript' },
          { value: 'Go', label: 'Go' },
        ],
        allowCustom: false,
        minSelections: 1,
        maxSelections: 2,
      },
    } as unknown as InteractionRequest
    const textarea = {
      ...base,
      control: { type: 'textarea', minLength: 10, maxLength: 1_000 },
    } as unknown as InteractionRequest
    const dateRange = {
      ...base,
      control: { type: 'date_range' },
    } as unknown as InteractionRequest
    const file = {
      ...base,
      control: {
        type: 'file',
        acceptedMediaTypes: ['application/pdf'],
        maxFiles: 1,
      },
    } as unknown as InteractionRequest

    expect(validateInteractionAnswer(multiChoice, ['TypeScript'])).toEqual([
      'TypeScript',
    ])
    expect(() => validateInteractionAnswer(multiChoice, ['Rust'])).toThrow(
      InteractionValidationError
    )
    expect(
      validateInteractionAnswer(
        textarea,
        'Built reliable APIs for production systems.'
      )
    ).toBe('Built reliable APIs for production systems.')
    expect(() => validateInteractionAnswer(textarea, 'short')).toThrow(
      InteractionValidationError
    )
    expect(
      validateInteractionAnswer(dateRange, {
        start: '2024-01-01',
        end: '2025-01-01',
      })
    ).toEqual({ start: '2024-01-01', end: '2025-01-01' })
    expect(() =>
      validateInteractionAnswer(dateRange, {
        start: '2025-01-01',
        end: '2024-01-01',
      })
    ).toThrow(InteractionValidationError)
    expect(
      validateInteractionAnswer(file, [
        { fileId: 'uploaded-file-1', mediaType: 'application/pdf' },
      ])
    ).toEqual([{ fileId: 'uploaded-file-1', mediaType: 'application/pdf' }])
    expect(() =>
      validateInteractionAnswer(file, [
        { fileId: 'uploaded-file-1', mediaType: 'image/png' },
      ])
    ).toThrow(InteractionValidationError)
  })

  it('preserves suggested choices and custom input from a normalization question', () => {
    const interactions = createInteractionRequests([
      {
        field: 'content.basics.headline',
        question: 'Which target headline should the resume use?',
        reason: 'Two roles are equally supported by the candidate evidence.',
        severity: 'important',
        control: {
          type: 'single_choice',
          options: [
            {
              value: 'Backend Engineer',
              label: 'Backend Engineer',
              recommended: true,
            },
            { value: 'Platform Engineer', label: 'Platform Engineer' },
          ],
          allowCustom: true,
        },
      },
    ] as never)

    expect(interactions[0]?.control).toEqual({
      type: 'single_choice',
      options: [
        {
          value: 'Backend Engineer',
          label: 'Backend Engineer',
          recommended: true,
        },
        { value: 'Platform Engineer', label: 'Platform Engineer' },
      ],
      allowCustom: true,
    })
  })

  it('rejects unknown and prototype-polluting candidate field paths', () => {
    const base = {
      id: 'candidate-normalization:path',
      prompt: 'Provide a value',
      reason: 'The value is required.',
      required: true,
      severity: 'important',
      privacy: 'standard',
      control: { type: 'text', minLength: 1, maxLength: 500 },
    }
    const unknownField = {
      ...base,
      field: 'content.basics.notAResumeField',
    } as InteractionRequest
    const prototypeField = {
      ...base,
      field: 'content.basics.__proto__.polluted',
    } as InteractionRequest
    const outsideContent = {
      ...base,
      field: 'layouts.0.template',
    } as InteractionRequest

    expect(() =>
      applyInteractionAnswer(candidate, unknownField, 'unexpected')
    ).toThrow(InteractionValidationError)
    expect(() =>
      applyInteractionAnswer(candidate, prototypeField, 'yes')
    ).toThrow(InteractionValidationError)
    expect(() =>
      applyInteractionAnswer(candidate, outsideContent, 'moderncv-casual')
    ).toThrow(InteractionValidationError)
    expect(({} as { polluted?: string }).polluted).toBeUndefined()
  })

  it('prioritizes blocking questions without changing their stable IDs', () => {
    const interactions = createInteractionRequests([
      {
        field: 'content.basics.headline',
        question: 'What headline do you prefer?',
        reason: 'A headline improves positioning.',
        severity: 'important',
      },
      {
        field: 'content.basics.name',
        question: 'What is your full name?',
        reason: 'The resume cannot be valid without a name.',
        severity: 'blocking',
      },
      {
        field: 'content.basics.summary',
        question: 'Would you like to add a summary?',
        reason: 'A summary is optional.',
        severity: 'optional',
      },
    ])

    expect(interactions.map((interaction) => interaction.id)).toEqual([
      'candidate-normalization:2',
      'candidate-normalization:1',
      'candidate-normalization:3',
    ])
  })

  it('uses safe field-specific fallbacks when the model omits control metadata', () => {
    const interactions = createInteractionRequests([
      {
        field: 'content.basics.summary',
        question: 'Describe your professional focus.',
        reason: 'The profile has no summary.',
        severity: 'important',
      },
      {
        field: 'content.basics.url',
        question: 'What is your professional profile URL?',
        reason: 'The URL is missing.',
        severity: 'important',
      },
      {
        field: 'content.education.0.startDate',
        question: 'When did this education begin?',
        reason: 'The start date is missing.',
        severity: 'important',
      },
    ])

    expect(interactions.map((interaction) => interaction.control.type)).toEqual(
      ['textarea', 'url', 'text']
    )
  })

  it('materializes control defaults before publishing an interaction', () => {
    const interactions = createInteractionRequests([
      {
        field: 'content.skills.0.keywords',
        question: 'Which technologies should be included?',
        reason: 'The source contains two plausible technologies.',
        severity: 'important',
        control: {
          type: 'multi_choice',
          options: [
            { value: 'TypeScript', label: 'TypeScript' },
            { value: 'Go', label: 'Go' },
          ],
          allowCustom: false,
        },
      },
    ] as never)

    expect(interactions[0]?.control).toEqual({
      type: 'multi_choice',
      options: [
        { value: 'TypeScript', label: 'TypeScript' },
        { value: 'Go', label: 'Go' },
      ],
      allowCustom: false,
      minSelections: 1,
      maxSelections: 5,
    })
  })

  it('rejects contradictory or duplicate model-supplied control metadata', () => {
    const duplicateChoices = InteractionControlSchema.safeParse({
      type: 'single_choice',
      options: [
        { value: 'backend', label: 'Backend Engineer' },
        { value: 'backend', label: 'Platform Engineer' },
      ],
      allowCustom: true,
    })
    const invalidLengths = InteractionControlSchema.safeParse({
      type: 'text',
      minLength: 100,
      maxLength: 10,
    })
    const impossibleDate = InteractionControlSchema.safeParse({
      type: 'date',
      min: '2026-02-30',
    })

    expect(duplicateChoices.success).toBe(false)
    expect(invalidLengths.success).toBe(false)
    expect(impossibleDate.success).toBe(false)
  })

  it('limits choice controls to five concise options', () => {
    const tooManyOptions = Array.from({ length: 6 }, (_, index) => ({
      value: `option-${index + 1}`,
      label: `Option ${index + 1}`,
    }))

    expect(
      InteractionControlSchema.safeParse({
        type: 'single_choice',
        options: tooManyOptions,
        allowCustom: true,
      }).success
    ).toBe(false)
    expect(
      InteractionControlSchema.safeParse({
        type: 'multi_choice',
        options: tooManyOptions,
        allowCustom: true,
        minSelections: 1,
        maxSelections: 5,
      }).success
    ).toBe(false)
  })

  it('updates an existing array entry without mutating the source resume', () => {
    const source = {
      ...candidate,
      content: {
        ...candidate.content,
        education: [
          {
            institution: 'Analytical Academy',
            area: 'Mathematics',
            degree: 'Bachelor' as const,
            startDate: '1840-01-01',
          },
        ],
      },
    }
    const interaction = {
      id: 'candidate-normalization:education-institution',
      field: 'content.education.0.institution',
      prompt: 'Which institution did you attend?',
      reason: 'The institution name is ambiguous.',
      required: true,
      severity: 'important',
      privacy: 'standard',
      control: { type: 'text', minLength: 1, maxLength: 500 },
    } as InteractionRequest

    const updated = applyInteractionAnswer(
      source,
      interaction,
      'University of London'
    )

    expect(updated.content.education?.[0]?.institution).toBe(
      'University of London'
    )
    expect(source.content.education[0]?.institution).toBe('Analytical Academy')
  })
})
