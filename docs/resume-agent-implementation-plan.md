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
- YAML, JSON, Markdown, HTML, LaTeX, PDF, DOCX, TXT, RTF, and ODT artifacts;
  the latter three are separately researched exporters rather than aliases of
  an existing payload and remain development-grade rather than operational.
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

**Status:** implemented for development; in-memory remains the default, while
same-host durable persistence is opt-in. Cancellation remains planned.

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
- the opt-in SQLite adapter persists checkpoints and task rows and supports
  explicit restart drain plus execution-time heartbeat/fencing, but there is
  no automatic worker, claim-ahead lifecycle, cancellation or retention policy;
- these limits must be addressed before calling the protocol operational.

### Unit 7B — Structured human-in-the-loop interaction

**Status:** implemented for development; in-memory is the default, with an
opt-in same-host durable checkpoint/outbox path. It is not operational.

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

- the in-memory adapter makes answer receipt/checkpoint updates atomic within
  one process; the SQLite adapter proves the durable transaction and explicit
  restart path on one host, but not a production worker lifecycle;
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

- the default in-memory adapter still loses records and queued work on restart;
- durable cross-process CAS and transactional task dispatch require opting into
  the SQLite adapter delivered by Units 7D/7E;
- a future adapter must use a database conditional write, not a read followed
  by an unconditional update;
- multi-region last-writer-wins storage does not satisfy this contract.

Research, state transitions, RED → GREEN evidence, and reversal criteria are
recorded in
[`resume-agent-run-store-concurrency.zh-CN.md`](./resume-agent-run-store-concurrency.zh-CN.md).

### Unit 7D — Durable versioned RunStore adapter

**Status:** implemented for development on one host; not operational.

Delivered:

- an opt-in SQLite schema v1 adapter using the existing `RunStore` contract;
- disk persistence across close/reopen and service reconstruction;
- atomic `INSERT ... ON CONFLICT DO NOTHING` creation and
  `UPDATE ... WHERE revision = ?` compare-and-set;
- WAL, `synchronous=FULL`, bounded lock wait, prepared statements and explicit
  idempotent connection close;
- safe configuration/storage/corruption errors without record bodies, raw
  SQLite errors or database paths;
- fail-closed handling for unsupported schema versions and corrupt records.

Verified tests:

- reopen persistence and public snapshot privacy;
- matching, stale and missing revision behavior;
- one winner across two connections to the same file;
- create/CAS/get isolation;
- close, configuration, serialization, corrupt-record and future-schema
  failures; all temporary files and connections are cleaned up.

Known limits:

- Node 22 reports `node:sqlite` as Stability 1.1 (active development), and its
  synchronous API can block the event loop;
- WAL coordinates connections on one host, not deployments on different hosts
  or network filesystems;
- persisted private inputs are not encrypted by this adapter;
- the RA-015B historical adapter had separate state CAS and scheduling; current
  schema v2 adds Unit 7E transactional task rows and Unit 7G heartbeat/fencing,
  while automatic polling and production operation remain out of scope.

The research, schema, error model and evidence ledger are recorded in
[`resume-agent-durable-run-store.zh-CN.md`](./resume-agent-durable-run-store.zh-CN.md).

### Unit 7E — Transactional outbox and explicit restart recovery

**Status:** implemented for development on one host; explicit drain only, not
enabled or operational.

Delivered:

- schema v2 with a durable task table and v1→v2 migration that preserves Runs;
- `createWithTask` and `compareAndSetWithTask` transactions, so Run mutation
  and prepare/completion enqueue commit or roll back together;
- atomic oldest-ready claim with a bounded lease and attempt counter;
- owner + claim-attempt ack/release plus lease-expiry takeover;
- schedule hints for the normal path and bounded `recoverPendingTasks()` for an
  explicit startup/recovery lifecycle;
- at-least-once replay rules for terminal Runs and Runs that already have a
  checkpoint, without an exactly-once claim.

Verified tests:

- task-insert collision rolls back the corresponding Run mutation;
- two connections have one claim winner, and stale owners/generations cannot
  ack/release a task after takeover;
- lost start and final-answer schedule hints recover after close/reopen;
- two services racing to drain execute the current lease once;
- a lost acknowledgement causes terminal replay without a second model call;
- prior in-memory Run and durable Store behavior remains green.

Known limits:

- Unit 7G subsequently supplies heartbeat, lease extension and Store-side Run
  mutation fencing; there is still no automatic poller, DLQ/redrive, retry
  backoff or jitter;
- Provider calls remain at-least-once even with Unit 7G because an already sent
  external request cannot join the SQLite transaction;
- `recoverPendingTasks(limit)` claims before scheduled execution, so queued
  callbacks consume lease time;
- SQLite remains a synchronous, same-host development adapter; no multi-host
  or production operational evidence exists.

