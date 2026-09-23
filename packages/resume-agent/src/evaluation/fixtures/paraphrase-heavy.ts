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

import { EvalDatasetSchema } from '@/evaluation/contracts'

/**
 * Synthetic cases where the job description and the candidate describe the
 * same skills in different words: abbreviations, synonyms, Chinese versus
 * English. They exist to measure what semantic evidence retrieval (RA-018)
 * changes downstream: with the lexical judge fixed, a run only scores higher
 * if the draft surfaces the supported facts in the job's own vocabulary.
 *
 * Both the postings and the candidates are invented; no provenance.
 */
export const paraphraseHeavyDevelopmentCases = EvalDatasetSchema.parse([
  {
    version: 1,
    id: 'synthetic-platform-paraphrase-2026-09',
    request: {
      jobDescription:
        'Platform Engineer. Provision and operate Kubernetes clusters on bare-metal hardware. Build and maintain CI/CD pipelines for application teams. Author Terraform modules for networking and identity. Take part in an on-call rotation and lead incident reviews. Nice to have: experience with relational database query optimisation.',
      candidate: {
        resume: {
          content: {
            basics: {
              name: 'Example Infra Candidate',
              email: 'infra.candidate@example.invalid',
              summary:
                'Infrastructure engineer who keeps container platforms and delivery tooling running for product teams.',
            },
            education: [],
            work: [
              {
                name: 'Sample Colocation Services',
                position: 'Infrastructure Engineer',
                startDate: '2021-03',
                endDate: '2026-08',
                summary:
                  '- Ran k8s clusters on physical servers in a colocation data centre.\n- Set up GitHub Actions workflows that test and deploy every merge.\n- Wrote HCL modules for VPC networking and IAM roles.\n- Took weekly incident duty and wrote the postmortems.\n- Tuned slow Postgres queries and added the indexes the planner needed.',
                keywords: [
                  'k8s',
                  'GitHub Actions',
                  'HCL',
                  'Postgres',
                  'incident duty',
                ],
              },
            ],
          },
        },
      },
      preferences: {
        targetTitle: 'Platform Engineer',
        formats: ['yaml'],
        styles: ['ats-compact'],
      },
    },
    expectations: {
      targetTitle: 'Platform Engineer',
      requiredJobKeywords: ['Kubernetes', 'CI/CD', 'Terraform'],
      minimumRequirementCoverage: 0.4,
      minimumMustHaveCoverage: 0.4,
    },
  },
  {
    version: 1,
    id: 'synthetic-ai-application-zh-2026-09',
    request: {
      jobDescription:
        'AI 应用开发工程师。负责大模型应用的设计与开发；参与 RAG 检索链路建设，熟悉向量检索与 Embedding；熟悉 Python 与 TypeScript，有 Node.js 服务开发经验；重视单元测试与工程质量；良好的沟通与团队协作能力。',
      candidate: {
        resume: {
          content: {
            basics: {
              name: '示例候选人',
              email: 'ai.candidate@example.invalid',
              summary:
                '两年后端与智能问答方向开发经验，负责过检索增强问答系统的搭建与评测。',
            },
            education: [],
            projects: [
              {
                name: '内部文档智能问答',
                startDate: '2025-01',
                endDate: '2026-06',
                summary:
                  '- 接入 GPT 接口做问答机器人，负责提示词与结构化输出校验。\n- 用 FAISS 做语义搜索，接入 bge 模型做文档切块与重排。\n- 用 Node.js 写服务端，pandas 做离线评测统计。\n- 把 Jest 覆盖率从 40% 提到 85%。',
                keywords: ['GPT', 'FAISS', 'bge', 'Node.js', 'pandas', 'Jest'],
              },
            ],
          },
        },
      },
      preferences: {
        targetTitle: 'AI 应用开发工程师',
        formats: ['yaml'],
        styles: ['ats-compact'],
      },
    },
    expectations: {
      targetTitle: 'AI 应用开发工程师',
      requiredJobKeywords: ['RAG', '向量检索', 'Node.js'],
      minimumRequirementCoverage: 0.4,
      minimumMustHaveCoverage: 0.4,
    },
  },
])
