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

import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import {
  DEFAULT_SECTIONS_ORDER,
  getOptionTranslation,
  getResumeRenderer,
  mergeArrayWithOrder,
  type OrderableSectionID,
  type Resume,
} from '@yamlresume/core'
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx'
import { stringify } from 'yaml'

import type {
  ArtifactFailure,
  OutputArtifact,
  OutputFormat,
  RenderedResume,
  StylePresetID,
} from '@/contracts'
import { applyStylePreset } from '@/rendering/styles'

const execFileAsync = promisify(execFile)

const MEDIA_TYPES: Record<OutputFormat, string> = {
  yaml: 'application/yaml',
  json: 'application/json',
  markdown: 'text/markdown',
  html: 'text/html',
  latex: 'application/x-latex',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain; charset=utf-8',
  rtf: 'application/rtf',
}

export interface RenderOptions {
  formats: OutputFormat[]
  pdfTimeoutMs?: number
}

export interface PdfCompiler {
  compile(latex: string, timeoutMs: number): Promise<Buffer>
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function asRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value
        .map(asRecord)
        .filter((item): item is Record<string, unknown> => item !== undefined)
    : []
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function summaryParagraphs(value: unknown): string[] {
  return stringValue(value)
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*]\s*/, '').trim())
    .filter(Boolean)
}

function joinMetadata(values: unknown[]): string {
  return values.map(fieldText).filter(Boolean).join(' · ')
}

function fieldText(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(stringValue).filter(Boolean).join(', ')
  }
  return stringValue(value).replace(/\s+/g, ' ')
}

interface ResumeDocumentEntry {
  title: string
  metadata: string
  details: string[]
}

interface ResumeDocumentSection {
  heading: string
  entries: ResumeDocumentEntry[]
}

interface ResumeDocument {
  title: string
  headline: string
  contacts: string[]
  summaryHeading: string
  summary: string[]
  sections: ResumeDocumentSection[]
}

interface SectionDefinition {
  key: Exclude<OrderableSectionID, 'basics'> | 'profiles'
  heading: string
  titleFields: string[]
  metadataFields: string[]
  detailFields?: Array<{ key: string; label?: string }>
}

const DOCUMENT_SECTIONS: SectionDefinition[] = [
  {
    key: 'work',
    heading: 'Experience',
    titleFields: ['position', 'name'],
    metadataFields: ['name', 'startDate', 'endDate'],
    detailFields: [
      { key: 'summary' },
      { key: 'keywords', label: 'Keywords' },
      { key: 'url' },
    ],
  },
  {
    key: 'projects',
    heading: 'Projects',
    titleFields: ['name'],
    metadataFields: ['description', 'startDate', 'endDate'],
    detailFields: [
      { key: 'summary' },
      { key: 'keywords', label: 'Keywords' },
      { key: 'url' },
    ],
  },
  {
    key: 'education',
    heading: 'Education',
    titleFields: ['degree', 'area', 'institution'],
    metadataFields: ['area', 'institution', 'startDate', 'endDate'],
    detailFields: [
      { key: 'summary' },
      { key: 'score', label: 'Score' },
      { key: 'courses', label: 'Courses' },
      { key: 'url' },
    ],
  },
  {
    key: 'skills',
    heading: 'Skills',
    titleFields: ['name'],
    metadataFields: ['level'],
    detailFields: [{ key: 'keywords' }],
  },
  {
    key: 'certificates',
    heading: 'Certificates',
    titleFields: ['name'],
    metadataFields: ['issuer', 'date'],
    detailFields: [{ key: 'summary' }, { key: 'url' }],
  },
  {
    key: 'awards',
    heading: 'Awards',
    titleFields: ['title'],
    metadataFields: ['awarder', 'date'],
    detailFields: [{ key: 'summary' }, { key: 'url' }],
  },
  {
    key: 'publications',
    heading: 'Publications',
    titleFields: ['name'],
    metadataFields: ['publisher', 'releaseDate'],
    detailFields: [{ key: 'summary' }, { key: 'url' }],
  },
  {
    key: 'volunteer',
    heading: 'Volunteer',
    titleFields: ['position', 'organization'],
    metadataFields: ['organization', 'startDate', 'endDate'],
    detailFields: [{ key: 'summary' }, { key: 'url' }],
  },
  {
    key: 'languages',
    heading: 'Languages',
    titleFields: ['language'],
    metadataFields: ['fluency'],
    detailFields: [{ key: 'keywords' }],
  },
  {
    key: 'profiles',
    heading: 'Profiles',
    titleFields: ['network', 'username'],
    metadataFields: ['username', 'url'],
  },
  {
    key: 'interests',
    heading: 'Interests',
    titleFields: ['name'],
    metadataFields: [],
    detailFields: [{ key: 'keywords' }],
  },
  {
    key: 'references',
    heading: 'References',
    titleFields: ['name'],
    metadataFields: ['relationship', 'email', 'phone'],
    detailFields: [{ key: 'summary' }],
  },
]

