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

import { parse as parseYaml } from 'yaml'

import type {
  JsonCompletionRequest,
  LlmClient,
  LlmCompletion,
} from '@/contracts'

/**
 * An `LlmClient` that never calls a model.
 *
 * It answers the three workflow boundaries (candidate normalization, job
 * analysis, draft) and chat with deterministic heuristics over the data the
 * prompts embed: the job description block, the canonical resume or uploaded
 * artifact text, and the evidence index. That is enough to run the whole
 * pipeline — matching, validation, diff, quality report, rendering — with no
 * credentials and no network, which is what the local demo and the browser
 * smoke path need.
 *
 * It is not a model stand-in for quality purposes. It does not rewrite resume
 * content, its job analysis is a line splitter with a keyword lexicon, and
 * every profile it extracts is flagged in `warnings`. Where a fact cannot be
 * found it asks rather than invents: a missing name becomes a blocking
 * follow-up question, never a guess.
 */

const PROVIDER = 'offline'
const MODEL = 'heuristic-v1'

/** Names matched case-insensitively unless shorter than four characters. */
const TECH_LEXICON = [
  'TypeScript',
  'JavaScript',
  'Python',
  'Java',
  'Go',
  'Rust',
  'C++',
  'C#',
  'Kotlin',
  'Swift',
  'SQL',
  'NoSQL',
  'PostgreSQL',
  'MySQL',
  'SQLite',
  'Redis',
  'MongoDB',
  'Elasticsearch',
  'Kafka',
  'RabbitMQ',
  'Spark',
  'Flink',
  'Hadoop',
  'Airflow',
  'dbt',
  'React',
  'Vue',
  'Angular',
  'Next.js',
  'Node.js',
  'Express',
  'NestJS',
  'Django',
  'Flask',
  'FastAPI',
  'Spring',
  'Docker',
  'Kubernetes',
  'Terraform',
  'AWS',
  'GCP',
  'Azure',
  'Linux',
  'Git',
  'CI/CD',
  'GraphQL',
  'REST',
  'gRPC',
  'LLM',
  'RAG',
  'Agent',
  'LangChain',
  'LangGraph',
  'Prompt',
  'Embedding',
  'PyTorch',
  'TensorFlow',
  'Transformer',
  'OpenAI',
  'Claude',
  'MCP',
  'Tailwind',
  'HTML',
  'CSS',
  'Playwright',
  'Vitest',
  'Jest',
  '大模型',
  '向量检索',
  '检索增强',
  '智能体',
  '提示词',
  '微调',
  '数据分析',
  '机器学习',
  '深度学习',
  '前端',
  '后端',
  '全栈',
]

const REQUIREMENT_CUE =
  /熟悉|熟练|掌握|精通|了解|经验|能力|优先|加分|负责|参与|学历|本科|硕士|experience|proficien|familiar|strong|knowledge|ability|years|degree|bachelor|master|fluent|understanding|hands-on|skills?/i
const NICE_TO_HAVE_CUE = /加分|优先|bonus|a plus|preferred|nice to have/i
const RESPONSIBILITY_CUE =
  /^(负责|参与|主导|推动|own|build|design|lead|drive|develop|maintain|deliver)/i
const SOFT_SKILL_CUE =
  /沟通|团队|协作|communicat|collaborat|teamwork|leadership/i
const TITLE_CUE =
  /工程师|开发|研发|算法|engineer|developer|scientist|analyst|manager|designer|architect|lead|实习/i
const TITLE_PREFIX =
  /^(岗位名称|岗位|职位|职位名称|title|role|position)\s*[:：]\s*/i
