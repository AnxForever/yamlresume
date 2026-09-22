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

import type {
  AgentRunStatus,
  AgentTraceEvent,
  ChatRequest,
  ChatResponse,
  DraftResponse,
  JobSpec,
  LlmClient,
  ResumeTailoringCheckpoint,
  StructuredOutputTelemetry,
  TailorResumeRequest,
  TailorResumeResult,
} from '@/contracts'
import {
  ChatResponseSchema,
  DraftResponseSchema,
  JobSpecSchema,
} from '@/contracts'
import { extractArtifacts } from '@/input/artifacts'
import { artifactEvidence, normalizeCandidateInput } from '@/input/candidate'
import { completeStructuredOutput } from '@/llm/structured-output'
import { buildMatchReport } from '@/matching/match'
import {
  buildDraftPrompt,
  buildJobAnalysisPrompt,
  INTERACTION_CONTROL_EXPECTED_SHAPE,
} from '@/prompts'
import { renderResumeVariant } from '@/rendering/artifacts'
import {
  applyStylePreset,
  getStylePreset,
  resolveStyleIDs,
} from '@/rendering/styles'
import { buildResumeDiff } from '@/transparency/diff'
import { buildQualityReport } from '@/transparency/quality'
import { buildEvidenceIndex } from '@/validation/evidence'
import { prepareDraftResume } from '@/validation/resume'
import {
  budgetedLlmClient,
  type RunBudget,
  type RunBudgetLimits,
  toRunBudget,
} from '@/workflow/budget'

const JOB_ANALYSIS_SYSTEM_PROMPT =
  'You are a resume tailoring analyst. Extract job requirements into the requested JSON shape. Do not invent details that are not in the job description.'
const DRAFT_SYSTEM_PROMPT =
  'You are a resume editor. Produce a targeted YAMLResume JSON object using only candidate evidence. Never fabricate facts.'
const JOB_SPEC_EXPECTED_SHAPE = `{
  "targetTitle": string,
  "seniority": "intern" | "junior" | "mid" | "senior" | "lead" | "unknown",
  "company"?: string,
  "summary": string,
  "requirements": [{
    "id": string,
    "text": string,
    "keywords": string[],
    "importance": "must-have" | "nice-to-have",
    "category": "technical" | "domain" | "responsibility" | "soft-skill" | "other"
  }],
  "keywords": string[]
}`
const DRAFT_RESPONSE_EXPECTED_SHAPE = `{
  "resume": YAMLResume object,
  "selectedEvidenceIds": string[],
  "questions": [{
    "field": string,
    "question": string,
    "reason": string,
    "severity": "blocking" | "important" | "optional",
    "control"?: ${INTERACTION_CONTROL_EXPECTED_SHAPE}
  }],
  "notes": string[]
}`

function now(): string {
  return new Date().toISOString()
}

function addTrace(
  trace: AgentTraceEvent[],
  name: string,
  status: AgentTraceEvent['status'],
  metadata?: AgentTraceEvent['metadata']
): void {
  trace.push({ name, status, at: now(), ...(metadata ? { metadata } : {}) })
}

function structuredOutputMetadata(
  telemetry: StructuredOutputTelemetry
): AgentTraceEvent['metadata'] {
  return {
    provider: telemetry.provider,
    model: telemetry.model,
    modelCalls: telemetry.modelCalls,
    repairAttempts: telemetry.repairAttempts,
    transportAttempts: telemetry.transportAttempts,
    modelDurationMs: telemetry.durationMs,
    normalizedOutput: telemetry.normalizedOutput,
    ...(telemetry.inputTokens === undefined
      ? {}
      : { inputTokens: telemetry.inputTokens }),
    ...(telemetry.outputTokens === undefined
      ? {}
      : { outputTokens: telemetry.outputTokens }),
    ...(telemetry.reasoningTokens === undefined
      ? {}
      : { reasoningTokens: telemetry.reasoningTokens }),
  }
}

type ActiveAgentRunStatus = Exclude<
  AgentRunStatus,
  'queued' | 'needs_input' | 'completed' | 'failed'
>

