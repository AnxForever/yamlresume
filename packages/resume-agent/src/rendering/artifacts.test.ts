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

import type { Resume } from '@yamlresume/core'
import * as yamlResumeCore from '@yamlresume/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { OutputFormat } from '@/contracts'
import { type PdfCompiler, renderResumeVariant } from '@/rendering/artifacts'

const source: Resume = {
  content: {
    basics: {
      name: 'Ada 洛夫莱斯',
      email: 'ada@example.com',
      summary: 'Built reliable analytical systems.',
    },
    projects: [
      {
        name: 'Compiler project',
        startDate: '2024',
        summary: '- Built a TypeScript compiler service',
        keywords: ['TypeScript'],
      },
    ],
  },
  layouts: [
    { engine: 'latex', template: 'moderncv-casual' },
    { engine: 'html', template: 'vscode' },
  ],
}

const TEXT_MEDIA_TYPES: Record<
  Extract<OutputFormat, 'yaml' | 'json' | 'markdown' | 'html' | 'latex'>,
  string
> = {
  yaml: 'application/yaml',
  json: 'application/json',
  markdown: 'text/markdown',
  html: 'text/html',
  latex: 'application/x-latex',
}

describe('renderResumeVariant', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders non-empty text artifacts with stable metadata and UTF-8 sizes', async () => {
    const formats = ['yaml', 'json', 'markdown', 'html', 'latex'] as const

    const result = await renderResumeVariant(source, 'modern-classic', {
      formats: [...formats],
    })

    expect(result.failures).toEqual([])
    expect(result.artifacts.map((artifact) => artifact.format)).toEqual(formats)
    for (const format of formats) {
      const artifact = result.artifacts.find((item) => item.format === format)
      expect(artifact).toMatchObject({
        format,
        style: 'modern-classic',
        filename: `resume-modern-classic.${format}`,
        mediaType: TEXT_MEDIA_TYPES[format],
        encoding: 'utf8',
      })
      expect(artifact?.content.trim().length).toBeGreaterThan(0)
      expect(artifact?.content).toContain('Ada')
      expect(artifact?.sizeBytes).toBe(
        Buffer.byteLength(artifact?.content ?? '', 'utf8')
      )
      expect(result[format]).toBe(artifact?.content)
    }
  })

  it('deduplicates formats without changing their first-seen order', async () => {
    const result = await renderResumeVariant(source, 'ats-compact', {
      formats: ['json', 'yaml', 'json', 'html', 'yaml'],
    })

    expect(result.artifacts.map((artifact) => artifact.format)).toEqual([
      'json',
      'yaml',
      'html',
    ])
    expect(result.failures).toEqual([])
  })

  it('does not modify the source while rendering different styles', async () => {
    const before = structuredClone(source)

    await renderResumeVariant(source, 'ats-compact', { formats: ['yaml'] })
    await renderResumeVariant(source, 'modern-casual', { formats: ['html'] })

    expect(source).toEqual(before)
    expect(
      source.layouts?.find((layout) => layout.engine === 'latex')
    ).toMatchObject({ template: 'moderncv-casual' })
  })

  it('returns DOCX as a base64-encoded OOXML package', async () => {
    const result = await renderResumeVariant(source, 'ats-compact', {
      formats: ['docx'],
    })

    expect(result.failures).toEqual([])
    expect(result.artifacts).toHaveLength(1)
    const artifact = result.artifacts[0]
    expect(artifact).toMatchObject({
      format: 'docx',
      style: 'ats-compact',
      filename: 'resume-ats-compact.docx',
      mediaType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      encoding: 'base64',
    })
    const decoded = Buffer.from(artifact?.content ?? '', 'base64')
    expect(decoded.subarray(0, 4)).toEqual(Buffer.from('PK\u0003\u0004'))
    expect(decoded.includes(Buffer.from('[Content_Types].xml'))).toBe(true)
    expect(decoded.includes(Buffer.from('word/document.xml'))).toBe(true)
    expect(artifact?.sizeBytes).toBe(decoded.byteLength)
  })

  it('passes the rendered LaTeX and configured timeout to the PDF compiler', async () => {
    const calls: Array<{ latex: string; timeoutMs: number }> = []
    const pdf = Buffer.from('%PDF-1.7\nfake-pdf')
    const compiler: PdfCompiler = {
      async compile(latex, timeoutMs) {
        calls.push({ latex, timeoutMs })
        return pdf
      },
    }

    const result = await renderResumeVariant(
      source,
      'developer-two-column',
      { formats: ['latex', 'pdf'], pdfTimeoutMs: 1_234 },
      compiler
    )

    expect(calls).toEqual([{ latex: result.latex, timeoutMs: 1_234 }])
    const artifact = result.artifacts.find((item) => item.format === 'pdf')
    expect(artifact).toMatchObject({
      format: 'pdf',
      style: 'developer-two-column',
      filename: 'resume-developer-two-column.pdf',
      mediaType: 'application/pdf',
      encoding: 'base64',
      content: pdf.toString('base64'),
      sizeBytes: pdf.byteLength,
    })
  })

  it('uses a bounded default timeout for PDF compilation', async () => {
    const timeouts: number[] = []
    const compiler: PdfCompiler = {
      async compile(_latex, timeoutMs) {
        timeouts.push(timeoutMs)
        return Buffer.from('%PDF-1.7\ndefault-timeout')
      },
    }

    await renderResumeVariant(
      source,
      'ats-compact',
      { formats: ['pdf'] },
      compiler
    )

    expect(timeouts).toEqual([60_000])
  })

  it('keeps other artifacts and hides PDF compiler failure details', async () => {
    const privateFailure =
      'PRIVATE_COMPILER_OUTPUT_48291 at /tmp/yamlresume-agent-private/resume.tex'
    const compiler: PdfCompiler = {
      async compile() {
        throw new Error(privateFailure)
      },
    }

    const result = await renderResumeVariant(
      source,
      'ats-compact',
      { formats: ['yaml', 'pdf', 'json'] },
      compiler
    )

    expect(result.artifacts.map((artifact) => artifact.format)).toEqual([
      'yaml',
      'json',
    ])
    expect(result.failures).toEqual([
      {
        format: 'pdf',
        style: 'ats-compact',
        code: 'pdf_render_failed',
        message: 'Failed to render PDF artifact.',
      },
    ])
    expect(JSON.stringify(result)).not.toContain(privateFailure)
    expect(JSON.stringify(result)).not.toContain(
      '/tmp/yamlresume-agent-private'
    )
  })

  it('isolates a text renderer failure from other requested formats', async () => {
    const getResumeRenderer = yamlResumeCore.getResumeRenderer
    vi.spyOn(yamlResumeCore, 'getResumeRenderer').mockImplementation(
      (resume, layoutIndex) => {
        if (resume.layouts?.[layoutIndex]?.engine === 'html') {
          throw new Error('PRIVATE_HTML_RENDERER_OUTPUT_91357')
        }
        return getResumeRenderer(resume, layoutIndex)
      }
    )

    const result = await renderResumeVariant(source, 'modern-professional', {
      formats: ['yaml', 'html', 'json', 'latex'],
    })

    expect(result.artifacts.map((artifact) => artifact.format)).toEqual([
      'yaml',
      'json',
      'latex',
    ])
    expect(result.failures).toEqual([
      {
        format: 'html',
        style: 'modern-professional',
        code: 'artifact_render_failed',
        message: 'Failed to render HTML artifact.',
      },
    ])
    expect(result.html).toBeUndefined()
    expect(JSON.stringify(result)).not.toContain(
      'PRIVATE_HTML_RENDERER_OUTPUT_91357'
    )
  })
})
