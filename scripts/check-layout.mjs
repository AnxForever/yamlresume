import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import process from 'node:process'

/**
 * Check the typeset output of resume YAML files for content that a template
 * typeset past the right margin.
 *
 * LaTeX reports these as `Overfull \hbox` warnings and then lays the text out
 * anyway, so nothing fails and the PDF looks finished — the line just runs
 * into the margin. On a resume that means a date or a URL can be sitting
 * outside the text block and nobody notices until it is printed or read on a
 * different machine.
 *
 * A resume template cannot wrap its way out of this: moderncv and jake both
 * set their heading rows in a `tabular*`, and a column's width is the widest
 * cell in it, so a long title and a long URL add up and the table grows past
 * `\maincolumnwidth`. The fix is to shorten the content, which is why this
 * reports rather than repairs.
 *
 * Usage:
 *   node scripts/check-layout.mjs <resume.yml> [more.yml ...]
 *
 * Exits 1 if any resume has an overfull box.
 */

const OVERFULL = /Overfull \\hbox \(([\d.]+)pt too wide\)(?: in (\w+) at lines (\d+)--(\d+))?/
const OUTPUT = /Output written on .*?\((\d+) pages?/

/** Locate the CLI the same way the rest of the repo invokes it. */
function findCli() {
  const candidates = [
    'packages/cli/dist/cli.js',
    'packages/cli/dist/index.js',
  ]
  for (const candidate of candidates) {
    const path = resolve(candidate)
    if (existsSync(path)) return path
  }
  return undefined
}

function build(cli, yamlPath) {
  const result = spawnSync(process.execPath, [cli, 'build', yamlPath], {
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
    throw new Error(`build failed for ${yamlPath}\n${output}`)
  }
}

/** One entry per overfull box, richest first so the worst offenders read first. */
function overfullBoxes(logText) {
  const boxes = []
  for (const line of logText.split('\n')) {
    const match = OVERFULL.exec(line)
    if (!match) continue
    boxes.push({
      points: Number.parseFloat(match[1]),
      kind: match[2],
      from: match[3] ? Number.parseInt(match[3], 10) : undefined,
      to: match[4] ? Number.parseInt(match[4], 10) : undefined,
    })
  }
  return boxes.sort((a, b) => b.points - a.points)
}

function pageCount(logText) {
  const match = OUTPUT.exec(logText)
  return match ? Number.parseInt(match[1], 10) : undefined
}

function check(cli, yamlPath) {
  build(cli, yamlPath)

  const logPath = join(
    dirname(yamlPath),
    `${basename(yamlPath, extname(yamlPath))}.log`
  )
  if (!existsSync(logPath)) {
    throw new Error(`no LaTeX log at ${logPath} — did the build run?`)
  }

  const logText = readFileSync(logPath, 'utf8')
  return {
    yamlPath,
    pages: pageCount(logText),
    bytes: existsSync(logPath.replace(/\.log$/, '.pdf'))
      ? statSync(logPath.replace(/\.log$/, '.pdf')).size
      : undefined,
    boxes: overfullBoxes(logText),
  }
}

function main() {
  const inputs = process.argv.slice(2)
  if (inputs.length === 0) {
    console.error('usage: node scripts/check-layout.mjs <resume.yml> [...]')
    process.exit(2)
  }

  const cli = findCli()
  if (!cli) {
    console.error(
      'CLI not built. Run `pnpm build` (or `pnpm cli build`) first.'
    )
    process.exit(2)
  }

  let failed = false
  for (const input of inputs) {
    const yamlPath = resolve(input)
    if (!existsSync(yamlPath)) {
      console.error(`✗ ${input}: no such file`)
      failed = true
      continue
    }

    let report
    try {
      report = check(cli, yamlPath)
    } catch (error) {
      console.error(`✗ ${input}: ${error.message}`)
      failed = true
      continue
    }

    const pages =
      report.pages === undefined ? '? pages' : `${report.pages} page(s)`
    if (report.boxes.length === 0) {
      console.log(`✓ ${basename(input)}  ${pages}  nothing outside the margin`)
      continue
    }

    failed = true
    const worst = report.boxes[0].points.toFixed(2)
    console.error(
      `✗ ${basename(input)}  ${pages}  ${report.boxes.length} overfull box(es), worst ${worst}pt`
    )
    for (const box of report.boxes) {
      const where = box.from === undefined ? '' : `  (source line ${box.from})`
      console.error(
        `    ${box.points.toFixed(2)}pt too wide${where}`
      )
    }
    console.error('    → shorten the widest cell in that row; see the header of this file.')
  }

  process.exit(failed ? 1 : 0)
}

main()
