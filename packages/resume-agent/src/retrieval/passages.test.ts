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
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 */

import { describe, expect, it } from 'vitest'

import { buildPassages } from '@/retrieval/passages'

function evidence(id: string, text: string) {
  return { id, path: id, section: 'uploaded-document', text }
}

describe('buildPassages', () => {
  it('keeps a short evidence item as a single passage with its own id', () => {
    const passages = buildPassages([
      evidence('candidate.content.work[0].keywords[0]', 'Terraform'),
    ])
    expect(passages).toEqual([
      {
        id: 'candidate.content.work[0].keywords[0]',
        evidenceId: 'candidate.content.work[0].keywords[0]',
        text: 'Terraform',
      },
    ])
  })

  it('splits a long document on paragraphs and sentences and numbers the chunks', () => {
    const paragraph =
      'Operated Kubernetes clusters for three product teams. Wrote Terraform modules for networking. Joined the on-call rotation and led two incident reviews.'
    const passages = buildPassages(
      [
        evidence(
          'artifact.a1',
          `${paragraph}\n\n用 FAISS 做过语义搜索。接入过 bge 向量模型。负责检索链路的评测。`
        ),
      ],
      { maxChars: 90, minChars: 20 }
    )
    expect(passages.map((passage) => passage.id)).toEqual([
      'artifact.a1#1',
      'artifact.a1#2',
      'artifact.a1#3',
      'artifact.a1#4',
    ])
    expect(
      passages.every((passage) => passage.evidenceId === 'artifact.a1')
    ).toBe(true)
    expect(passages.every((passage) => passage.text.length <= 90)).toBe(true)
    expect(passages.slice(0, 3).map((passage) => passage.text)).toEqual([
      'Operated Kubernetes clusters for three product teams.',
      'Wrote Terraform modules for networking.',
      'Joined the on-call rotation and led two incident reviews.',
    ])
    expect(passages[3]?.text).toBe(
      '用 FAISS 做过语义搜索。接入过 bge 向量模型。负责检索链路的评测。'
    )
  })

  it('merges a tiny heading into the paragraph that follows it', () => {
    const passages = buildPassages(
      [
        evidence(
          'artifact.a2',
          `${'x'.repeat(280)}\n项目经历\n用 TypeScript 和 Node.js 开发过一个简历生成工具，接入 LLM 做结构化输出校验。`
        ),
      ],
      { maxChars: 300, minChars: 40 }
    )
    expect(passages).toHaveLength(2)
    expect(passages[1]?.text).toBe(
      '项目经历\n用 TypeScript 和 Node.js 开发过一个简历生成工具，接入 LLM 做结构化输出校验。'
    )
  })

  it('attaches a trailing fragment to the paragraph before it', () => {
    const passages = buildPassages(
      [evidence('artifact.a3', `${'y'.repeat(120)}\n${'z'.repeat(120)}\n完`)],
      { maxChars: 150, minChars: 20 }
    )
    expect(passages.map((passage) => passage.text)).toEqual([
      'y'.repeat(120),
      `${'z'.repeat(120)}\n完`,
    ])
  })

  it('drops empty evidence and rejects nonsense bounds', () => {
    expect(buildPassages([evidence('e', '   ')])).toEqual([])
    expect(() => buildPassages([], { maxChars: 10 })).toThrow(/bounds/)
    expect(() => buildPassages([], { minChars: 400, maxChars: 300 })).toThrow(
      /bounds/
    )
  })
})
