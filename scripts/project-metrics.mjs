import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

/**
 * Measure the Career Agent packages so the numbers quoted in the README and
 * elsewhere come from one reproducible command instead of an ad-hoc `wc -l`.
 *
 * Counts only files git tracks, so build output, local databases and personal
 * resume files never leak into the totals. The MIT header every source file
 * carries is excluded from line counts: it is boilerplate, not code.
 *
 * Test *case* counts are not computed here; they come from `pnpm test`.
 *
 * Usage: node scripts/project-metrics.mjs
 */

const SCOPES = [
  {
    label: 'Agent backend (resume-agent + resume-agent-api)',
    prefixes: ['packages/resume-agent/', 'packages/resume-agent-api/'],
  },
  {
    label: 'Agent backend + workbench (adds agent-web)',
    prefixes: [
      'packages/resume-agent/',
      'packages/resume-agent-api/',
      'packages/agent-web/',
    ],
  },
]

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

function trackedFiles() {
  return git('ls-files', '-z').split('\0').filter(Boolean)
}

function isSource(file) {
  return /\/src\/.*\.(ts|tsx)$/.test(file) && !isTest(file)
}

function isTest(file) {
  return /\/src\/.*\.test\.(ts|tsx)$/.test(file)
}

/** Lines in a file, minus the leading MIT block comment when present. */
function codeLines(file) {
  let lines = readFileSync(file, 'utf8').split('\n')
  if (lines.at(-1) === '') lines = lines.slice(0, -1)
  if (lines[0]?.startsWith('/**')) {
    const end = lines.findIndex((line) => line.trim() === '*/')
    if (end !== -1) lines = lines.slice(end + 1)
    while (lines[0]?.trim() === '') lines = lines.slice(1)
  }
  return lines.length
}

function sum(files) {
  return files.reduce((total, file) => total + codeLines(file), 0)
}

const files = trackedFiles()
const rows = SCOPES.map(({ label, prefixes }) => {
  const scoped = files.filter((file) =>
    prefixes.some((prefix) => file.startsWith(prefix))
  )
  const source = scoped.filter(isSource)
  const tests = scoped.filter(isTest)
  return {
    label,
    sourceFiles: source.length,
    sourceLines: sum(source),
    testFiles: tests.length,
    testLines: sum(tests),
  }
})

const docs = files.filter(
  (file) =>
    /^docs\/.*\.md$/.test(file) && /resume-agent|career-agent/.test(file)
)
const forkCommits = Number(git('rev-list', '--count', 'upstream/main..main'))

console.log('| Scope | Source files | Source lines | Test files | Test lines |')
console.log('| --- | ---: | ---: | ---: | ---: |')
for (const row of rows) {
  console.log(
    `| ${row.label} | ${row.sourceFiles} | ${row.sourceLines} | ${row.testFiles} | ${row.testLines} |`
  )
}
console.log()
console.log(`Agent design docs: ${docs.length} files, ${sum(docs)} lines`)
console.log(`Commits on top of upstream/main: ${forkCommits}`)
console.log(
  "Lines exclude each file's MIT header. Test case counts: see `pnpm test`."
)
