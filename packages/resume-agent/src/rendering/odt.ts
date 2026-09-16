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

interface OdtResumeDocument {
  title: string
  headline: string
  contacts: string[]
  summaryHeading: string
  summary: string[]
  sections: Array<{
    heading: string
    entries: Array<{
      title: string
      metadata: string
      details: string[]
    }>
  }>
}

interface StoredZipEntry {
  name: string
  content: Buffer
}

const ODT_MEDIA_TYPE = 'application/vnd.oasis.opendocument.text'
const UTF8_FLAG = 0x0800
const ZIP_VERSION = 20
const DOS_DATE_1980_01_01 = 0x0021

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

function storedZip(entries: StoredZipEntry[]): Buffer {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let localOffset = 0

  for (const entry of entries) {
    const filename = Buffer.from(entry.name, 'utf8')
    const checksum = crc32(entry.content)
    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt16LE(ZIP_VERSION, 4)
    localHeader.writeUInt16LE(UTF8_FLAG, 6)
    localHeader.writeUInt16LE(0, 8)
    localHeader.writeUInt16LE(0, 10)
    localHeader.writeUInt16LE(DOS_DATE_1980_01_01, 12)
    localHeader.writeUInt32LE(checksum, 14)
    localHeader.writeUInt32LE(entry.content.byteLength, 18)
    localHeader.writeUInt32LE(entry.content.byteLength, 22)
    localHeader.writeUInt16LE(filename.byteLength, 26)
    localHeader.writeUInt16LE(0, 28)
    localParts.push(localHeader, filename, entry.content)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x02014b50, 0)
    centralHeader.writeUInt16LE(ZIP_VERSION, 4)
    centralHeader.writeUInt16LE(ZIP_VERSION, 6)
    centralHeader.writeUInt16LE(UTF8_FLAG, 8)
    centralHeader.writeUInt16LE(0, 10)
    centralHeader.writeUInt16LE(0, 12)
    centralHeader.writeUInt16LE(DOS_DATE_1980_01_01, 14)
    centralHeader.writeUInt32LE(checksum, 16)
    centralHeader.writeUInt32LE(entry.content.byteLength, 20)
    centralHeader.writeUInt32LE(entry.content.byteLength, 24)
    centralHeader.writeUInt16LE(filename.byteLength, 28)
    centralHeader.writeUInt16LE(0, 30)
    centralHeader.writeUInt16LE(0, 32)
    centralHeader.writeUInt16LE(0, 34)
    centralHeader.writeUInt16LE(0, 36)
    centralHeader.writeUInt32LE(0, 38)
    centralHeader.writeUInt32LE(localOffset, 42)
    centralParts.push(centralHeader, filename)

    localOffset +=
      localHeader.byteLength + filename.byteLength + entry.content.byteLength
  }

  const centralDirectory = Buffer.concat(centralParts)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralDirectory.byteLength, 12)
  end.writeUInt32LE(localOffset, 16)
  end.writeUInt16LE(0, 20)
  return Buffer.concat([...localParts, centralDirectory, end])
}