const BULLET_PREFIX = /^[\s\-–—•*·●▪◦]+|^\(?\d+[.)、]\s*/
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/
const NAME_REJECT =
  /\d|@|http|[:：|。，,、;；!！?？]|简历|resume|\bcv\b|curriculum|求职|个人信息|联系|电话|邮箱|地址|我|经验|开发|工程师|summary|experience|education|skills/i

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function lexiconHits(text: string): string[] {
  const hits: string[] = []
  for (const term of TECH_LEXICON) {
    const ascii = /^[\x20-\x7e]+$/.test(term)
    const pattern = ascii
      ? new RegExp(
          `(?<![A-Za-z0-9])${escapeRegExp(term)}(?![A-Za-z0-9])`,
          term.length < 4 ? '' : 'i'
        )
      : new RegExp(escapeRegExp(term))
    if (pattern.test(text)) hits.push(term)
  }
  return hits
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function lines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

/**
 * The launcher submits a chat transcript as the job description, so a line
 * can carry a `user:` / `assistant:` role prefix. Assistant turns are this
 * provider's own replies and never describe the job.
 */
function transcriptToText(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => !/^assistant:/i.test(line.trim()))
    .map((line) => line.replace(/^user:\s*/i, ''))
    .join('\n')
}

/** Text between `start` and the earliest of `ends`, or to the end of `text`. */
function section(
  text: string,
  start: string,
  ends: string[]
): string | undefined {
  const from = text.indexOf(start)
  if (from === -1) return undefined
  const bodyStart = from + start.length
  let bodyEnd = text.length
  for (const end of ends) {
    const at = text.indexOf(end, bodyStart)
    if (at !== -1 && at < bodyEnd) bodyEnd = at
  }
  return text.slice(bodyStart, bodyEnd).trim()
}

interface PromptArtifact {
  id: string
  filename: string
  text: string
}

function parseArtifacts(block: string | undefined): PromptArtifact[] {
  if (!block) return []
  // Slice between headers rather than matching lazily up to `$`: with the
  // multiline flag `$` is every line end, which cuts an artifact to one line.
  const headers = [...block.matchAll(/^ARTIFACT (\S+) \((.+)\)$/gm)]
  return headers.map((header, index) => {
    const from = (header.index ?? 0) + header[0].length
    const to = headers[index + 1]?.index ?? block.length
    return {
      id: header[1] as string,
      filename: header[2] as string,
      text: block.slice(from, to).trim(),
    }
  })
}

function parseJson(block: string | undefined, what: string): unknown {
  if (!block) throw new Error(`Offline provider: prompt has no ${what} block`)
  try {
    return JSON.parse(block)
  } catch {
    throw new Error(`Offline provider: ${what} block is not JSON`)
  }
}

function metadata(startedAt: number) {
  return {
    provider: PROVIDER,
    model: MODEL,
    durationMs: Math.max(0, Date.now() - startedAt),
    attempt: 1,
  }
}

// ---------------------------------------------------------------------------
// Chat

function chat(request: JsonCompletionRequest): unknown {
  // The agent frames the prompt as `CONVERSATION:` / `CONTEXT:` / `USER:`
  // blocks with upper-case roles and a fixed closing instruction. Only the
  // user's own words count towards "has enough content to generate from".
  const framed = request.user
    .replace(/\n\nReturn JSON with reply and readyToGenerate\.$/, '')
    .replace(/^(CONVERSATION|CONTEXT):$/gm, '')
  const body = collapse(transcriptToText(framed))
  const ready = body.length >= 40
  const reply = ready
    ? '离线演示模式：我不会调用模型。已收到你的内容。请把岗位描述贴在对话里，把简历作为候选人附件上传，然后点「生成」。生成结果里的匹配、缺口和产物都是真实流水线算出来的，只有文本不会被改写。'
    : '离线演示模式：我不会调用模型。请把岗位描述（至少几句话）贴在对话里，并把简历作为候选人附件上传。'
  return { reply, readyToGenerate: ready }
}

// ---------------------------------------------------------------------------
// Job analysis

function seniorityOf(text: string): string {
  if (/实习|intern/i.test(text)) return 'intern'
  if (/应届|校招|初级|junior|entry|graduate/i.test(text)) return 'junior'
  if (/高级|资深|senior|\bsr\.?/i.test(text)) return 'senior'
  if (/staff|principal|lead|负责人|专家|总监|director/i.test(text))
    return 'lead'
  return 'unknown'
}

