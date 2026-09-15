# Resume Agent Backend Implementation Plan

## Product boundary

The backend MVP accepts a job description and one canonical YAMLResume source,
then returns a grounded, job-targeted YAMLResume plus analysis artifacts. It is
not an autonomous job-application bot and it does not crawl websites, send
applications, host a frontend, or persist personal data in a production
database.

## User inputs

### Required

- `jobDescription`: raw JD text.
- `candidate.yaml` or `candidate.resume`: exactly one canonical YAMLResume
  source.

### Optional preferences

- output language.
- target title override.
- LaTeX template.
- one-page or two-page target.

The canonical source requirement is deliberate: raw personal notes are too
ambiguous to use safely without a separate profile-ingestion and confirmation
workflow. That workflow is a future backend capability, not silently folded
into resume generation.

## User outputs

- structured `JobSpec`.
- requirement-to-evidence `MatchReport`.
- generated and validated YAMLResume.
- YAML, HTML, and LaTeX artifacts.
- deterministic source-to-draft diff.
- deterministic quality report.
- follow-up questions and warnings.
- trace events for every workflow stage.
- asynchronous run status for future Agent UI integration.

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

**Status:** implemented, then extended in Unit 7.

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

**Status:** next.

Deliverables:

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

### Unit 7 — Asynchronous run protocol

**Status:** planned.

Deliverables:

- `RunStore` port and `InMemoryRunStore` implementation;
- run state machine;
- `POST /v1/runs` and `GET /v1/runs/:id`;
- stage-driven status updates;
- request IDs and terminal error state;
- synchronous endpoint retained for development and tests.

Tests:

- state transitions;
- successful background run;
- failed background run;
- unknown run;
- API returns `202` then reaches a terminal state.

### Unit 8 — Backend documentation and completion audit

**Status:** planned.

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
- raw PDF/DOCX profile ingestion;
- resumable human-in-the-loop answers;
- automated web browsing or job application;
- PDF compilation sandbox and page-count optimization;
- real-model quality benchmarks requiring credentials.

These are deferred because the MVP must first establish a reliable and
measurable generation kernel. Their interfaces are preserved through the
provider, store, trace, and artifact boundaries.
