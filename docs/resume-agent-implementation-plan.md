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

Candidate files can currently be normalized from declared text types, digital
PDF, DOCX, HTML, Markdown, YAML, JSON, and supported image formats. ODT, RTF,
and legacy DOC are planned but are not implemented; filename or caller-supplied
MIME alone must not be treated as trusted binary identification. The result is
marked for review. Asynchronous Runs can now pause after normalization for
important structured questions, accept validated answers, and resume from JD
analysis. This development loop is in-memory, so it must not be presented as
durable user confirmation across process restarts.

## User outputs

- structured `JobSpec`.
- requirement-to-evidence `MatchReport`.
- generated and validated YAMLResume.
- YAML, JSON, Markdown, HTML, LaTeX, PDF, and DOCX artifacts; TXT, RTF, and ODT
  are planned as separately researched exporters rather than aliases of an
  existing payload.
- deterministic source-to-draft diff.
- deterministic quality report.
- follow-up questions and warnings.
- trace events for every workflow stage.
- trace metadata for synchronous runs and stage-driven status for in-memory
  asynchronous runs, including `needs_input`; durable status and restart
  recovery remain planned.

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
- versioned atomic create and compare-and-set semantics for every stored state
  transition inside one adapter instance;
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
- in-memory checkpoints now support Unit 7B, but there is no durable queue,
  cancellation, retention policy, or restart recovery;
- these limits must be addressed before calling the protocol operational.

### Unit 7B — Structured human-in-the-loop interaction

**Status:** implemented for development with an in-memory checkpoint; not
durable or operational.

Delivered:

- typed interaction requests for choices, custom input, field-specific inputs,
  files, and confirmations;
- a stored `needs_input` state linked to a Run and in-memory workflow
  checkpoint;
- an answer endpoint with idempotency and validation;
- resume from the necessary stage without repeating unrelated model calls;
- audit-safe question and answer metadata without logging private source text.

Verified tests:

- missing required fact pauses with one focused question;
- suggested choices still allow custom input;
- field requests select the correct control and validation rules;
- confirmation, file-reference, choice, text, number, day-precision date, URL,
  and range values are validated by control type;
- repeated or stale answers are handled deterministically;
- invalid required answers leave the Run paused;
- priority ordering preserves stable interaction IDs and removes every answered
  question;
- resumed runs preserve prior artifacts and do not duplicate completed stages;
- HTTP answers return `202`, while invalid, unknown, stale and wrong-state
  requests use stable `400` / `404` / `409` errors.

Known limits:

- the in-memory adapter now makes answer receipt/checkpoint updates atomic
  within one process, but no durable adapter has proven the same contract;
- `date` and `date_range` intentionally accept only day-precision
  `YYYY-MM-DD`; year/month-aware controls remain to be designed;
- `file` validates references only; binary upload and re-normalization are not
  connected to the answer endpoint;
- deterministic conflict detection between uploaded files is not implemented;
  the protocol can carry a model-proposed confirmation, but that scenario is
  not yet an independently proven capability;
- only post-normalization interruption is implemented; later-stage approvals
  require their own Feature Brief and Eval.

### Unit 7C — Revision-safe Store and concurrent answer acceptance

**Status:** implemented for development in one process; not durable or
operational.

Delivered:

- an internal monotonic revision and separate atomic `create` / `compareAndSet`
  Store operations;
- a real synchronous check-and-set critical section in `InMemoryRunStore`, with
  clone isolation at every Store boundary;
- bounded CAS retries for safely recomputable workflow state transitions;
- no blind retry for answer intent: CAS losers re-read the winner and resolve
  to idempotent success, `idempotency_conflict`, or `answer_conflict`;
- full-record derivation so concurrent updates do not erase requests,
  checkpoints, receipts, or public state;
- no revision or trusted workflow state in public Run snapshots.

Verified tests:

- create collision, matching revision, stale revision, and clone isolation;
- concurrent identical answers produce one logical write and one completion
  schedule;
- same-key/different-value and different-command races accept one winner and
  return stable domain conflicts;
- conflict winners retain checkpoint, receipt, request, and public status;
- all earlier sequential pause, answer, resume, and completion tests continue
  to pass.

Known limits:

- records and queued tasks remain in memory and do not survive restart;
- CAS is scoped to one Store instance and does not coordinate processes;
- CAS success and completion-task scheduling are not one durable transaction;
- a future adapter must use a database conditional write, not a read followed
  by an unconditional update;
- multi-region last-writer-wins storage does not satisfy this contract.

Research, state transitions, RED → GREEN evidence, and reversal criteria are
recorded in
[`resume-agent-run-store-concurrency.zh-CN.md`](./resume-agent-run-store-concurrency.zh-CN.md).

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
- durable/restart-resumable Human-in-the-loop storage and transactional answer
  coordination;
- binary file answers and candidate re-normalization after upload;
- automated web browsing or job application;
- PDF compilation sandbox and page-count optimization;
- real-model quality benchmarks requiring credentials.

These are deferred because the MVP must first establish a reliable and
measurable generation kernel. Their interfaces are preserved through the
provider, store, trace, and artifact boundaries.