function titleOf(jdLines: string[]): string {
  const candidates = jdLines.slice(0, 15)
  const cued = candidates.find(
    (line) => TITLE_CUE.test(line) && line.length <= 60
  )
  const chosen = cued ?? candidates.find((line) => line.length <= 60)
  return chosen ? chosen.replace(TITLE_PREFIX, '').trim() : 'Target role'
}

function requirementLines(jdLines: string[]): string[] {
  const stripped = jdLines
    .map((line) => line.replace(BULLET_PREFIX, '').trim())
    .filter((line) => line.length >= 4 && line.length <= 300)
  const cued = stripped.filter((line) => REQUIREMENT_CUE.test(line))
  if (cued.length > 0) return cued.slice(0, 12)
  const withTech = stripped.filter((line) => lexiconHits(line).length > 0)
  if (withTech.length > 0) return withTech.slice(0, 8)
  return [...stripped].sort((a, b) => b.length - a.length).slice(0, 5)
}

function keywordsOf(line: string): string[] {
  const hits = lexiconHits(line)
  if (hits.length > 0) return hits.slice(0, 5)
  return [...new Set(line.match(/[A-Za-z][A-Za-z0-9.+#-]{3,}/g) ?? [])]
    .sort((a, b) => b.length - a.length)
    .slice(0, 3)
}

function analyzeJob(request: JsonCompletionRequest): unknown {
  const declared = section(request.user, 'JOB DESCRIPTION START\n', [
    '\nJOB DESCRIPTION END',
  ])
  const uploaded = parseArtifacts(
    section(request.user, 'UPLOADED JOB FILES\n', [])
  )
  const isPlaceholder =
    !declared ||
    /^The job description is contained in the attached files\.?$/.test(declared)
  const pool = [
    isPlaceholder ? '' : transcriptToText(declared),
    ...uploaded.map((artifact) => artifact.text),
  ]
    .filter(Boolean)
    .join('\n')
  const jdLines = lines(pool)
  const title = titleOf(jdLines)
  const requirements = requirementLines(jdLines).map((text, index) => {
    const keywords = keywordsOf(text)
    const category = SOFT_SKILL_CUE.test(text)
      ? 'soft-skill'
      : RESPONSIBILITY_CUE.test(text)
        ? 'responsibility'
        : keywords.length > 0 && lexiconHits(text).length > 0
          ? 'technical'
          : 'other'
    return {
      id: `req-${index + 1}`,
      text: text.length > 120 ? `${text.slice(0, 117)}...` : text,
      keywords,
      importance: NICE_TO_HAVE_CUE.test(text) ? 'nice-to-have' : 'must-have',
      category,
    }
  })
  const company = pool
    .match(/(?:公司|company)\s*[:：]\s*(.{2,80})/i)?.[1]
    ?.trim()
  const summary = collapse(pool).slice(0, 200)
  return {
    targetTitle: title,
    seniority: seniorityOf(`${title}\n${pool.slice(0, 300)}`),
    ...(company ? { company } : {}),
    summary: summary || 'No job description text was provided.',
    requirements,
    keywords: [...new Set(requirements.flatMap((item) => item.keywords))].slice(
      0,
      25
    ),
  }
}

// ---------------------------------------------------------------------------
// Candidate normalization

const NAME_QUESTION = {
  field: 'content.basics.name',
  question: '上传的材料里没有识别出姓名，请填写。',
  reason:
    '离线 Provider 只用启发式规则提取档案，找不到姓名时不会猜测；简历必须有姓名才能继续。',
  severity: 'blocking',
  control: { type: 'text', minLength: 2, maxLength: 128 },
}

function nameFrom(text: string): string | undefined {
  const words = (line: string) => line.split(/\s+/).length
  return lines(text)
    .slice(0, 8)
    .find(
      (line) =>
        line.length >= 2 &&
        line.length <= 40 &&
        words(line) <= 3 &&
        !NAME_REJECT.test(line)
    )
}

function normalizeCandidate(request: JsonCompletionRequest): unknown {
  const canonical = section(request.user, 'CANONICAL RESUME\n', [
    '\n\nUPLOADED CANDIDATE FILES\n',
    '\n\nReturn the normalized',
  ])
  const artifacts = parseArtifacts(
    section(request.user, 'UPLOADED CANDIDATE FILES\n', [
      '\n\nReturn the normalized',
    ])
  )
  const sourceArtifactIds = artifacts.map((artifact) => artifact.id)
  const warnings = [
    'Offline provider: profile fields were extracted with heuristics, not a model; review them.',
  ]

  if (canonical) {
    return {
      resume: parseYaml(canonical) as unknown,
      sourceArtifactIds,
      questions: [],
      warnings,
    }
  }

  // The chat transcript rides along as an artifact; a real document beats it
  // for every field, and assistant turns are never candidate material.
  const documents = artifacts.filter(
    (artifact) => artifact.filename !== 'conversation.txt'
  )
  const pool = (documents.length > 0 ? documents : artifacts)
    .map((artifact) => transcriptToText(artifact.text))
    .join('\n')
  const name = nameFrom(pool)
  const email = pool.match(EMAIL)?.[0]
  const summary = collapse(pool).slice(0, 1024)
  return {
    resume: {
      content: {
        basics: {
          name: name ?? 'Unnamed Candidate',
          ...(email ? { email } : {}),
          ...(summary.length >= 16 ? { summary } : {}),
        },
        education: [],
      },
    },
    sourceArtifactIds,
    questions: name ? [] : [NAME_QUESTION],
    warnings,
  }
}

// ---------------------------------------------------------------------------
// Draft

interface PromptEvidence {
  id: string
  text: string
}

function draft(request: JsonCompletionRequest): unknown {
  const jobSpec = parseJson(
    section(request.user, 'JOB SPEC\n', ['\n\nCANDIDATE RESUME\n']),
    'JOB SPEC'
  ) as { keywords?: unknown }
  const candidate = parseJson(
    section(request.user, 'CANDIDATE RESUME\n', ['\n\nEVIDENCE INDEX\n']),
    'CANDIDATE RESUME'
  )
  const evidence = parseJson(
    section(request.user, 'EVIDENCE INDEX\n', [
      '\n\nUPLOADED CANDIDATE DOCUMENTS\n',
    ]),
    'EVIDENCE INDEX'
  ) as PromptEvidence[]
  const keywords = Array.isArray(jobSpec.keywords)
    ? jobSpec.keywords
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.toLowerCase())
    : []
  const selectedEvidenceIds = evidence
    .filter((item) => {
      const text = item.text.toLowerCase()
      return keywords.some((keyword) => text.includes(keyword))
    })
    .map((item) => item.id)
    .slice(0, 50)
  return {
    resume: candidate,
    selectedEvidenceIds,
    questions: [],
    notes: [
      'Offline provider: the resume text was not rewritten; evidence was selected by job keyword overlap.',
    ],
  }
}

// ---------------------------------------------------------------------------

export function createOfflineLlmClient(): LlmClient {
  return {
    async completeJson<T>(
      request: JsonCompletionRequest
    ): Promise<LlmCompletion<T>> {
      const startedAt = Date.now()
      let data: unknown
      switch (request.schemaName) {
        case 'ResumeAgentChatResponse':
          data = chat(request)
          break
        case 'JobSpec':
          data = analyzeJob(request)
          break
        case 'CandidateNormalization':
          data = normalizeCandidate(request)
          break
        case 'TailoredResumeDraft':
          data = draft(request)
          break
        default:
          throw new Error(
            `Offline provider does not answer schema ${request.schemaName}`
          )
      }
      return { data: data as T, metadata: metadata(startedAt) }
    },
  }
}
