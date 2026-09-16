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

import { describe, expect, it } from 'vitest'
import { extractArtifact } from './artifacts'
import { extractRtfText } from './rtf'

function encoded(value: string): string {
  return Buffer.from(value, 'ascii').toString('base64')
}

describe('extractRtfText', () => {
  it('extracts visible paragraphs, escapes, unicode and fallback text', () => {
    expect(
      extractRtfText(
        Buffer.from(
          String.raw`{\rtf1\ansi\uc1 Hello \b world\b0\par Unicode: \u233? and \u-10179?\u-8704?\par Escaped \\ \{ok\}}`,
          'ascii'
        )
      )
    ).toBe('Hello world\nUnicode: é and 😀\nEscaped \\ {ok}')
  })

  it('skips metadata, pictures, field instructions and unknown starred destinations', () => {
    const text = extractRtfText(
      Buffer.from(
        String.raw`{\rtf1{\info hidden}{\pict hidden}{\field{\*\fldinst SECRET}{\fldrslt Visible}}{\*\custom nope}Keep}`,
        'ascii'
      )
    )
    expect(text).toBe('VisibleKeep')
  })

  it('skips bounded binary payloads and rejects truncated groups', () => {
    expect(
      extractRtfText(Buffer.from('{\\rtf1 before\\bin3 abcafter}', 'ascii'))
    ).toBe('beforeafter')
    expect(() =>
      extractRtfText(Buffer.from('{\\rtf1 broken', 'ascii'))
    ).toThrow('RTF document is invalid or unsupported.')
  })
})

describe('RTF artifact integration', () => {
  it('extracts content from base64 RTF input', async () => {
    const result = await extractArtifact({
      filename: 'candidate.rtf',
      contentBase64: encoded(
        '{\\rtf1\\ansi Platform engineer\\par TypeScript}'
      ),
    })
    expect(result.mediaType).toBe('application/rtf')
    expect(result.text).toBe('Platform engineer\nTypeScript')
  })
})
