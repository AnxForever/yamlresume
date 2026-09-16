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

import type { InputFile } from '@/contracts'
import {
  BoundedZipError,
  isZipArchive,
  openBoundedZip,
} from '@/input/bounded-zip'
import { ArtifactInputError } from '@/input/errors'
import { inspectOdtPackage, ODT_MEDIA_TYPE } from '@/input/odt'

export const DOCX_MEDIA_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
export { ODT_MEDIA_TYPE } from '@/input/odt'

export type SupportedInputFormat =
  | 'plain-text'
  | 'html'
  | 'yaml'
  | 'json'
  | 'markdown'
  | 'pdf'
  | 'docx'
  | 'odt'
  | 'rtf'
  | 'doc'
  | 'png'
  | 'jpeg'
  | 'webp'
  | 'gif'

export interface DetectedInputFormat {
  format: SupportedInputFormat
  canonicalMediaType: string
  confidence: 'signature-and-container' | 'signature' | 'validated-text'
  decodedText?: string
}

const TEXT_MEDIA_TYPES = new Set([
  'application/json',
  'application/yaml',
  'text/html',
  'text/markdown',
  'text/plain',
  'text/xml',
])

function mismatch(): never {
  throw new ArtifactInputError(
    'file_type_mismatch',
    'File type does not match its content.'
  )
}

function extensionOf(filename: string): string {
  const extension = filename.toLocaleLowerCase().split('.').pop()
  return extension ?? ''
}

function mediaTypeForExtension(filename: string): string | undefined {
  switch (extensionOf(filename)) {
    case 'docx':
      return DOCX_MEDIA_TYPE
    case 'doc':
      return 'application/msword'
    case 'json':
    case 'jsonld':
      return 'application/json'
    case 'html':
    case 'htm':
      return 'text/html'
    case 'md':
    case 'markdown':
      return 'text/markdown'
    case 'pdf':
      return 'application/pdf'
    case 'odt':
      return ODT_MEDIA_TYPE
    case 'rtf':
      return 'application/rtf'
    case 'gif':
      return 'image/gif'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'png':
      return 'image/png'
    case 'webp':
      return 'image/webp'
    case 'yaml':
    case 'yml':
      return 'application/yaml'
    case 'txt':
      return 'text/plain'
    case 'xml':
      return 'text/xml'
    default:
      return undefined
  }
}

function canonicalMediaType(value: string): string {
  switch (value) {
    case 'application/ld+json':
      return 'application/json'
    case 'application/x-yaml':
    case 'text/x-yaml':
    case 'text/yaml':
      return 'application/yaml'
    case 'text/x-markdown':
      return 'text/markdown'
    case 'application/x-pdf':
      return 'application/pdf'
    case 'application/x-rtf':
    case 'text/rtf':
      return 'application/rtf'
    case 'image/jpg':
      return 'image/jpeg'
    default:
      return value
  }
}

function declaredMediaType(file: InputFile): string | undefined {
  const value = file.mediaType?.toLocaleLowerCase().split(';')[0].trim()
  return value ? canonicalMediaType(value) : undefined
}

function claimsFor(file: InputFile): string[] {
  const claims = [
    declaredMediaType(file),
    mediaTypeForExtension(file.filename),
  ].filter(
    (claim): claim is string =>
      claim !== undefined && claim !== 'application/octet-stream'
  )
  if (new Set(claims).size > 1) mismatch()
  return claims
}

function formatForMediaType(
  mediaType: string
): SupportedInputFormat | undefined {
  switch (mediaType) {
    case 'text/plain':
    case 'text/xml':
      return 'plain-text'
    case 'text/html':
      return 'html'
    case 'application/yaml':
      return 'yaml'
    case 'application/json':
      return 'json'
    case 'text/markdown':
      return 'markdown'
    case 'application/pdf':
      return 'pdf'
    case DOCX_MEDIA_TYPE:
      return 'docx'
    case ODT_MEDIA_TYPE:
      return 'odt'
    case 'application/rtf':
      return 'rtf'
    case 'application/msword':
      return 'doc'
    case 'image/png':
      return 'png'
    case 'image/jpeg':
      return 'jpeg'
    case 'image/webp':
      return 'webp'
    case 'image/gif':
      return 'gif'
    default:
      return undefined
  }
}

function hasRtfHeader(buffer: Buffer): boolean {
  let offset = buffer.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))
    ? 3
    : 0
  while (
    offset < buffer.length &&
    (buffer[offset] === 0x09 ||
      buffer[offset] === 0x0a ||
      buffer[offset] === 0x0d ||
      buffer[offset] === 0x20)
  ) {
    offset += 1
  }
  return /^\{\\rtf\d/u.test(
    buffer.subarray(offset, offset + 16).toString('ascii')
  )
}

function decodeUtf8(buffer: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    throw new BoundedZipError('corrupt_archive')
  }
}

function validateArchiveEntries(
  archive: ReturnType<typeof openBoundedZip>
): void {
  for (const entry of archive.entries) {
    if (!entry.name.endsWith('/')) archive.read(entry.name)
  }
}