export interface ResumeTailoringRunOptions {
  onStatus?: (status: ActiveAgentRunStatus) => Promise<void> | void
  /**
   * Call and token ceilings for this run.
   *
   * Pass `RunBudgetLimits` to set ceilings, or an existing `RunBudget` to share
   * one tracker across phases. `run` creates a single tracker and threads it
   * through `prepare` and `complete`, so one run is metered as a whole rather
   * than per phase.
   */
  budget?: RunBudget | RunBudgetLimits
}

async function reportStatus(
  options: ResumeTailoringRunOptions,
  status: ActiveAgentRunStatus
): Promise<void> {
  await options.onStatus?.(status)
}

function enumValue(
  value: unknown,
  allowed: string[],
  aliases: Record<string, string>
): unknown {
  if (typeof value !== 'string') return value
  const normalized = value.trim().toLowerCase()
  if (allowed.includes(normalized)) return normalized
  return aliases[normalized] ?? value
}

function normalizeJobSpec(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return value
  }
  const raw = value as Record<string, unknown>
  const targetTitle = raw.targetTitle ?? raw.jobTitle ?? raw.job_title
  const seniority = enumValue(
    raw.seniority,
    ['intern', 'junior', 'mid', 'senior', 'lead', 'unknown'],
    {
      'entry-level': 'junior',
      entry: 'junior',
      'early-career': 'junior',
      unspecified: 'unknown',
      'not specified': 'unknown',
    }
  )
  const requirements = Array.isArray(raw.requirements)
    ? raw.requirements.map((item, index) => {
        if (typeof item === 'string') {
          return {
            id: `requirement-${index + 1}`,
            text: item,
            keywords: [],
            importance: 'must-have',
            category: 'other',
          }
        }
        if (typeof item !== 'object' || item === null || Array.isArray(item)) {
          return item
        }
        const requirement = item as Record<string, unknown>
        return {
          ...requirement,
          id: requirement.id ?? requirement.key ?? `requirement-${index + 1}`,
          text:
            requirement.text ??
            requirement.description ??
            requirement.requirement,
          keywords: requirement.keywords,
          importance: enumValue(
            requirement.importance ?? requirement.priority,
            ['must-have', 'nice-to-have'],
            {
              high: 'must-have',
              critical: 'must-have',
              required: 'must-have',
              must: 'must-have',
              medium: 'nice-to-have',
              low: 'nice-to-have',
              optional: 'nice-to-have',
            }
          ),
          category: enumValue(
            requirement.category,
            ['technical', 'domain', 'responsibility', 'soft-skill', 'other'],
            {
              programming: 'technical',
              ai: 'technical',
              'ai agents': 'technical',
              'ai infrastructure': 'technical',
              backend: 'technical',
              quality: 'technical',
              tools: 'technical',
              product: 'responsibility',
              professional: 'soft-skill',
              security: 'technical',
            }
          ),
        }
      })
    : raw.requirements

  return {
    ...raw,
    ...(targetTitle !== undefined ? { targetTitle } : {}),
    seniority,
    summary: raw.summary,
    requirements,
    keywords: raw.keywords,
  }
}

export class ResumeTailoringAgent {
  constructor(private readonly llm: LlmClient) {}

  async chat(
    request: ChatRequest,
    options: ResumeTailoringRunOptions = {}
  ): Promise<ChatResponse> {
    const history = (request.history ?? [])
      .map((entry) => `${entry.role.toUpperCase()}: ${entry.content}`)
      .join('\n')
    const llm = budgetedLlmClient(this.llm, toRunBudget(options.budget))
    const completion = await llm.completeJson<ChatResponse>({
      schemaName: 'ResumeAgentChatResponse',
      system:
        'You are a friendly resume assistant. Chat naturally in the user language. Do not require uploads. Ask for missing resume details conversationally. Set readyToGenerate true only when the user has provided enough information to draft a resume.',
      user: [
        history ? `CONVERSATION:\n${history}` : '',
        request.context ? `CONTEXT:\n${request.context}` : '',
        `USER: ${request.message}`,
        'Return JSON with reply and readyToGenerate.',
      ]
        .filter(Boolean)
        .join('\n\n'),
    })
    return ChatResponseSchema.parse(completion.data)
  }