function detailLines(
  item: Record<string, unknown>,
  definition: SectionDefinition
): string[] {
  return (definition.detailFields ?? []).flatMap(({ key, label }) => {
    if (key === 'summary') return summaryParagraphs(item[key])
    const value = fieldText(item[key])
    if (!value) return []
    return [label ? `${label}: ${value}` : value]
  })
}

function buildResumeDocument(resume: Resume): ResumeDocument {
  const content = asRecord(resume.content) ?? {}
  const basics = asRecord(content.basics) ?? {}
  const location = asRecord(content.location) ?? {}
  const layout = resume.layouts?.find(
    (candidate) => candidate.engine === 'latex'
  )
  const sectionHeading = (
    key: OrderableSectionID | 'profiles',
    fallback: string
  ): string =>
    fieldText(layout?.sections?.aliases?.[key]) ||
    getOptionTranslation(resume.locale?.language ?? 'en', 'sections', key) ||
    fallback
  const locationText = joinMetadata([
    location.address,
    location.city,
    location.region,
    location.country,
    location.postalCode,
  ])
  const contacts = [basics.email, basics.phone, basics.url]
    .map(fieldText)
    .filter(Boolean)
  if (locationText) contacts.push(locationText)

  const orderedKeys = mergeArrayWithOrder(
    layout?.sections?.order,
    DEFAULT_SECTIONS_ORDER
  ).filter((key) => key !== 'basics')
  const orderedDefinitions = [
    ...orderedKeys.flatMap((key) => {
      const definition = DOCUMENT_SECTIONS.find((item) => item.key === key)
      return definition ? [definition] : []
    }),
    ...DOCUMENT_SECTIONS.filter((definition) => definition.key === 'profiles'),
  ]
  const sections = orderedDefinitions.flatMap((definition) => {
    const entries = asRecords(content[definition.key]).map((item) => ({
      title:
        definition.titleFields
          .map((field) => fieldText(item[field]))
          .find(Boolean) ?? sectionHeading(definition.key, definition.heading),
      metadata: joinMetadata(
        definition.metadataFields.map((field) => item[field])
      ),
      details: detailLines(item, definition),
    }))
    return entries.length
      ? [
          {
            heading: sectionHeading(definition.key, definition.heading),
            entries,
          },
        ]
      : []
  })

  return {
    title: fieldText(basics.name) || 'Resume',
    headline: fieldText(basics.headline),
    contacts,
    summaryHeading: sectionHeading('basics', 'Summary'),
    summary: summaryParagraphs(basics.summary),
    sections,
  }
}

function resumeToText(resume: Resume): string {
  const document = buildResumeDocument(resume)
  const lines = [document.title]
  if (document.headline) lines.push(document.headline)
  if (document.contacts.length) lines.push(document.contacts.join(' · '))
  if (document.summary.length) {
    lines.push('', document.summaryHeading, ...document.summary)
  }
  for (const section of document.sections) {
    lines.push('', section.heading)
    for (const entry of section.entries) {
      lines.push(entry.title)
      if (entry.metadata) lines.push(`  ${entry.metadata}`)
      lines.push(...entry.details.map((detail) => `  - ${detail}`))
    }
  }
  return `${lines.join('\n').trimEnd()}\n`
}

function escapeRtfText(value: string): string {
  let escaped = ''
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)
    switch (codeUnit) {
      case 9:
        escaped += '\\tab '
        break
      case 10:
        escaped += '\\line '
        break
      case 13:
        break
      case 92:
        escaped += '\\\\'
        break
      case 123:
        escaped += '\\{'
        break
      case 125:
        escaped += '\\}'
        break
      default:
        if (codeUnit >= 32 && codeUnit <= 126) {
          escaped += String.fromCharCode(codeUnit)
        } else if (codeUnit > 126) {
          const signedCodeUnit =
            codeUnit > 0x7fff ? codeUnit - 0x1_0000 : codeUnit
          escaped += `\\u${signedCodeUnit}?`
        }
    }
  }
  return escaped
}

function rtfParagraph(text: string, prefix = ''): string {
  return `${prefix}${escapeRtfText(text)}\\par\n`
}

