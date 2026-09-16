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

import { describe, expect, it } from 'vitest'

import {
  type AttachedFile,
  type LauncherDraft,
  submitBlockers,
} from '@/lib/draft'

function fileOf(
  role: 'job' | 'candidate',
  overrides: Partial<AttachedFile> = {}
): AttachedFile {
  return {
    id: overrides.id ?? `${role}-1`,
    name: overrides.name ?? `${role}.pdf`,
    size: overrides.size ?? 1024,
    role,
    file: overrides.file ?? ({} as File),
  }
}

function draft(overrides: Partial<LauncherDraft> = {}): LauncherDraft {
  return {
    jobDescription: '',
    candidateYaml: '',
    files: [],
    ...overrides,
  }
}

describe('submitBlockers', () => {
  it('blocks an empty draft with both reasons', () => {
    expect(submitBlockers(draft())).toEqual([
      '还需要岗位 JD（至少 20 个字符，或上传一份岗位文件）',
      '还需要你的材料（YAML 文本或一份简历文件）',
    ])
  })

  it('treats a short JD as missing', () => {
    const blockers = submitBlockers(
      draft({ jobDescription: '太短了', candidateYaml: 'name: A' })
    )
    expect(blockers).toContain(
      '还需要岗位 JD（至少 20 个字符，或上传一份岗位文件）'
    )
  })

  it('accepts a JD supplied only by an uploaded file', () => {
    const blockers = submitBlockers(
      draft({ candidateYaml: 'name: A', files: [fileOf('job')] })
    )
    expect(blockers).toEqual([])
  })

  it('accepts a candidate supplied only by a file', () => {
    const blockers = submitBlockers(
      draft({
        jobDescription: '这是一段足够长的岗位描述文本内容用于通过校验',
        files: [fileOf('candidate')],
      })
    )
    expect(blockers).toEqual([])
  })

  it('passes a complete draft', () => {
    expect(
      submitBlockers(
        draft({
          jobDescription: '这是一段足够长的岗位描述文本内容用于通过校验',
          candidateYaml: 'name: Ada',
        })
      )
    ).toEqual([])
  })

  it('flags too many job files using the provided limit', () => {
    const blockers = submitBlockers(
      draft({
        candidateYaml: 'name: A',
        files: [
          fileOf('job', { id: 'j1' }),
          fileOf('job', { id: 'j2' }),
          fileOf('job', { id: 'j3' }),
        ],
      }),
      { fileBytes: 999_999, jobFiles: 2, candidateFiles: 12 }
    )
    expect(blockers).toContain('岗位文件最多 2 个')
  })

  it('flags an oversized file by name', () => {
    const blockers = submitBlockers(
      draft({
        jobDescription: '这是一段足够长的岗位描述文本内容用于通过校验',
        files: [fileOf('candidate', { name: 'big.pdf', size: 20_000_000 })],
      }),
      { fileBytes: 1_000, jobFiles: 8, candidateFiles: 12 }
    )
    expect(blockers).toContain('big.pdf 超过单文件大小限制')
  })
})