  async run(
    request: TailorResumeRequest,
    options: ResumeTailoringRunOptions = {}
  ): Promise<TailorResumeResult> {
    // One tracker for the whole run: `prepare` and `complete` must not each
    // get a fresh allowance, or a run could spend the budget twice over.
    const budget = toRunBudget(options.budget)
    const shared: ResumeTailoringRunOptions = { ...options, budget }
    const checkpoint = await this.prepare(request, shared)
    return this.complete(checkpoint, shared)
  }

  async prepare(
    request: TailorResumeRequest,
    options: ResumeTailoringRunOptions = {}
  ): Promise<ResumeTailoringCheckpoint> {
    const llm = budgetedLlmClient(this.llm, toRunBudget(options.budget))
    const trace: AgentTraceEvent[] = []
    const preferences = request.preferences ?? {}
    const candidateFiles = request.candidate.files ?? []
    const jobFiles = request.jobFiles ?? []

    await reportStatus(options, 'ingesting_inputs')
    addTrace(trace, 'ingest_inputs', 'started', {
      candidateFiles: candidateFiles.length,
      jobFiles: jobFiles.length,
    })
    const [candidateArtifacts, jobArtifacts] = await Promise.all([
      extractArtifacts(candidateFiles),
      extractArtifacts(jobFiles),
    ])
    const jobText = [
      request.jobDescription ?? '',
      ...jobArtifacts
        .filter((artifact) => artifact.text)
        .map((artifact) => artifact.text),
    ]
      .filter(Boolean)
      .join('\n\n')
      .trim()
    if (!jobText && jobArtifacts.length === 0) {
      throw new Error('No job description text or files were provided')
    }
    addTrace(trace, 'ingest_inputs', 'completed', {
      candidateArtifacts: candidateArtifacts.length,
      jobArtifacts: jobArtifacts.length,
    })

    await reportStatus(options, 'normalizing_candidate')
    addTrace(trace, 'normalize_candidate', 'started')
    const normalizedCandidate = await normalizeCandidateInput(
      llm,
      request.candidate,
      candidateArtifacts
    )
    const candidate = normalizedCandidate.resume
    addTrace(trace, 'normalize_candidate', 'completed', {
      questions: normalizedCandidate.questions.length,
      warnings: normalizedCandidate.warnings.length,
      ...(normalizedCandidate.telemetry
        ? structuredOutputMetadata(normalizedCandidate.telemetry)
        : {}),
    })

    return {
      version: 1,
      jobText,
      jobArtifacts,
      candidateArtifacts,
      candidate,
      preferences,
      questions: normalizedCandidate.questions,
      warnings: normalizedCandidate.warnings,
      trace,
    }
  }

