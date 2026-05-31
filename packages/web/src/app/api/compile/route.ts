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

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execa } from 'execa'
import { NextResponse } from 'next/server'
import which from 'which'

export const runtime = 'nodejs'

interface CompileRequest {
  filename?: string
  latex?: string
}

type CompileErrorCode =
  | 'compile-failed'
  | 'compiler-unavailable'
  | 'invalid-request'

const COMPILER_UNAVAILABLE_MESSAGE =
  '未找到 LaTeX 编译器，请安装 xelatex 或 tectonic'

function cleanFilename(value: string | undefined): string {
  const trimmed = value?.trim() || 'resume'
  const cleaned = trimmed.replace(/[^\p{L}\p{N}._-]+/gu, '-')

  return cleaned.length > 0 ? cleaned : 'resume'
}

function compileFailure(
  code: CompileErrorCode,
  error: string,
  status = 200
): Response {
  return NextResponse.json(
    {
      ok: false,
      code,
      error,
    },
    { status }
  )
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function inferCompiler(): 'xelatex' | 'tectonic' {
  if (which.sync('xelatex', { nothrow: true })) {
    return 'xelatex'
  }

  if (which.sync('tectonic', { nothrow: true })) {
    return 'tectonic'
  }

  throw new Error(COMPILER_UNAVAILABLE_MESSAGE)
}

async function compileLatex(
  compiler: 'xelatex' | 'tectonic',
  filename: string,
  cwd: string
): Promise<void> {
  if (compiler === 'tectonic') {
    await execa(compiler, [filename], {
      cwd,
      timeout: 30000,
    })
    return
  }

  await execa(compiler, ['-halt-on-error', filename], {
    cwd,
    timeout: 30000,
  })
}

export async function POST(request: Request): Promise<Response> {
  let workdir = ''

  try {
    const payload = (await request.json()) as CompileRequest
    const latex = payload.latex?.trim()

    if (!latex) {
      return compileFailure('invalid-request', '缺少 LaTeX 内容', 400)
    }

    const filename = cleanFilename(payload.filename)
    workdir = await mkdtemp(path.join(tmpdir(), 'yamlresume-'))
    const texFilename = `${filename}.tex`
    const pdfFilename = `${filename}.pdf`
    const texPath = path.join(workdir, texFilename)
    const pdfPath = path.join(workdir, pdfFilename)

    await writeFile(texPath, latex)
    await compileLatex(inferCompiler(), texFilename, workdir)

    const pdf = await readFile(pdfPath)
    const pdfBody = pdf.buffer.slice(
      pdf.byteOffset,
      pdf.byteOffset + pdf.byteLength
    ) as ArrayBuffer

    return new Response(pdfBody, {
      headers: {
        'Content-Disposition': `attachment; filename="${pdfFilename}"`,
        'Content-Type': 'application/pdf',
      },
    })
  } catch (error) {
    const message = getErrorMessage(error)

    if (message.includes(COMPILER_UNAVAILABLE_MESSAGE)) {
      return compileFailure(
        'compiler-unavailable',
        '当前环境未安装 LaTeX 编译器，无法生成 PDF。请安装 xelatex 或 tectonic，或使用 HTML 近似预览。'
      )
    }

    return compileFailure(
      'compile-failed',
      message || 'PDF 编译失败，请检查 LaTeX 内容。'
    )
  } finally {
    if (workdir) {
      await rm(workdir, { force: true, recursive: true })
    }
  }
}
