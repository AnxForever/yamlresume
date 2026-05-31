# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

YAMLResume — "Resume as Code in YAML". Author resumes in YAML and compile them to
pixel-perfect PDFs (via LaTeX) plus Markdown/HTML. See also `AGENTS.md` for code-style
conventions; this file focuses on architecture.

## Commands

`pnpm` is required (workspace uses `pnpm@10`). Root package exposes per-package
filter aliases: `core`, `cli`, `json2yamlresume`, `create-yamlresume`, `playground`, `web`.

- **Build all:** `pnpm build` (each package builds with `tsup`)
- **Build one package:** `pnpm core build` (swap `core` for any alias)
- **Test all:** `pnpm test`
- **Test one package:** `pnpm core test`
- **Single test file:** `pnpm core test src/utils/date.test.ts`
- **Single test by name:** `pnpm core test -t 'description substring'`
- **Coverage / watch:** `pnpm core test:cov` / `pnpm core test:watch`
- **Lint + format + typecheck + license headers (writes):** `pnpm check`
- **CI variant (no writes):** `pnpm check:ci`
- **Typecheck only:** `pnpm check:tsc` · **Biome only:** `pnpm check:biome`
- **Add MIT header to new files:** `pnpm license:add` (every `.ts` file MUST have it)
- **Release (version bump + changelog):** `pnpm release`

Run `pnpm check` before proposing changes — `husky` + `lint-staged` run it on staged `.ts`.

## Monorepo layout (`packages/*`)

- **`@yamlresume/core`** — the engine. Pure library, no I/O side effects. Everything below lives here.
- **`yamlresume` (cli)** — Commander-based CLI. Owns all filesystem + LaTeX process execution.
- **`json2yamlresume`** — converts [JSON Resume](https://jsonresume.org/) → YAMLResume format.
- **`create-yamlresume`** — `npx create-yamlresume` project scaffolder.
- **`@yamlresume/playground`** — React component powering the web playground/editor.
- **`@yamlresume/web`** — Next.js 15 browser editor + `/api/compile` route (private, newer addition).

## Core architecture (`packages/core/src`)

The pipeline transforms a YAML resume into rendered output:

```
YAML/JSON ──parse──▶ Resume object ──validate (Zod)──▶ preprocess ──▶ renderer ──▶ .tex / .md / .html
                                                                          │
                                                          (CLI) compileLaTeX ──▶ .pdf
```

- **`schema/`** — Zod schemas (`ResumeSchema`) + `schema.json`. The source of truth for what a
  valid resume looks like (`content/`, `layouts/`, `locale/`). Validation produces positional
  (line/column) errors that the CLI renders clang-style.
- **`models/`** — TypeScript types for the `Resume` object and its sections (`types/`).
- **`compiler/`** — turns rich-text fields (e.g. `summary`, written in Markdown) into an AST and
  back out: `parser/` (`MarkdownParser` → `Node` AST) + `codegen/` (`LatexCodeGenerator`,
  `HtmlCodeGenerator`). This is how inline formatting survives into LaTeX/HTML.
- **`renderer/`** — turns a whole `Resume` into a document string. **`getResumeRenderer(resume, layoutIndex)`**
  (in `renderer/resume.ts`) is the central dispatcher. It selects a renderer by the layout's
  `engine` + `template`:
  - `latex` → `JakeRenderer` | `ModerncvBankingRenderer` (default) | `ModerncvClassicRenderer` | `ModerncvCasualRenderer`
  - `markdown` → `MarkdownRenderer`
  - `html` → `HtmlRenderer`
- **`preprocess/`, `translations/`, `utils/`, `errors/`** — supporting layers. `errors/` defines
  `YAMLResumeError` (carries an error code + `errno` used as the CLI process exit code).

### Multi-layout output

A resume's `layouts` array can list several layouts, each with its own `engine` (`latex`/`markdown`/`html`)
and, for LaTeX, a `template`. `buildResume` (CLI) iterates every layout and emits one file per layout.
When an engine has >1 layout the filenames are indexed (`resume.0.tex`, `resume.1.tex`); otherwise plain
(`resume.tex`). Falls back to `DEFAULT_RESUME_LAYOUTS` when none specified.

## CLI specifics (`packages/cli/src`)

- Commands are assembled in `program.ts`; each `commands/*.ts` exports a `create<Name>Command()`.
  Commands: `new`, `build`, `generate`, `dev` (watch mode), `doctor`, `languages`, `templates`, `validate`.
- **LaTeX engine detection** (`build.ts`): prefers `xelatex`, falls back to `tectonic`, throws
  `LATEX_NOT_FOUND` if neither is on PATH. Compilation shells out via `execa` with a default
  30s timeout (`--timeout`/`-t` flag, `0` disables).
- The core library never touches the filesystem or spawns processes — that boundary lives in the CLI
  (and in `web`'s `/api/compile` route). Keep it that way.

## Conventions that bite if missed

- **License header:** every `.ts` source file must begin with the MIT block. New files won't pass
  `pnpm check:ci` until you run `pnpm license:add`.
- **Formatting (Biome, `biome.json`):** single quotes, no semicolons, 2-space indent, 80-col width,
  `es5` trailing commas, double quotes in JSX. Don't hand-fight it — run `pnpm check`.
- **Imports:** use the `@/` alias for intra-package imports (e.g. `import { Resume } from '@/models'`).
- **TS config (`tsconfig.base.json`):** full `strict` is intentionally OFF (commented), but
  `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, `noUncheckedIndexedAccess`, and
  `noFallthroughCasesInSwitch` are ON. Avoid `any`; prefer `unknown`.
- **Errors:** for expected failures prefer returning `null`/error objects over throwing; when throwing
  in core, use the classes in `packages/core/src/errors`.
- **Tests:** Vitest, colocated as `name.test.ts` next to source; the project aims for ~100% coverage.
- **Commits:** Conventional Commits enforced by `commitlint`. Don't commit directly to `main` untested.
