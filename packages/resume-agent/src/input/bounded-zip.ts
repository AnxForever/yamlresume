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

import { inflateRawSync } from 'node:zlib'

const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50
const MAX_ZIP_COMMENT_BYTES = 65_535
const ZIP64_UINT16 = 0xffff
const ZIP64_UINT32 = 0xffffffff

export const DEFAULT_ZIP_LIMITS = Object.freeze({
  maxEntries: 128,
  maxExpandedBytes: 32 * 1024 * 1024,
})

export type BoundedZipErrorCode =
  | 'corrupt_archive'
  | 'encrypted_archive'
  | 'archive_limit_exceeded'
  | 'unsupported_archive'

export class BoundedZipError extends Error {
  constructor(readonly code: BoundedZipErrorCode) {
    super('Archive could not be inspected safely.')
    this.name = 'BoundedZipError'
  }
}

export interface BoundedZipEntry {
  readonly name: string
  readonly compressionMethod: 0 | 8
  readonly compressedSize: number
  readonly uncompressedSize: number
  readonly localHeaderOffset: number
}

interface IndexedZipEntry extends BoundedZipEntry {
  readonly crc32: number
  readonly dataOffset: number
}

export interface BoundedZipArchive {
  readonly entries: readonly BoundedZipEntry[]
  has(name: string): boolean
  entry(name: string): BoundedZipEntry | undefined
  read(name: string): Buffer
}

interface ZipLimits {
  maxEntries: number
  maxExpandedBytes: number
}

function fail(code: BoundedZipErrorCode = 'corrupt_archive'): never {
  throw new BoundedZipError(code)
}

function crc32(content: Buffer): number {
  let crc = 0xffffffff
  for (const byte of content) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const minimumOffset = Math.max(0, buffer.length - 22 - MAX_ZIP_COMMENT_BYTES)
  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) !== END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      continue
    }
    const commentLength = buffer.readUInt16LE(offset + 20)
    if (offset + 22 + commentLength === buffer.length) return offset
  }
  return fail()
}

function decodeEntryName(bytes: Buffer, utf8: boolean): string {
  if (!utf8 && bytes.some((byte) => byte > 0x7f)) return fail()
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return fail()
  }
}

function assertSafeEntryName(name: string): void {
  const segments = name.split('/')
  if (
    !name ||
    name.includes('\u0000') ||
    name.includes('\\') ||
    name.startsWith('/') ||
    /^[A-Za-z]:/u.test(name) ||
    segments.some((segment) => segment === '.' || segment === '..')
  ) {
    fail()
  }
}

function checkedEnd(offset: number, length: number, maximum: number): number {
  if (offset < 0 || length < 0 || offset > maximum - length) return fail()
  return offset + length
}

export function isZipArchive(buffer: Buffer): boolean {
  if (buffer.length < 4) return false
  const signature = buffer.readUInt32LE(0)
  return (
    signature === LOCAL_FILE_HEADER_SIGNATURE ||
    signature === END_OF_CENTRAL_DIRECTORY_SIGNATURE
  )
}

