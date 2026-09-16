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
import { z } from 'zod'

export const JobRequirementSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  keywords: z.array(z.string().min(1)).default([]),
  importance: z.enum(['must-have', 'nice-to-have']).default('must-have'),
  category: z
    .enum(['technical', 'domain', 'responsibility', 'soft-skill', 'other'])
    .default('other'),
})

export const JobSpecSchema = z.object({
  targetTitle: z.string().min(1),
  seniority: z
    .enum(['intern', 'junior', 'mid', 'senior', 'lead', 'unknown'])
    .default('unknown'),
  company: z.string().optional(),
  summary: z.string().min(1),
  requirements: z.array(JobRequirementSchema),
  keywords: z.array(z.string().min(1)).default([]),
})

export const InputFileSchema = z
  .object({
    id: z.string().min(1).max(128).optional(),
    filename: z.string().min(1).max(255),
    mediaType: z.string().min(1).max(128).optional(),
    text: z.string().max(1_000_000).optional(),
    contentBase64: z.string().max(20_000_000).optional(),
  })
  .superRefine((value, context) => {
    const supplied =
      Number(value.text !== undefined) +
      Number(value.contentBase64 !== undefined)
    if (supplied !== 1) {
      context.addIssue({
        code: 'custom',
        message: 'Provide exactly one of text or contentBase64 for each file',
      })
    }
  })

export const CandidateInputSchema = z
  .object({
    yaml: z.string().max(500_000).optional(),
    resume: z.unknown().optional(),
    files: z.array(InputFileSchema).max(12).default([]),
  })
  .superRefine((value, context) => {
    const supplied =
      Number(value.yaml !== undefined) + Number(value.resume !== undefined)
    if (supplied > 1) {
      context.addIssue({
        code: 'custom',
        message: 'Provide at most one of candidate.yaml or candidate.resume',
      })
    }
    if (supplied === 0 && value.files.length === 0) {
      context.addIssue({
        code: 'custom',
        message: 'Provide candidate.yaml, candidate.resume, or candidate.files',
      })
    }
  })

export const OutputFormatSchema = z.enum([
  'yaml',
  'json',
  'markdown',
  'html',
  'latex',
  'pdf',
  'docx',
  'txt',
  'rtf',
  'odt',
])

export const StylePresetSchema = z.enum([
  'ats-compact',
  'modern-professional',
  'modern-classic',
  'modern-casual',
  'developer-two-column',
])

export const TailorPreferencesSchema = z.object({
  language: z.string().max(32).optional(),
  template: z
    .enum([
      'jake',
      'moderncv-banking',
      'moderncv-casual',
      'moderncv-classic',
      'deedy',
    ])
    .optional(),
  maxPages: z.union([z.literal(1), z.literal(2)]).optional(),
  targetTitle: z.string().max(200).optional(),
  formats: z
    .array(OutputFormatSchema)
    .min(1)
    .max(10)
    .default(['yaml', 'json', 'markdown', 'html', 'latex']),
  styles: z.array(StylePresetSchema).min(1).max(5).default(['ats-compact']),
})

export const TailorResumeRequestSchema = z
  .object({
    jobDescription: z.string().trim().min(20).max(100_000).optional(),
    jobFiles: z.array(InputFileSchema).max(8).default([]),
    candidate: CandidateInputSchema,
    preferences: TailorPreferencesSchema.optional(),
  })
  .superRefine((value, context) => {
    if (!value.jobDescription && value.jobFiles.length === 0) {
      context.addIssue({
        code: 'custom',
        message: 'Provide jobDescription or jobFiles',
        path: ['jobDescription'],
      })
    }
  })

export const InteractionChoiceOptionSchema = z.object({
  value: z.string().min(1).max(500),
  label: z.string().min(1).max(200),
  description: z.string().min(1).max(500).optional(),
  recommended: z.boolean().optional(),
})