function resumeToRtf(resume: Resume): string {
  const document = buildResumeDocument(resume)
  const parts = [
    '{\\rtf1\\ansi\\deff0\\uc1',
    '{\\fonttbl{\\f0 Calibri;}}',
    '\\viewkind4\\pard\\f0\\fs22\n',
    rtfParagraph(document.title, '\\b\\fs32 '),
    '\\b0\\fs22\n',
  ]
  if (document.headline) {
    parts.push(rtfParagraph(document.headline, '\\i '), '\\i0\n')
  }
  if (document.contacts.length) {
    parts.push(rtfParagraph(document.contacts.join(' | ')))
  }
  if (document.summary.length) {
    parts.push(
      rtfParagraph(document.summaryHeading, '\\b '),
      '\\b0\n',
      ...document.summary.map((paragraph) => rtfParagraph(paragraph))
    )
  }
  for (const section of document.sections) {
    parts.push(rtfParagraph(section.heading, '\\b\\fs26 '), '\\b0\\fs22\n')
    for (const entry of section.entries) {
      parts.push(rtfParagraph(entry.title, '\\b '), '\\b0\n')
      if (entry.metadata)
        parts.push(rtfParagraph(entry.metadata, '\\i '), '\\i0\n')
      parts.push(
        ...entry.details.map((detail) => rtfParagraph(detail, '\\bullet\\tab '))
      )
    }
  }
  parts.push('}')
  return parts.join('')
}

function resumeToDocx(resume: Resume): Promise<Buffer> {
  const content = asRecord(resume.content) ?? {}
  const basics = asRecord(content.basics) ?? {}
  const children: Paragraph[] = []
  const name = stringValue(basics.name) || 'Resume'
  const headline = stringValue(basics.headline)
  const contacts = [
    basics.email,
    basics.phone,
    basics.url,
    asRecord(content.location)?.city,
  ]
    .map(stringValue)
    .filter(Boolean)

  children.push(
    new Paragraph({ text: name, heading: HeadingLevel.TITLE }),
    ...(headline ? [new Paragraph({ text: headline })] : []),
    ...(contacts.length ? [new Paragraph({ text: contacts.join(' · ') })] : [])
  )

  for (const summary of summaryParagraphs(basics.summary)) {
    children.push(new Paragraph({ text: summary, bullet: { level: 0 } }))
  }

  const sections: Array<{ key: string; label: string; fields: string[] }> = [
    {
      key: 'work',
      label: 'Experience',
      fields: ['position', 'name', 'startDate', 'endDate'],
    },
    {
      key: 'projects',
      label: 'Projects',
      fields: ['name', 'description', 'startDate', 'endDate'],
    },
    {
      key: 'education',
      label: 'Education',
      fields: ['degree', 'area', 'institution', 'startDate', 'endDate'],
    },
    { key: 'skills', label: 'Skills', fields: ['name', 'level', 'keywords'] },
    {
      key: 'certificates',
      label: 'Certificates',
      fields: ['name', 'issuer', 'date'],
    },
    { key: 'awards', label: 'Awards', fields: ['title', 'awarder', 'date'] },
    { key: 'languages', label: 'Languages', fields: ['language', 'fluency'] },
    {
      key: 'volunteer',
      label: 'Volunteer',
      fields: ['position', 'organization', 'startDate', 'endDate'],
    },
  ]

  for (const section of sections) {
    const items = asRecords(content[section.key])
    if (items.length === 0) continue
    children.push(
      new Paragraph({ text: section.label, heading: HeadingLevel.HEADING_1 })
    )
    for (const item of items) {
      const title = stringValue(item[section.fields[0]]) || section.label
      const metadata = joinMetadata(
        section.fields.slice(1).map((field) => item[field])
      )
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: title, bold: true }),
            ...(metadata ? [new TextRun({ text: ` — ${metadata}` })] : []),
          ],
          bullet: { level: 0 },
        })
      )
      for (const summary of summaryParagraphs(item.summary)) {
        children.push(new Paragraph({ text: summary, bullet: { level: 1 } }))
      }
    }
  }

  const document = new Document({ sections: [{ children }] })
  return Packer.toBuffer(document)
}