function xmlText(value: string): string {
  let safe = ''
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0
    if (
      codePoint === 0x09 ||
      codePoint === 0x0a ||
      codePoint === 0x0d ||
      (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
      (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
      (codePoint >= 0x10000 && codePoint <= 0x10ffff)
    ) {
      safe += character
    } else {
      safe += '\ufffd'
    }
  }
  return safe
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function xmlAttribute(value: string): string {
  return xmlText(value).replaceAll('"', '&quot;').replaceAll("'", '&apos;')
}

function inlineText(value: string): string {
  const linkPattern = /https?:\/\/[^\s]+/gu
  const fragments: string[] = []
  let offset = 0
  for (const match of value.matchAll(linkPattern)) {
    const index = match.index
    const link = match[0]
    fragments.push(xmlText(value.slice(offset, index)))
    fragments.push(
      `<text:a xlink:type="simple" xlink:href="${xmlAttribute(link)}">${xmlText(link)}</text:a>`
    )
    offset = index + link.length
  }
  fragments.push(xmlText(value.slice(offset)))
  return fragments.join('')
}

function paragraph(value: string, style: string): string {
  return `      <text:p text:style-name="${style}">${inlineText(value)}</text:p>`
}

function heading(value: string, level: 1 | 2, style: string): string {
  return `      <text:h text:style-name="${style}" text:outline-level="${level}">${inlineText(value)}</text:h>`
}

function manifestXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">
  <manifest:file-entry manifest:full-path="/" manifest:version="1.3" manifest:media-type="${ODT_MEDIA_TYPE}"/>
  <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
  <manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>
  <manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>
</manifest:manifest>
`
}

function contentXml(document: OdtResumeDocument): string {
  const body = [heading(document.title, 1, 'ResumeTitle')]
  if (document.headline) {
    body.push(paragraph(document.headline, 'ResumeHeadline'))
  }
  if (document.contacts.length) {
    body.push(paragraph(document.contacts.join(' • '), 'ResumeContact'))
  }
  if (document.summary.length) {
    body.push(heading(document.summaryHeading, 1, 'ResumeSectionHeading'))
    body.push(
      ...document.summary.map((value) => paragraph(value, 'ResumeBody'))
    )
  }
  for (const section of document.sections) {
    body.push(heading(section.heading, 1, 'ResumeSectionHeading'))
    for (const entry of section.entries) {
      body.push(heading(entry.title, 2, 'ResumeEntryHeading'))
      if (entry.metadata) {
        body.push(paragraph(entry.metadata, 'ResumeMetadata'))
      }
      if (entry.details.length) {
        body.push('      <text:list text:style-name="ResumeBulletList">')
        for (const detail of entry.details) {
          body.push(
            '        <text:list-item>',
            `          <text:p text:style-name="ResumeBody">${inlineText(detail)}</text:p>`,
            '        </text:list-item>'
          )
        }
        body.push('      </text:list>')
      }
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" office:version="1.3">
  <office:automatic-styles/>
  <office:body>
    <office:text>
${body.join('\n')}
    </office:text>
  </office:body>
</office:document-content>
`
}

function stylesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" office:version="1.3">
  <office:styles>
    <style:default-style style:family="paragraph">
      <style:paragraph-properties fo:line-height="115%" fo:orphans="2" fo:widows="2"/>
      <style:text-properties fo:font-family="Liberation Sans" fo:font-size="10pt"/>
    </style:default-style>
    <style:style style:name="ResumeTitle" style:family="paragraph">
      <style:paragraph-properties fo:margin-bottom="0.08in"/>
      <style:text-properties fo:font-size="20pt" fo:font-weight="bold"/>
    </style:style>
    <style:style style:name="ResumeHeadline" style:family="paragraph">
      <style:paragraph-properties fo:margin-bottom="0.05in"/>
      <style:text-properties fo:font-size="12pt" fo:font-style="italic"/>
    </style:style>
    <style:style style:name="ResumeContact" style:family="paragraph">
      <style:paragraph-properties fo:margin-bottom="0.12in"/>
      <style:text-properties fo:font-size="9pt"/>
    </style:style>
    <style:style style:name="ResumeSectionHeading" style:family="paragraph">
      <style:paragraph-properties fo:margin-top="0.12in" fo:margin-bottom="0.04in" fo:border-bottom="0.5pt solid #666666" fo:padding-bottom="0.02in"/>
      <style:text-properties fo:font-size="13pt" fo:font-weight="bold"/>
    </style:style>
    <style:style style:name="ResumeEntryHeading" style:family="paragraph">
      <style:paragraph-properties fo:margin-top="0.06in" fo:margin-bottom="0.02in"/>
      <style:text-properties fo:font-weight="bold"/>
    </style:style>
    <style:style style:name="ResumeMetadata" style:family="paragraph">
      <style:paragraph-properties fo:margin-bottom="0.02in"/>
      <style:text-properties fo:font-size="9pt" fo:font-style="italic"/>
    </style:style>
    <style:style style:name="ResumeBody" style:family="paragraph">
      <style:paragraph-properties fo:margin-bottom="0.03in"/>
    </style:style>
    <text:list-style style:name="ResumeBulletList">
      <text:list-level-style-bullet text:level="1" text:bullet-char="•">
        <style:list-level-properties text:space-before="0.25in" text:min-label-width="0.2in"/>
      </text:list-level-style-bullet>
    </text:list-style>
  </office:styles>
  <office:automatic-styles>
    <style:page-layout style:name="ResumePage">
      <style:page-layout-properties fo:page-width="8.27in" fo:page-height="11.69in" style:print-orientation="portrait" fo:margin="0.7in"/>
    </style:page-layout>
  </office:automatic-styles>
  <office:master-styles>
    <style:master-page style:name="ResumeMaster" style:page-layout-name="ResumePage"/>
  </office:master-styles>
</office:document-styles>
`
}

function metaXml(document: OdtResumeDocument): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" office:version="1.3">
  <office:meta>
    <meta:generator>YAMLResume Resume Agent</meta:generator>
    <dc:title>${xmlText(document.title)}</dc:title>
  </office:meta>
</office:document-meta>
`
}

export function renderOdtDocument(document: OdtResumeDocument): Buffer {
  const entries: StoredZipEntry[] = [
    { name: 'mimetype', content: Buffer.from(ODT_MEDIA_TYPE, 'ascii') },
    {
      name: 'META-INF/manifest.xml',
      content: Buffer.from(manifestXml(), 'utf8'),
    },
    { name: 'content.xml', content: Buffer.from(contentXml(document), 'utf8') },
    { name: 'styles.xml', content: Buffer.from(stylesXml(), 'utf8') },
    { name: 'meta.xml', content: Buffer.from(metaXml(document), 'utf8') },
  ]
  return storedZip(entries)
}