function detectZipFormat(buffer: Buffer): DetectedInputFormat | undefined {
  const archive = openBoundedZip(buffer)
  if (archive.has('[Content_Types].xml') && archive.has('word/document.xml')) {
    const contentTypes = decodeUtf8(archive.read('[Content_Types].xml'))
    if (
      !/<!DOCTYPE|<!ENTITY/iu.test(contentTypes) &&
      contentTypes.includes('/word/document.xml') &&
      (contentTypes.includes(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'
      ) ||
        contentTypes.includes('application/vnd.ms-word.document.main+xml'))
    ) {
      validateArchiveEntries(archive)
      return {
        format: 'docx',
        canonicalMediaType: DOCX_MEDIA_TYPE,
        confidence: 'signature-and-container',
      }
    }
  }

  if (inspectOdtPackage(archive)) {
    validateArchiveEntries(archive)
    return {
      format: 'odt',
      canonicalMediaType: ODT_MEDIA_TYPE,
      confidence: 'signature-and-container',
    }
  }
  return undefined
}

function mapArchiveError(error: unknown): never {
  if (error instanceof ArtifactInputError) throw error
  if (error instanceof BoundedZipError) {
    if (error.code === 'encrypted_archive') {
      throw new ArtifactInputError(
        'encrypted_document',
        'Encrypted documents are not supported.'
      )
    }
    if (error.code === 'archive_limit_exceeded') {
      throw new ArtifactInputError(
        'document_limit_exceeded',
        'Document archive exceeds safe processing limits.'
      )
    }
  }
  throw new ArtifactInputError(
    'corrupt_document',
    'Document archive is invalid or unsupported.'
  )
}

function detectSignedFormat(buffer: Buffer): DetectedInputFormat | undefined {
  if (buffer.subarray(0, 5).equals(Buffer.from('%PDF-', 'ascii'))) {
    return {
      format: 'pdf',
      canonicalMediaType: 'application/pdf',
      confidence: 'signature',
    }
  }
  if (
    buffer
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return {
      format: 'png',
      canonicalMediaType: 'image/png',
      confidence: 'signature',
    }
  }
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return {
      format: 'jpeg',
      canonicalMediaType: 'image/jpeg',
      confidence: 'signature',
    }
  }
  const header = buffer.subarray(0, 12).toString('ascii')
  if (header.startsWith('GIF87a') || header.startsWith('GIF89a')) {
    return {
      format: 'gif',
      canonicalMediaType: 'image/gif',
      confidence: 'signature',
    }
  }
  if (header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP') {
    return {
      format: 'webp',
      canonicalMediaType: 'image/webp',
      confidence: 'signature',
    }
  }
  if (hasRtfHeader(buffer)) {
    return {
      format: 'rtf',
      canonicalMediaType: 'application/rtf',
      confidence: 'signature',
    }
  }
  if (isZipArchive(buffer)) {
    try {
      return detectZipFormat(buffer)
    } catch (error) {
      return mapArchiveError(error)
    }
  }
  return undefined
}

function decodeValidatedText(buffer: Buffer): string | undefined {
  try {
    let text: string
    if (buffer[0] === 0xff && buffer[1] === 0xfe) {
      text = new TextDecoder('utf-16le', { fatal: true }).decode(
        buffer.subarray(2)
      )
    } else if (buffer[0] === 0xfe && buffer[1] === 0xff) {
      text = new TextDecoder('utf-16be', { fatal: true }).decode(
        buffer.subarray(2)
      )
    } else {
      text = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
    }
    return text.includes('\u0000') ? undefined : text.replace(/^\uFEFF/, '')
  } catch {
    return undefined
  }
}

export function detectInputFormat(
  file: InputFile,
  buffer?: Buffer
): DetectedInputFormat {
  const claims = claimsFor(file)
  if (!buffer) {
    const mediaType = claims[0] ?? 'text/plain'
    if (!TEXT_MEDIA_TYPES.has(mediaType)) mismatch()
    const format = formatForMediaType(mediaType)
    if (!format) {
      throw new ArtifactInputError(
        'unsupported_file_type',
        'File type is not supported.'
      )
    }
    return {
      format,
      canonicalMediaType: mediaType,
      confidence: 'validated-text',
      decodedText: file.text ?? '',
    }
  }

  const signed = detectSignedFormat(buffer)
  if (signed) {
    if (claims.some((claim) => claim !== signed.canonicalMediaType)) mismatch()
    return signed
  }
  if (isZipArchive(buffer)) {
    if (claims.length) mismatch()
    throw new ArtifactInputError(
      'unsupported_file_type',
      'File type is not supported.'
    )
  }

  const decodedText = decodeValidatedText(buffer)
  if (decodedText !== undefined) {
    if (claims.some((claim) => !TEXT_MEDIA_TYPES.has(claim))) mismatch()
    const mediaType = claims[0] ?? 'text/plain'
    const format = formatForMediaType(mediaType)
    if (!format) {
      throw new ArtifactInputError(
        'unsupported_file_type',
        'File type is not supported.'
      )
    }
    return {
      format,
      canonicalMediaType: mediaType,
      confidence: 'validated-text',
      decodedText,
    }
  }

  if (claims.length === 0) {
    throw new ArtifactInputError(
      'unsupported_file_type',
      'File type is not supported.'
    )
  }
  if (claims.every((claim) => TEXT_MEDIA_TYPES.has(claim))) {
    throw new ArtifactInputError(
      'invalid_file_encoding',
      'Text file encoding is invalid or unsupported.'
    )
  }
  return mismatch()
}
