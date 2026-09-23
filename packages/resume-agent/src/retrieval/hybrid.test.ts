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
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 */

import { describe, expect, it } from 'vitest'

import type { Evidence, JobSpec } from '@/contracts'
import type { EmbeddingClient } from '@/retrieval/embeddings'
import { buildHybridMatchReport } from '@/retrieval/hybrid'

/**
 * A scripted embedding: every text maps to a fixed vector, so similarity is
 * whatever the test declares. Unknown texts get an orthogonal vector.
 */
function scripted(vectors: Record<string, number[]>): EmbeddingClient {
  return {
    id: 'scripted',
    async embed(texts) {
      return texts.map((text) => vectors[text] ?? [0, 0, 0, 1])
    },
  }
}

const jobSpec: JobSpec = {
  targetTitle: 'Platform Engineer',
  seniority: 'mid',
  summary: 'Runs clusters',
  requirements: [
    {
      id: 'terraform',
      text: 'Terraform modules',
      keywords: ['Terraform'],
      importance: 'must-have',
      category: 'technical',
    },
    {
      id: 'k8s',
      text: 'Provision Kubernetes clusters on bare metal',
      keywords: ['Kubernetes', 'bare metal'],
      importance: 'must-have',
      category: 'technical',
    },
    {
      id: 'rust',
      text: 'Rust systems programming',
      keywords: ['Rust'],
      importance: 'nice-to-have',
      category: 'technical',
    },
  ],
  keywords: ['Terraform', 'Kubernetes', 'Rust'],
}

const evidence: Evidence[] = [
  {
    id: 'candidate.content.work[0].summary',
    path: 'candidate.content.work[0].summary',
    section: 'work',
    text: 'Built Terraform modules and ran k8s workloads on physical servers.',
  },
  {
    id: 'candidate.content.work[0].keywords[0]',
    path: 'candidate.content.work[0].keywords[0]',
    section: 'work',
    text: 'on-call',
  },
]

const K8S_QUERY =
  'Provision Kubernetes clusters on bare metal (Kubernetes, bare metal)'
const RUST_QUERY = 'Rust systems programming (Rust)'
const SUMMARY = evidence[0]?.text as string
const K8S_ONLY: JobSpec = {
  ...jobSpec,
  requirements: [jobSpec.requirements[1] as JobSpec['requirements'][number]],
}

