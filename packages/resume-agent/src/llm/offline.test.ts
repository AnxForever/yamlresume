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

import {
  CandidateNormalizationResponseSchema,
  DraftResponseSchema,
  JobSpecSchema,
} from '@/contracts'
import { createOfflineLlmClient } from '@/llm/offline'
import { buildDraftPrompt, buildJobAnalysisPrompt } from '@/prompts'

const client = createOfflineLlmClient()

const JOB = `岗位名称：AI 应用开发工程师（校招）
公司：Example Labs
岗位职责：
- 负责 LLM Agent 应用的设计与开发
- 参与 RAG 检索链路的建设
任职要求：
1. 熟悉 TypeScript 或 Python，有 Node.js 开发经验
2. 了解向量检索与 Embedding，有 LangChain 经验者优先
3. 良好的沟通与团队协作能力`

describe('offline LlmClient', () => {
  it('reports itself as the offline provider', async () => {
    const completion = await client.completeJson({
      schemaName: 'ResumeAgentChatResponse',
      system: '',
      user: 'user: 你好',
    })
    expect(completion.metadata.provider).toBe('offline')
    expect(completion.metadata.attempt).toBe(1)
  })

  it('is ready to generate only once the chat carries real content', async () => {
    const short = await client.completeJson<{ readyToGenerate: boolean }>({
      schemaName: 'ResumeAgentChatResponse',
      system: '',
      user: 'user: 你好',
    })
    const long = await client.completeJson<{ readyToGenerate: boolean }>({
      schemaName: 'ResumeAgentChatResponse',
      system: '',
      user: `user: ${JOB}`,
    })
    expect(short.data.readyToGenerate).toBe(false)
    expect(long.data.readyToGenerate).toBe(true)
  })

  it('analyzes a job description into schema-valid atomic requirements', async () => {
    const completion = await client.completeJson({
      schemaName: 'JobSpec',
      system: '',
      user: buildJobAnalysisPrompt(JOB),
    })
    const spec = JobSpecSchema.parse(completion.data)
    expect(spec.targetTitle).toBe('AI 应用开发工程师（校招）')
    expect(spec.seniority).toBe('junior')
    expect(spec.company).toBe('Example Labs')
    expect(spec.keywords).toEqual(
      expect.arrayContaining(['TypeScript', 'Python', 'Node.js', 'LangChain'])
    )
    const langchain = spec.requirements.find((item) =>
      item.keywords.includes('LangChain')
    )
    expect(langchain?.importance).toBe('nice-to-have')
    const soft = spec.requirements.find((item) => /沟通/.test(item.text))
    expect(soft?.category).toBe('soft-skill')
    const rag = spec.requirements.find((item) => /RAG/.test(item.text))
    expect(rag?.category).toBe('responsibility')
  })

  it('strips chat transcript roles from a job description', async () => {
    const transcript = `user: ${JOB.split('\n').join('\nuser: ')}\nassistant: 离线演示模式：我不会调用模型。`
    const completion = await client.completeJson({
      schemaName: 'JobSpec',
      system: '',
      user: buildJobAnalysisPrompt(transcript),
    })
    const spec = JobSpecSchema.parse(completion.data)
    expect(spec.targetTitle).toBe('AI 应用开发工程师（校招）')
    expect(spec.summary).not.toContain('assistant:')
    expect(spec.summary).not.toContain('user:')
  })

  it('returns a canonical resume unchanged and cites every artifact', async () => {
    const resume = {
      content: {
        basics: {
          name: 'Example Candidate',
          summary: 'Builds TypeScript tools for tests.',
        },
        education: [],
      },
    }
    const completion = await client.completeJson({
      schemaName: 'CandidateNormalization',
      system: '',
      user: `CANONICAL RESUME\n${JSON.stringify(resume, null, 2)}\n\nUPLOADED CANDIDATE FILES\nARTIFACT a1 (notes.txt)\nWorked on TypeScript.\n\nReturn the normalized candidate profile and cite the uploaded artifacts.`,
    })
    const parsed = CandidateNormalizationResponseSchema.parse(completion.data)
    expect(parsed.resume).toEqual(resume)
    expect(parsed.sourceArtifactIds).toEqual(['a1'])
    expect(parsed.questions).toEqual([])
  })

  it('extracts name, email and summary from uploaded text without inventing', async () => {
    const completion = await client.completeJson({
      schemaName: 'CandidateNormalization',
      system: '',
      user: 'UPLOADED CANDIDATE FILES\nARTIFACT r1 (resume.txt)\n个人简历\n张三\n邮箱：zhangsan@example.invalid\n项目经历：用 TypeScript 和 Node.js 开发过一个简历生成工具。\n\nARTIFACT conversation (conversation.txt)\nuser: 这是岗位描述\nassistant: 收到\n\nReturn the normalized candidate profile and cite the uploaded artifacts.',
    })
    const parsed = CandidateNormalizationResponseSchema.parse(completion.data)
    const content = (
      parsed.resume as {
        content: { basics: Record<string, unknown>; education: unknown[] }
      }
    ).content
    expect(content.basics.name).toBe('张三')
    expect(content.basics.email).toBe('zhangsan@example.invalid')
    expect(content.basics.summary).toContain('TypeScript')
    expect(content.basics.summary).not.toContain('assistant:')
    expect(content.education).toEqual([])
    expect(content).not.toHaveProperty('skills')
    expect(parsed.sourceArtifactIds).toEqual(['r1', 'conversation'])
    expect(parsed.questions).toEqual([])
    expect(parsed.warnings[0]).toMatch(/heuristics/)
  })

  it('asks a blocking question instead of guessing a missing name', async () => {
    const completion = await client.completeJson({
      schemaName: 'CandidateNormalization',
      system: '',
      user: 'UPLOADED CANDIDATE FILES\nARTIFACT conversation (conversation.txt)\nuser: 我做过三年后端开发，主要用 Python 和 PostgreSQL。\nassistant: 收到\n\nReturn the normalized candidate profile and cite the uploaded artifacts.',
    })
    const parsed = CandidateNormalizationResponseSchema.parse(completion.data)
    expect(parsed.questions).toHaveLength(1)
    expect(parsed.questions[0]).toMatchObject({
      field: 'content.basics.name',
      severity: 'blocking',
      control: { type: 'text' },
    })
  })

  it('drafts by returning the candidate and selecting evidence by keyword overlap', async () => {
    const jobSpec = JobSpecSchema.parse({
      targetTitle: 'Engineer',
      summary: 'Builds things',
      requirements: [],
      keywords: ['TypeScript'],
    })
    const candidate = {
      content: {
        basics: {
          name: 'Example Candidate',
          summary: 'Builds TypeScript tools for tests.',
        },
        education: [],
      },
    }
    const evidence = [
      {
        id: 'candidate.content.basics.summary',
        path: 'candidate.content.basics.summary',
        section: 'basics',
        text: 'Builds TypeScript tools for tests.',
      },
      {
        id: 'artifact.a1',
        path: 'artifact.a1',
        section: 'uploaded-document',
        text: 'Unrelated Python notes.',
      },
    ]
    const completion = await client.completeJson({
      schemaName: 'TailoredResumeDraft',
      system: '',
      user: buildDraftPrompt(
        jobSpec,
        candidate,
        evidence,
        { formats: ['yaml'] } as never,
        []
      ),
    })
    const parsed = DraftResponseSchema.parse(completion.data)
    expect(parsed.resume).toEqual(candidate)
    expect(parsed.selectedEvidenceIds).toEqual([
      'candidate.content.basics.summary',
    ])
    expect(parsed.questions).toEqual([])
  })

  it('refuses a schema it does not know', async () => {
    await expect(
      client.completeJson({ schemaName: 'Mystery', system: '', user: '' })
    ).rejects.toThrow(/Mystery/)
  })
})
