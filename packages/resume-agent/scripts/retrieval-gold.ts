/**
 * Score the retrieval gold set with every matcher we have and sweep the two
 * acceptance rules, so the default is calibrated instead of guessed.
 *
 *   pnpm --filter @yamlresume/resume-agent exec tsx scripts/retrieval-gold.ts
 *   NODE_OPTIONS=--use-env-proxy ...   (when the model must be downloaded via a proxy)
 *
 * Prints a table with micro precision / recall / F1, exact cases and whether
 * the three trap cases stayed empty. Nothing is written.
 */
import { retrievalParaphraseCases } from '../src/evaluation/fixtures/retrieval-paraphrase'
import {
  evaluateRetrieval,
  hybridRetrievalMatcher,
  lexicalRetrievalMatcher,
  type RetrievalMatcher,
} from '../src/evaluation/retrieval'
import { createHashEmbeddingClient } from '../src/retrieval/embeddings'
import type { SemanticAcceptance } from '../src/retrieval/hybrid'
import { createTransformersEmbeddingClient } from '../src/retrieval/transformers-embeddings'

const rows: Record<string, unknown>[] = []

async function score(matcher: RetrievalMatcher): Promise<void> {
  const report = await evaluateRetrieval(retrievalParaphraseCases, matcher)
  const traps = report.cases.filter((item) => item.expected.length === 0)
  rows.push({
    matcher: report.matcher,
    precision: report.micro.precision,
    recall: report.micro.recall,
    f1: report.micro.f1,
    exact: `${report.exactCases}/${report.cases.length}`,
    // The lexical judge always contributes one: "Go" inside "go-to-market".
    trapFPs: traps.reduce((total, item) => total + item.falsePositives, 0),
    en: report.byLanguage.en.recall,
    zh: report.byLanguage.zh.recall,
    mixed: report.byLanguage.mixed.recall,
  })
}

await score(lexicalRetrievalMatcher())

const hash = createHashEmbeddingClient()
for (const acceptance of [
  { kind: 'absolute', threshold: 0.3 },
  { kind: 'background-margin', margin: 0.1 },
] satisfies SemanticAcceptance[]) {
  await score(hybridRetrievalMatcher({ embeddings: hash, acceptance }))
}

const e5 = createTransformersEmbeddingClient()
const absolute = [0.8, 0.82, 0.84, 0.85, 0.86, 0.88]
const margins = [0.06, 0.08, 0.1, 0.12, 0.14]
for (const threshold of absolute) {
  await score(
    hybridRetrievalMatcher({
      embeddings: e5,
      acceptance: { kind: 'absolute', threshold },
    })
  )
}
for (const margin of margins) {
  await score(
    hybridRetrievalMatcher({
      embeddings: e5,
      acceptance: { kind: 'background-margin', margin },
    })
  )
}
console.table(rows)