describe('buildHybridMatchReport', () => {
  it('keeps lexical matches and promotes a paraphrased gap to partial with the score', async () => {
    const report = await buildHybridMatchReport(jobSpec, evidence, {
      embeddings: scripted({
        [K8S_QUERY]: [1, 0, 0, 0],
        [RUST_QUERY]: [0, 1, 0, 0],
        [SUMMARY]: [0.95, 0.05, 0, 0],
        'on-call': [0, 0, 1, 0],
      }),
      acceptance: { kind: 'absolute', threshold: 0.9 },
    })
    expect(
      report.matchedRequirements.map((match) => match.requirementId)
    ).toEqual(['terraform', 'k8s'])
    expect(
      report.missingRequirements.map((match) => match.requirementId)
    ).toEqual(['rust'])
    const k8s = report.matchedRequirements[1]
    expect(k8s?.status).toBe('partial')
    expect(k8s?.evidenceIds).toEqual(['candidate.content.work[0].summary'])
    expect(k8s?.rationale).toMatch(
      /Semantic match: 1 evidence item at cosine >= 0.9 \(best 1\.00\)/
    )
    expect(report.matchedRequirements[0]?.rationale).not.toMatch(/Semantic/)
    expect(report.score).toBe(0.67)
    expect(report.semantic).toEqual({
      model: 'scripted',
      acceptance: { kind: 'absolute', threshold: 0.9 },
      topK: 3,
      matches: [
        {
          requirementId: 'k8s',
          evidenceId: 'candidate.content.work[0].summary',
          passageId: 'candidate.content.work[0].summary',
          score: 0.999,
        },
      ],
    })
    expect(report.selectedEvidenceIds).toEqual([
      'candidate.content.work[0].summary',
    ])
  })

  it('leaves a requirement missing when nothing clears the threshold', async () => {
    const report = await buildHybridMatchReport(jobSpec, evidence, {
      embeddings: scripted({
        [K8S_QUERY]: [1, 0, 0, 0],
        [RUST_QUERY]: [0, 1, 0, 0],
        [SUMMARY]: [0.5, 0.5, 0.5, 0.5],
        'on-call': [0, 0, 1, 0],
      }),
      acceptance: { kind: 'absolute', threshold: 0.9 },
    })
    expect(
      report.missingRequirements.map((match) => match.requirementId)
    ).toEqual(['k8s', 'rust'])
    expect(report.semantic.matches).toEqual([])
  })

  it('accepts by margin over the query’s own background similarity and embeds the background once per client', async () => {
    // Unit vectors chosen so cosine with the query [1,0,0,0] is exact:
    // background 0.80, a strong passage 0.95, a weak passage 0.85.
    const strong = [0.95, Math.sqrt(1 - 0.95 ** 2), 0, 0]
    const weak = [0.85, Math.sqrt(1 - 0.85 ** 2), 0, 0]
    let backgroundEmbeds = 0
    const client: EmbeddingClient = {
      id: 'margin-scripted',
      async embed(texts, kind) {
        if (texts.includes('neutral')) backgroundEmbeds += 1
        return texts.map((text) => {
          if (text === K8S_QUERY) return [1, 0, 0, 0]
          if (text === 'neutral') return [0.8, 0.6, 0, 0]
          if (text === 'Ran k8s on physical servers.') return strong
          if (text === 'Kept the wiki tidy.') return weak
          return kind === 'query' ? [0, 1, 0, 0] : [0, 0, 0, 1]
        })
      },
    }
    const docs: Evidence[] = [
      {
        id: 'candidate.content.work[0].summary',
        path: 'candidate.content.work[0].summary',
        section: 'work',
        text: 'Ran k8s on physical servers.',
      },
      {
        id: 'candidate.content.work[1].summary',
        path: 'candidate.content.work[1].summary',
        section: 'work',
        text: 'Kept the wiki tidy.',
      },
    ]
    const options = {
      embeddings: client,
      acceptance: {
        kind: 'background-margin',
        margin: 0.1,
        background: ['neutral'],
      },
    } as const
    const report = await buildHybridMatchReport(K8S_ONLY, docs, options)
    expect(report.matchedRequirements[0]?.evidenceIds).toEqual([
      'candidate.content.work[0].summary',
    ])
    expect(report.matchedRequirements[0]?.rationale).toMatch(
      /at least 0.1 above the query's background similarity 0.80 \(best 0.95\)/
    )
    expect(report.semantic.acceptance).toEqual({
      kind: 'background-margin',
      margin: 0.1,
      sentences: 1,
    })
    expect(report.semantic.matches[0]).toMatchObject({
      score: 0.95,
      margin: 0.15,
    })
    await buildHybridMatchReport(K8S_ONLY, docs, options)
    expect(backgroundEmbeds).toBe(1)
  })

  it('dedupes chunks of one document and caps hits at topK', async () => {
    const long = 'Ran k8s clusters on physical servers. '.repeat(12).trim()
    const docs: Evidence[] = [
      {
        id: 'artifact.a',
        path: 'artifact.a',
        section: 'uploaded-document',
        text: long,
      },
      {
        id: 'artifact.b',
        path: 'artifact.b',
        section: 'uploaded-document',
        text: 'Operated Kubernetes on bare metal.',
      },
      {
        id: 'artifact.c',
        path: 'artifact.c',
        section: 'uploaded-document',
        text: 'Provisioned bare-metal Kubernetes.',
      },
    ]
    const client: EmbeddingClient = {
      id: 'all-similar',
      async embed(texts, kind) {
        return texts.map(() => (kind === 'query' ? [1, 0] : [0.99, 0.01]))
      },
    }
    const report = await buildHybridMatchReport(K8S_ONLY, docs, {
      embeddings: client,
      acceptance: { kind: 'absolute', threshold: 0.9 },
      topK: 2,
      passages: { maxChars: 120, minChars: 20 },
    })
    const hit = report.matchedRequirements[0]
    expect(hit?.evidenceIds).toHaveLength(2)
    expect(new Set(hit?.evidenceIds).size).toBe(2)
    expect(
      report.semantic.matches.every((match) =>
        match.passageId.startsWith(match.evidenceId)
      )
    ).toBe(true)
  })

  it('makes no embedding call when the lexical matcher already covered everything', async () => {
    let calls = 0
    const client: EmbeddingClient = {
      id: 'counting',
      async embed(texts) {
        calls += 1
        return texts.map(() => [1])
      },
    }
    const spec: JobSpec = {
      ...jobSpec,
      requirements: [
        jobSpec.requirements[0] as JobSpec['requirements'][number],
      ],
    }
    const report = await buildHybridMatchReport(spec, evidence, {
      embeddings: client,
    })
    expect(calls).toBe(0)
    expect(report.score).toBe(1)
    expect(report.semantic.model).toBe('counting')
  })

  it('falls back to the lexical report when embedding fails', async () => {
    const client: EmbeddingClient = {
      id: 'broken',
      async embed() {
        throw new Error('model not downloaded')
      },
    }
    const report = await buildHybridMatchReport(jobSpec, evidence, {
      embeddings: client,
    })
    expect(
      report.missingRequirements.map((match) => match.requirementId)
    ).toEqual(['k8s', 'rust'])
    expect(report.semantic.fallback).toBe('embedding_failed')
    expect(report.semantic.matches).toEqual([])
  })

  it('rejects an unusable acceptance rule or topK before touching the embeddings', async () => {
    const client = scripted({})
    await expect(
      buildHybridMatchReport(jobSpec, evidence, {
        embeddings: client,
        acceptance: { kind: 'absolute', threshold: 1.5 },
      })
    ).rejects.toThrow(/threshold/)
    await expect(
      buildHybridMatchReport(jobSpec, evidence, {
        embeddings: client,
        acceptance: { kind: 'background-margin', margin: 0 },
      })
    ).rejects.toThrow(/margin/)
    await expect(
      buildHybridMatchReport(jobSpec, evidence, {
        embeddings: client,
        acceptance: { kind: 'background-margin', margin: 0.1, background: [] },
      })
    ).rejects.toThrow(/background/)
    await expect(
      buildHybridMatchReport(jobSpec, evidence, {
        embeddings: client,
        topK: 0,
      })
    ).rejects.toThrow(/topK/)
  })
})