  async complete(
    checkpoint: ResumeTailoringCheckpoint,
    options: ResumeTailoringRunOptions = {}
  ): Promise<TailorResumeResult> {
    const llm = budgetedLlmClient(this.llm, toRunBudget(options.budget))
    const {
      candidate,
      candidateArtifacts,
      jobArtifacts,
      jobText,
      preferences,
    } = checkpoint
    const trace = structuredClone(checkpoint.trace)
    const evidence = buildEvidenceIndex(
      candidate,
      artifactEvidence(candidateArtifacts)
    )

    await reportStatus(options, 'analyzing_jd')
    addTrace(trace, 'analyze_job', 'started')
    let jobSpec: JobSpec
    try {
      const jobCompletion = await completeStructuredOutput(llm, {
        request: {
          schemaName: 'JobSpec',
          system: JOB_ANALYSIS_SYSTEM_PROMPT,
          user: buildJobAnalysisPrompt(
            jobText ||
              'The job description is contained in the attached files.',
            jobArtifacts
          ),
          images: jobArtifacts
            .filter((artifact) => artifact.imageDataUrl)
            .map((artifact) => ({
              filename: artifact.filename,
              mediaType: artifact.mediaType,
              dataUrl: artifact.imageDataUrl as string,
            })),
        },
        schema: JobSpecSchema,
        expectedShape: JOB_SPEC_EXPECTED_SHAPE,
        normalize: normalizeJobSpec,
      })
      jobSpec = jobCompletion.data
      addTrace(trace, 'analyze_job', 'completed', {
        requirements: jobSpec.requirements.length,
        ...structuredOutputMetadata(jobCompletion.telemetry),
      })
    } catch (error) {
      addTrace(trace, 'analyze_job', 'failed')
      throw error
    }

    await reportStatus(options, 'matching_evidence')
    addTrace(trace, 'match_evidence', 'started', {
      evidence: evidence.length,
    })
    const matchReport = buildMatchReport(jobSpec, evidence)
    addTrace(trace, 'match_evidence', 'completed', {
      score: matchReport.score,
      matched: matchReport.matchedRequirements.length,
      missing: matchReport.missingRequirements.length,
    })

    const evidenceIds = new Set(evidence.map((item) => item.id))

    await reportStatus(options, 'drafting')
    addTrace(trace, 'draft_resume', 'started')
    let draftResponse: DraftResponse
    try {
      const draftCompletion = await completeStructuredOutput(llm, {
        request: {
          schemaName: 'TailoredResumeDraft',
          system: DRAFT_SYSTEM_PROMPT,
          user: buildDraftPrompt(
            jobSpec,
            candidate,
            evidence,
            preferences,
            candidateArtifacts
          ),
          images: candidateArtifacts
            .filter((artifact) => artifact.imageDataUrl)
            .map((artifact) => ({
              filename: artifact.filename,
              mediaType: artifact.mediaType,
              dataUrl: artifact.imageDataUrl as string,
            })),
        },
        schema: DraftResponseSchema,
        expectedShape: DRAFT_RESPONSE_EXPECTED_SHAPE,
      })
      draftResponse = draftCompletion.data
      const invalidEvidenceId = draftResponse.selectedEvidenceIds.find(
        (id) => !evidenceIds.has(id)
      )
      if (invalidEvidenceId) {
        throw new Error(
          `Generated draft referenced unknown evidence: ${invalidEvidenceId}`
        )
      }
      addTrace(trace, 'draft_resume', 'completed', {
        ...structuredOutputMetadata(draftCompletion.telemetry),
      })
    } catch (error) {
      addTrace(trace, 'draft_resume', 'failed')
      throw error
    }

    await reportStatus(options, 'validating')
    addTrace(trace, 'validate_resume', 'started')
    const resume = prepareDraftResume(
      draftResponse.resume,
      candidate,
      preferences
    )
    addTrace(trace, 'validate_resume', 'completed')

    addTrace(trace, 'assess_resume', 'started')
    const diff = buildResumeDiff(candidate, resume)
    const quality = buildQualityReport(jobSpec, resume)
    addTrace(trace, 'assess_resume', 'completed', {
      changes: diff.changes.length,
      mustHaveCoverage: quality.mustHaveCoverage,
      keywordCoverage: quality.keywordCoverage,
    })

    await reportStatus(options, 'rendering')
    addTrace(trace, 'render_resume', 'started')
    const styleIDs = resolveStyleIDs(preferences)
    const formats = preferences.formats ?? [
      'yaml',
      'json',
      'markdown',
      'html',
      'latex',
    ]
    const variants = []
    for (const style of styleIDs) {
      variants.push(await renderResumeVariant(resume, style, { formats }))
    }
    const primaryResume = applyStylePreset(resume, styleIDs[0])
    const primaryVariant = variants[0]
    if (!primaryVariant) {
      throw new Error('At least one resume style variant is required')
    }
    const rendered = primaryVariant
    const renderedVariants = styleIDs.map((style, index) => {
      const preset = getStylePreset(style)
      return {
        style,
        label: preset.label,
        template: preset.template,
        artifacts: variants[index].artifacts,
        failures: variants[index].failures,
      }
    })
    addTrace(trace, 'render_resume', 'completed', {
      styles: styleIDs.length,
      formats: formats.length,
      failures: renderedVariants.reduce(
        (total, variant) => total + variant.failures.length,
        0
      ),
    })

    return {
      status: 'completed',
      jobSpec,
      diff,
      quality,
      matchReport: {
        ...matchReport,
        selectedEvidenceIds: draftResponse.selectedEvidenceIds.length
          ? draftResponse.selectedEvidenceIds
          : matchReport.selectedEvidenceIds,
      },
      resume: primaryResume,
      rendered,
      variants: renderedVariants,
      questions: [...checkpoint.questions, ...draftResponse.questions],
      warnings: [
        ...checkpoint.warnings,
        ...draftResponse.notes,
        ...renderedVariants.flatMap((variant) =>
          variant.failures.map((failure) => failure.message)
        ),
      ],
      trace,
    }
  }
}
