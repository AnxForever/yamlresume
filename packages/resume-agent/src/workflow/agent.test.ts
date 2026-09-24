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
import type {
  JsonCompletionRequest,
  LlmClient,
  ResumeTailoringCheckpoint,
} from '@/contracts'
import { StructuredOutputValidationError } from '@/llm/structured-output'
import { renderOdtDocument } from '@/rendering/odt'
import type { EmbeddingClient } from '@/retrieval/embeddings'
import { ResumeTailoringAgent } from '@/workflow/agent'

const candidate = {
  content: {
    basics: {
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      summary: 'Built reliable analytical systems.',
    },
    education: [],
    projects: [
      {
        name: 'Compiler project',
        startDate: '2024',
        summary: '- Built a TypeScript compiler service',
        keywords: ['TypeScript'],
      },
    ],
  },
  layouts: [
    { engine: 'latex', template: 'jake' },
    { engine: 'html', template: 'calm' },
  ],
}

describe('ResumeTailoringAgent', () => {
  it('supports direct chat without uploaded context', async () => {
    const llm: LlmClient = {
      async completeJson(request) {
        expect(request.schemaName).toBe('ResumeAgentChatResponse')
        return {
          data: { reply: '先告诉我你的目标职位。', readyToGenerate: false },
          metadata: {
            provider: 'fake',
            model: 'fake',
            durationMs: 1,
            attempt: 1,
          },
        }
      },
    }
    await expect(
      new ResumeTailoringAgent(llm).chat({ message: '你好' })
    ).resolves.toEqual({
      reply: '先告诉我你的目标职位。',
      readyToGenerate: false,
    })
  })

  it('runs the tailoring workflow and renders a schema-valid resume', async () => {
    const responses = [
      {
        targetTitle: 'TypeScript Engineer',
        seniority: 'junior',
        summary: 'Builds TypeScript systems',
        requirements: [
          {
            id: 'typescript',
            text: 'TypeScript experience',
            keywords: ['TypeScript'],
            importance: 'must-have',
            category: 'technical',
          },
        ],
        keywords: ['TypeScript'],
      },
      {
        resume: candidate,
        selectedEvidenceIds: ['candidate.content.projects[0].keywords[0]'],
        questions: [],
        notes: [],
      },
    ]

    const llm: LlmClient = {
      async completeJson() {
        return {
          data: responses.shift(),
          metadata: {
            provider: 'fake',
            model: 'fake-model',
            durationMs: 1,
            attempt: 1,
          },
        }
      },
    }

    const result = await new ResumeTailoringAgent(llm).run({
      jobDescription: 'We need a TypeScript Engineer.',
      candidate: { resume: candidate },
    })

    expect(result.status).toBe('completed')
    expect(result.jobSpec.targetTitle).toBe('TypeScript Engineer')
    expect(result.matchReport.score).toBe(1)
    expect(result.rendered.yaml).toContain('Ada Lovelace')
    expect(result.rendered.latex).toContain('Ada Lovelace')
    expect(result.rendered.html).toContain('Ada Lovelace')
    expect(result.quality.mustHaveCoverage).toBe(1)
    expect(result.diff.counts.added).toBe(0)
    expect(result.trace.map((event) => event.name)).toEqual([
      'ingest_inputs',
      'ingest_inputs',
      'normalize_candidate',
      'normalize_candidate',
      'analyze_job',
      'analyze_job',
      'match_evidence',
      'match_evidence',
      'draft_resume',
      'draft_resume',
      'validate_resume',
      'validate_resume',
      'assess_resume',
      'assess_resume',
      'render_resume',
      'render_resume',
    ])
  })

  it('propagates one cancellation signal through job analysis and drafting', async () => {
    const receivedSignals: Array<AbortSignal | undefined> = []
    const llm: LlmClient = {
      async completeJson<T>(request, options) {
        receivedSignals.push(options?.signal)
        const data =
          request.schemaName === 'JobSpec'
            ? {
                targetTitle: 'TypeScript Engineer',
                seniority: 'junior',
                summary: 'Builds TypeScript systems',
                requirements: [],
                keywords: [],
              }
            : {
                resume: candidate,
                selectedEvidenceIds: [],
                questions: [],
                notes: [],
              }
        return {
          data: data as T,
          metadata: {
            provider: 'fake',
            model: 'fake-model',
            durationMs: 1,
            attempt: 1,
          },
        }
      },
    }
    const controller = new AbortController()

    await new ResumeTailoringAgent(llm).run(
      {
        jobDescription: 'We need a TypeScript Engineer for reliable systems.',
        candidate: { resume: candidate },
      },
      { signal: controller.signal }
    )

    expect(receivedSignals).toEqual([controller.signal, controller.signal])
  })

  it('adds semantic evidence to the gaps, hints the draft, and keeps the lexical judge', async () => {
    const jobSpec = {
      targetTitle: 'Platform Engineer',
      seniority: 'mid',
      summary: 'Runs clusters',
      requirements: [
        {
          id: 'typescript',
          text: 'TypeScript experience',
          keywords: ['TypeScript'],
          importance: 'must-have',
          category: 'technical',
        },
        {
          id: 'compilers',
          text: 'Build language tooling',
          keywords: ['language tooling'],
          importance: 'must-have',
          category: 'technical',
        },
      ],
      keywords: ['TypeScript', 'language tooling'],
    }
    const requests: JsonCompletionRequest[] = []
    const llm: LlmClient = {
      async completeJson(request) {
        requests.push(request)
        const data =
          request.schemaName === 'JobSpec'
            ? jobSpec
            : {
                resume: candidate,
                selectedEvidenceIds: [],
                questions: [],
                notes: [],
              }
        return {
          data,
          metadata: {
            provider: 'fake',
            model: 'fake',
            durationMs: 1,
            attempt: 1,
          },
        }
      },
    }
    const embeddings: EmbeddingClient = {
      id: 'scripted-e5',
      async embed(texts, kind) {
        return texts.map((text) => {
          if (kind === 'query') return [1, 0, 0]
          if (text === '- Built a TypeScript compiler service')
            return [0.98, 0.2, 0]
          return [0.5, 0.5, 0.7]
        })
      },
    }
    const request = {
      jobDescription:
        'We need a Platform Engineer who builds language tooling.',
      candidate: { resume: candidate },
    }
    const lexical = await new ResumeTailoringAgent(llm).run(request)
    const hybrid = await new ResumeTailoringAgent(llm, {
      retrieval: {
        embeddings,
        acceptance: {
          kind: 'background-margin',
          margin: 0.1,
          background: ['neutral'],
        },
      },
    }).run(request)

    const compilers = hybrid.matchReport.matchedRequirements.find(
      (match) => match.requirementId === 'compilers'
    )
    expect(compilers?.status).toBe('partial')
    expect(compilers?.evidenceIds).toEqual([
      'candidate.content.projects[0].summary',
    ])
    expect(compilers?.rationale).toMatch(/Semantic match/)
    expect(hybrid.matchReport.score).toBe(1)
    expect(lexical.matchReport.score).toBe(0.5)

    const draftPrompt = requests.at(-1)?.user ?? ''
    expect(draftPrompt).toContain('REQUIREMENT EVIDENCE HINTS')
    expect(draftPrompt).toContain(
      'typescript | matched | candidate.content.projects[0].summary, candidate.content.projects[0].keywords[0]'
    )
    expect(draftPrompt).toContain(
      'compilers | partial (semantic) | candidate.content.projects[0].summary'
    )
    expect(requests[1]?.user).not.toContain('REQUIREMENT EVIDENCE HINTS')

    const matchTrace = hybrid.trace.find(
      (event) => event.name === 'match_evidence' && event.status === 'completed'
    )
    expect(matchTrace?.metadata).toMatchObject({
      matcher: 'hybrid',
      embeddingModel: 'scripted-e5',
      semanticMatches: 1,
    })
    // Judge separation: the quality report is computed by the lexical
    // matcher on the final resume, so it is identical with and without
    // retrieval when the draft did not change.
    expect(hybrid.quality).toEqual(lexical.quality)
    expect(hybrid.quality.requirementCoverage).toBe(0.5)
  })

  it('falls back to keyword matching with a warning when embeddings fail', async () => {
    const llm: LlmClient = {
      async completeJson(request) {
        const data =
          request.schemaName === 'JobSpec'
            ? {
                targetTitle: 'Engineer',
                seniority: 'unknown',
                summary: 'Builds things',
                requirements: [
                  {
                    id: 'tooling',
                    text: 'Build language tooling',
                    keywords: ['language tooling'],
                    importance: 'must-have',
                    category: 'technical',
                  },
                ],
                keywords: ['language tooling'],
              }
            : {
                resume: candidate,
                selectedEvidenceIds: [],
                questions: [],
                notes: [],
              }
        return {
          data,
          metadata: {
            provider: 'fake',
            model: 'fake',
            durationMs: 1,
            attempt: 1,
          },
        }
      },
    }
    const result = await new ResumeTailoringAgent(llm, {
      retrieval: {
        embeddings: {
          id: 'absent-model',
          async embed() {
            throw new Error('model not downloaded')
          },
        },
      },
    }).run({
      jobDescription: 'We need an engineer who builds language tooling.',
      candidate: { resume: candidate },
    })
    expect(result.status).toBe('completed')
    expect(result.matchReport.score).toBe(0)
    expect(result.warnings).toContain(
      'Semantic evidence matching was unavailable; requirement matching used keywords only.'
    )
    const matchTrace = result.trace.find(
      (event) => event.name === 'match_evidence' && event.status === 'completed'
    )
    expect(matchTrace?.metadata).toMatchObject({
      matcher: 'hybrid',
      semanticFallback: 'embedding_failed',
    })
  })

  it('ingests ODT candidate and job files through the complete workflow', async () => {
    const requests: JsonCompletionRequest[] = []
    const responses = [
      {
        resume: candidate,
        sourceArtifactIds: ['artifact.candidate.odt'],
        questions: [],
        warnings: [],
      },
      {
        targetTitle: 'Platform Engineer',
        seniority: 'senior',
        summary: 'Builds reliable TypeScript platforms',
        requirements: [],
        keywords: ['TypeScript'],
      },
      {
        resume: candidate,
        selectedEvidenceIds: [],
        questions: [],
        notes: [],
      },
    ]
    const llm: LlmClient = {
      async completeJson(request) {
        requests.push(request)
        return {
          data: responses.shift(),
          metadata: {
            provider: 'fake',
            model: 'fake-model',
            durationMs: 1,
            attempt: 1,
          },
        }
      },
    }
    const candidateOdt = renderOdtDocument({
      title: 'ODT Candidate',
      headline: 'Reliable platform engineer',
      contacts: [],
      summaryHeading: 'Summary',
      summary: ['Builds TypeScript services.'],
      sections: [],
    })
    const jobOdt = renderOdtDocument({
      title: 'Platform Engineer Role',
      headline: '',
      contacts: [],
      summaryHeading: 'Requirements',
      summary: ['Build reliable TypeScript platforms.'],
      sections: [],
    })

    const result = await new ResumeTailoringAgent(llm).run({
      jobFiles: [
        {
          filename: 'role.odt',
          contentBase64: jobOdt.toString('base64'),
        },
      ],
      candidate: {
        files: [
          {
            filename: 'candidate.odt',
            contentBase64: candidateOdt.toString('base64'),
          },
        ],
      },
      preferences: { formats: ['yaml'] },
    })

    expect(result.status).toBe('completed')
    expect(requests[0]?.user).toContain('Reliable platform engineer')
    expect(requests[1]?.user).toContain('Build reliable TypeScript platforms.')
  })

  it('ingests RTF candidate and job files through the complete workflow', async () => {
    const requests: JsonCompletionRequest[] = []
    const responses = [
      {
        resume: candidate,
        sourceArtifactIds: ['artifact.candidate.rtf'],
        questions: [],
        warnings: [],
      },
      {
        targetTitle: 'Platform Engineer',
        seniority: 'senior',
        summary: 'Builds reliable TypeScript platforms',
        requirements: [],
        keywords: ['TypeScript'],
      },
      {
        resume: candidate,
        selectedEvidenceIds: [],
        questions: [],
        notes: [],
      },
    ]
    const llm: LlmClient = {
      async completeJson(request) {
        requests.push(request)
        return {
          data: responses.shift(),
          metadata: {
            provider: 'fake',
            model: 'fake-model',
            durationMs: 1,
            attempt: 1,
          },
        }
      },
    }
    const candidateRtf = Buffer.from(
      String.raw`{\rtf1\ansi\deff0\uc1\b Ada Lovelace\b0\par Built TypeScript services.}`
    )
    const jobRtf = Buffer.from(
      String.raw`{\rtf1\ansi\deff0\uc1 Platform Engineer\par Build reliable TypeScript platforms.}`
    )

    const result = await new ResumeTailoringAgent(llm).run({
      jobFiles: [
        { filename: 'role.rtf', contentBase64: jobRtf.toString('base64') },
      ],
      candidate: {
        files: [
          {
            filename: 'candidate.rtf',
            contentBase64: candidateRtf.toString('base64'),
          },
        ],
      },
      preferences: { formats: ['yaml'] },
    })

    expect(result.status).toBe('completed')
    expect(requests[0]?.user).toContain('Ada Lovelace')
    expect(requests[0]?.user).toContain('Built TypeScript services.')
    expect(requests[1]?.user).toContain('Platform Engineer')
    expect(requests[1]?.user).toContain('Build reliable TypeScript platforms.')
  })

  it('normalizes an omitted empty education collection from file input', async () => {
    const responses = [
      {
        resume: {
          content: {
            basics: candidate.content.basics,
            skills: [
              { name: 'TypeScript' },
              { name: 'Python', level: 'Advanced' },
            ],
            projects: candidate.content.projects,
          },
          layouts: candidate.layouts,
        },
        sourceArtifactIds: ['candidate.txt'],
        questions: [],
        warnings: [],
      },
      {
        targetTitle: 'TypeScript Engineer',
        seniority: 'junior',
        summary: 'Builds TypeScript systems',
        requirements: [],
        keywords: ['TypeScript'],
      },
      {
        resume: {
          ...candidate,
          content: {
            ...candidate.content,
            skills: [{ name: 'Python', level: 'Advanced' }],
          },
        },
        selectedEvidenceIds: [],
        questions: [],
        notes: [],
      },
    ]
    const llm: LlmClient = {
      async completeJson() {
        return {
          data: responses.shift(),
          metadata: {
            provider: 'fake',
            model: 'fake-model',
            durationMs: 1,
            attempt: 1,
          },
        }
      },
    }

    const result = await new ResumeTailoringAgent(llm).run({
      candidate: {
        files: [{ filename: 'candidate.txt', text: 'Ada Lovelace' }],
      },
      jobDescription: 'We need a TypeScript Engineer.',
      preferences: { formats: ['yaml'] },
    })

    expect(result.status).toBe('completed')
    expect(result.resume.content.education).toEqual([])
    expect(result.resume.content.skills).toEqual([
      { name: 'Python', level: 'Advanced' },
    ])
    expect(result.warnings).toContain(
      'Some incomplete optional candidate entries were omitted; confirm missing details before submitting.'
    )
  })

  it('retains extracted source text when normalization omits a summary', async () => {
    const responses = [
      {
        resume: {
          content: {
            basics: { name: 'Ada Lovelace' },
            education: [],
          },
          layouts: candidate.layouts,
        },
        sourceArtifactIds: ['candidate.txt'],
        questions: [],
        warnings: [],
      },
      {
        targetTitle: 'Platform Engineer',
        seniority: 'unknown',
        summary: 'Build reliable platforms',
        requirements: [],
        keywords: [],
      },
      {
        resume: {
          ...candidate,
          content: {
            basics: { name: 'Ada Lovelace' },
            education: [],
          },
        },
        selectedEvidenceIds: [],
        questions: [],
        notes: [],
      },
    ]
    const llm: LlmClient = {
      async completeJson() {
        return {
          data: responses.shift(),
          metadata: {
            provider: 'fake',
            model: 'fake-model',
            durationMs: 1,
            attempt: 1,
          },
        }
      },
    }

    const result = await new ResumeTailoringAgent(llm).run({
      candidate: {
        files: [
          {
            filename: 'candidate.txt',
            text: 'Ada Lovelace built reliable TypeScript services.',
          },
        ],
      },
      jobDescription: 'Platform Engineer',
      preferences: { formats: ['yaml'] },
    })

    expect(result.status).toBe('completed')
    expect(result.warnings).toContain(
      'A summary was assembled from extracted source text because the normalized profile omitted one; review it before submitting.'
    )
  })

  it('reports metadata from each rendered style preset', async () => {
    const responses = [
      {
        targetTitle: 'TypeScript Engineer',
        seniority: 'junior',
        summary: 'Builds TypeScript systems',
        requirements: [],
        keywords: ['TypeScript'],
      },
      {
        resume: candidate,
        selectedEvidenceIds: [],
        questions: [],
        notes: [],
      },
    ]
    const llm: LlmClient = {
      async completeJson() {
        return {
          data: responses.shift(),
          metadata: {
            provider: 'fake',
            model: 'fake-model',
            durationMs: 1,
            attempt: 1,
          },
        }
      },
    }

    const result = await new ResumeTailoringAgent(llm).run({
      jobDescription: 'We need a TypeScript Engineer.',
      candidate: { resume: candidate },
      preferences: {
        formats: ['yaml'],
        styles: ['ats-compact', 'modern-classic', 'developer-two-column'],
      },
    })

    expect(
      result.variants.map(({ style, label, template }) => ({
        style,
        label,
        template,
      }))
    ).toEqual([
      { style: 'ats-compact', label: 'ATS Compact', template: 'jake' },
      {
        style: 'modern-classic',
        label: 'Modern Classic',
        template: 'moderncv-classic',
      },
      {
        style: 'developer-two-column',
        label: 'Developer Two Column',
        template: 'deedy',
      },
    ])
    expect(
      result.variants.map((variant) => variant.artifacts[0]?.style)
    ).toEqual(['ats-compact', 'modern-classic', 'developer-two-column'])
  })

  it('accepts a wrapped, compatibly normalized job analysis', async () => {
    const responses = [
      {
        data: {
          job_title: 'TypeScript Engineer',
          seniority: 'entry-level',
          summary: 'Builds TypeScript systems',
          requirements: [
            'TypeScript experience',
            {
              key: 'backend',
              description: 'API systems experience',
              priority: 'required',
              category: 'programming',
            },
          ],
          keywords: ['TypeScript'],
        },
      },
      {
        resume: candidate,
        selectedEvidenceIds: [],
        questions: [],
        notes: [],
      },
    ]
    const llm: LlmClient = {
      async completeJson() {
        return {
          data: responses.shift(),
          metadata: {
            provider: 'fake',
            model: 'fake-model',
            durationMs: 2,
            attempt: 1,
          },
        }
      },
    }

    const result = await new ResumeTailoringAgent(llm).run({
      jobDescription: 'We need a TypeScript Engineer.',
      candidate: { resume: candidate },
    })

    expect(result.jobSpec).toMatchObject({
      targetTitle: 'TypeScript Engineer',
      seniority: 'junior',
      requirements: [
        {
          id: 'requirement-1',
          text: 'TypeScript experience',
          importance: 'must-have',
          category: 'other',
        },
        {
          id: 'backend',
          text: 'API systems experience',
          importance: 'must-have',
          category: 'technical',
        },
      ],
    })
    expect(
      result.trace.find(
        (event) => event.name === 'analyze_job' && event.status === 'completed'
      )?.metadata
    ).toMatchObject({
      modelCalls: 1,
      repairAttempts: 0,
      transportAttempts: 1,
      normalizedOutput: true,
    })
  })

  it('repairs an unknown job enum instead of silently coercing it', async () => {
    const requests: JsonCompletionRequest[] = []
    const responses = [
      {
        targetTitle: 'TypeScript Engineer',
        seniority: 'wizard',
        summary: 'Builds TypeScript systems',
        requirements: [
          {
            id: 'typescript',
            text: 'TypeScript experience',
            keywords: ['TypeScript'],
            importance: 'mandatory',
            category: 'magic',
          },
        ],
        keywords: ['TypeScript'],
      },
      {
        targetTitle: 'TypeScript Engineer',
        seniority: 'senior',
        summary: 'Builds TypeScript systems',
        requirements: [
          {
            id: 'typescript',
            text: 'TypeScript experience',
            keywords: ['TypeScript'],
            importance: 'must-have',
            category: 'technical',
          },
        ],
        keywords: ['TypeScript'],
      },
      {
        resume: candidate,
        selectedEvidenceIds: [],
        questions: [],
        notes: [],
      },
    ]
    const llm: LlmClient = {
      async completeJson(request) {
        requests.push(request)
        return {
          data: responses.shift(),
          metadata: {
            provider: 'fake',
            model: 'fake-model',
            durationMs: 3,
            attempt: 1,
            usage: { inputTokens: 5, outputTokens: 2 },
          },
        }
      },
    }

    const result = await new ResumeTailoringAgent(llm).run({
      jobDescription: 'We need a senior TypeScript Engineer.',
      candidate: { resume: candidate },
    })

    expect(result.jobSpec.seniority).toBe('senior')
    expect(requests).toHaveLength(3)
    expect(requests[1]?.user).toContain('seniority')
    expect(requests[1]?.user).toContain('requirements.0.importance')
    expect(requests[1]?.user).toContain('requirements.0.category')
    expect(
      result.trace.find(
        (event) => event.name === 'analyze_job' && event.status === 'completed'
      )?.metadata
    ).toMatchObject({
      modelCalls: 2,
      repairAttempts: 1,
      transportAttempts: 2,
      modelDurationMs: 6,
      inputTokens: 10,
      outputTokens: 4,
      normalizedOutput: false,
    })
  })

  it('repairs a draft response that is missing the resume', async () => {
    const requests: JsonCompletionRequest[] = []
    const responses = [
      {
        targetTitle: 'TypeScript Engineer',
        seniority: 'junior',
        summary: 'Builds TypeScript systems',
        requirements: [],
        keywords: ['TypeScript'],
      },
      { selectedEvidenceIds: [], questions: [], notes: [] },
      {
        resume: candidate,
        selectedEvidenceIds: [],
        questions: [],
        notes: [],
      },
    ]
    const llm: LlmClient = {
      async completeJson(request) {
        requests.push(request)
        return {
          data: responses.shift(),
          metadata: {
            provider: 'fake',
            model: 'fake-model',
            durationMs: 2,
            attempt: 1,
          },
        }
      },
    }

    const result = await new ResumeTailoringAgent(llm).run({
      jobDescription: 'We need a TypeScript Engineer.',
      candidate: { resume: candidate },
    })

    expect(result.status).toBe('completed')
    expect(requests).toHaveLength(3)
    expect(requests[2]?.user).toContain('resume')
    expect(requests[2]?.user).toContain('"type": "single_choice"')
    expect(requests[2]?.user).toContain('"type": "file"')
    expect(
      result.trace.find(
        (event) => event.name === 'draft_resume' && event.status === 'completed'
      )?.metadata
    ).toMatchObject({
      modelCalls: 2,
      repairAttempts: 1,
      transportAttempts: 2,
      modelDurationMs: 4,
    })
    expect(JSON.stringify(result.trace)).not.toContain('Ada Lovelace')
    expect(JSON.stringify(result.trace)).not.toContain('ada@example.com')
  })

  it('repairs candidate normalization through the shared output loop', async () => {
    const requests: JsonCompletionRequest[] = []
    const receivedSignals: Array<AbortSignal | undefined> = []
    const responses = [
      { sourceArtifactIds: [], questions: [], warnings: [] },
      {
        resume: candidate,
        sourceArtifactIds: ['artifact.candidate.txt'],
        questions: [],
        warnings: [],
      },
      {
        targetTitle: 'TypeScript Engineer',
        seniority: 'junior',
        summary: 'Builds TypeScript systems',
        requirements: [],
        keywords: ['TypeScript'],
      },
      {
        resume: candidate,
        selectedEvidenceIds: [],
        questions: [],
        notes: [],
      },
    ]
    const llm: LlmClient = {
      async completeJson(request, options) {
        requests.push(request)
        receivedSignals.push(options?.signal)
        return {
          data: responses.shift(),
          metadata: {
            provider: 'fake',
            model: 'fake-model',
            durationMs: 2,
            attempt: 1,
          },
        }
      },
    }
    const controller = new AbortController()

    const result = await new ResumeTailoringAgent(llm).run(
      {
        jobDescription: 'We need a TypeScript Engineer.',
        candidate: {
          files: [
            {
              filename: 'candidate.txt',
              mediaType: 'text/plain',
              text: 'Ada Lovelace built reliable analytical systems.',
            },
          ],
        },
      },
      { signal: controller.signal }
    )

    expect(result.status).toBe('completed')
    expect(requests).toHaveLength(4)
    expect(receivedSignals).toEqual([
      controller.signal,
      controller.signal,
      controller.signal,
      controller.signal,
    ])
    expect(requests[1]?.user).toContain('resume')
    expect(requests[1]?.user).toContain('"type": "single_choice"')
    expect(requests[1]?.user).toContain('"type": "date_range"')
    expect(
      result.trace.find(
        (event) =>
          event.name === 'normalize_candidate' && event.status === 'completed'
      )?.metadata
    ).toMatchObject({
      modelCalls: 2,
      repairAttempts: 1,
      transportAttempts: 2,
      modelDurationMs: 4,
    })
  })

  it('re-ingests answer files into the candidate and re-normalizes the profile', async () => {
    // A `file` interaction answer carries binaries. The candidate profile
    // has to be rebuilt from the full material set — the original artifacts
    // plus the new ones — not patched field by field, because the new
    // material can change any part of the profile.
    const responses = [
      {
        resume: {
          ...candidate,
          content: {
            ...candidate.content,
            projects: [
              ...candidate.content.projects,
              {
                name: 'Answer project',
                startDate: '2025',
                summary: '- Delivered the answer-file material',
                keywords: ['Go'],
              },
            ],
          },
        },
        sourceArtifactIds: ['answer-file-1'],
        questions: [],
        warnings: [],
      },
    ]
    const seenPrompts: string[] = []
    const llm: LlmClient = {
      async completeJson(request) {
        seenPrompts.push(request.user)
        return {
          data: responses.shift(),
          metadata: {
            provider: 'fake',
            model: 'fake-model',
            durationMs: 1,
            attempt: 1,
          },
        }
      },
    }
    const checkpoint: ResumeTailoringCheckpoint = {
      version: 1,
      jobText: 'Backend engineer role.',
      jobArtifacts: [],
      candidateArtifacts: [
        {
          id: 'original-1',
          filename: 'resume.md',
          mediaType: 'text/markdown',
          kind: 'text',
          text: 'Original resume material.',
          warnings: [],
        },
      ],
      candidate,
      preferences: {},
      questions: [],
      warnings: [],
      trace: [],
    }

    const updated = await new ResumeTailoringAgent(llm).reingestCandidate(
      checkpoint,
      [
        {
          id: 'answer-file-1',
          filename: 'answers.txt',
          text: 'The answer file describes a Go project delivered in 2025.',
        },
      ]
    )

    expect(updated.candidateArtifacts.map((artifact) => artifact.id)).toEqual([
      'original-1',
      'answer-file-1',
    ])
    expect(
      updated.candidate.content.projects.some(
        (project) => project.name === 'Answer project'
      )
    ).toBe(true)
    // The normalization prompt must see both the original and the new
    // material, or the rebuilt profile would drop what was already known.
    expect(seenPrompts[0]).toContain('Original resume material.')
    expect(seenPrompts[0]).toContain('answer file describes a Go project')
    expect(
      updated.trace
        .map((event) => event.name)
        .includes('ingest_candidate_files')
    ).toBe(true)
  })

  it('stops the workflow when job analysis repair is exhausted', async () => {
    let calls = 0
    const llm: LlmClient = {
      async completeJson() {
        calls += 1
        return {
          data: { privateJobText: `confidential-${calls}` },
          metadata: {
            provider: 'fake',
            model: 'fake-model',
            durationMs: 1,
            attempt: 1,
          },
        }
      },
    }

    let thrown: unknown
    try {
      await new ResumeTailoringAgent(llm).run({
        jobDescription: 'Confidential employer needs a TypeScript Engineer.',
        candidate: { resume: candidate },
      })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(StructuredOutputValidationError)
    expect(thrown).toMatchObject({
      schemaName: 'JobSpec',
      telemetry: { modelCalls: 2, repairAttempts: 1 },
    })
    expect(calls).toBe(2)
    expect(
      `${(thrown as Error).message}\n${JSON.stringify(thrown)}`
    ).not.toContain('Confidential employer')
  })
})
