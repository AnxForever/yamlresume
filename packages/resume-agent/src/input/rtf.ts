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
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

import { ArtifactInputError } from '@/input/errors'

const MAX_GROUP_DEPTH = 128
const MAX_CONTROL_WORDS = 250_000
const MAX_CONTROL_NAME = 32
const MAX_BINARY_BYTES = 8 * 1024 * 1024
const MAX_OUTPUT_CHARACTERS = 1_000_000

interface Frame {
  readonly skip: boolean
  readonly starred: boolean
  readonly uc: number
  fallback: number
}

const SKIPPED_DESTINATIONS = new Set([
  'annotation',
  'colortbl',
  'filetbl',
  'fonttbl',
  'footer',
  'footerf',
  'footerl',
  'footerr',
  'generator',
  'header',
  'headerf',
  'headerl',
  'headerr',
  'info',
  'listtable',
  'listoverridetable',
  'pict',
  'pntext',
  'stylesheet',
])

function corrupt(): never {
  throw new ArtifactInputError(
    'corrupt_document',
    'RTF document is invalid or unsupported.'
  )
}

function limited(): never {
  throw new ArtifactInputError(
    'document_limit_exceeded',
    'RTF document exceeds safe processing limits.'
  )
}

function codePointFromRtf(value: number): string {
  const codePoint = value < 0 ? value + 0x10000 : value
  if (codePoint < 0 || codePoint > 0x10ffff) {
    corrupt()
  }
  if (codePoint >= 0xd800 && codePoint <= 0xdfff) {
    return String.fromCharCode(codePoint)
  }
  return String.fromCodePoint(codePoint)
}

function decodeAnsiByte(value: number): string {
  return new TextDecoder('windows-1252').decode(Uint8Array.of(value))
}

function normalizeText(value: string): string {
  return value
    .replace(/\r\n?/gu, '\n')
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
}

export function extractRtfText(buffer: Buffer): string {
  if (buffer.length === 0) corrupt()
  let position = 0
  let controls = 0
  let binaryBytes = 0
  let outputCharacters = 0
  let pendingIgnorable = false
  const frames: Frame[] = [{ skip: false, starred: false, uc: 1, fallback: 0 }]
  const output: string[] = []

  const current = (): Frame => frames[frames.length - 1]
  const append = (value: string): void => {
    if (current().skip || current().fallback > 0) {
      if (current().fallback > 0) current().fallback -= 1
      return
    }
    outputCharacters += [...value].length
    if (outputCharacters > MAX_OUTPUT_CHARACTERS) limited()
    output.push(value)
  }
  const consumeFallback = (): boolean => {
    if (current().fallback === 0) return false
    current().fallback -= 1
    return true
  }
  const setDestination = (name: string): void => {
    if (SKIPPED_DESTINATIONS.has(name) || name === 'fldinst') {
      const frame = current()
      frames[frames.length - 1] = { ...frame, skip: true }
      return
    }
    if (name === 'fldrslt') {
      const frame = current()
      frames[frames.length - 1] = { ...frame, skip: false, starred: false }
      return
    }
    if (pendingIgnorable) {
      const frame = current()
      frames[frames.length - 1] = { ...frame, skip: true }
    }
    pendingIgnorable = false
  }

  while (position < buffer.length) {
    const byte = buffer[position]
    if (byte === 0x7b) {
      if (frames.length >= MAX_GROUP_DEPTH) limited()
      const parent = current()
      frames.push({
        skip: parent.skip,
        starred: false,
        uc: parent.uc,
        fallback: parent.fallback,
      })
      position += 1
      continue
    }
    if (byte === 0x7d) {
      if (frames.length === 1) corrupt()
      frames.pop()
      position += 1
      continue
    }
    if (byte !== 0x5c) {
      position += 1
      if (byte === 0x0a || byte === 0x0d) continue
      if (!consumeFallback()) append(String.fromCharCode(byte))
      continue
    }

    position += 1
    if (position >= buffer.length) corrupt()
    const escaped = buffer[position]
    if (escaped === 0x27) {
      if (position + 2 >= buffer.length) corrupt()
      const hex = buffer.subarray(position + 1, position + 3).toString('ascii')
      if (!/^[0-9A-Fa-f]{2}$/u.test(hex)) corrupt()
      position += 3
      if (!consumeFallback()) append(decodeAnsiByte(Number.parseInt(hex, 16)))
      continue
    }
    if (escaped === 0x7b || escaped === 0x7d || escaped === 0x5c) {
      position += 1
      if (!consumeFallback()) append(String.fromCharCode(escaped))
      continue
    }
    if (escaped === 0x2a) {
      pendingIgnorable = true
      position += 1
      continue
    }
    if (!/[A-Za-z]/u.test(String.fromCharCode(escaped))) {
      position += 1
      if (!consumeFallback()) {
        if (escaped === 0x7e) append(' ')
        else if (escaped === 0x2d || escaped === 0x5f) append('-')
      }
      continue
    }

    const nameStart = position
    while (
      position < buffer.length &&
      /[A-Za-z]/u.test(String.fromCharCode(buffer[position]))
    ) {
      position += 1
      if (position - nameStart > MAX_CONTROL_NAME) limited()
    }
    const name = buffer
      .subarray(nameStart, position)
      .toString('ascii')
      .toLowerCase()
    controls += 1
    if (controls > MAX_CONTROL_WORDS) limited()
    let sign = 1
    if (buffer[position] === 0x2d) {
      sign = -1
      position += 1
    } else if (buffer[position] === 0x2b) {
      position += 1
    }
    const numberStart = position
    while (
      position < buffer.length &&
      /[0-9]/u.test(String.fromCharCode(buffer[position]))
    ) {
      position += 1
    }
    const number =
      position > numberStart
        ? sign *
          Number.parseInt(
            buffer.subarray(numberStart, position).toString('ascii'),
            10
          )
        : undefined
    if (buffer[position] === 0x20) position += 1

    if (consumeFallback()) continue
    if (name === 'bin') {
      if (number === undefined || number < 0) corrupt()
      binaryBytes += number
      if (binaryBytes > MAX_BINARY_BYTES || position + number > buffer.length)
        limited()
      position += number
      continue
    }
    if (name === 'uc') {
      if (number === undefined || number < 0 || number > 32) corrupt()
      const frame = current()
      frames[frames.length - 1] = { ...frame, uc: number }
      continue
    }
    if (name === 'u') {
      if (number === undefined) corrupt()
      append(codePointFromRtf(number))
      current().fallback = current().uc
      continue
    }
    if (name === 'par' || name === 'line') append('\n')
    else if (name === 'tab') append('\t')
    else setDestination(name)
  }

  if (frames.length !== 1) corrupt()
  const text = normalizeText(output.join(''))
  if (!text) {
    throw new ArtifactInputError(
      'empty_extracted_text',
      'Document contains no extractable text.'
    )
  }
  return text
}