export function openBoundedZip(
  buffer: Buffer,
  limits: ZipLimits = DEFAULT_ZIP_LIMITS
): BoundedZipArchive {
  if (!isZipArchive(buffer) || buffer.length < 22) return fail()
  const endOffset = findEndOfCentralDirectory(buffer)
  const diskNumber = buffer.readUInt16LE(endOffset + 4)
  const centralDisk = buffer.readUInt16LE(endOffset + 6)
  const entriesOnDisk = buffer.readUInt16LE(endOffset + 8)
  const entryCount = buffer.readUInt16LE(endOffset + 10)
  const centralSize = buffer.readUInt32LE(endOffset + 12)
  const centralOffset = buffer.readUInt32LE(endOffset + 16)

  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) {
    return fail('unsupported_archive')
  }
  if (
    entryCount === ZIP64_UINT16 ||
    centralSize === ZIP64_UINT32 ||
    centralOffset === ZIP64_UINT32
  ) {
    return fail('unsupported_archive')
  }
  if (entryCount > limits.maxEntries) return fail('archive_limit_exceeded')
  const centralEnd = checkedEnd(centralOffset, centralSize, endOffset)
  if (centralEnd !== endOffset) return fail()

  const indexed: IndexedZipEntry[] = []
  const names = new Set<string>()
  let expandedBytes = 0
  let position = centralOffset

  for (let index = 0; index < entryCount; index += 1) {
    checkedEnd(position, 46, centralEnd)
    if (buffer.readUInt32LE(position) !== CENTRAL_DIRECTORY_SIGNATURE) {
      return fail()
    }
    const flags = buffer.readUInt16LE(position + 8)
    const compressionMethod = buffer.readUInt16LE(position + 10)
    const checksum = buffer.readUInt32LE(position + 16)
    const compressedSize = buffer.readUInt32LE(position + 20)
    const uncompressedSize = buffer.readUInt32LE(position + 24)
    const nameLength = buffer.readUInt16LE(position + 28)
    const extraLength = buffer.readUInt16LE(position + 30)
    const commentLength = buffer.readUInt16LE(position + 32)
    const diskStart = buffer.readUInt16LE(position + 34)
    const localHeaderOffset = buffer.readUInt32LE(position + 42)
    const entryEnd = checkedEnd(
      position,
      46 + nameLength + extraLength + commentLength,
      centralEnd
    )

    if ((flags & 0x1) !== 0) return fail('encrypted_archive')
    if (diskStart !== 0) return fail('unsupported_archive')
    if (
      compressedSize === ZIP64_UINT32 ||
      uncompressedSize === ZIP64_UINT32 ||
      localHeaderOffset === ZIP64_UINT32
    ) {
      return fail('unsupported_archive')
    }
    if (compressionMethod !== 0 && compressionMethod !== 8) {
      return fail('unsupported_archive')
    }

    const nameStart = position + 46
    const name = decodeEntryName(
      buffer.subarray(nameStart, nameStart + nameLength),
      (flags & 0x0800) !== 0
    )
    assertSafeEntryName(name)
    if (names.has(name)) return fail()
    names.add(name)

    expandedBytes += uncompressedSize
    if (
      uncompressedSize > limits.maxExpandedBytes ||
      expandedBytes > limits.maxExpandedBytes
    ) {
      return fail('archive_limit_exceeded')
    }

    checkedEnd(localHeaderOffset, 30, centralOffset)
    if (
      buffer.readUInt32LE(localHeaderOffset) !== LOCAL_FILE_HEADER_SIGNATURE
    ) {
      return fail()
    }
    const localFlags = buffer.readUInt16LE(localHeaderOffset + 6)
    const localMethod = buffer.readUInt16LE(localHeaderOffset + 8)
    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26)
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28)
    const localNameStart = localHeaderOffset + 30
    const dataOffset = checkedEnd(
      localNameStart,
      localNameLength + localExtraLength,
      centralOffset
    )
    checkedEnd(dataOffset, compressedSize, centralOffset)
    const localName = decodeEntryName(
      buffer.subarray(localNameStart, localNameStart + localNameLength),
      (localFlags & 0x0800) !== 0
    )
    if (
      localName !== name ||
      localFlags !== flags ||
      localMethod !== compressionMethod
    ) {
      return fail()
    }
    if ((flags & 0x0008) === 0) {
      if (
        buffer.readUInt32LE(localHeaderOffset + 14) !== checksum ||
        buffer.readUInt32LE(localHeaderOffset + 18) !== compressedSize ||
        buffer.readUInt32LE(localHeaderOffset + 22) !== uncompressedSize
      ) {
        return fail()
      }
    }

    indexed.push({
      name,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      crc32: checksum,
      dataOffset,
    })
    position = entryEnd
  }
  if (position !== centralEnd) return fail()

  const occupied = indexed
    .map((entry) => ({
      start: entry.localHeaderOffset,
      end: entry.dataOffset + entry.compressedSize,
    }))
    .sort((left, right) => left.start - right.start)
  for (let index = 1; index < occupied.length; index += 1) {
    if ((occupied[index - 1]?.end ?? 0) > (occupied[index]?.start ?? 0)) {
      return fail()
    }
  }

  const byName = new Map(indexed.map((entry) => [entry.name, entry]))
  return {
    entries: indexed,
    has: (name) => byName.has(name),
    entry: (name) => byName.get(name),
    read: (name) => {
      const entry = byName.get(name)
      if (!entry) return fail()
      const compressed = buffer.subarray(
        entry.dataOffset,
        entry.dataOffset + entry.compressedSize
      )
      let content: Buffer
      try {
        content =
          entry.compressionMethod === 0
            ? Buffer.from(compressed)
            : inflateRawSync(compressed, {
                maxOutputLength: Math.max(1, entry.uncompressedSize),
              })
      } catch {
        return fail()
      }
      if (
        content.length !== entry.uncompressedSize ||
        crc32(content) !== entry.crc32
      ) {
        return fail()
      }
      return content
    },
  }
}
