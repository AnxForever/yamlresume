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

import {
  cosineSimilarity,
  createHashEmbeddingClient,
} from '@/retrieval/embeddings'

describe('cosineSimilarity', () => {
  it('is 1 for parallel vectors, 0 for orthogonal ones and 0 for a zero vector', () => {
    expect(cosineSimilarity([1, 2, 3], [2, 4, 6])).toBeCloseTo(1)
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0)
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0)
  })

  it('refuses vectors of different lengths', () => {
    expect(() => cosineSimilarity([1], [1, 2])).toThrow(/length mismatch/)
  })
})

describe('createHashEmbeddingClient', () => {
  const client = createHashEmbeddingClient()

  it('is deterministic and unit-length', async () => {
    const [first] = await client.embed(['Built Terraform modules'], 'passage')
    const [second] = await client.embed(['Built Terraform modules'], 'query')
    expect(first).toEqual(second)
    const norm = Math.sqrt(
      (first as number[]).reduce((total, value) => total + value * value, 0)
    )
    expect(norm).toBeCloseTo(1)
    expect(client.id).toBe('hash-ngram-v1/512')
  })

  it('scores shared surface text above unrelated text, in English and Chinese', async () => {
    const [query, close, far] = await client.embed(
      [
        'Kubernetes clusters on bare metal',
        'Operated Kubernetes clusters for the platform team',
        'Presented quarterly findings to stakeholders',
      ],
      'passage'
    )
    expect(
      cosineSimilarity(query as number[], close as number[])
    ).toBeGreaterThan(cosineSimilarity(query as number[], far as number[]))
    const [zhQuery, zhClose, zhFar] = await client.embed(
      ['熟悉向量检索与 Embedding', '做过向量检索服务', '负责前端页面开发'],
      'passage'
    )
    expect(
      cosineSimilarity(zhQuery as number[], zhClose as number[])
    ).toBeGreaterThan(cosineSimilarity(zhQuery as number[], zhFar as number[]))
  })

  it('embeds an empty text as the zero vector so it can never match', async () => {
    const [empty] = await client.embed(['   '], 'passage')
    expect((empty as number[]).every((value) => value === 0)).toBe(true)
  })

  it('rejects unusable dimensions', () => {
    expect(() => createHashEmbeddingClient({ dimensions: 4 })).toThrow(
      /at least 8/
    )
  })
})
