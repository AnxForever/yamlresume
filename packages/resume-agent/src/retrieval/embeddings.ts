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

/**
 * The port the matcher uses to turn text into vectors.
 *
 * Same shape of contract as `LlmClient`: one method, injectable, trivially
 * faked. `kind` lets asymmetric models (the e5 family expects `query:` and
 * `passage:` prefixes) treat the two sides differently; symmetric models
 * ignore it.
 */
export interface EmbeddingClient {
  /** Stable identifier recorded in reports, e.g. a model name. */
  readonly id: string
  embed(
    texts: readonly string[],
    kind: 'query' | 'passage'
  ): Promise<number[][]>
}

/**
 * Cosine similarity in [-1, 1]. A zero vector on either side scores 0, so an
 * empty text can never match anything.
 */
export function cosineSimilarity(
  left: readonly number[],
  right: readonly number[]
): number {
  if (left.length !== right.length) {
    throw new Error(
      `Vector length mismatch: ${left.length} versus ${right.length}`
    )
  }
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] as number
    const b = right[index] as number
    dot += a * b
    leftNorm += a * a
    rightNorm += b * b
  }
  if (leftNorm === 0 || rightNorm === 0) return 0
  return dot / Math.sqrt(leftNorm * rightNorm)
}

function normalizeText(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** FNV-1a, 32-bit. Cheap, portable, and stable across platforms. */
function fnv1a(value: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

function features(text: string): string[] {
  const normalized = normalizeText(text)
  if (!normalized) return []
  const result: string[] = []
  for (const word of normalized.split(' ')) {
    if (/^[a-z0-9][a-z0-9+#.-]*$/.test(word)) result.push(`w:${word}`)
  }
  const compact = normalized.replace(/ /g, '')
  for (let index = 0; index + 3 <= compact.length; index += 1) {
    result.push(`c:${compact.slice(index, index + 3)}`)
  }
  return result
}

export interface HashEmbeddingOptions {
  /** Vector width. More dimensions, fewer hash collisions. Defaults to 512. */
  dimensions?: number
}

/**
 * A deterministic embedding with no model behind it.
 *
 * Word unigrams and character trigrams are hashed into a fixed-width vector
 * (the hashing trick), so two texts score high when they share surface
 * substrings and nothing else. It captures spelling variants and mixed
 * Chinese/English overlap; it cannot see synonyms or paraphrase. That makes
 * it the right stand-in for tests and the offline demo, and the wrong one
 * for any quality claim.
 */
export function createHashEmbeddingClient(
  options: HashEmbeddingOptions = {}
): EmbeddingClient {
  const dimensions = options.dimensions ?? 512
  if (!Number.isInteger(dimensions) || dimensions < 8) {
    throw new Error(
      'Hash embedding dimensions must be an integer of at least 8'
    )
  }
  return {
    id: `hash-ngram-v1/${dimensions}`,
    async embed(texts) {
      return texts.map((text) => {
        const vector = new Array<number>(dimensions).fill(0)
        for (const feature of features(text)) {
          const hash = fnv1a(feature)
          const index = hash % dimensions
          const sign = hash >>> 31 === 1 ? -1 : 1
          vector[index] = (vector[index] as number) + sign
        }
        const norm = Math.sqrt(
          vector.reduce((total, value) => total + value * value, 0)
        )
        return norm === 0 ? vector : vector.map((value) => value / norm)
      })
    },
  }
}
