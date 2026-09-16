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
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ArtifactInputError,
  extractArtifact,
  extractArtifacts,
} from './artifacts'

afterEach(() => {
  vi.doUnmock('node:fs/promises')
  vi.restoreAllMocks()
  vi.resetModules()
})

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

  it('extracts text from a digital PDF without a standard-font warning', async () => {
    const warn = vi.spyOn(console, 'warn')
    const buffer = await readFile(join(__dirname, 'fixtures', 'text.pdf'))
    const result = await extractArtifact({
      filename: 'profile.pdf',
      contentBase64: buffer.toString('base64'),
    })

    expect(result.kind).toBe('pdf')
    expect(result.text).toContain('TypeScript PDF fixture')
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('returns a safe warning when a standard font resource is missing', async () => {
    const sensitiveMarker = 'jane.doe@example.com has a private employment gap'
    const buffer = await readFile(join(__dirname, 'fixtures', 'text.pdf'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const actualFs =
      await vi.importActual<typeof import('node:fs/promises')>(
        'node:fs/promises'
      )
    vi.doMock('node:fs/promises', () => ({
      ...actualFs,
      readFile: async (path: Parameters<typeof actualFs.readFile>[0]) => {
        if (String(path).endsWith('.ttf')) {
          throw new Error(sensitiveMarker)
        }
        return actualFs.readFile(path)
      },
    }))
    vi.resetModules()
    const { extractArtifact: extractWithMissingFont } = await import(
      './artifacts'
    )

    const result = await extractWithMissingFont({
      filename: 'private-candidate.pdf',
      contentBase64: buffer.toString('base64'),
    })

    expect(result.text).toContain('TypeScript PDF fixture')
    expect(result.warnings).toContain(
      'PDF standard font resources are unavailable or invalid; extracted text may be incomplete'
    )
    expect(
      JSON.stringify({ warnings: result.warnings, logs: warn.mock.calls })
    ).not.toContain(sensitiveMarker)
  })

  it('returns a safe warning when a standard font resource is corrupted', async () => {
    const sensitiveMarker = 'private resume details must not be logged'
    const buffer = await readFile(join(__dirname, 'fixtures', 'text.pdf'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const actualFs =
      await vi.importActual<typeof import('node:fs/promises')>(
        'node:fs/promises'
      )
    vi.doMock('node:fs/promises', () => ({
      ...actualFs,
      readFile: async (path: Parameters<typeof actualFs.readFile>[0]) => {
        if (String(path).endsWith('.ttf')) {
          return Buffer.from(sensitiveMarker.repeat(100))
        }
        return actualFs.readFile(path)
      },
    }))
    vi.resetModules()
    const { extractArtifact: extractWithCorruptedFont } = await import(
      './artifacts'
    )

    const result = await extractWithCorruptedFont({
      filename: 'private-candidate.pdf',
      contentBase64: buffer.toString('base64'),
    })

    expect(result.warnings).toContain(
      'PDF standard font resources are unavailable or invalid; extracted text may be incomplete'
    )
    expect(
      JSON.stringify({ warnings: result.warnings, logs: warn.mock.calls })
    ).not.toContain(sensitiveMarker)
  })

  it('returns a safe parsing error without logging PDF content or personal information', async () => {
    const personalInformation = 'jane.doe@example.com'
    const privateResumeText = 'Private employment gap from 2024 to 2025'
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const errorLog = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    let thrown: unknown
    try {
      await extractArtifact({
        filename: `${personalInformation}.pdf`,
        contentBase64: Buffer.from(
          `%PDF-1.7\n${personalInformation}\n${privateResumeText}`
        ).toString('base64'),
      })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(ArtifactInputError)
    expect((thrown as Error).message).toBe(
      'Could not extract PDF text: invalid or corrupted PDF'
    )
    const diagnostics = JSON.stringify({
      error: (thrown as Error).message,
      logs: [
        ...warn.mock.calls,
        ...errorLog.mock.calls,
        ...info.mock.calls,
        ...log.mock.calls,
      ],
    })
    expect(diagnostics).not.toContain(personalInformation)
    expect(diagnostics).not.toContain(privateResumeText)
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
