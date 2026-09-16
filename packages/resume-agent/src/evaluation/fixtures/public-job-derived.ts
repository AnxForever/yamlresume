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

import {
  type EvalCaseProvenance,
  EvalDatasetSchema,
} from '@/evaluation/contracts'

function provenance(
  publisher: string,
  sourcePostingId: string,
  sourceUrl: string,
  sourceUpdatedAt: string
): EvalCaseProvenance {
  return {
    split: 'development',
    jobDescription: {
      kind: 'public_job_posting_derived',
      publisher,
      sourceUrl,
      sourcePostingId,
      observedAt: '2026-09-16',
      sourceUpdatedAt,
      handling: 'paraphrased_requirements_only',
    },
    candidate: {
      kind: 'synthetic',
      containsRealPersonalData: false,
    },
  }
}

export const publicJobDerivedDevelopmentCases = EvalDatasetSchema.parse([
  {
    version: 1,
    id: 'public-grafana-platform-metal-2026-09',
    provenance: provenance(
      'Grafana Labs',
      '6144059004',
      'https://job-boards.greenhouse.io/grafanalabs/jobs/6144059004',
      '2026-08-18T08:56:38-04:00'
    ),
    request: {
      jobDescription:
        'Software Engineer - Platform Metal. A UK remote platform team is building and provisioning storage, networking, and Kubernetes clusters on physical hardware. The engineer will manage cluster networking, scheduling, autoscaling, Crossplane compositions, and Terraform modules; operate what they build; participate in on-call; and work directly with internal application teams. Go, Python, shell, public-cloud Kubernetes, data-center systems, and clear remote communication are relevant. Cluster API, Tinkerbell, Talos, Ceph, and open-source experience are useful additions.',
      candidate: {
        resume: {
          content: {
            basics: {
              name: 'Example Platform Candidate',
              email: 'platform.candidate@example.invalid',
              summary:
                'Platform engineer focused on cloud Kubernetes automation and dependable developer tooling.',
            },
            education: [],
            work: [
              {
                name: 'Northstar Demo Systems',
                position: 'Platform Engineer',
                startDate: '2022-04',
                endDate: '2026-08',
                summary:
                  '- Operated AWS Kubernetes workloads and joined an on-call rotation.\n- Built Terraform modules and Go utilities for application teams.\n- Improved deployment reliability through integration tests and runbooks.',
                keywords: ['AWS', 'Go', 'Kubernetes', 'Terraform', 'on-call'],
              },
            ],
          },
        },
      },
      preferences: {
        targetTitle: 'Software Engineer - Platform Metal',
        formats: ['yaml'],
        styles: ['ats-compact'],
      },
    },
    expectations: {
      targetTitle: 'Software Engineer - Platform Metal',
      requiredJobKeywords: ['Kubernetes', 'Terraform', 'Crossplane'],
      minimumRequirementCoverage: 0.4,
      minimumMustHaveCoverage: 0.4,
      requiredWarningCodes: ['missing_job_keywords'],
    },
  },
  {
    version: 1,
    id: 'public-cloudflare-senior-data-analyst-2026-09',
    provenance: provenance(
      'Cloudflare',
      '8109620',
      'https://boards.greenhouse.io/cloudflare/jobs/8109620?gh_jid=8109620',
      '2026-09-14T04:21:56-04:00'
    ),
    request: {
      jobDescription:
        'Senior Data Analyst. A London analytics team needs an experienced analyst to own curated datasets, translate business questions into analysis, advise stakeholders, review team changes, and communicate actionable findings. Mandatory capabilities include advanced SQL on large datasets, version control, Airflow orchestration, and data transformation with dbt or similar tools. A quantitative degree, at least four years in centralized analytics, AI-assisted analytics workflows, and strong stakeholder partnership are expected. Python or R and SaaS analytics are useful additions.',
      candidate: {
        resume: {
          content: {
            basics: {
              name: 'Example Analytics Candidate',
              email: 'analytics.candidate@example.invalid',
              summary:
                'Data analyst who turns product questions into maintained datasets and decision-ready reporting.',
            },
            education: [
              {
                institution: 'Example Technical University',
                area: 'Statistics',
                degree: 'Bachelor',
                startDate: '2017-09',
                endDate: '2021-06',
              },
            ],
            work: [
              {
                name: 'Sample Analytics Cooperative',
                position: 'Data Analyst',
                startDate: '2021-07',
                endDate: '2026-08',
                summary:
                  '- Optimized SQL models and reviewed dbt changes for subscription analytics.\n- Maintained Airflow pipelines in GitHub and presented product recommendations to stakeholders.\n- Used Python for statistical analysis and data-quality checks.',
                keywords: [
                  'Airflow',
                  'dbt',
                  'GitHub',
                  'Python',
                  'SQL',
                  'stakeholder analytics',
                ],
              },
            ],
          },
        },
      },
      preferences: {
        targetTitle: 'Senior Data Analyst',
        formats: ['yaml'],
        styles: ['ats-compact'],
      },
    },
    expectations: {
      targetTitle: 'Senior Data Analyst',
      requiredJobKeywords: ['SQL', 'Airflow', 'dbt'],
      minimumRequirementCoverage: 0.55,
      minimumMustHaveCoverage: 0.5,
      requiredWarningCodes: ['missing_job_keywords'],
    },
  },
  {
    version: 1,
    id: 'public-anthropic-data-engineer-2026-09',
    provenance: provenance(
      'Anthropic',
      '4956672008',
      'https://job-boards.greenhouse.io/anthropic/jobs/4956672008',
      '2026-08-21T12:49:43-04:00'
    ),
    request: {
      jobDescription:
        'Data Engineer. An analytics organization needs an engineer to translate stakeholder data needs into technical requirements, build reliable pipelines and canonical datasets, establish data integrity standards and delivery SLAs, and create dashboards and self-service data products. The role expects extensive data-engineering experience plus strong SQL and Python, multi-step ETL, dbt-style data modeling, Airflow-style workflow management, GitHub, and cross-functional work with product and go-to-market teams. Dashboarding experience and comfort creating clarity in ambiguous, fast-moving work are important.',
      candidate: {
        resume: {
          content: {
            basics: {
              name: 'Example Data Engineering Candidate',
              email: 'data.engineering.candidate@example.invalid',
              summary:
                'Backend engineer moving into analytics engineering with experience building scheduled data workflows.',
            },
            education: [],
            work: [
              {
                name: 'Example Product Studio',
                position: 'Backend Engineer',
                startDate: '2023-01',
                endDate: '2026-08',
                summary:
                  '- Built Python and SQL ingestion jobs for product events.\n- Scheduled workflows in Airflow and added data-quality alerts.\n- Partnered with product managers on operational dashboards.',
                keywords: ['Airflow', 'data quality', 'ETL', 'Python', 'SQL'],
              },
            ],
          },
        },
      },
      preferences: {
        targetTitle: 'Data Engineer',
        formats: ['yaml'],
        styles: ['ats-compact'],
      },
    },
    expectations: {
      targetTitle: 'Data Engineer',
      requiredJobKeywords: ['SQL', 'Python', 'dbt', 'Airflow'],
      minimumRequirementCoverage: 0.4,
      minimumMustHaveCoverage: 0.4,
      requiredWarningCodes: ['missing_job_keywords'],
    },
  },
])