export class DefaultPdfCompiler implements PdfCompiler {
  async compile(latex: string, timeoutMs: number): Promise<Buffer> {
    const workdir = await mkdtemp(path.join(tmpdir(), 'yamlresume-agent-'))
    const texPath = path.join(workdir, 'resume.tex')
    const pdfPath = path.join(workdir, 'resume.pdf')

    try {
      await writeFile(texPath, latex)
      let lastError: unknown
      for (const compiler of ['xelatex', 'tectonic']) {
        try {
          const args =
            compiler === 'xelatex'
              ? [
                  '-halt-on-error',
                  '-interaction=nonstopmode',
                  '-no-shell-escape',
                  '-output-directory',
                  workdir,
                  texPath,
                ]
              : ['--outdir', workdir, texPath]
          await execFileAsync(compiler, args, {
            cwd: workdir,
            timeout: timeoutMs,
            maxBuffer: 4 * 1024 * 1024,
          })
          return await readFile(pdfPath)
        } catch (error) {
          lastError = error
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') break
        }
      }
      throw new Error(
        `No usable LaTeX compiler was available: ${lastError instanceof Error ? lastError.message : String(lastError)}`
      )
    } finally {
      await rm(workdir, { force: true, recursive: true })
    }
  }
}

function textArtifact(
  format: OutputFormat,
  style: StylePresetID,
  filename: string,
  content: string
): OutputArtifact {
  return {
    format,
    style,
    filename,
    mediaType: MEDIA_TYPES[format],
    encoding: 'utf8',
    content,
    sizeBytes: Buffer.byteLength(content, 'utf8'),
  }
}

function binaryArtifact(
  format: OutputFormat,
  style: StylePresetID,
  filename: string,
  content: Buffer
): OutputArtifact {
  return {
    format,
    style,
    filename,
    mediaType: MEDIA_TYPES[format],
    encoding: 'base64',
    content: content.toString('base64'),
    sizeBytes: content.byteLength,
  }
}

function rendererIndex(
  resume: Resume,
  engine: 'latex' | 'html' | 'markdown'
): number {
  return resume.layouts?.findIndex((layout) => layout.engine === engine) ?? -1
}

type TextOutputFormat = Exclude<OutputFormat, 'pdf' | 'docx'>
type LegacyTextOutputFormat = Extract<
  TextOutputFormat,
  'yaml' | 'json' | 'markdown' | 'html' | 'latex'
>

function renderWithEngine(
  resume: Resume,
  engine: 'latex' | 'html' | 'markdown'
): string {
  const layoutIndex = rendererIndex(resume, engine)
  if (layoutIndex < 0) {
    throw new Error(`Missing ${engine} layout`)
  }
  return getResumeRenderer(resume, layoutIndex).render()
}

function renderTextContent(resume: Resume, format: TextOutputFormat): string {
  let content: string
  switch (format) {
    case 'yaml':
      content = stringify(resume, { lineWidth: 0 })
      break
    case 'json':
      content = JSON.stringify(resume, null, 2)
      break
    case 'txt':
      content = resumeToText(resume)
      break
    case 'rtf':
      content = resumeToRtf(resume)
      break
    case 'markdown':
    case 'html':
    case 'latex':
      content = renderWithEngine(resume, format)
      break
  }
  if (!content.trim()) {
    throw new Error(`Empty ${format} artifact`)
  }
  return content
}

export async function renderResumeVariant(
  source: Resume,
  style: StylePresetID,
  options: RenderOptions,
  pdfCompiler: PdfCompiler = new DefaultPdfCompiler()
): Promise<RenderedResume> {
  const resume = applyStylePreset(source, style)
  const artifacts: OutputArtifact[] = []
  const failures: ArtifactFailure[] = []
  const requested = [...new Set(options.formats)]
  const renderedText: Partial<Record<LegacyTextOutputFormat, string>> = {}
  const textCache: Partial<Record<TextOutputFormat, string>> = {}
  const getTextContent = (format: TextOutputFormat): string => {
    const cached = textCache[format]
    if (cached !== undefined) return cached
    const content = renderTextContent(resume, format)
    textCache[format] = content
    return content
  }

  for (const format of requested) {
    const filename = `resume-${style}.${format}`
    try {
      if (format === 'pdf') {
        const latex = getTextContent('latex')
        artifacts.push(
          binaryArtifact(
            format,
            style,
            `resume-${style}.pdf`,
            await pdfCompiler.compile(latex, options.pdfTimeoutMs ?? 60_000)
          )
        )
      } else if (format === 'docx') {
        artifacts.push(
          binaryArtifact(
            format,
            style,
            `resume-${style}.docx`,
            await resumeToDocx(resume)
          )
        )
      } else {
        const content = getTextContent(format)
        if (format !== 'txt' && format !== 'rtf') {
          renderedText[format] = content
        }
        artifacts.push(textArtifact(format, style, filename, content))
      }
    } catch {
      failures.push({
        format,
        style,
        code: format === 'pdf' ? 'pdf_render_failed' : 'artifact_render_failed',
        message: `Failed to render ${format.toUpperCase()} artifact.`,
      })
    }
  }

  return {
    ...renderedText,
    artifacts,
    failures,
  }
}

export { resumeToDocx }
