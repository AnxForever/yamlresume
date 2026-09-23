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

import type { EmbeddingClient } from '@/retrieval/embeddings'

export const DEFAULT_TRANSFORMERS_EMBEDDING_MODEL =
  'Xenova/multilingual-e5-small'

export interface TransformersEmbeddingOptions {
  /** Hugging Face model id. Defaults to multilingual-e5-small (384 dims). */
  model?: string
  /** Weight precision; `q8` is a 4x smaller download with negligible loss. */
  dtype?: 'fp32' | 'fp16' | 'q8'
}

/** Minimal view of the transformers.js pipeline this adapter needs. */
type FeatureExtractor = (
  texts: string[],
  options: { pooling: 'mean'; normalize: boolean }
) => Promise<{ tolist(): number[][] }>

interface TransformersModule {
  pipeline(
    task: 'feature-extraction',
    model: string,
    options: { dtype: string }
  ): Promise<FeatureExtractor>
}

export class EmbeddingModelUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EmbeddingModelUnavailableError'
  }
}

/**
 * Embeddings from a model that runs inside this process.
 *
 * `@huggingface/transformers` is an optional peer dependency loaded on the
 * first call, so consumers that never enable semantic matching do not pay
 * for onnxruntime. The e5 family is asymmetric: queries and passages carry
 * `query: ` / `passage: ` prefixes, mean pooling, L2 normalisation. The
 * first call downloads the model (about 130 MB for e5-small) into the
 * library's cache; behind a proxy run Node with `--use-env-proxy`, or point
 * `HF_ENDPOINT` at a mirror.
 *
 * A missing package or a failed download surfaces as
 * `EmbeddingModelUnavailableError`; the hybrid matcher turns that into a
 * lexical fallback with a warning rather than a failed run.
 */
export function createTransformersEmbeddingClient(
  options: TransformersEmbeddingOptions = {}
): EmbeddingClient {
  const model = options.model ?? DEFAULT_TRANSFORMERS_EMBEDDING_MODEL
  const dtype = options.dtype ?? 'q8'
  const prefixed = /e5/i.test(model)
  let extractor: Promise<FeatureExtractor> | undefined

  async function load(): Promise<FeatureExtractor> {
    extractor ??= (async () => {
      let module: TransformersModule
      try {
        module = (await import(
          /* webpackIgnore: true */ '@huggingface/transformers'
        )) as unknown as TransformersModule
      } catch {
        throw new EmbeddingModelUnavailableError(
          'Semantic matching needs the optional peer dependency @huggingface/transformers'
        )
      }
      try {
        return await module.pipeline('feature-extraction', model, { dtype })
      } catch (error) {
        throw new EmbeddingModelUnavailableError(
          `Embedding model ${model} could not be loaded: ${
            error instanceof Error ? error.message : 'unknown error'
          }`
        )
      }
    })()
    try {
      return await extractor
    } catch (error) {
      extractor = undefined
      throw error
    }
  }

  return {
    id: `${model}@${dtype}`,
    async embed(texts, kind) {
      if (texts.length === 0) return []
      const extract = await load()
      const input = texts.map((text) => (prefixed ? `${kind}: ${text}` : text))
      const output = await extract(input, { pooling: 'mean', normalize: true })
      return output.tolist()
    },
  }
}
