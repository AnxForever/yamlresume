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

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Resume } from '@yamlresume/core'
import { YAMLResumeError } from '@yamlresume/core'
import { consola } from 'consola'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { compileLaTeX, LATEX_COMPILE_TIMEOUT_MS } from './build'
import {
  createGenerateCommand,
  generateResume,
  generateStyledResume,
  getLatexLayout,
  inferFormat,
  resolveOutputPath,
  validateFormat,
  validateStyle,
  withStyle,
  writeFile,
} from './generate'
import { getFixture } from './utils'
import { readResume } from './validate'

// Mock compileLaTeX so tests never shell out to xelatex/tectonic, while
// keeping the rest of `./build` (parseTimeout, LATEX_COMPILE_TIMEOUT_MS) real.
vi.mock('./build', async () => {
  const actual = await vi.importActual<typeof import('./build')>('./build')
  return {
    ...actual,
    compileLaTeX: vi.fn(),
  }
})

const FIXTURE = getFixture('software-engineer.yml')
const CLASSIC = { suffix: 'classic', template: 'jake' } as const

function loadResume(): Resume {
  return readResume(FIXTURE).resume
}

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yamlresume-generate-'))
  vi.mocked(compileLaTeX).mockClear()
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe(validateStyle, () => {
  it('should accept classic, modern, and both', () => {
    expect(validateStyle('classic')).toBe('classic')
    expect(validateStyle('modern')).toBe('modern')
    expect(validateStyle('both')).toBe('both')
  })

  it('should throw for an invalid style', () => {
    expect(() => validateStyle('fancy')).toThrowError(
      'Invalid style: fancy (expected classic, modern, or both)'
    )
  })
})

describe(validateFormat, () => {
  it('should accept pdf and tex', () => {
    expect(validateFormat('pdf')).toBe('pdf')
    expect(validateFormat('tex')).toBe('tex')
  })

  it('should throw for an invalid format', () => {
    expect(() => validateFormat('docx')).toThrowError(
      'Invalid format: docx (expected pdf or tex)'
    )
  })
})

describe(inferFormat, () => {
  it('should prefer the explicit format when provided', () => {
    expect(inferFormat('resume.pdf', 'tex')).toBe('tex')
    expect(inferFormat('resume.tex', 'pdf')).toBe('pdf')
  })

  it('should infer tex from a .tex output path', () => {
    expect(inferFormat('resume.tex')).toBe('tex')
  })

  it('should default to pdf for any other output path', () => {
    expect(inferFormat('resume.pdf')).toBe('pdf')
    expect(inferFormat('resume')).toBe('pdf')
  })
})

describe(resolveOutputPath, () => {
  it('should not append a style suffix for a single style', () => {
    expect(resolveOutputPath('/out/resume.pdf', CLASSIC, 1, 'pdf')).toBe(
      path.join(path.resolve('/out'), 'resume.pdf')
    )
  })

  it('should append a style suffix when generating multiple styles', () => {
    expect(resolveOutputPath('/out/resume.pdf', CLASSIC, 2, 'pdf')).toBe(
      path.join(path.resolve('/out'), 'resume-classic.pdf')
    )
  })

  it('should fall back to the format extension when none is given', () => {
    expect(resolveOutputPath('/out/resume', CLASSIC, 1, 'tex')).toBe(
      path.join(path.resolve('/out'), 'resume.tex')
    )
  })
})

describe(getLatexLayout, () => {
  it('should return the resume latex layout when present', () => {
    const resume = {
      layouts: [{ engine: 'markdown' }, { engine: 'latex', template: 'jake' }],
    } as unknown as Resume

    expect(getLatexLayout(resume).template).toBe('jake')
  })

  it('should fall back to the default layout when no latex layout', () => {
    const resume = {
      layouts: [{ engine: 'markdown' }],
    } as unknown as Resume

    expect(getLatexLayout(resume).template).toBe('moderncv-banking')
  })

  it('should fall back to the default layout when no layouts at all', () => {
    expect(getLatexLayout({} as unknown as Resume).template).toBe(
      'moderncv-banking'
    )
  })
})

describe(withStyle, () => {
  it('should replace the layout template with the given style', () => {
    const resume = {
      layouts: [{ engine: 'latex', template: 'jake' }],
    } as unknown as Resume

    const styled = withStyle(resume, 'moderncv-classic')

    expect(styled.layouts).toHaveLength(1)
    expect(styled.layouts?.[0]).toMatchObject({
      engine: 'latex',
      template: 'moderncv-classic',
    })
    // original resume is left untouched
    expect(resume.layouts?.[0]).toMatchObject({ template: 'jake' })
  })
})

describe(writeFile, () => {
  it('should create the directory and write the file', () => {
    const target = path.join(tmpDir, 'nested', 'resume.tex')

    writeFile(target, 'hello')

    expect(fs.readFileSync(target, 'utf8')).toBe('hello')
  })

  it('should throw FILE_WRITE_ERROR when writing fails', () => {
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {
      throw new Error('disk full')
    })

    try {
      writeFile(path.join(tmpDir, 'resume.tex'), 'hello')
      expect.unreachable('writeFile should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(YAMLResumeError)
      expect(error.code).toBe('FILE_WRITE_ERROR')
    }
  })
})

