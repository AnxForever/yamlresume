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

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import { API_ROUTES } from './server'

describe('OpenAPI contract', () => {
  it('documents every registered HTTP route', async () => {
    const path = join(process.cwd(), '../../docs/api/resume-agent.openapi.yaml')
    const document = parse(await readFile(path, 'utf8')) as {
      openapi?: string
      paths?: Record<string, Record<string, unknown>>
    }

    expect(document.openapi).toBe('3.1.0')
    for (const route of API_ROUTES) {
      expect(document.paths?.[route.path]?.[route.method]).toBeDefined()
    }
  })

  it('documents the frontend-critical result fields', async () => {
    const path = join(process.cwd(), '../../docs/api/resume-agent.openapi.yaml')
    const document = parse(await readFile(path, 'utf8')) as {
      components?: { schemas?: Record<string, unknown> }
    }
    const schemas = document.components?.schemas ?? {}

    expect(schemas.TailorResumeResult).toBeDefined()
    expect(schemas.OutputArtifact).toBeDefined()
    expect(schemas.RenderedVariant).toBeDefined()
    expect(schemas.TailorResumeMultipartRequest).toBeDefined()
    expect(schemas.ResumeAgentRun).toBeDefined()
  })

  it('documents structured-output validation failures', async () => {
    const path = join(process.cwd(), '../../docs/api/resume-agent.openapi.yaml')
    const document = parse(await readFile(path, 'utf8')) as {
      components?: {
        schemas?: {
          ErrorEnvelope?: {
            properties?: {
              error?: {
                properties?: { code?: { enum?: string[] } }
              }
            }
          }
        }
      }
    }

    expect(
      document.components?.schemas?.ErrorEnvelope?.properties?.error?.properties
        ?.code?.enum
    ).toContain('structured_output_validation_failed')
  })
})
