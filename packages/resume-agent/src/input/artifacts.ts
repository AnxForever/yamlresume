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
import { fileURLToPath } from 'node:url'
import mammoth from 'mammoth'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

import type { ExtractedArtifact, InputFile } from '@/contracts'
import {
  DOC_MEDIA_TYPE,
  DOCX_MEDIA_TYPE,
  detectInputFormat,
} from '@/input/detection'
import { ArtifactInputError } from '@/input/errors'
import { extractLegacyDocText } from '@/input/legacy-doc'
import { extractOdtText, ODT_MEDIA_TYPE } from '@/input/odt'
import { extractRtfText } from '@/input/rtf'

export type { ArtifactInputErrorCode } from '@/input/errors'
export { ArtifactInputError } from '@/input/errors'

export const MAX_ARTIFACT_BYTES = 12 * 1024 * 1024
export const MAX_TOTAL_ARTIFACT_BYTES = 30 * 1024 * 1024

const IMAGE_MEDIA_TYPES = new Set([
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
])
const PDF_STANDARD_FONT_DATA_URL = fileURLToPath(
  new URL(
    '../../standard_fonts/',
    import.meta.resolve('pdfjs-dist/legacy/build/pdf.mjs')
  )
)
const PDF_STANDARD_FONT_WARNING =
  'PDF standard font resources are unavailable or invalid; extracted text may be incomplete'
const MIN_STANDARD_FONT_BYTES = 1024

type PdfBinaryDataKind = 'cMapUrl' | 'standardFontDataUrl' | 'wasmUrl'

interface PdfBinaryDataFactoryOptions {
  cMapUrl?: string | null
  standardFontDataUrl?: string | null
  wasmUrl?: string | null
}

function hasValidStandardFontHeader(
  filename: string,
  data: Uint8Array
): boolean {
  if (data.byteLength < MIN_STANDARD_FONT_BYTES) return false

  if (filename.endsWith('.ttf')) {
    const signature = String.fromCharCode(...data.subarray(0, 4))
    return (
      (data[0] === 0 && data[1] === 1 && data[2] === 0 && data[3] === 0) ||
      signature === 'OTTO' ||
      signature === 'true' ||
      signature === 'typ1'
    )
  }

  if (filename.endsWith('.pfb')) {
    return data[0] === 1 && data[1] === 0 && data[2] === 4 && data[3] === 2
  }

  return false
}

function createPdfBinaryDataFactory(resourceWarnings: Set<string>) {
  return class PdfBinaryDataFactory {
    readonly #baseUrls: PdfBinaryDataFactoryOptions

    constructor(baseUrls: PdfBinaryDataFactoryOptions) {
      this.#baseUrls = baseUrls
    }

    async fetch({
      kind,
      filename,
    }: {
      kind: PdfBinaryDataKind
      filename: string
    }): Promise<Uint8Array> {
      const baseUrl = this.#baseUrls[kind]
      if (!baseUrl) {
        throw new Error('PDF binary resource location is not configured')
      }

      try {
        const data = await readFile(join(baseUrl, filename))
        if (
          kind === 'standardFontDataUrl' &&
          !hasValidStandardFontHeader(filename, data)
        ) {
          throw new Error('Standard font resource is invalid')
        }
        return new Uint8Array(data)
      } catch {
        if (kind === 'standardFontDataUrl') {
          resourceWarnings.add(PDF_STANDARD_FONT_WARNING)
          throw new Error(
            'PDF standard font resource is unavailable or invalid'
          )
        }
        throw new Error('PDF binary resource is unavailable or invalid')
      }
    }
  }
}

function decodeBase64(value: string): Buffer {
  const normalized = value.replace(/^data:[^;]+;base64,/, '').replace(/\s/g, '')
  if (
    !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) ||
    normalized.length % 4 === 1
  ) {
    throw new ArtifactInputError(
      'invalid_file_encoding',
      'File content is not valid base64.'
    )
  }

  const buffer = Buffer.from(normalized, 'base64')
  if (buffer.length === 0) {
    throw new ArtifactInputError(
      'empty_extracted_text',
      'File content is empty.'
    )
  }
  return buffer
}

function stripHtml(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeExtractedText(text: string, mediaType: string): string {
  const normalized = text.trim()
  return mediaType === 'text/html' ? stripHtml(normalized) : normalized
}

function requireExtractedText(text: string): string {
  if (!text.trim()) {
    throw new ArtifactInputError(
      'empty_extracted_text',
      'Document contains no extractable text.'
    )
  }
  return text
}

function pdfExtractionErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'InvalidPDFException') {
      return 'Could not extract PDF text: invalid or corrupted PDF'
    }
    if (error.name === 'PasswordException') {
      return 'Could not extract PDF text: password-protected PDF is not supported'
    }
  }

  return 'Could not extract PDF text: PDF parsing failed'
}

async function extractPdfText(
  buffer: Buffer
): Promise<{ text: string; warnings: string[] }> {
  const resourceWarnings = new Set<string>()
  const loadingTask = getDocument({
    BinaryDataFactory: createPdfBinaryDataFactory(resourceWarnings),
    data: new Uint8Array(buffer),
    disableFontFace: true,
    standardFontDataUrl: PDF_STANDARD_FONT_DATA_URL,
    useSystemFonts: false,
  })
  const document = await loadingTask.promise
  const pages: string[] = []

  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent()
      pages.push(
        content.items
          .map((item) => ('str' in item ? item.str : ''))
          .filter(Boolean)
          .join(' ')
      )
    }
  } finally {
    document.cleanup()
  }

  return {
    text: pages.join('\n\n').trim(),
    warnings: [...resourceWarnings],
  }
}

