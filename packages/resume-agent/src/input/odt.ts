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

import {
  type BoundedZipArchive,
  BoundedZipError,
  openBoundedZip,
} from '@/input/bounded-zip'
import { ArtifactInputError } from '@/input/errors'

const MANIFEST_NAMESPACE = 'urn:oasis:names:tc:opendocument:xmlns:manifest:1.0'
const OFFICE_NAMESPACE = 'urn:oasis:names:tc:opendocument:xmlns:office:1.0'
const TEXT_NAMESPACE = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0'
const DRAW_NAMESPACE = 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0'
const XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace'
const XMLNS_NAMESPACE = 'http://www.w3.org/2000/xmlns/'

const MAX_XML_DEPTH = 128
const MAX_XML_ELEMENTS = 100_000
const MAX_EXTRACTED_CHARACTERS = 1_000_000

export const ODT_MEDIA_TYPE = 'application/vnd.oasis.opendocument.text'

interface ExpandedName {
  readonly namespace: string
  readonly localName: string
  readonly qualifiedName: string
}

interface XmlElement extends ExpandedName {
  readonly attributes: ReadonlyMap<string, string>
}

interface XmlVisitor {
  start(element: XmlElement): void
  text(value: string): void
  end(element: XmlElement): void
}

interface XmlStackEntry {
  readonly element: XmlElement
  readonly namespaces: ReadonlyMap<string, string>
}

interface RawAttribute {
  readonly name: string
  readonly value: string
}

interface TextBlock {
  readonly chunks: string[]
  readonly listDepth: number
  readonly qualifiedName: string
  characters: number
  segments: number
}

function corruptDocument(): never {
  throw new ArtifactInputError(
    'corrupt_document',
    'ODT document is invalid or unsupported.'
  )
}

function documentLimitExceeded(): never {
  throw new ArtifactInputError(
    'document_limit_exceeded',
    'ODT document exceeds safe processing limits.'
  )
}

function encryptedDocument(): never {
  throw new ArtifactInputError(
    'encrypted_document',
    'Encrypted documents are not supported.'
  )
}

function emptyDocument(): never {
  throw new ArtifactInputError(
    'empty_extracted_text',
    'Document contains no extractable text.'
  )
}

function expandedNameKey(namespace: string, localName: string): string {
  return `${namespace}\u0000${localName}`
}

function isXmlNameStart(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z_]/u.test(character)
}

function isXmlNameCharacter(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z0-9_.:-]/u.test(character)
}

function isXmlWhitespace(character: string | undefined): boolean {
  return (
    character === ' ' ||
    character === '\t' ||
    character === '\n' ||
    character === '\r'
  )
}

