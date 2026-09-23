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

import { RetrievalDatasetSchema } from '@/evaluation/retrieval'

/**
 * Hand-labelled requirement → evidence pairs where the support is phrased
 * differently from the requirement: synonyms, abbreviations, Chinese and
 * English wording, and mixed-script resumes. Every text is synthetic.
 *
 * Cases with an empty `relevantEvidenceIds` are traps: the evidence shares
 * a token or a topic with the requirement but does not support it.
 */
export const retrievalParaphraseCases = RetrievalDatasetSchema.parse([
  {
    version: 1,
    id: 'en-k8s-abbreviation',
    language: 'en',
    requirement: {
      text: 'Provision and operate Kubernetes clusters on bare-metal hardware',
      keywords: ['Kubernetes', 'bare metal'],
    },
    evidence: [
      {
        id: 'a',
        text: 'Ran k8s clusters on physical servers in a colocation data centre.',
      },
      { id: 'b', text: 'Presented quarterly findings to stakeholders.' },
      { id: 'c', text: 'Maintained the marketing site in WordPress.' },
    ],
    relevantEvidenceIds: ['a'],
  },
  {
    version: 1,
    id: 'en-ci-github-actions',
    language: 'en',
    requirement: {
      text: 'Build and maintain CI/CD pipelines',
      keywords: ['CI/CD', 'pipelines'],
    },
    evidence: [
      {
        id: 'a',
        text: 'Set up GitHub Actions workflows that test and deploy every merge.',
      },
      { id: 'b', text: 'Designed the onboarding email sequence.' },
    ],
    relevantEvidenceIds: ['a'],
  },
  {
    version: 1,
    id: 'en-relational-postgres',
    language: 'en',
    requirement: {
      text: 'Experience with relational databases and query optimisation',
      keywords: ['relational databases', 'query optimisation'],
    },
    evidence: [
      {
        id: 'a',
        text: 'Tuned slow PostgreSQL queries and added the indexes the planner needed.',
      },
      { id: 'b', text: 'Wrote the team wiki and ran retrospectives.' },
      { id: 'c', text: 'Stored session blobs in Redis.' },
    ],
    relevantEvidenceIds: ['a'],
  },
  {
    version: 1,
    id: 'en-rest-endpoints',
    language: 'en',
    requirement: { text: 'Design REST APIs', keywords: ['REST', 'API'] },
    evidence: [
      {
        id: 'a',
        text: 'Exposed HTTP endpoints with versioned JSON contracts for the mobile app.',
      },
      { id: 'b', text: 'Modelled 3D assets in Blender.' },
    ],
    relevantEvidenceIds: ['a'],
  },
  {
    version: 1,
    id: 'en-unit-testing-jest',
    language: 'en',
    requirement: { text: 'Write unit tests', keywords: ['unit tests'] },
    evidence: [
      { id: 'a', text: 'Brought the Jest suite to 90% statement coverage.' },
      { id: 'b', text: 'Negotiated vendor contracts.' },
    ],
    relevantEvidenceIds: ['a'],
  },
  {
    version: 1,
    id: 'en-data-pipelines-etl',
    language: 'en',
    requirement: {
      text: 'Build reliable data pipelines',
      keywords: ['data pipelines'],
    },
    evidence: [
      {
        id: 'a',
        text: 'Scheduled nightly ETL jobs in Airflow and added data-quality alerts.',
      },
      { id: 'b', text: 'Ran the office move.' },
    ],
    relevantEvidenceIds: ['a'],
  },
  {
    version: 1,
    id: 'en-oncall-incident',
    language: 'en',
    requirement: {
      text: 'Participate in an on-call rotation',
      keywords: ['on-call'],
    },
    evidence: [
      { id: 'a', text: 'Took weekly incident duty and wrote the postmortems.' },
      { id: 'b', text: 'Taught an internal Excel course.' },
    ],
    relevantEvidenceIds: ['a'],
  },
  {
    version: 1,
    id: 'en-terraform-literal',
    language: 'en',
    requirement: { text: 'Author Terraform modules', keywords: ['Terraform'] },
    evidence: [
      { id: 'a', text: 'Built Terraform modules for networking and IAM.' },
      { id: 'b', text: 'Designed print brochures.' },
    ],
    relevantEvidenceIds: ['a'],
  },
  {
    version: 1,
    id: 'en-two-supports',
    language: 'en',
    requirement: {
      text: 'Operate cloud infrastructure',
      keywords: ['cloud infrastructure'],
    },
    evidence: [
      { id: 'a', text: 'Managed AWS accounts, VPCs and autoscaling groups.' },
      { id: 'b', text: 'Migrated workloads to GCP and set up billing alerts.' },
      { id: 'c', text: 'Photographed company events.' },
    ],
    relevantEvidenceIds: ['a', 'b'],
  },
  {
    version: 1,
    id: 'zh-vector-search',
    language: 'zh',
    requirement: {
      text: '熟悉向量检索与 Embedding',
      keywords: ['向量检索', 'Embedding'],
    },
    evidence: [
      { id: 'a', text: '用 FAISS 做过语义搜索，接入过 bge 模型。' },
      { id: 'b', text: '负责前端页面开发与 CSS 动画。' },
      { id: 'c', text: '组织过部门团建活动。' },
    ],
    relevantEvidenceIds: ['a'],
  },
  {
    version: 1,
    id: 'zh-llm-application',
    language: 'zh',
    requirement: { text: '有大模型应用开发经验', keywords: ['大模型', 'LLM'] },
    evidence: [
      {
        id: 'a',
        text: '接入 GPT 接口做客服问答机器人，负责提示词与结构化输出。',
      },
      { id: 'b', text: '维护公司报销系统的表单校验。' },
    ],
    relevantEvidenceIds: ['a'],
  },
  {
    version: 1,
    id: 'zh-microservices',
    language: 'zh',
    requirement: { text: '熟悉微服务架构', keywords: ['微服务'] },
    evidence: [
      { id: 'a', text: '用 Spring Cloud 把单体拆成多个独立部署的服务。' },
      { id: 'b', text: '设计过产品的用户调研问卷。' },
    ],
    relevantEvidenceIds: ['a'],
  },
  {
    version: 1,
    id: 'zh-data-visualization',
    language: 'zh',
    requirement: { text: '数据可视化能力', keywords: ['数据可视化'] },
    evidence: [
      { id: 'a', text: '用 ECharts 搭建运营看板，展示日活与留存。' },
      { id: 'b', text: '负责仓库的进出库登记。' },
    ],
    relevantEvidenceIds: ['a'],
  },
  {
    version: 1,
    id: 'zh-unit-test',
    language: 'zh',
    requirement: { text: '重视单元测试', keywords: ['单元测试'] },
    evidence: [
      { id: 'a', text: '把 Jest 覆盖率从 40% 提到 85%。' },
      { id: 'b', text: '写过公众号推文。' },
    ],
    relevantEvidenceIds: ['a'],
  },
  {
    version: 1,
    id: 'mixed-k8s-zh',
    language: 'mixed',
    requirement: { text: '熟悉 Kubernetes 容器编排', keywords: ['Kubernetes'] },
    evidence: [
      { id: 'a', text: '维护过 k8s 集群，写过 Helm chart。' },
      { id: 'b', text: '做过短视频剪辑。' },
    ],
    relevantEvidenceIds: ['a'],
  },
  {
    version: 1,
    id: 'mixed-python-analysis',
    language: 'mixed',
    requirement: { text: 'Python 数据分析', keywords: ['Python', '数据分析'] },
    evidence: [
      { id: 'a', text: '用 pandas 清洗销售数据并做周报。' },
      { id: 'b', text: '负责门店陈列。' },
    ],
    relevantEvidenceIds: ['a'],
  },
  {
    version: 1,
    id: 'mixed-rag-en-resume',
    language: 'mixed',
    requirement: { text: '参与 RAG 检索链路建设', keywords: ['RAG', '检索'] },
    evidence: [
      {
        id: 'a',
        text: 'Built a retrieval-augmented QA bot over internal docs with chunking and reranking.',
      },
      { id: 'b', text: 'Ran the summer internship programme.' },
    ],
    relevantEvidenceIds: ['a'],
  },
  {
    version: 1,
    id: 'trap-go-language',
    language: 'en',
    requirement: { text: 'Write services in Go', keywords: ['Go'] },
    evidence: [
      { id: 'a', text: 'Owned the go-to-market plan for the launch.' },
      { id: 'b', text: 'Wrote Python services for billing.' },
    ],
    relevantEvidenceIds: [],
  },
  {
    version: 1,
    id: 'trap-ml-training',
    language: 'zh',
    requirement: {
      text: '有机器学习模型训练经验',
      keywords: ['机器学习', '模型训练'],
    },
    evidence: [
      { id: 'a', text: '负责前端页面开发与 CSS 动画。' },
      { id: 'b', text: '做过线下销售培训。' },
    ],
    relevantEvidenceIds: [],
  },
  {
    version: 1,
    id: 'trap-rust-vs-python',
    language: 'en',
    requirement: { text: 'Rust systems programming', keywords: ['Rust'] },
    evidence: [
      { id: 'a', text: 'Built Django web apps in Python.' },
      { id: 'b', text: 'Wrote SQL reports.' },
    ],
    relevantEvidenceIds: [],
  },
])
