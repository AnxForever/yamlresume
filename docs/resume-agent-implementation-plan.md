# Resume Agent Backend Implementation Plan

## Product boundary

The backend MVP accepts a job description plus either a canonical YAMLResume
source or candidate files, then returns a grounded, job-targeted YAMLResume
plus analysis artifacts. It is not an autonomous job-application bot and it
does not crawl websites, send applications, host a frontend, or persist
personal data in a production database.

## User inputs

### Required

- `jobDescription` and/or `jobFiles`: raw JD text or supported files.
- one candidate representation: `candidate.yaml`, `candidate.resume`, or one
  or more `candidate.files`.

### Optional preferences

- output language.
- target title override.
- LaTeX template.
- one-page or two-page target.
- output formats and style presets.

Candidate files can currently be normalized from text, structured documents,
digital PDF, DOCX, HTML, Markdown, and supported image formats. The result is
marked for review and can contain follow-up questions, but a resumable
confirmation workflow is still planned; normalization must not be presented as
user-confirmed truth.

## User outputs

- structured `JobSpec`.
- requirement-to-evidence `MatchReport`.
- generated and validated YAMLResume.
- YAML, JSON, Markdown, HTML, LaTeX, PDF, and DOCX artifacts.
- deterministic source-to-draft diff.
- deterministic quality report.
- follow-up questions and warnings.
- trace events for every workflow stage.
- trace metadata for synchronous runs and stage-driven status for in-memory
  asynchronous runs; durable status and checkpoint recovery remain planned.

## Execution plan

### Unit 1 — Contracts and validation

**Status:** implemented.

Acceptance criteria:

- exactly one candidate representation is accepted;
- invalid YAMLResume input is rejected before an LLM call;
- model outputs are validated with Zod and `ResumeSchema`;
- source identity, contact, entry identities, and dates cannot be fabricated.

Tests:

- malformed candidate;
- ambiguous candidate input;
- unsupported generated entry.

### Unit 2 — Evidence grounding and requirement matching

**Status:** implemented, then hardened in Unit 5.

Acceptance criteria:

- every candidate string has a stable evidence ID;
- unknown model-supplied evidence IDs are rejected;
- each JD requirement has a matched, partial, or missing status;
- matching behavior is deterministic and independently testable.

Tests:

- evidence paths across nested content;
- direct keyword matches;
- missing requirements;
- duplicate evidence removal.

### Unit 3 — Bounded agent workflow

**Status:** implemented.

Acceptance criteria:

- JD analysis and resume drafting are separate LLM boundaries;
- the workflow never asks the LLM to render HTML or LaTeX;
- each stage emits started/completed/failed trace events;
- generated output renders through `@yamlresume/core`.

Tests:

- complete fake-LLM workflow;
- invalid job analysis;
- invalid evidence reference;
- immutable-fact rejection.

### Unit 4 — HTTP API

**Status:** implemented.

Acceptance criteria:

- health endpoint;
- synchronous tailoring endpoint;
- bounded request body;
- runtime request validation;
- structured HTTP errors;
- model credentials remain server-side.

Tests:

- successful end-to-end HTTP request;
- malformed request;
- body size limit;
- validation and provider error mapping.

### Unit 5 — Deterministic transparency artifacts

**Status:** implemented.

Delivered:

- source-to-draft `ResumeDiff`;
- deterministic `QualityReport` with must-have coverage, keyword coverage,
  missing requirements, and warnings;
- result contract extensions.

Tests:

- changed summary;
- omitted project;
- reordered project;
- keyword and must-have coverage calculations.

### Unit 6A — Provider transport reliability

**Status:** implemented; timeout and invalid-JSON regression coverage remains to
be added during provider-adapter hardening.

Delivered:

- completion metadata including model, tokens, latency, and transport attempts;
- retries only for retryable HTTP/network failures;
- bounded timeout and invalid-JSON errors;
- tests for usage extraction, retryable 5xx and non-retryable 4xx.

### Unit 6B — Structured-output validation and Repair

**Status:** implemented.

Delivered:

- one reusable `completeStructuredOutput` module for candidate normalization,
  JD analysis, and resume drafting;
- direct Zod validation before one-level envelope handling and conservative
  JobSpec normalization;
- validation-feedback Repair with a default hard limit of one call and a
  configurable maximum of two;
- typed `StructuredOutputValidationError` containing only safe issue summaries
  and aggregate telemetry;
- separate model-call, Repair, transport-attempt, duration, and token counts in
  successful trace metadata;
- `502 structured_output_validation_failed` API semantics and OpenAPI coverage.

Tests:

- valid first response and `data` / `result` / `output` wrappers;
- snake-case fields, string requirement arrays and known enum aliases;
- unknown enums enter Repair instead of receiving a silent fallback;
- Repair success, zero-Repair mode, strict exhaustion at one or two attempts;
- CandidateNormalizationResponse, JobSpec and DraftResponse workflow paths;
- token/latency/attempt aggregation and error/trace/API response redaction.

### Unit 7A — Asynchronous run protocol

**Status:** implemented for development with an in-memory adapter; durable
persistence and cancellation remain planned.

Delivered:

- `RunStore` port, `InMemoryRunStore` adapter, and public run snapshots that do
  not expose source requests or raw errors;
- explicit queued, stage-driven, completed, and failed state transitions;
- `POST /v1/runs` and `GET /v1/runs/{id}`;
- request IDs and a data-safe terminal error state;
- synchronous endpoint retained for development and tests.

Verified tests:

- state transitions;
- successful background run;
- failed background run;
- unknown run;
- API returns `202` then reaches a terminal state.

Known limits:

- in-memory runs do not survive restarts and are not shared across instances;
- there is no cancellation, durable queue, retention policy, or checkpoint yet;
- these limits must be addressed before calling the protocol operational.

### Unit 7B — Structured human-in-the-loop interaction

**Status:** planned.

Deliverables:

- typed interaction requests for choices, custom input, field-specific inputs,
  files, and confirmations;
- a persisted `needs_input` state linked to a run and workflow checkpoint;
- an answer endpoint with idempotency and validation;
- resume from the necessary stage without repeating unrelated model calls;
- audit-safe question and answer metadata without logging private source text.

Tests:

- missing required fact pauses with one focused question;
- suggested choices still allow custom input;
- field requests select the correct control and validation rules;
- conflicting files require confirmation;
- repeated or stale answers are handled deterministically;
- resumed runs preserve prior artifacts and do not duplicate completed stages.

### Unit 8 — Backend documentation and completion audit

**Status:** in progress; core design and API documents exist, while the final
completion audit, runbook, and evaluation guide remain planned.

Deliverables:

- final architecture document;
- input/output examples;
- sequence and state diagrams;
- design rationale and trade-offs;
- local runbook;
- testing and evaluation strategy;
- explicit production gaps.

Verification gates:

```bash
pnpm test
pnpm build
pnpm check:ci
```

## Explicitly deferred

- frontend and open-source Agent UI selection;
- authentication and multi-user tenancy;
- production database and encrypted object storage;
- production-grade OCR for image-only PDFs;
- resumable human-in-the-loop answers;
- automated web browsing or job application;
- PDF compilation sandbox and page-count optimization;
- real-model quality benchmarks requiring credentials.

These are deferred because the MVP must first establish a reliable and
measurable generation kernel. Their interfaces are preserved through the
provider, store, trace, and artifact boundaries.
