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
import { getResumeRenderer, type Resume } from '@yamlresume/core'
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
  return values.map(stringValue).filter(Boolean).join(' · ')
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
  const renderedText: Partial<Record<TextOutputFormat, string>> = {}
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
        renderedText[format] = content
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