function isAllowedXmlCodePoint(codePoint: number): boolean {
  return (
    codePoint === 0x09 ||
    codePoint === 0x0a ||
    codePoint === 0x0d ||
    (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
    (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
    (codePoint >= 0x10000 && codePoint <= 0x10ffff)
  )
}

function assertXmlCharacters(value: string): void {
  for (const character of value) {
    const codePoint = character.codePointAt(0)
    if (codePoint === undefined || !isAllowedXmlCodePoint(codePoint)) {
      corruptDocument()
    }
  }
}

function decodeXmlEntities(value: string): string {
  const chunks: string[] = []
  let position = 0
  for (;;) {
    const entityStart = value.indexOf('&', position)
    if (entityStart < 0) {
      chunks.push(value.slice(position))
      break
    }
    chunks.push(value.slice(position, entityStart))
    const entityEnd = value.indexOf(';', entityStart + 1)
    if (entityEnd < 0) corruptDocument()
    const entity = value.slice(entityStart + 1, entityEnd)
    let decoded: string
    switch (entity) {
      case 'amp':
        decoded = '&'
        break
      case 'apos':
        decoded = "'"
        break
      case 'gt':
        decoded = '>'
        break
      case 'lt':
        decoded = '<'
        break
      case 'quot':
        decoded = '"'
        break
      default: {
        const hexadecimal = entity.startsWith('#x')
        const decimal = entity.startsWith('#') && !hexadecimal
        const digits = entity.slice(hexadecimal ? 2 : decimal ? 1 : 0)
        if (
          (!hexadecimal && !decimal) ||
          !(hexadecimal ? /^[0-9A-Fa-f]+$/u : /^[0-9]+$/u).test(digits)
        ) {
          corruptDocument()
        }
        const codePoint = Number.parseInt(digits, hexadecimal ? 16 : 10)
        if (!isAllowedXmlCodePoint(codePoint)) corruptDocument()
        decoded = String.fromCodePoint(codePoint)
      }
    }
    chunks.push(decoded)
    position = entityEnd + 1
  }
  const decoded = chunks.join('')
  assertXmlCharacters(decoded)
  return decoded
}

function splitQualifiedName(name: string): [string | undefined, string] {
  const parts = name.split(':')
  if (parts.length === 1) return [undefined, name]
  if (parts.length !== 2 || !parts[0] || !parts[1]) corruptDocument()
  return [parts[0], parts[1]]
}

function resolveName(
  qualifiedName: string,
  namespaces: ReadonlyMap<string, string>,
  attribute: boolean
): ExpandedName {
  const [prefix, localName] = splitQualifiedName(qualifiedName)
  if (prefix === 'xmlns') corruptDocument()
  const namespace = prefix
    ? namespaces.get(prefix)
    : attribute
      ? ''
      : (namespaces.get('') ?? '')
  if (namespace === undefined) corruptDocument()
  return { namespace, localName, qualifiedName }
}

function scanXml(xmlInput: string, visitor: XmlVisitor): void {
  const xml = xmlInput.replace(/\r\n?/gu, '\n')
  const stack: XmlStackEntry[] = []
  let position = 0
  let rootSeen = false
  let rootClosed = false
  let elementCount = 0

  const parseName = (): string => {
    if (!isXmlNameStart(xml[position])) corruptDocument()
    const start = position
    position += 1
    while (isXmlNameCharacter(xml[position])) position += 1
    const name = xml.slice(start, position)
    splitQualifiedName(name)
    return name
  }

  const skipWhitespace = (): void => {
    while (isXmlWhitespace(xml[position])) position += 1
  }

  const text = (rawValue: string, decodeEntities: boolean): void => {
    if (rawValue.includes(']]>')) corruptDocument()
    const value = decodeEntities ? decodeXmlEntities(rawValue) : rawValue
    assertXmlCharacters(value)
    if (stack.length === 0) {
      if (value.trim()) corruptDocument()
      return
    }
    visitor.text(value)
  }

  while (position < xml.length) {
    if (xml[position] !== '<') {
      const nextTag = xml.indexOf('<', position)
      const end = nextTag < 0 ? xml.length : nextTag
      text(xml.slice(position, end), true)
      position = end
      continue
    }

    if (xml.startsWith('<!--', position)) {
      const end = xml.indexOf('-->', position + 4)
      if (end < 0 || xml.slice(position + 4, end).includes('--')) {
        corruptDocument()
      }
      position = end + 3
      continue
    }

    if (xml.startsWith('<?', position)) {
      const end = xml.indexOf('?>', position + 2)
      if (end < 0) corruptDocument()
      position = end + 2
      continue
    }

    if (xml.startsWith('<![CDATA[', position)) {
      const end = xml.indexOf(']]>', position + 9)
      if (end < 0) corruptDocument()
      text(xml.slice(position + 9, end), false)
      position = end + 3
      continue
    }

    if (xml.startsWith('</', position)) {
      position += 2
      const qualifiedName = parseName()
      skipWhitespace()
      if (xml[position] !== '>') corruptDocument()
      position += 1
      const entry = stack.pop()
      if (!entry || entry.element.qualifiedName !== qualifiedName) {
        corruptDocument()
      }
      visitor.end(entry.element)
      if (stack.length === 0) rootClosed = true
      continue
    }

    if (xml.startsWith('<!', position) || rootClosed) corruptDocument()
    position += 1
    const qualifiedName = parseName()
    elementCount += 1
    if (elementCount > MAX_XML_ELEMENTS) documentLimitExceeded()
    const rawAttributes: RawAttribute[] = []
    const rawAttributeNames = new Set<string>()
    let selfClosing = false

    for (;;) {
      skipWhitespace()
      if (xml.startsWith('/>', position)) {
        selfClosing = true
        position += 2
        break
      }
      if (xml[position] === '>') {
        position += 1
        break
      }
      const name = parseName()
      if (rawAttributeNames.has(name)) corruptDocument()
      rawAttributeNames.add(name)
      skipWhitespace()
      if (xml[position] !== '=') corruptDocument()
      position += 1
      skipWhitespace()
      const quote = xml[position]
      if (quote !== '"' && quote !== "'") corruptDocument()
      position += 1
      const valueStart = position
      const valueEnd = xml.indexOf(quote, valueStart)
      if (valueEnd < 0) corruptDocument()
      const rawValue = xml.slice(valueStart, valueEnd)
      if (rawValue.includes('<')) corruptDocument()
      rawAttributes.push({ name, value: decodeXmlEntities(rawValue) })
      position = valueEnd + 1
    }

    const parentNamespaces = stack.at(-1)?.namespaces
    const namespaces = new Map(parentNamespaces)
    if (!parentNamespaces) {
      namespaces.set('xml', XML_NAMESPACE)
      namespaces.set('xmlns', XMLNS_NAMESPACE)
    }
    for (const attribute of rawAttributes) {
      if (attribute.name === 'xmlns') {
        namespaces.set('', attribute.value)
        continue
      }
      if (attribute.name.startsWith('xmlns:')) {
        const prefix = attribute.name.slice('xmlns:'.length)
        if (
          !prefix ||
          prefix === 'xmlns' ||
          (prefix === 'xml' && attribute.value !== XML_NAMESPACE) ||
          !attribute.value
        ) {
          corruptDocument()
        }
        namespaces.set(prefix, attribute.value)
      }
    }

    const name = resolveName(qualifiedName, namespaces, false)
    const attributes = new Map<string, string>()
    for (const attribute of rawAttributes) {
      if (attribute.name === 'xmlns' || attribute.name.startsWith('xmlns:')) {
        continue
      }
      const attributeName = resolveName(attribute.name, namespaces, true)
      const key = expandedNameKey(
        attributeName.namespace,
        attributeName.localName
      )
      if (attributes.has(key)) corruptDocument()
      attributes.set(key, attribute.value)
    }
    const element: XmlElement = { ...name, attributes }

    if (stack.length === 0) {
      if (rootSeen) corruptDocument()
      rootSeen = true
    }
    if (!selfClosing) {
      if (stack.length >= MAX_XML_DEPTH) documentLimitExceeded()
      stack.push({ element, namespaces })
    }
    visitor.start(element)
    if (selfClosing) {
      visitor.end(element)
      if (stack.length === 0) rootClosed = true
    }
  }

  if (!rootSeen || !rootClosed || stack.length > 0) corruptDocument()
}

function isElement(
  element: ExpandedName,
  namespace: string,
  localName: string
): boolean {
  return element.namespace === namespace && element.localName === localName
}

function attribute(
  element: XmlElement,
  namespace: string,
  localName: string
): string | undefined {
  return element.attributes.get(expandedNameKey(namespace, localName))
}

function decodeXml(buffer: Buffer): string {
  let xml: string
  try {
    xml = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    return corruptDocument()
  }
  xml = xml.replace(/^\uFEFF/u, '')
  const declaration = /^<\?xml\s+([^?]+)\?>/u.exec(xml)
  const encoding = declaration?.[1]?.match(
    /\bencoding\s*=\s*['"]([^'"]+)['"]/iu
  )
  if (encoding && encoding[1]?.toLocaleLowerCase() !== 'utf-8') {
    corruptDocument()
  }
  return xml
}

function validateManifest(buffer: Buffer): void {
  let rootIsManifest = false
  let rootEntryCount = 0
  let depth = 0
  scanXml(decodeXml(buffer), {
    start: (element) => {
      depth += 1
      if (depth === 1) {
        rootIsManifest = isElement(element, MANIFEST_NAMESPACE, 'manifest')
      }
      if (isElement(element, MANIFEST_NAMESPACE, 'encryption-data')) {
        encryptedDocument()
      }
      if (isElement(element, MANIFEST_NAMESPACE, 'file-entry')) {
        const path = attribute(element, MANIFEST_NAMESPACE, 'full-path')
        if (path === '/') {
          rootEntryCount += 1
          if (
            attribute(element, MANIFEST_NAMESPACE, 'media-type') !==
            ODT_MEDIA_TYPE
          ) {
            corruptDocument()
          }
        }
      }
    },
    text: () => undefined,
    end: () => {
      depth -= 1
    },
  })
  if (!rootIsManifest || rootEntryCount !== 1) corruptDocument()
}

export function inspectOdtPackage(archive: BoundedZipArchive): boolean {
  const mimetype = archive.entry('mimetype')
  if (!mimetype) return false
  const declaredType = archive.read('mimetype').toString('ascii')
  if (declaredType !== ODT_MEDIA_TYPE) return false
  if (
    mimetype.compressionMethod !== 0 ||
    mimetype.localHeaderOffset !== 0 ||
    mimetype.localExtraLength !== 0 ||
    !archive.has('META-INF/manifest.xml') ||
    !archive.has('content.xml')
  ) {
    corruptDocument()
  }
  validateManifest(archive.read('META-INF/manifest.xml'))
  return true
}

function shouldSkip(element: XmlElement): boolean {
  if (
    isElement(element, TEXT_NAMESPACE, 'tracked-changes') ||
    isElement(element, TEXT_NAMESPACE, 'hidden-text') ||
    isElement(element, TEXT_NAMESPACE, 'hidden-paragraph') ||
    isElement(element, TEXT_NAMESPACE, 'script') ||
    isElement(element, TEXT_NAMESPACE, 'execute-macro') ||
    isElement(element, OFFICE_NAMESPACE, 'annotation') ||
    isElement(element, OFFICE_NAMESPACE, 'scripts') ||
    isElement(element, OFFICE_NAMESPACE, 'script') ||
    isElement(element, OFFICE_NAMESPACE, 'binary-data') ||
    isElement(element, DRAW_NAMESPACE, 'image') ||
    isElement(element, DRAW_NAMESPACE, 'object') ||
    isElement(element, DRAW_NAMESPACE, 'object-ole')
  ) {
    return true
  }
  return (
    isElement(element, TEXT_NAMESPACE, 'section') &&
    attribute(element, TEXT_NAMESPACE, 'display') === 'none'
  )
}

function extractContentText(buffer: Buffer): string {
  const lines: string[] = []
  let emittedCharacters = 0
  let depth = 0
  let rootIsDocumentContent = false
  let bodyDepth = 0
  let bodyCount = 0
  let insideOfficeText = false
  let officeTextCount = 0
  let listDepth = 0
  let skipDepth = 0
  const blocks: TextBlock[] = []

  const append = (value: string): void => {
    const currentBlock = blocks.at(-1)
    if (!currentBlock || !value) return
    if (
      currentBlock.characters >
      MAX_EXTRACTED_CHARACTERS - emittedCharacters - value.length
    ) {
      documentLimitExceeded()
    }
    currentBlock.chunks.push(value)
    currentBlock.characters += value.length
  }

  const flushBlock = (block: TextBlock): void => {
    const value = block.chunks.join('').trim()
    if (value) {
      const prefix =
        block.listDepth && block.segments === 0
          ? `${'  '.repeat(block.listDepth - 1)}- `
          : ''
      const line = `${prefix}${value}`
      if (
        line.length + (lines.length ? 1 : 0) >
        MAX_EXTRACTED_CHARACTERS - emittedCharacters
      ) {
        documentLimitExceeded()
      }
      lines.push(line)
      emittedCharacters += line.length + (lines.length > 1 ? 1 : 0)
      block.segments += 1
    }
    block.chunks.length = 0
    block.characters = 0
  }

  scanXml(decodeXml(buffer), {
    start: (element) => {
      depth += 1
      if (depth === 1) {
        rootIsDocumentContent = isElement(
          element,
          OFFICE_NAMESPACE,
          'document-content'
        )
        if (!rootIsDocumentContent) corruptDocument()
      }
      if (skipDepth > 0) {
        skipDepth += 1
        return
      }
      if (isElement(element, OFFICE_NAMESPACE, 'body')) {
        if (depth !== 2 || bodyDepth !== 0) corruptDocument()
        bodyDepth = depth
        bodyCount += 1
        return
      }
      if (insideOfficeText && shouldSkip(element)) {
        skipDepth = 1
        return
      }
      if (isElement(element, OFFICE_NAMESPACE, 'text')) {
        if (insideOfficeText || bodyDepth === 0 || depth !== bodyDepth + 1) {
          corruptDocument()
        }
        insideOfficeText = true
        officeTextCount += 1
        return
      }
      if (!insideOfficeText) return
      if (isElement(element, TEXT_NAMESPACE, 'list')) {
        listDepth += 1
        return
      }
      if (
        isElement(element, TEXT_NAMESPACE, 'p') ||
        isElement(element, TEXT_NAMESPACE, 'h')
      ) {
        const parentBlock = blocks.at(-1)
        if (parentBlock) flushBlock(parentBlock)
        blocks.push({
          chunks: [],
          listDepth,
          qualifiedName: element.qualifiedName,
          characters: 0,
          segments: 0,
        })
        return
      }
      if (isElement(element, TEXT_NAMESPACE, 's')) {
        const rawCount = attribute(element, TEXT_NAMESPACE, 'c') ?? '1'
        if (!/^[1-9][0-9]*$/u.test(rawCount)) corruptDocument()
        const count = Number(rawCount)
        if (!Number.isSafeInteger(count) || count > MAX_EXTRACTED_CHARACTERS) {
          documentLimitExceeded()
        }
        append(' '.repeat(count))
        return
      }
      if (isElement(element, TEXT_NAMESPACE, 'tab')) {
        append('\t')
        return
      }
      if (isElement(element, TEXT_NAMESPACE, 'line-break')) {
        append('\n')
      }
    },
    text: (value) => {
      if (skipDepth === 0) append(value.replace(/[\t\n ]+/gu, ' '))
    },
    end: (element) => {
      try {
        if (skipDepth > 0) {
          skipDepth -= 1
          return
        }
        if (
          isElement(element, TEXT_NAMESPACE, 'p') ||
          isElement(element, TEXT_NAMESPACE, 'h')
        ) {
          const block = blocks.pop()
          if (!block || block.qualifiedName !== element.qualifiedName) {
            corruptDocument()
          }
          flushBlock(block)
          return
        }
        if (isElement(element, TEXT_NAMESPACE, 'list')) {
          listDepth -= 1
          if (listDepth < 0) corruptDocument()
          return
        }
        if (isElement(element, OFFICE_NAMESPACE, 'text')) {
          if (blocks.length > 0) corruptDocument()
          insideOfficeText = false
        }
      } finally {
        if (
          isElement(element, OFFICE_NAMESPACE, 'body') &&
          bodyDepth === depth
        ) {
          bodyDepth = 0
        }
        depth -= 1
      }
    },
  })

  if (
    depth !== 0 ||
    !rootIsDocumentContent ||
    bodyDepth !== 0 ||
    bodyCount !== 1 ||
    insideOfficeText ||
    officeTextCount !== 1 ||
    listDepth !== 0 ||
    blocks.length !== 0
  ) {
    corruptDocument()
  }
  const text = lines.join('\n').trim()
  return text || emptyDocument()
}

function mapArchiveError(error: unknown): never {
  if (error instanceof ArtifactInputError) throw error
  if (error instanceof BoundedZipError) {
    if (error.code === 'encrypted_archive') encryptedDocument()
    if (error.code === 'archive_limit_exceeded') documentLimitExceeded()
  }
  return corruptDocument()
}

export function extractOdtText(buffer: Buffer): string {
  try {
    const archive = openBoundedZip(buffer)
    if (!inspectOdtPackage(archive)) corruptDocument()
    return extractContentText(archive.read('content.xml'))
  } catch (error) {
    return mapArchiveError(error)
  }
}
