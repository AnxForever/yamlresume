# Agent Guidelines for yamlresume

This document provides instructions for agentic coding agents (like GitHub
Copilot, Cursor, or OpenCode) to maintain consistency and quality across the
`yamlresume` repository.

## 🛠 Commands

Use `pnpm` for all operations.

- **Build all:** `pnpm build`
- **Build specific package:** `pnpm core build` (or `json2yamlresume`, `cli`,
  `create-yamlresume`)
- **Lint & Format (Biome):** `pnpm check` (runs `biome check --write` and
  `tsc --noEmit`)
- **Test all:** `pnpm test`
- **Test with coverage for a package:** `pnpm core test:cov` (or
  `json2yamlresume`, `cli`, `create-yamlresume`)
- **Run a single test file for a package:**
  `pnpm core test path/to/file.test.ts` (or `json2yamlresume`, `cli`,
  `create-yamlresume`)
- **Watch mode for a package:** `pnpm core test:watch` (or `json2yamlresume`,
  `cli`, `create-yamlresume`)

## 🎨 Code Style

### Formatting & Linting

- We use **Biome** for formatting and linting. Configuration is in `biome.json`.
- **Indentation:** 2 spaces.
- **Quotes:** Single quotes for strings, double quotes for JSX.
- **Semicolons:** Omitted unless necessary (as per Biome config).
- **Imports:** Use `@/` alias for internal package imports (e.g.,
  `import { ... } from '@/models'`).

### Naming Conventions

- **Files:** `kebab-case.ts`. Test files should be `name.test.ts`.
- **Classes/Interfaces/Types:** `PascalCase`.
- **Functions/Variables:** `camelCase`.
- **Constants:** `UPPER_SNAKE_CASE`.

### TypeScript Usage

- **Strict Typing:** Avoid `any` whenever possible. Use `unknown` if the type is
  truly unknown.
- **Named Exports:** Prefer named exports over default exports for better
  tree-shaking and IDE support.
- **Interfaces vs Types:** Use `interface` for object shapes that might be
  extended, and `type` for unions, intersections, or primitives.
- **Explicit Returns:** Annotate return types for public functions to improve
  readability and catch errors early.

### Error Handling

- Use `try...catch` blocks for operations that can fail (e.g., date parsing,
  file I/O).
- Prefer returning `null` or a specific error object instead of throwing
  exceptions for expected failure cases.
- Use the custom error classes in `packages/core/src/errors` if throwing is
  necessary.

### Licensing

- **Every** source file (`.ts`) must start with the MIT license header:
  ```typescript
  /**
   * MIT License
   *
   * Copyright (c) 2023–Present PPResume (https://ppresume.com)
   * ...
   */
  ```
- Use `pnpm license:add` to automatically prepend the header to new files.

## 🧪 Testing Guidelines

- Use **Vitest** for testing.
- Test files must be colocated with the source code (e.g., `src/utils/date.ts`
  -> `src/utils/date.test.ts`).
- Aim for 100% coverage for all packages.
- Use descriptive `describe` and `it`/`test` blocks.

## 📚 Agent Development Learning Record

This repository is also a learning project for understanding how production
agents are researched, designed, implemented, evaluated, and improved. Treat
the learning record as part of each material Agent feature, not as optional
cleanup after the code is finished.

- Follow the sequence: research -> feature brief -> contracts and state
  transitions -> one-behavior-at-a-time TDD -> full verification -> status
  update.
- Before implementation, add or update the feature's evidence-ledger entry and
  record the user outcome, current evidence, important edge cases, acceptance
  evidence, and remaining gaps.
- Record durable design knowledge: why the chosen approach fits, alternatives
  considered, tradeoffs, framework-independent concepts, security/privacy
  boundaries, failure and recovery behavior, and what evidence could reverse
  the decision.
- Record the implementation journey at a useful teaching level: the public
  interface and state model, each meaningful RED -> GREEN behavior, important
  defects and root causes, refactors that changed the design, and the exact
  commands and results used for verification.
- Keep documentation honest and synchronized with the code. Clearly distinguish
  `Idea`, `Planned`, `Implemented`, `Enabled`, and `Operational`; never describe
  an in-memory prototype or fake-model test as production-ready.
- Prefer focused feature documents under `docs/` and link them from the relevant
  roadmap, architecture, or learning guide. Update existing documents instead
  of creating duplicate narratives.
- Write for a future learner who should be able to reconstruct the development
  process and repeat the experiment without relying on chat history.
- Do not store hidden chain-of-thought, credentials, personal resume data, raw
  model completions, or transient debug dumps. Preserve concise decisions,
  observable evidence, sanitized examples, and reproducible results instead.

## 🚀 Deployment

- Do not commit to `main` directly without testing.
- Ensure `pnpm check` passes before proposing changes.
