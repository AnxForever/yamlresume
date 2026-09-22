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

import { createRequire } from 'node:module'

const MAX_EXTRACTED_CHARACTERS = 1_000_000
const EXTRACTION_TIMEOUT_MS = 5_000

interface LegacyWordDocument {
  getBody(options?: { filterUnicode?: boolean }): string
}

interface LegacyWordExtractor {
  extract(buffer: Buffer): Promise<LegacyWordDocument>
}

type LegacyWordExtractorConstructor = new () => LegacyWordExtractor

const require = createRequire(import.meta.url)
const WordExtractor =
  require('word-extractor') as LegacyWordExtractorConstructor

export async function extractLegacyDocText(buffer: Buffer): Promise<string> {
  const extraction = new WordExtractor().extract(buffer)
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('legacy document timeout')),
      EXTRACTION_TIMEOUT_MS
    )
    timer.unref?.()
  })

  try {
    const document = await Promise.race([extraction, timeout])
    const text = document.getBody({ filterUnicode: false }).trim()
    if (!text) {
      throw new Error('legacy document is empty')
    }
    if (text.length > MAX_EXTRACTED_CHARACTERS) {
      throw new Error('legacy document exceeds text limit')
    }
    return text
  } finally {
    if (timer) clearTimeout(timer)
  }
}
