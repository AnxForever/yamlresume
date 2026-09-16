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

/**
 * Mirrors of the `@yamlresume/resume-agent` public contracts.
 *
 * These are hand-written on purpose. The backend package depends on zod 4 and
 * pulls in `@yamlresume/core`; the browser bundle only needs the response
 * shapes. Keep this file aligned with
 * `packages/resume-agent/src/contracts.ts` — the backend is the source of
 * truth, and any disagreement means this file is stale.
 */

export type AgentRunStatus =
  | 'queued'
  | 'ingesting_inputs'
  | 'normalizing_candidate'
  | 'analyzing_jd'
  | 'matching_evidence'
  | 'drafting'
  | 'validating'
  | 'rendering'
  | 'needs_input'
  | 'completed'
  | 'failed'

export type TraceStatus = 'started' | 'completed' | 'failed'

export type TraceMetadataValue = string | number | boolean

export interface AgentTraceEvent {
  name: string
  status: TraceStatus
  at: string
  metadata?: Record<string, TraceMetadataValue>
}

export type InteractionSeverity = 'blocking' | 'important' | 'optional'

export type InteractionPrivacy = 'standard' | 'personal' | 'sensitive'

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

/**
 * The ten control types the backend ships. A newer backend may add an unknown
 * `type` at runtime — renderers must treat the discriminated union as
 * non-exhaustive and degrade on the `else` branch (a `{ type: string }` member
 * is deliberately NOT part of this union, because `type: string` would
 * overlap every literal and destroy narrowing).
 */
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
  severity: InteractionSeverity
  privacy: InteractionPrivacy
  control: InteractionControl
}

export interface InteractionAnswer {
  interactionId: string
  idempotencyKey: string
  value: unknown
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

export type RequirementImportance = 'must-have' | 'nice-to-have'

export type RequirementCategory =
  | 'technical'
  | 'domain'
  | 'responsibility'
  | 'soft-skill'
  | 'other'

export interface JobRequirement {
  id: string
  text: string
  keywords: string[]
  importance: RequirementImportance
  category: RequirementCategory
}

export type Seniority =
  | 'intern'
  | 'junior'
  | 'mid'
  | 'senior'
  | 'lead'
  | 'unknown'

export interface JobSpec {
  targetTitle: string
  seniority: Seniority
  company?: string
  summary: string
  requirements: JobRequirement[]
  keywords: string[]
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

export type OutputFormat =
  | 'yaml'
  | 'json'
  | 'markdown'
  | 'html'
  | 'latex'
  | 'pdf'
  | 'docx'

export type StylePresetID =
  | 'ats-compact'
  | 'modern-professional'
  | 'modern-classic'
  | 'modern-casual'
  | 'developer-two-column'

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

export interface FollowUpQuestion {
  field: string
  question: string
  reason: string
  severity: InteractionSeverity
}

export interface TailorResumeResult {
  status: 'completed'
  jobSpec: JobSpec
  matchReport: MatchReport
  diff: ResumeDiff
  quality: QualityReport
  resume: unknown
  rendered: RenderedResume
  variants: RenderedVariant[]
  questions: FollowUpQuestion[]
  warnings: string[]
  trace: AgentTraceEvent[]
}