const ISO_DATE_SCHEMA = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`)
    return (
      !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
    )
  }, 'Date must be a real calendar date')

export const InteractionControlSchema = z
  .discriminatedUnion('type', [
    z.object({
      type: z.literal('text'),
      minLength: z.number().int().min(0).max(500).default(1),
      maxLength: z.number().int().min(1).max(10_000).default(500),
    }),
    z.object({
      type: z.literal('textarea'),
      minLength: z.number().int().min(0).max(5_000).default(1),
      maxLength: z.number().int().min(1).max(50_000).default(5_000),
    }),
    z.object({
      type: z.literal('single_choice'),
      options: z.array(InteractionChoiceOptionSchema).min(2).max(5),
      allowCustom: z.boolean().default(true),
    }),
    z.object({
      type: z.literal('multi_choice'),
      options: z.array(InteractionChoiceOptionSchema).min(2).max(5),
      allowCustom: z.boolean().default(true),
      minSelections: z.number().int().min(0).max(5).default(1),
      maxSelections: z.number().int().min(1).max(5).default(5),
    }),
    z.object({
      type: z.literal('number'),
      min: z.number().finite().optional(),
      max: z.number().finite().optional(),
      integer: z.boolean().optional(),
    }),
    z.object({
      type: z.literal('date'),
      min: ISO_DATE_SCHEMA.optional(),
      max: ISO_DATE_SCHEMA.optional(),
    }),
    z.object({
      type: z.literal('date_range'),
      min: ISO_DATE_SCHEMA.optional(),
      max: ISO_DATE_SCHEMA.optional(),
      allowOpenEnd: z.boolean().default(true),
    }),
    z.object({
      type: z.literal('url'),
      maxLength: z.number().int().min(1).max(5_000).default(500),
    }),
    z.object({
      type: z.literal('file'),
      acceptedMediaTypes: z.array(z.string().min(1).max(128)).min(1).max(12),
      maxFiles: z.number().int().min(1).max(12).default(1),
    }),
    z.object({
      type: z.literal('confirm'),
      confirmLabel: z.string().min(1).max(100).optional(),
      cancelLabel: z.string().min(1).max(100).optional(),
    }),
  ])
  .superRefine((control, context) => {
    if (
      (control.type === 'text' || control.type === 'textarea') &&
      control.minLength > control.maxLength
    ) {
      context.addIssue({
        code: 'custom',
        path: ['minLength'],
        message: 'minLength must not exceed maxLength',
      })
    }
    if (control.type === 'single_choice' || control.type === 'multi_choice') {
      const values = control.options.map((option) => option.value)
      if (new Set(values).size !== values.length) {
        context.addIssue({
          code: 'custom',
          path: ['options'],
          message: 'Choice option values must be unique',
        })
      }
    }
    if (
      control.type === 'multi_choice' &&
      control.minSelections > control.maxSelections
    ) {
      context.addIssue({
        code: 'custom',
        path: ['maxSelections'],
        message: 'minSelections must not exceed maxSelections',
      })
    }
    if (
      control.type === 'multi_choice' &&
      !control.allowCustom &&
      control.minSelections > control.options.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['minSelections'],
        message: 'Required selections exceed the available options',
      })
    }
    if (
      control.type === 'number' &&
      control.min !== undefined &&
      control.max !== undefined &&
      control.min > control.max
    ) {
      context.addIssue({
        code: 'custom',
        path: ['min'],
        message: 'min must not exceed max',
      })
    }
    if (
      (control.type === 'date' || control.type === 'date_range') &&
      control.min !== undefined &&
      control.max !== undefined &&
      control.min > control.max
    ) {
      context.addIssue({
        code: 'custom',
        path: ['min'],
        message: 'min date must not exceed max date',
      })
    }
  })

export const FollowUpQuestionSchema = z.object({
  field: z.string().min(1).max(500),
  question: z.string().min(1).max(2_000),
  reason: z.string().min(1).max(2_000),
  severity: z.enum(['blocking', 'important', 'optional']).default('important'),
  control: InteractionControlSchema.optional(),
})

export interface InteractionTextControl {
  type: 'text'
  minLength: number
  maxLength: number
}

export interface InteractionTextareaControl {
  type: 'textarea'
  minLength: number
  maxLength: number
}

export interface InteractionChoiceOption {
  value: string
  label: string
  description?: string
  recommended?: boolean
}

export interface InteractionSingleChoiceControl {
  type: 'single_choice'
  options: InteractionChoiceOption[]
  allowCustom: boolean
}

export interface InteractionMultiChoiceControl {
  type: 'multi_choice'
  options: InteractionChoiceOption[]
  allowCustom: boolean
  minSelections: number
  maxSelections: number
}

export interface InteractionNumberControl {
  type: 'number'
  min?: number
  max?: number
  integer?: boolean
}

export interface InteractionDateControl {
  type: 'date'
  min?: string
  max?: string
}

export interface InteractionDateRangeControl {
  type: 'date_range'
  min?: string
  max?: string
  allowOpenEnd?: boolean
}

export interface InteractionUrlControl {
  type: 'url'
  maxLength: number
}

export interface InteractionConfirmControl {
  type: 'confirm'
  confirmLabel?: string
  cancelLabel?: string
}

export interface InteractionFileControl {
  type: 'file'
  acceptedMediaTypes: string[]
  maxFiles: number
}

export interface InteractionFileReference {
  fileId: string
  mediaType: string
}

export type InteractionControl =
  | InteractionTextControl
  | InteractionTextareaControl
  | InteractionSingleChoiceControl
  | InteractionMultiChoiceControl
  | InteractionNumberControl
  | InteractionDateControl
  | InteractionDateRangeControl
  | InteractionUrlControl
  | InteractionFileControl
  | InteractionConfirmControl

export interface InteractionRequest {
  id: string
  field: string
  prompt: string
  reason: string
  required: boolean
  severity: FollowUpQuestion['severity']
  privacy: 'standard' | 'personal' | 'sensitive'
  control: InteractionControl
}

export const InteractionRequestSchema = z.object({
  id: z.string().min(1).max(200),
  field: z.string().min(1).max(500),
  prompt: z.string().min(1).max(2_000),
  reason: z.string().min(1).max(2_000),
  required: z.boolean(),
  severity: z.enum(['blocking', 'important', 'optional']),
  privacy: z.enum(['standard', 'personal', 'sensitive']),
  control: InteractionControlSchema,
})

export const InteractionAnswerSchema = z.object({
  interactionId: z.string().min(1).max(200),
  idempotencyKey: z.string().min(1).max(200),
  value: z.unknown(),
})

export type InteractionAnswer = z.infer<typeof InteractionAnswerSchema>

const REQUIRED_OUTPUT_VALUE_SCHEMA = z
  .unknown()
  .refine((value) => value !== undefined, { message: 'Required' })

export const CandidateNormalizationResponseSchema = z.object({
  resume: REQUIRED_OUTPUT_VALUE_SCHEMA,
  sourceArtifactIds: z.array(z.string()).default([]),
  questions: z.array(FollowUpQuestionSchema).default([]),
  warnings: z.array(z.string()).default([]),
})

export const DraftResponseSchema = z.object({
  resume: REQUIRED_OUTPUT_VALUE_SCHEMA,
  selectedEvidenceIds: z.array(z.string()).default([]),
  questions: z.array(FollowUpQuestionSchema).default([]),
  notes: z.array(z.string()).default([]),
})

export type JobRequirement = z.infer<typeof JobRequirementSchema>
export type InputFile = z.input<typeof InputFileSchema>
export type CandidateInput = z.input<typeof CandidateInputSchema>
export type CandidateInputData = z.output<typeof CandidateInputSchema>
export type JobSpec = z.infer<typeof JobSpecSchema>
export type OutputFormat = z.infer<typeof OutputFormatSchema>
export type StylePresetID = z.infer<typeof StylePresetSchema>
export type FollowUpQuestion = z.infer<typeof FollowUpQuestionSchema>
export type TailorPreferences = z.input<typeof TailorPreferencesSchema>
export type TailorResumeRequest = z.input<typeof TailorResumeRequestSchema>
export type TailorResumeRequestData = z.output<typeof TailorResumeRequestSchema>
export type DraftResponse = z.infer<typeof DraftResponseSchema>

export type ExtractedArtifactKind = 'text' | 'pdf' | 'docx' | 'image'

export interface ExtractedArtifact {
  id: string
  filename: string
  mediaType: string
  kind: ExtractedArtifactKind
  text?: string
  imageDataUrl?: string
  warnings: string[]
}

export interface InputBundle {
  jobDescription: string
  jobArtifacts: ExtractedArtifact[]
  candidateArtifacts: ExtractedArtifact[]
}

export interface CandidateNormalizationResult {
  resume: Resume
  sourceArtifactIds: string[]
  questions: FollowUpQuestion[]
  warnings: string[]
  telemetry?: StructuredOutputTelemetry
}

export interface Evidence {
  id: string
  path: string
  section: string
  text: string
}

export type MatchStatus = 'matched' | 'partial' | 'missing'

export interface RequirementMatch {
  requirementId: string
  requirement: string
  status: MatchStatus
  evidenceIds: string[]
  rationale: string
}

export interface MatchReport {
  score: number
  matchedRequirements: RequirementMatch[]
  missingRequirements: RequirementMatch[]
  selectedEvidenceIds: string[]
}

export type AgentRunStatus =
  | 'queued'
  | 'ingesting_inputs'
  | 'normalizing_candidate'
  | 'needs_input'
  | 'analyzing_jd'
  | 'matching_evidence'
  | 'drafting'
  | 'validating'
  | 'rendering'
  | 'completed'
  | 'failed'

export interface AgentTraceEvent {
  name: string
  status: 'started' | 'completed' | 'failed'
  at: string
  metadata?: Record<string, string | number | boolean>
}

export interface ResumeTailoringCheckpoint {
  version: 1
  jobText: string
  jobArtifacts: ExtractedArtifact[]
  candidateArtifacts: ExtractedArtifact[]
  candidate: Resume
  preferences: TailorPreferences
  questions: FollowUpQuestion[]
  warnings: string[]
  trace: AgentTraceEvent[]
}

export type ResumeChangeType = 'added' | 'removed' | 'changed' | 'reordered'

export interface ResumeChange {
  type: ResumeChangeType
  path: string
  section: string
  before?: unknown
  after?: unknown
}

export interface ResumeDiff {
  changes: ResumeChange[]
  counts: Record<ResumeChangeType, number>
}

export interface QualityWarning {
  code: string
  severity: 'info' | 'warning'
  message: string
}

export interface QualityReport {
  requirementCoverage: number
  mustHaveCoverage: number
  keywordCoverage: number
  matchedKeywords: string[]
  missingKeywords: string[]
  missingMustHave: string[]
  warnings: QualityWarning[]
}

export interface OutputArtifact {
  format: OutputFormat
  style: StylePresetID
  filename: string
  mediaType: string
  encoding: 'utf8' | 'base64'
  content: string
  sizeBytes: number
}

export interface ArtifactFailure {
  format: OutputFormat
  style: StylePresetID
  code: string
  message: string
}

export interface RenderedVariant {
  style: StylePresetID
  label: string
  template: string
  artifacts: OutputArtifact[]
  failures: ArtifactFailure[]
}

export interface RenderedResume {
  yaml?: string
  json?: string
  markdown?: string
  html?: string
  latex?: string
  artifacts: OutputArtifact[]
  failures: ArtifactFailure[]
}

export interface TailorResumeResult {
  status: Extract<AgentRunStatus, 'completed'>
  jobSpec: JobSpec
  matchReport: MatchReport
  diff: ResumeDiff
  quality: QualityReport
  resume: Resume
  rendered: RenderedResume
  variants: RenderedVariant[]
  questions: FollowUpQuestion[]
  warnings: string[]
  trace: AgentTraceEvent[]
}

export interface AgentRunFailure {
  code: string
  message: string
}

export interface ResumeAgentRun {
  id: string
  status: AgentRunStatus
  createdAt: string
  updatedAt: string
  interactions?: InteractionRequest[]
  result?: TailorResumeResult
  error?: AgentRunFailure
}

export interface LlmImageAttachment {
  filename: string
  mediaType: string
  dataUrl: string
}

export interface JsonCompletionRequest {
  system: string
  user: string
  schemaName: string
  images?: LlmImageAttachment[]
}

export interface LlmUsage {
  inputTokens?: number
  outputTokens?: number
  reasoningTokens?: number
}

export interface LlmCallMetadata {
  provider: string
  model: string
  durationMs: number
  attempt: number
  requestId?: string
  usage?: LlmUsage
}

export interface LlmCompletion<T> {
  data: T
  metadata: LlmCallMetadata
}

export interface StructuredOutputTelemetry {
  provider: string
  model: string
  modelCalls: number
  repairAttempts: number
  transportAttempts: number
  durationMs: number
  normalizedOutput: boolean
  inputTokens?: number
  outputTokens?: number
  reasoningTokens?: number
}

export interface LlmClient {
  completeJson<T>(request: JsonCompletionRequest): Promise<LlmCompletion<T>>
}
