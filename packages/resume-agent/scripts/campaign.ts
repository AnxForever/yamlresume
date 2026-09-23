/**
 * Run a real-provider evaluation campaign and print the safe report.
 *
 *   pnpm --filter @yamlresume/resume-agent exec tsx scripts/campaign.ts \
 *     --matcher lexical|hybrid --repetitions 3 --cases public|paraphrase|all \
 *     [--out report.json] [--env ../../.env.local]
 *
 * The provider comes from OPENAI_* (loaded from the env file when present;
 * variables already in the shell win, so clear stale ones first). Behind a
 * proxy run with NODE_OPTIONS=--use-env-proxy. The report holds case ids,
 * booleans, stable failure codes, timings and aggregates only: no job text,
 * no resume, no model output.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { runEvaluationCampaign } from '../src/evaluation/campaign'
import type { EvalCase, EvalExecute } from '../src/evaluation/contracts'
import { paraphraseHeavyDevelopmentCases } from '../src/evaluation/fixtures/paraphrase-heavy'
import { publicJobDerivedDevelopmentCases } from '../src/evaluation/fixtures/public-job-derived'
import { createOpenAICompatibleClientFromEnv } from '../src/llm/openai-compatible'
import { createTransformersEmbeddingClient } from '../src/retrieval/transformers-embeddings'
import { ResumeTailoringAgent } from '../src/workflow/agent'

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback)
}

const matcher = arg('matcher', 'lexical')
const repetitions = Number(arg('repetitions', '1'))
const caseSet = arg('cases', 'all')
const out = arg('out', '')
const envFile = resolve(arg('env', '../../.env.local'))

if (matcher !== 'lexical' && matcher !== 'hybrid') {
  throw new Error('--matcher must be lexical or hybrid')
}
if (existsSync(envFile)) process.loadEnvFile(envFile)

const llm = createOpenAICompatibleClientFromEnv(process.env)
if (!llm)
  throw new Error(
    'OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL are not configured'
  )

const cases: EvalCase[] = [
  ...(caseSet === 'paraphrase' ? [] : publicJobDerivedDevelopmentCases),
  ...(caseSet === 'public' ? [] : paraphraseHeavyDevelopmentCases),
]
const agent = new ResumeTailoringAgent(
  llm,
  matcher === 'hybrid'
    ? { retrieval: { embeddings: createTransformersEmbeddingClient() } }
    : {}
)

let sequence = 0
const execute: EvalExecute = async (request) => {
  sequence += 1
  const started = Date.now()
  const label = `#${sequence} ${request.preferences?.targetTitle ?? 'run'}`
  console.error(`▸ ${label}`)
  try {
    const result = await agent.run(request)
    const seen = new Set<string>()
    const keywords = result.jobSpec.keywords
      .map((keyword) => keyword.trim())
      .filter((keyword) => {
        const key = keyword.toLocaleLowerCase()
        if (!keyword || seen.has(key)) return false
        seen.add(key)
        return true
      })
      .slice(0, 100)
    console.error(
      `  ${label}: ${((Date.now() - started) / 1000).toFixed(1)}s coverage=${result.quality.requirementCoverage} mustHave=${result.quality.mustHaveCoverage}`
    )
    return {
      jobSpec: { targetTitle: result.jobSpec.targetTitle, keywords },
      quality: {
        requirementCoverage: result.quality.requirementCoverage,
        mustHaveCoverage: result.quality.mustHaveCoverage,
        warnings: result.quality.warnings.map((warning) => ({
          code: warning.code,
        })),
      },
    }
  } catch (error) {
    console.error(
      `  ${label}: failed after ${((Date.now() - started) / 1000).toFixed(1)}s (${error instanceof Error ? error.name : 'error'})`
    )
    throw error
  }
}

const host = new URL(process.env.OPENAI_BASE_URL ?? 'http://unknown').hostname
const runtimeRevision = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
  encoding: 'utf8',
}).trim()
const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
console.error(
  `campaign: ${matcher} matcher, ${cases.length} cases x ${repetitions} repetitions, provider ${host} model ${process.env.OPENAI_MODEL}`
)

const report = await runEvaluationCampaign(cases, execute, {
  campaignId: `ra018-${matcher}-${caseSet}-${stamp}`,
  provider: host,
  model: process.env.OPENAI_MODEL ?? 'unknown',
  promptRevision:
    matcher === 'hybrid'
      ? 'atomic-requirements-v3-hints-v1'
      : 'atomic-requirements-v3',
  runtimeRevision,
  repetitions,
})

const { aggregate } = report
console.log(
  JSON.stringify(
    {
      campaignId: report.configuration.campaignId,
      matcher,
      passRate: aggregate.passRate,
      passRateConfidenceInterval: aggregate.passRateConfidenceInterval,
      passed: aggregate.passed,
      failed: aggregate.failed,
      scored: aggregate.scored,
      averageRequirementCoverage: aggregate.averageRequirementCoverage,
      averageMustHaveCoverage: aggregate.averageMustHaveCoverage,
      averageDurationMs: aggregate.averageDurationMs,
      failureCodeCounts: aggregate.failureCodeCounts,
    },
    null,
    2
  )
)
console.table(
  report.caseAggregates.map((item) => ({
    caseId: item.caseId,
    passed: `${item.passed}/${item.executions}`,
    scored: item.scored,
    interval: item.passRateConfidenceInterval
      ? `[${item.passRateConfidenceInterval.lower}, ${item.passRateConfidenceInterval.upper}]`
      : '-',
    failures:
      Object.entries(item.failureCodeCounts)
        .filter(([, count]) => count > 0)
        .map(([code, count]) => `${code}=${count}`)
        .join(' ') || '-',
  }))
)
if (out) {
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`)
  console.error(`report written to ${out}`)
}
