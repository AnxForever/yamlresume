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
import path from 'node:path'
import {
  getResumeRenderer,
  joinNonEmptyString,
  type LatexLayout,
  type LatexTemplate,
  type Resume,
  YAMLResumeError,
} from '@yamlresume/core'
import { Command } from 'commander'
import { consola } from 'consola'

import { compileLaTeX, LATEX_COMPILE_TIMEOUT_MS, parseTimeout } from './build'
import { readResume } from './validate'

type GenerateStyle = 'classic' | 'modern' | 'both'
type GenerateFormat = 'pdf' | 'tex'

interface GenerateOptions {
  input: string
  output: string
  style: GenerateStyle
  format?: GenerateFormat
  validate: boolean
  timeout: number
}

interface StylePreset {
  suffix: Exclude<GenerateStyle, 'both'>
  template: LatexTemplate
}

const STYLE_PRESETS: Record<Exclude<GenerateStyle, 'both'>, StylePreset> = {
  classic: {
    suffix: 'classic',
    template: 'jake',
  },
  modern: {
    suffix: 'modern',
    template: 'moderncv-banking',
  },
}

const DEFAULT_LATEX_LAYOUT: LatexLayout = {
  engine: 'latex',
  page: {
    margins: {
      top: '1.5cm',
      bottom: '1.5cm',
      left: '1.2cm',
      right: '1.2cm',
    },
    paperSize: 'a4',
    showPageNumbers: false,
  },
  template: 'moderncv-banking',
  typography: {
    fontSize: '10pt',
  },
}

export function getLatexLayout(resume: Resume): LatexLayout {
  return (
    (resume.layouts?.find((layout) => layout.engine === 'latex') as
      | LatexLayout
      | undefined) ?? DEFAULT_LATEX_LAYOUT
  )
}

export function withStyle(resume: Resume, template: LatexTemplate): Resume {
  const baseLayout = getLatexLayout(resume)

  return {
    ...resume,
    layouts: [
      {
        ...baseLayout,
        engine: 'latex',
        template,
      },
    ],
  }
}

export function inferFormat(
  output: string,
  format?: GenerateFormat
): GenerateFormat {
  if (format) {
    return format
  }

  return path.extname(output) === '.tex' ? 'tex' : 'pdf'
}

export function resolveOutputPath(
  output: string,
  style: StylePreset,
  total: number,
  format: GenerateFormat
): string {
  const resolved = path.resolve(output)
  const parsed = path.parse(resolved)
  const extension = parsed.ext || `.${format}`
  const baseName = total > 1 ? `${parsed.name}-${style.suffix}` : parsed.name

  return path.join(parsed.dir, `${baseName}${extension}`)
}

export function writeFile(outputPath: string, content: string): void {
  const outputDir = path.dirname(outputPath)

  try {
    fs.mkdirSync(outputDir, { recursive: true })
    fs.writeFileSync(outputPath, content)
  } catch (_error) {
    throw new YAMLResumeError('FILE_WRITE_ERROR', { path: outputPath })
  }
}

export async function generateStyledResume(
  resume: Resume,
  preset: StylePreset,
  outputPath: string,
  format: GenerateFormat,
  timeout: number
): Promise<void> {
  const styledResume = withStyle(resume, preset.template)
  const latex = getResumeRenderer(styledResume, 0).render()
  const texPath = outputPath.replace(/\.(pdf|tex)$/i, '.tex')

  writeFile(texPath, latex)
  consola.success(`Generated resume tex file successfully: ${texPath}`)

  if (format === 'pdf') {
    await compileLaTeX(texPath, path.dirname(texPath), timeout)
  }
}

export async function generateResume(options: GenerateOptions): Promise<void> {
  const format = inferFormat(options.output, options.format)
  const styles =
    options.style === 'both'
      ? [STYLE_PRESETS.classic, STYLE_PRESETS.modern]
      : [STYLE_PRESETS[options.style]]
  const { resume } = readResume(options.input, options.validate)

  for (const style of styles) {
    const outputPath = resolveOutputPath(
      options.output,
      style,
      styles.length,
      format
    )

    await generateStyledResume(
      resume,
      style,
      outputPath,
      format,
      options.timeout
    )
  }
}

export function validateStyle(value: string): GenerateStyle {
  if (value === 'classic' || value === 'modern' || value === 'both') {
    return value
  }

  throw new Error(
    joinNonEmptyString(
      ['Invalid style:', value, '(expected classic, modern, or both)'],
      ' '
    )
  )
}

export function validateFormat(value: string): GenerateFormat {
  if (value === 'pdf' || value === 'tex') {
    return value
  }

  throw new Error(
    joinNonEmptyString(['Invalid format:', value, '(expected pdf or tex)'], ' ')
  )
}

/**
 * Create a command instance to generate classic and/or modern resumes.
 */
export function createGenerateCommand() {
  return new Command()
    .name('generate')
    .description('generate classic and/or modern resume PDF/TeX files')
    .requiredOption('-i, --input <file>', 'the resume YAML or JSON file path')
    .requiredOption('-o, --output <file>', 'the output PDF or TeX file path')
    .option(
      '-s, --style <style>',
      'classic, modern, or both',
      validateStyle,
      'both'
    )
    .option('-f, --format <format>', 'pdf or tex', validateFormat)
    .option('--no-validate', 'skip resume schema validation')
    .option(
      '-t, --timeout <seconds>',
      joinNonEmptyString(
        [
          'timeout for LaTeX compilation in seconds',
          `(default: ${LATEX_COMPILE_TIMEOUT_MS / 1000}, 0 to disable)`,
        ],
        ' '
      ),
      (value) => parseTimeout(value)
    )
    .action(async (options: GenerateOptions) => {
      try {
        await generateResume({
          ...options,
          timeout: options.timeout ?? LATEX_COMPILE_TIMEOUT_MS,
        })
      } catch (error) {
        consola.error(error.message)
        process.exit(error.errno ?? 1)
      }
    })
}