describe(generateStyledResume, () => {
  it('should write the tex file and compile when format is pdf', async () => {
    const outputPath = path.join(tmpDir, 'resume.pdf')
    const texPath = path.join(tmpDir, 'resume.tex')

    await generateStyledResume(loadResume(), CLASSIC, outputPath, 'pdf', 15000)

    expect(fs.existsSync(texPath)).toBe(true)
    expect(compileLaTeX).toBeCalledWith(texPath, tmpDir, 15000)
  })

  it('should write the tex file and skip compilation when format is tex', async () => {
    const outputPath = path.join(tmpDir, 'resume.tex')

    await generateStyledResume(loadResume(), CLASSIC, outputPath, 'tex', 0)

    expect(fs.existsSync(outputPath)).toBe(true)
    expect(compileLaTeX).not.toBeCalled()
  })
})

describe(generateResume, () => {
  it('should generate both styles with suffixed file names', async () => {
    await generateResume({
      input: FIXTURE,
      output: path.join(tmpDir, 'resume.pdf'),
      style: 'both',
      validate: true,
      timeout: 30000,
    })

    expect(fs.existsSync(path.join(tmpDir, 'resume-classic.tex'))).toBe(true)
    expect(fs.existsSync(path.join(tmpDir, 'resume-modern.tex'))).toBe(true)
    expect(compileLaTeX).toBeCalledTimes(2)
  })

  it('should generate a single style without a suffix', async () => {
    await generateResume({
      input: FIXTURE,
      output: path.join(tmpDir, 'resume.tex'),
      style: 'modern',
      validate: true,
      timeout: 0,
    })

    expect(fs.existsSync(path.join(tmpDir, 'resume.tex'))).toBe(true)
    expect(compileLaTeX).not.toBeCalled()
  })
})

describe(createGenerateCommand, () => {
  it('should have the correct name and description', () => {
    const command = createGenerateCommand()

    expect(command.name()).toBe('generate')
    expect(command.description()).toBe(
      'generate classic and/or modern resume PDF/TeX files'
    )
  })

  it('should expose input, output, style, and format options', () => {
    const { options } = createGenerateCommand()
    const longs = options.map((option) => option.long)

    expect(longs).toContain('--input')
    expect(longs).toContain('--output')
    expect(longs).toContain('--style')
    expect(longs).toContain('--format')
    expect(longs).toContain('--no-validate')
    expect(longs).toContain('--timeout')
  })

  it('should generate a tex file via the command action', async () => {
    vi.spyOn(consola, 'success').mockImplementation(vi.fn())
    const output = path.join(tmpDir, 'resume.tex')

    await createGenerateCommand().parseAsync([
      'node',
      'generate',
      '-i',
      FIXTURE,
      '-o',
      output,
      '-s',
      'classic',
      '-f',
      'tex',
    ])

    expect(fs.existsSync(output)).toBe(true)
    expect(compileLaTeX).not.toBeCalled()
  })

  it('should skip validation with --no-validate', async () => {
    vi.spyOn(consola, 'success').mockImplementation(vi.fn())
    const output = path.join(tmpDir, 'novalidate.tex')

    await createGenerateCommand().parseAsync([
      'node',
      'generate',
      '-i',
      FIXTURE,
      '-o',
      output,
      '-s',
      'classic',
      '-f',
      'tex',
      '--no-validate',
    ])

    expect(fs.existsSync(output)).toBe(true)
  })

  it('should pass a custom timeout through to compileLaTeX', async () => {
    vi.spyOn(consola, 'success').mockImplementation(vi.fn())

    await createGenerateCommand().parseAsync([
      'node',
      'generate',
      '-i',
      FIXTURE,
      '-o',
      path.join(tmpDir, 'resume.pdf'),
      '-s',
      'classic',
      '-t',
      '15',
    ])

    expect(compileLaTeX).toBeCalledWith(
      expect.stringContaining('resume.tex'),
      expect.any(String),
      15000
    )
  })

  it('should use the default timeout when none is provided', async () => {
    vi.spyOn(consola, 'success').mockImplementation(vi.fn())

    await createGenerateCommand().parseAsync([
      'node',
      'generate',
      '-i',
      FIXTURE,
      '-o',
      path.join(tmpDir, 'resume.pdf'),
      '-s',
      'classic',
    ])

    expect(compileLaTeX).toBeCalledWith(
      expect.any(String),
      expect.any(String),
      LATEX_COMPILE_TIMEOUT_MS
    )
  })

  it('should report errors and exit when generation fails', async () => {
    const errorSpy = vi.spyOn(consola, 'error').mockImplementation(vi.fn())
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never)

    await createGenerateCommand().parseAsync([
      'node',
      'generate',
      '-i',
      path.join(tmpDir, 'does-not-exist.yml'),
      '-o',
      path.join(tmpDir, 'resume.tex'),
      '-s',
      'classic',
      '-f',
      'tex',
    ])

    expect(errorSpy).toBeCalledTimes(1)
    expect(exitSpy).toBeCalledTimes(1)
  })

  it('should exit with code 1 when the error has no errno', async () => {
    vi.spyOn(consola, 'success').mockImplementation(vi.fn())
    const errorSpy = vi.spyOn(consola, 'error').mockImplementation(vi.fn())
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never)
    vi.mocked(compileLaTeX).mockRejectedValueOnce(new Error('boom'))

    await createGenerateCommand().parseAsync([
      'node',
      'generate',
      '-i',
      FIXTURE,
      '-o',
      path.join(tmpDir, 'resume.pdf'),
      '-s',
      'classic',
    ])

    expect(errorSpy).toBeCalledWith('boom')
    expect(exitSpy).toBeCalledWith(1)
  })
})
