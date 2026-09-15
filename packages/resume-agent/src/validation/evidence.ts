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

import type { Evidence } from '@/contracts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isUsefulText(value: string): boolean {
  return value.trim().length > 0
}

export function buildEvidenceIndex(
  resume: Resume,
  additional: Evidence[] = []
): Evidence[] {
  const evidence: Evidence[] = []

  function visit(value: unknown, path: string, section: string): void {
    if (typeof value === 'string') {
      if (isUsefulText(value)) {
        evidence.push({
          id: `candidate.${path}`,
          path: `candidate.${path}`,
          section,
          text: value.trim(),
        })
      }
      return
    }

    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`, section))
      return
    }

    if (!isRecord(value)) {
      return
    }

    for (const [key, child] of Object.entries(value)) {
      if (key === 'computed' || key === 'layouts') {
        continue
      }
      const childPath = path ? `${path}.${key}` : key
      const childSection = section || key
      visit(child, childPath, childSection)
    }
  }

  visit(resume.content, 'content', '')
  return [...evidence, ...additional]
}
