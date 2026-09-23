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

import { cosineSimilarity } from '@/retrieval/embeddings'
import {
  createTransformersEmbeddingClient,
  DEFAULT_TRANSFORMERS_EMBEDDING_MODEL,
} from '@/retrieval/transformers-embeddings'

describe('createTransformersEmbeddingClient', () => {
  it('names the model and precision and embeds nothing without loading', async () => {
    const client = createTransformersEmbeddingClient()
    expect(client.id).toBe(`${DEFAULT_TRANSFORMERS_EMBEDDING_MODEL}@q8`)
    await expect(client.embed([], 'query')).resolves.toEqual([])
  })

  it('reports a model that cannot be loaded as unavailable', async () => {
    const client = createTransformersEmbeddingClient({
      model: 'Xenova/this-model-does-not-exist-anywhere',
    })
    await expect(client.embed(['x'], 'query')).rejects.toMatchObject({
      name: 'EmbeddingModelUnavailableError',
    })
  }, 60_000)

  // The real model is a 130 MB download; run this one deliberately:
  //   RESUME_AGENT_TEST_EMBEDDINGS=1 pnpm agent test src/retrieval/transformers-embeddings.test.ts
  it.runIf(process.env.RESUME_AGENT_TEST_EMBEDDINGS === '1')(
    'embeds a paraphrase closer than an unrelated sentence',
    async () => {
      const client = createTransformersEmbeddingClient()
      const [query] = await client.embed(
        ['Provision Kubernetes clusters on bare metal'],
        'query'
      )
      const [close, far] = await client.embed(
        [
          'Ran k8s clusters on physical servers in a colocation data centre.',
          'Presented quarterly findings to stakeholders.',
        ],
        'passage'
      )
      expect(query).toHaveLength(384)
      expect(
        cosineSimilarity(query as number[], close as number[])
      ).toBeGreaterThan(cosineSimilarity(query as number[], far as number[]))
    },
    120_000
  )
})