function kindFor(mediaType: string): ExtractedArtifact['kind'] {
  if (mediaType === 'application/pdf') return 'pdf'
  if (mediaType === DOCX_MEDIA_TYPE) {
    return 'docx'
  }
  if (mediaType === DOC_MEDIA_TYPE) return 'text'
  if (IMAGE_MEDIA_TYPES.has(mediaType)) return 'image'
  return 'text'
}

export async function extractArtifact(
  file: InputFile
): Promise<ExtractedArtifact> {
  const warnings: string[] = []
  let buffer: Buffer | undefined

  if (file.contentBase64 !== undefined) {
    buffer = decodeBase64(file.contentBase64)
    if (buffer.length > MAX_ARTIFACT_BYTES) {
      throw new ArtifactInputError(
        'document_limit_exceeded',
        `File exceeds the ${MAX_ARTIFACT_BYTES} byte per-file limit.`
      )
    }
  }

  const detected = detectInputFormat(file, buffer)
  const mediaType = detected.canonicalMediaType
  const decodedText = detected.decodedText
  const kind = kindFor(mediaType)

  const id = file.id ?? `artifact.${file.filename}`
  if (file.text !== undefined) {
    const text = normalizeExtractedText(file.text, mediaType)
    return {
      id,
      filename: file.filename,
      mediaType,
      kind: 'text',
      text: requireExtractedText(text),
      warnings,
    }
  }

  if (!buffer) {
    throw new ArtifactInputError(
      'document_extraction_failed',
      'File content is missing.'
    )
  }

  if (decodedText !== undefined) {
    const text = normalizeExtractedText(decodedText, mediaType)
    return {
      id,
      filename: file.filename,
      mediaType,
      kind: 'text',
      text: requireExtractedText(text),
      warnings,
    }
  }

  if (mediaType === 'application/pdf') {
    try {
      const result = await extractPdfText(buffer)
      const { text } = result
      warnings.push(...result.warnings)
      if (!text) {
        warnings.push(
          'PDF contains no extractable text; image/OCR processing is required'
        )
      }
      return { id, filename: file.filename, mediaType, kind, text, warnings }
    } catch (error) {
      throw new ArtifactInputError(
        error instanceof Error && error.name === 'PasswordException'
          ? 'encrypted_document'
          : 'corrupt_document',
        pdfExtractionErrorMessage(error)
      )
    }
  }

  if (kind === 'docx') {
    try {
      const result = await mammoth.extractRawText({ buffer })
      warnings.push(...result.messages.map((message) => message.message))
      return {
        id,
        filename: file.filename,
        mediaType,
        kind,
        text: result.value.trim(),
        warnings,
      }
    } catch {
      throw new ArtifactInputError(
        'document_extraction_failed',
        'Could not extract DOCX text.'
      )
    }
  }

  if (mediaType === DOC_MEDIA_TYPE) {
    try {
      const text = await extractLegacyDocText(buffer)
      return {
        id,
        filename: file.filename,
        mediaType,
        kind: 'text',
        text: requireExtractedText(text),
        warnings,
      }
    } catch {
      throw new ArtifactInputError(
        'document_extraction_failed',
        'Could not extract text from the legacy Word document.'
      )
    }
  }

  if (mediaType === ODT_MEDIA_TYPE) {
    return {
      id,
      filename: file.filename,
      mediaType,
      kind: 'text',
      text: extractOdtText(buffer),
      warnings,
    }
  }

  if (mediaType === 'application/rtf') {
    return {
      id,
      filename: file.filename,
      mediaType,
      kind: 'text',
      text: extractRtfText(buffer),
      warnings,
    }
  }

  if (IMAGE_MEDIA_TYPES.has(mediaType)) {
    return {
      id,
      filename: file.filename,
      mediaType,
      kind,
      imageDataUrl: `data:${mediaType};base64,${buffer.toString('base64')}`,
      warnings,
    }
  }

  throw new ArtifactInputError(
    'unsupported_file_type',
    'File type is not supported.'
  )
}

export async function extractArtifacts(
  files: InputFile[]
): Promise<ExtractedArtifact[]> {
  let totalBytes = 0
  const results: ExtractedArtifact[] = []
  const ids = new Set<string>()

  for (const file of files) {
    const bytes = file.contentBase64
      ? Math.floor((file.contentBase64.replace(/\s/g, '').length * 3) / 4)
      : Buffer.byteLength(file.text ?? '', 'utf8')
    totalBytes += bytes
    if (totalBytes > MAX_TOTAL_ARTIFACT_BYTES) {
      throw new ArtifactInputError(
        'document_limit_exceeded',
        `Input files exceed the ${MAX_TOTAL_ARTIFACT_BYTES} byte total limit.`
      )
    }

    const result = await extractArtifact(file)
    if (ids.has(result.id)) {
      throw new ArtifactInputError(
        'document_extraction_failed',
        'Input artifact IDs must be unique.'
      )
    }
    ids.add(result.id)
    results.push(result)
  }

  return results
}
