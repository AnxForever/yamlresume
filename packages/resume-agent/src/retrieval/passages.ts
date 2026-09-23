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

import type { Evidence } from '@/contracts'

/**
 * A unit of text the matcher scores. Short evidence items (a keyword, a
 * position, a one-line summary) are their own passage; a long item such as
 * an uploaded document is split so a match points at the paragraph that
 * supports it, not at the whole file.
 */
export interface Passage {
  /** `evidence.id` for a whole item, `evidence.id#n` for the n-th chunk. */
  id: string
  evidenceId: string
  text: string
}

export interface PassageOptions {
  /** Longest passage before an item is split. Defaults to 300 characters. */
  maxChars?: number
  /**
   * Chunks shorter than this are merged into their neighbour, so a heading or
   * a stray bullet does not become a passage of its own. Defaults to 40.
   */
  minChars?: number
}

const SENTENCE_BOUNDARY = /(?<=[.!?;。！？；])\s+|(?<=[。！？；])/u

function splitLong(text: string, maxChars: number): string[] {
  const pieces: string[] = []
  for (const block of text.split(/\n\s*\n|\n/)) {
    const trimmed = block.trim()
    if (!trimmed) continue
    if (trimmed.length <= maxChars) {
      pieces.push(trimmed)
      continue
    }
    let current = ''
    for (const sentence of trimmed.split(SENTENCE_BOUNDARY)) {
      const part = sentence.trim()
      if (!part) continue
      if (current && current.length + 1 + part.length > maxChars) {
        pieces.push(current)
        current = part
      } else {
        current = current ? `${current} ${part}` : part
      }
    }
    if (current) pieces.push(current)
  }
  return pieces
}

/**
 * Attach fragments shorter than `minChars` to a neighbour: a heading joins
 * the paragraph that follows it, a trailing fragment joins the paragraph
 * before it. Nothing grows past `maxChars`.
 */
function mergeShort(
  pieces: string[],
  minChars: number,
  maxChars: number
): string[] {
  const merged: string[] = []
  let pending = ''
  for (const original of pieces) {
    let piece = original
    if (pending) {
      if (pending.length + 1 + piece.length <= maxChars) {
        piece = `${pending}\n${piece}`
      } else {
        merged.push(pending)
      }
      pending = ''
    }
    if (piece.length < minChars) {
      pending = piece
      continue
    }
    merged.push(piece)
  }
  if (pending) {
    const previous = merged[merged.length - 1]
    if (
      previous !== undefined &&
      previous.length + 1 + pending.length <= maxChars
    ) {
      merged[merged.length - 1] = `${previous}\n${pending}`
    } else {
      merged.push(pending)
    }
  }
  return merged
}

export function buildPassages(
  evidence: readonly Evidence[],
  options: PassageOptions = {}
): Passage[] {
  const maxChars = options.maxChars ?? 300
  const minChars = options.minChars ?? 40
  if (maxChars < 20 || minChars < 1 || minChars > maxChars) {
    throw new Error(
      'Passage bounds must satisfy 1 <= minChars <= maxChars, maxChars >= 20'
    )
  }
  const passages: Passage[] = []
  for (const item of evidence) {
    const text = item.text.trim()
    if (!text) continue
    if (text.length <= maxChars) {
      passages.push({ id: item.id, evidenceId: item.id, text })
      continue
    }
    const chunks = mergeShort(splitLong(text, maxChars), minChars, maxChars)
    chunks.forEach((chunk, index) => {
      passages.push({
        id: `${item.id}#${index + 1}`,
        evidenceId: item.id,
        text: chunk,
      })
    })
  }
  return passages
}
