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
import type { JsonCompletionRequest, LlmClient } from '@/contracts'
import { StructuredOutputValidationError } from '@/llm/structured-output'
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
      candidate: {
        files: [
          {
            filename: 'candidate.txt',
            mediaType: 'text/plain',
            text: 'Ada Lovelace built reliable analytical systems.',
          },
        ],
      },
    })

    expect(result.status).toBe('completed')
    expect(requests).toHaveLength(4)
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