The research, state machine, RED → GREEN record and evidence ledger are in
[`resume-agent-run-outbox-recovery.zh-CN.md`](./resume-agent-run-outbox-recovery.zh-CN.md).

### Unit 7F — Multi-worker lease fencing and fault verification

**Status:** implemented for development on one host; not enabled or
operational.

Delivered:

- claim `attempt` as a receipt generation; ack/release require task ID, owner
  and current generation;
- at most one unexpired leased task per Run, while different Runs remain
  independently claimable;
- configurable bounded delivery attempts (default 3 executions), with a safe
  terminal Run failure on the next active claim;
- stale exhausted tasks for `needs_input`, completed or failed Runs are acked
  without public-state regression;
- bounded explicit recovery and stable worker/lease/attempt configuration
  validation.

Verified tests:

- same owner and different owner stale claims cannot alter a newer lease;
- two tasks for one Run serialize across two SQLite connections;
- a holder that closes after claim but before callback is taken over at exact
  fake-clock expiry by a second service;
- a recovery limit of two leaves the next different-Run task ready;
- invalid configuration fails before claim;
- task rows, public snapshots and errors exclude private markers;
- poison tasks stop without a model call, while stale paused tasks remain
  `needs_input`.

Known limits:

- fencing protects task acknowledgement, not an already-running Provider call
  or other external side effect;
- Unit 7G subsequently prevents a healthy long call from passively expiring and
  rejects stale Run writes, but cannot make Provider calls exactly-once;
- exhausted tasks are acknowledged after a safe Run failure; there is no
  inspectable DLQ, redrive workflow, backoff or operator alert;
- SQLite and injected fake-clock evidence remain same-host development proof,
  not multi-host or production operation.

Research, failure semantics, RED → GREEN evidence and reversal criteria are in
[`resume-agent-run-worker-concurrency.zh-CN.md`](./resume-agent-run-worker-concurrency.zh-CN.md).

### Unit 7G — Lease heartbeat and lost-lease Run mutation fencing

**Status:** implemented for development on one host; not enabled or
operational.

Delivered:

- generation-safe `renewTaskLease` matching task ID, Run ID, owner, attempt and
  a strictly unexpired lease;
- non-shortening expiry `max(oldExpiry, now + leaseDuration)` under the explicit
  same-host wall-clock assumption;
- `compareAndSetForTask` with atomic revision + current-claim predicates and
  stable `updated` / `revision_conflict` / `lease_lost` outcomes;
- task-local, non-overlapping heartbeat with an immediate execution-start
  renewal, default interval `lease / 3`, `clearInterval()` and `unref()`;
- all durable worker status, checkpoint, pause, result and failure mutations
  routed through leased CAS, while user answer CAS remains unchanged;
- async service `close()` that clears active timers, waits/isolates in-flight
  renewal and prevents later Provider results from mutating Runs.

Verified tests:

- current renewal advances expiry; wrong/missing/stale/expired identities fail,
  including exact-expiry and post-takeover cases;
- a deferred fake Provider crosses multiple original lease periods while a
  second SQLite connection remains unable to claim;
- renewal false or raw storage error becomes lease lost without status/result/
  error writes or stale ack/release;
- revision conflicts retain bounded recompute semantics;
- success, Provider error, lease loss, ack false, shutdown and in-flight renewal
  all clear fake timers; tests close every SQLite connection and temp directory;
- invalid lease/heartbeat bounds and injected private markers fail safely.

Known limits:

- Provider requests already sent may complete or repeat; delivery remains
  at-least-once and no exactly-once claim is made;
- `recoverPendingTasks(limit)` still claims a batch before schedule callbacks
  execute. The callback-start renewal prevents a stale callback from entering
  Provider work, but does not fix early lease consumption, fairness or
  backpressure; that lifecycle is RA-015F;
- no automatic poller, DLQ/redrive, backoff/jitter, production metrics/runbook,
  multi-host adapter or clock-skew tolerance;
- `node:sqlite` remains synchronous, same-host and Stability 1.1.

Research, interface/state decisions, RED → GREEN evidence and exact verification
results are in
[`resume-agent-run-lease-heartbeat.zh-CN.md`](./resume-agent-run-lease-heartbeat.zh-CN.md).

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
- RA-015F automatic durable worker/claim-ahead lifecycle, cancellation and
  operational restart recovery; Provider exactly-once remains explicitly
  rejected rather than deferred as a heartbeat outcome;
- binary file answers and candidate re-normalization after upload;
- automated web browsing or job application;
- PDF compilation sandbox and page-count optimization;
- real-model quality benchmarks requiring credentials.

These are deferred because the MVP must first establish a reliable and
measurable generation kernel. Their interfaces are preserved through the
provider, store, trace, and artifact boundaries.
