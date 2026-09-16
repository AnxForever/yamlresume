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
import { renderOdtDocument } from '../rendering/odt'
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

function replaceAscii(buffer: Buffer, from: string, to: string): Buffer {
  if (Buffer.byteLength(from) !== Buffer.byteLength(to)) {
    throw new Error('Replacement must preserve byte length')
  }
  const result = Buffer.from(buffer)
  const needle = Buffer.from(from, 'ascii')
  const replacement = Buffer.from(to, 'ascii')
  let searchOffset = 0
  for (;;) {
    const offset = result.indexOf(needle, searchOffset)
    if (offset < 0) break
    replacement.copy(result, offset)
    searchOffset = offset + replacement.length
  }
  return result
}

function centralHeaderOffset(buffer: Buffer, name: string): number {
  const needle = Buffer.from(name, 'utf8')
  let searchOffset = 0
  for (;;) {
    const offset = buffer.indexOf(needle, searchOffset)
    if (offset < 0) break
    if (offset >= 46 && buffer.readUInt32LE(offset - 46) === 0x02014b50) {
      return offset - 46
    }
    searchOffset = offset + needle.length
  }
  throw new Error(`Missing central directory entry: ${name}`)
}

function renameZipHeaders(buffer: Buffer, from: string, to: string): Buffer {
  if (Buffer.byteLength(from) !== Buffer.byteLength(to)) {
    throw new Error('ZIP entry rename must preserve byte length')
  }
  const result = Buffer.from(buffer)
  const needle = Buffer.from(from, 'utf8')
  const replacement = Buffer.from(to, 'utf8')
  let searchOffset = 0
  for (;;) {
    const offset = result.indexOf(needle, searchOffset)
    if (offset < 0) break
    const isLocal =
      offset >= 30 && result.readUInt32LE(offset - 30) === 0x04034b50
    const isCentral =
      offset >= 46 && result.readUInt32LE(offset - 46) === 0x02014b50
    if (isLocal || isCentral) replacement.copy(result, offset)
    searchOffset = offset + needle.length
  }
  return result
}

