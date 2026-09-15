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

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Document, Packer, Paragraph } from 'docx'
import { describe, expect, it } from 'vitest'

import {
  ArtifactInputError,
  extractArtifact,
  extractArtifacts,
} from './artifacts'

describe('extractArtifact', () => {
  it('extracts text and infers a markdown media type from the filename', async () => {
    const result = await extractArtifact({
      filename: 'profile.md',
      text: '# Candidate\n\nTypeScript engineer',
    })

    expect(result.kind).toBe('text')
    expect(result.mediaType).toBe('text/markdown')
    expect(result.text).toContain('TypeScript engineer')
  })

  it('extracts raw text from a DOCX buffer', async () => {
    const buffer = await Packer.toBuffer(
      new Document({
        sections: [{ children: [new Paragraph('FastAPI candidate')] }],
      })
    )

    const result = await extractArtifact({
      filename: 'profile.docx',
      contentBase64: buffer.toString('base64'),
    })

    expect(result.kind).toBe('docx')
    expect(result.text).toContain('FastAPI candidate')
  })

  it('extracts text from a PDF buffer', async () => {
    const buffer = await readFile(join(__dirname, 'fixtures', 'text.pdf'))
    const result = await extractArtifact({
      filename: 'profile.pdf',
      contentBase64: buffer.toString('base64'),
    })

    expect(result.kind).toBe('pdf')
    expect(result.text).toContain('TypeScript PDF fixture')
  })

  it('keeps images as vision-ready data URLs instead of pretending to OCR them', async () => {
    const result = await extractArtifact({
      filename: 'resume.png',
      contentBase64:
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    })

    expect(result.kind).toBe('image')
    expect(result.imageDataUrl).toMatch(/^data:image\/png;base64,/)
    expect(result.text).toBeUndefined()
  })

  it('enforces duplicate IDs and total size limits', async () => {
    await expect(
      extractArtifacts([
        { id: 'same', filename: 'a.txt', text: 'a' },
        { id: 'same', filename: 'b.txt', text: 'b' },
      ])
    ).rejects.toThrow(ArtifactInputError)

    await expect(
      extractArtifacts([
        { filename: 'a.txt', text: 'a'.repeat(31 * 1024 * 1024) },
      ])
    ).rejects.toThrow('total limit')
  })
})