function localEntryDataOffset(buffer: Buffer, name: string): number {
  const needle = Buffer.from(name, 'utf8')
  let searchOffset = 0
  for (;;) {
    const offset = buffer.indexOf(needle, searchOffset)
    if (offset < 0) break
    const headerOffset = offset - 30
    if (headerOffset >= 0 && buffer.readUInt32LE(headerOffset) === 0x04034b50) {
      const nameLength = buffer.readUInt16LE(headerOffset + 26)
      const extraLength = buffer.readUInt16LE(headerOffset + 28)
      return headerOffset + 30 + nameLength + extraLength
    }
    searchOffset = offset + needle.length
  }
  throw new Error(`Missing local ZIP entry: ${name}`)
}

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

  it('maps common text and image extensions to their existing input types', async () => {
    const text = await extractArtifact({
      filename: 'candidate.txt',
      text: 'Platform engineer',
    })
    const html = await extractArtifact({
      filename: 'candidate.htm',
      text: '<p>Platform engineer</p>',
    })
    const gif = await extractArtifact({
      filename: 'candidate.gif',
      contentBase64: Buffer.from('GIF89a', 'ascii').toString('base64'),
    })

    expect(text.mediaType).toBe('text/plain')
    expect(html.mediaType).toBe('text/html')
    expect(html.text).toBe('Platform engineer')
    expect(gif.mediaType).toBe('image/gif')
    expect(gif.kind).toBe('image')
  })

  it('rejects conflicting declared MIME and filename extension signals', async () => {
    await expect(
      extractArtifact({
        filename: 'candidate.md',
        mediaType: 'application/json',
        contentBase64: Buffer.from('Platform engineer', 'utf8').toString(
          'base64'
        ),
      })
    ).rejects.toMatchObject({
      code: 'file_type_mismatch',
      message: 'File type does not match its content.',
    })
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

  it('selects the DOCX parser from validated package entries', async () => {
    const buffer = await Packer.toBuffer(
      new Document({
        sections: [{ children: [new Paragraph('Container-detected DOCX')] }],
      })
    )

    const result = await extractArtifact({
      filename: 'candidate.upload',
      contentBase64: buffer.toString('base64'),
    })

    expect(result.kind).toBe('docx')
    expect(result.mediaType).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )
    expect(result.text).toContain('Container-detected DOCX')
  })

  it('rejects a corrupted DOCX entry before invoking its document parser', async () => {
    const docx = await Packer.toBuffer(
      new Document({
        sections: [{ children: [new Paragraph('Private candidate text')] }],
      })
    )
    const corrupted = Buffer.from(docx)
    const dataOffset = localEntryDataOffset(corrupted, 'word/document.xml')
    corrupted[dataOffset] = (corrupted[dataOffset] ?? 0) ^ 0xff

    await expect(
      extractArtifact({
        filename: 'candidate.docx',
        contentBase64: corrupted.toString('base64'),
      })
    ).rejects.toMatchObject({
      code: 'corrupt_document',
      message: 'Document archive is invalid or unsupported.',
    })
  })

  it('distinguishes an ODT package from DOCX before selecting a parser', async () => {
    const odt = renderOdtDocument({
      title: 'Synthetic Candidate',
      headline: 'Platform Engineer',
      contacts: [],
      summaryHeading: 'Summary',
      summary: ['Safe fixture'],
      sections: [],
    })

    await expect(
      extractArtifact({
        filename: 'candidate.docx',
        mediaType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        contentBase64: odt.toString('base64'),
      })
    ).rejects.toMatchObject({
      code: 'file_type_mismatch',
      message: 'File type does not match its content.',
    })
  })

  it('rejects archive entry paths that escape the document package', async () => {
    const odt = renderOdtDocument({
      title: 'Synthetic Candidate',
      headline: '',
      contacts: [],
      summaryHeading: 'Summary',
      summary: [],
      sections: [],
    })
    const pathTraversal = replaceAscii(odt, 'mimetype', '../x.txt')

    await expect(
      extractArtifact({
        filename: 'candidate.odt',
        contentBase64: pathTraversal.toString('base64'),
      })
    ).rejects.toMatchObject({
      code: 'corrupt_document',
      message: 'Document archive is invalid or unsupported.',
    })
  })

  it('rejects encrypted document archive entries with a stable error', async () => {
    const odt = renderOdtDocument({
      title: 'Synthetic Candidate',
      headline: '',
      contacts: [],
      summaryHeading: 'Summary',
      summary: [],
      sections: [],
    })
    const encrypted = Buffer.from(odt)
    const centralOffset = centralHeaderOffset(encrypted, 'content.xml')
    encrypted.writeUInt16LE(
      encrypted.readUInt16LE(centralOffset + 8) | 0x1,
      centralOffset + 8
    )

    await expect(
      extractArtifact({
        filename: 'candidate.odt',
        contentBase64: encrypted.toString('base64'),
      })
    ).rejects.toMatchObject({
      code: 'encrypted_document',
      message: 'Encrypted documents are not supported.',
    })
  })

  it('rejects document archives whose declared expansion exceeds the limit', async () => {
    const odt = renderOdtDocument({
      title: 'Synthetic Candidate',
      headline: '',
      contacts: [],
      summaryHeading: 'Summary',
      summary: [],
      sections: [],
    })
    const oversized = Buffer.from(odt)
    const centralOffset = centralHeaderOffset(oversized, 'content.xml')
    oversized.writeUInt32LE(32 * 1024 * 1024 + 1, centralOffset + 24)

    await expect(
      extractArtifact({
        filename: 'candidate.odt',
        contentBase64: oversized.toString('base64'),
      })
    ).rejects.toMatchObject({
      code: 'document_limit_exceeded',
      message: 'Document archive exceeds safe processing limits.',
    })
  })

  it('rejects ZIP64 document archive metadata', async () => {
    const odt = renderOdtDocument({
      title: 'Synthetic Candidate',
      headline: '',
      contacts: [],
      summaryHeading: 'Summary',
      summary: [],
      sections: [],
    })
    const zip64 = Buffer.from(odt)
    const endOffset = zip64.length - 22
    zip64.writeUInt16LE(0xffff, endOffset + 8)
    zip64.writeUInt16LE(0xffff, endOffset + 10)

    await expect(
      extractArtifact({
        filename: 'candidate.odt',
        contentBase64: zip64.toString('base64'),
      })
    ).rejects.toMatchObject({
      code: 'corrupt_document',
      message: 'Document archive is invalid or unsupported.',
    })
  })

  it('rejects document archives whose declared entry count exceeds the limit', async () => {
    const odt = renderOdtDocument({
      title: 'Synthetic Candidate',
      headline: '',
      contacts: [],
      summaryHeading: 'Summary',
      summary: [],
      sections: [],
    })
    const excessiveEntries = Buffer.from(odt)
    const endOffset = excessiveEntries.length - 22
    excessiveEntries.writeUInt16LE(129, endOffset + 8)
    excessiveEntries.writeUInt16LE(129, endOffset + 10)

    await expect(
      extractArtifact({
        filename: 'candidate.odt',
        contentBase64: excessiveEntries.toString('base64'),
      })
    ).rejects.toMatchObject({
      code: 'document_limit_exceeded',
      message: 'Document archive exceeds safe processing limits.',
    })
  })

  it('rejects duplicate document archive entry names', async () => {
    const odt = renderOdtDocument({
      title: 'Synthetic Candidate',
      headline: '',
      contacts: [],
      summaryHeading: 'Summary',
      summary: [],
      sections: [],
    })
    const duplicate = renameZipHeaders(odt, 'meta.xml', 'mimetype')

    await expect(
      extractArtifact({
        filename: 'candidate.odt',
        contentBase64: duplicate.toString('base64'),
      })
    ).rejects.toMatchObject({
      code: 'corrupt_document',
      message: 'Document archive is invalid or unsupported.',
    })
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

  it('selects the PDF parser from content when auxiliary type signals are absent', async () => {
    const buffer = await readFile(join(__dirname, 'fixtures', 'text.pdf'))

    const result = await extractArtifact({
      filename: 'candidate.upload',
      contentBase64: buffer.toString('base64'),
    })

    expect(result.kind).toBe('pdf')
    expect(result.mediaType).toBe('application/pdf')
    expect(result.text).toContain('TypeScript PDF fixture')
  })

  it('rejects a declared text file whose content is a signed PDF', async () => {
    const buffer = await readFile(join(__dirname, 'fixtures', 'text.pdf'))

    await expect(
      extractArtifact({
        filename: 'candidate.txt',
        mediaType: 'text/plain',
        contentBase64: buffer.toString('base64'),
      })
    ).rejects.toMatchObject({
      name: 'ArtifactInputError',
      code: 'file_type_mismatch',
      message: 'File type does not match its content.',
    })
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

  it('detects supported image types from their signatures', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64'
    )

    const result = await extractArtifact({
      filename: 'candidate.upload',
      contentBase64: png.toString('base64'),
    })

    expect(result.kind).toBe('image')
    expect(result.mediaType).toBe('image/png')
    expect(result.imageDataUrl).toBe(
      `data:image/png;base64,${png.toString('base64')}`
    )
  })

  it('rejects valid text that is disguised as a supported image', async () => {
    await expect(
      extractArtifact({
        filename: 'candidate.png',
        mediaType: 'image/png',
        contentBase64: Buffer.from(
          'Private candidate text, not a PNG image.',
          'utf8'
        ).toString('base64'),
      })
    ).rejects.toMatchObject({
      code: 'file_type_mismatch',
      message: 'File type does not match its content.',
    })
  })

  it('rejects unknown binary content instead of decoding it as plain text', async () => {
    await expect(
      extractArtifact({
        filename: 'candidate.upload',
        contentBase64: Buffer.from([
          0x00, 0xff, 0x10, 0x80, 0x00, 0x01, 0xfe, 0x7f,
        ]).toString('base64'),
      })
    ).rejects.toMatchObject({
      code: 'unsupported_file_type',
      message: 'File type is not supported.',
    })
  })

  it('rejects decoded text files that contain no visible text', async () => {
    await expect(
      extractArtifact({
        filename: 'candidate.txt',
        contentBase64: Buffer.from(' \n\t\r ', 'utf8').toString('base64'),
      })
    ).rejects.toMatchObject({
      code: 'empty_extracted_text',
      message: 'Document contains no extractable text.',
    })
  })

  it('decodes BOM-marked UTF-16 text without treating its NUL bytes as binary', async () => {
    const utf16le = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from('候选人 Platform engineer', 'utf16le'),
    ])

    const result = await extractArtifact({
      filename: 'candidate.txt',
      contentBase64: utf16le.toString('base64'),
    })

    expect(result.text).toBe('候选人 Platform engineer')
    expect(result.mediaType).toBe('text/plain')
  })

  it('recognizes an RTF control header before its extractor is enabled', async () => {
    await expect(
      extractArtifact({
        filename: 'candidate.rtf',
        mediaType: 'application/rtf',
        contentBase64: Buffer.from(
          '{\\rtf1\\ansi Platform engineer}',
          'ascii'
        ).toString('base64'),
      })
    ).rejects.toMatchObject({
      code: 'unsupported_file_type',
      message: 'File type is not supported.',
    })
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
