# Resume Agent Backend

> 本文只描述 Career Agent 的首个能力模块：针对 JD 的简历定制后端。它不是顶层 Career Agent，也不负责学习计划、岗位情报、资料研究或公司评估；这些能力将通过独立模块接入未来的 Career Agent Runtime。

## Goal

Turn a job description and a source YAMLResume into a job-targeted resume that
is concise, schema-valid, renderable, and traceable to candidate evidence.

The project is also designed as a learning vehicle. Each milestone exposes a
real agent engineering concern instead of hiding the whole system behind one
large prompt. The Chinese
[`Career Agent engineering learning guide`](./career-agent-learning-guide.zh-CN.md)
maps those concerns to the current code, exercises, and planned stages.

## Architecture

### Direct conversation (development)

`POST /v1/chat` accepts a message, optional conversation history, and optional
text context. It does not require a resume or uploaded file. The response
contains the assistant reply and a `readyToGenerate` hint; generation still
uses the existing tailor/run contract until the conversational draft is
complete. Authentication and an LLM provider remain required when the API is
running in its default secure mode.

```text
POST /v1/tailor-resume or POST /v1/runs → GET /v1/runs/{id}
                              │
                              ▼
 Request, file extraction, candidate normalization
          │
          ├── important fact missing → needs_input
          │                              │
          │               POST /v1/runs/{id}/answers
          │                              │
          ◀──────── validated checkpoint ┘
          │
          ▼
 Candidate evidence index ─────────────┐
          │                            │
          ▼                            │
 Structured JD analysis                │
          │                            │
          ▼                            │
 Deterministic requirement matching ◀──┘
          │
          ▼
 Evidence-constrained draft generation
          │
          ▼
 Schema + immutable-fact validation
          │
          ▼
 YAML / HTML / LaTeX rendering
```

### Module boundaries

- `@yamlresume/core`: resume schema and rendering engine.
- `@yamlresume/resume-agent`: LLM-independent workflow and policies.
- `@yamlresume/resume-agent-api`: frontend-independent HTTP transport.
- `LlmClient`: port used to swap model providers and inject deterministic test
  doubles.

## Current design decisions

### Bounded workflow instead of a ReAct loop

The initial workflow has known stages and no unrestricted tool loop. This makes
cost, latency, failures, prompts, and validation easier to reason about. Tool
calling should only be introduced when a concrete capability needs it, such as
reading an uploaded portfolio or verifying a public project metric.

### Structured output at every LLM boundary

The LLM produces a `CandidateNormalizationResponse`, `JobSpec`, and
`DraftResponse`. All three pass through the same provider-neutral structured
output module: direct Zod validation, one-level known-envelope handling,
conservative domain normalization, and at most one Repair call by default.
The LLM never directly owns HTML, LaTeX, HTTP responses, or PDF compilation.

OpenAI-compatible providers do not all enforce the same structured-output
dialect. The bounded validation and repair design is documented in
[`resume-agent-structured-output-reliability.zh-CN.md`](./resume-agent-structured-output-reliability.zh-CN.md).
Parseable provider JSON is never treated as domain-valid without the
application Schema checks. Repair exhaustion raises a typed, data-safe error;
transport retries and Repair calls are counted separately.

### Evidence grounding

Candidate text is indexed with stable IDs such as:

```text
candidate.content.projects[0].summary
```

The draft response returns selected evidence IDs. Unknown evidence IDs are
rejected. Immutable facts such as identity, contact information, organization
names, project names, and dates are checked against the source resume.

### Provider isolation

The workflow depends on `LlmClient`, not on one SDK. The included adapter uses
an OpenAI-compatible chat-completions endpoint. Provider-specific retries,
structured-output modes, and token accounting can evolve inside adapters.

### Structured Human-in-the-loop

Candidate normalization can emit typed questions. Important or blocking
questions pause an asynchronous Run at `needs_input`; the public snapshot
exposes one focused `InteractionRequest`, while a trusted store record retains
the checkpoint and remaining interactions. A validated answer is applied only
to an existing `content.*` path, the resulting candidate is revalidated by
`ResumeSchema`, and execution resumes at JD analysis without repeating input
extraction or normalization.

This is a development proof, not production orchestration. The default adapter
uses an in-memory revision and atomic compare-and-set within one Node.js
process. An opt-in SQLite adapter persists the same versioned Store contract
across restarts, coordinates connections on one host, and transactionally
stores workflow tasks with Run mutations, but uses Node's active-development
synchronous SQLite API. It provides explicit bounded restart drain plus
generation-safe heartbeat and Run mutation fencing while a claimed callback is
executing, but not an automatic worker, claim-ahead lifecycle, authentication,
retention, or a binary file-answer loop. Completed public snapshots intentionally contain
the generated resume and artifacts for the user; revisions, source requests,
checkpoints, answer receipts, raw answers, and raw model completions remain
private. See the
[`concurrency`](./resume-agent-run-store-concurrency.zh-CN.md) and
[`durable Store`](./resume-agent-durable-run-store.zh-CN.md), and
[`transactional outbox`](./resume-agent-run-outbox-recovery.zh-CN.md),
[`worker concurrency`](./resume-agent-run-worker-concurrency.zh-CN.md), and
[`lease heartbeat`](./resume-agent-run-lease-heartbeat.zh-CN.md) briefs.

## Feature evidence ledger

| ID | Capability | Delivery | Evidence | Coverage | Historical gap | Next acceptance evidence |
| --- | --- | --- | --- | --- | --- | --- |
| RA-001 | Validate candidate and API input | Implemented | Unit and API tests | Partial | None | Fuzz malformed YAML and oversized bodies |
| RA-001B | Common resume/JD document ingestion | Partial implementation; trusted detection and ODT extraction enabled for development | Content signatures, fatal text decoding, bounded DOCX/ODT ZIP inspection, namespace-aware ODT extraction, stable API/Run errors and adversarial tests | Partial | Backfilled | RTF extractor, CFB/DOC isolation, broader corpus, fuzz and operational limits |
| RA-002 | Structured JD analysis | Implemented | Zod contract, compatibility and Repair workflow tests | Partial | Backfilled | Golden JD evaluation set with field-level accuracy |
| RA-003 | Candidate evidence index | Implemented | Stable source paths used by workflow test | Partial | Backfilled | Test every YAMLResume content section |
| RA-004 | Requirement matching | Implemented | Deterministic lexical matcher | Gap | Inherited-unassessed | Compare lexical, embedding, and LLM reranking on eval set |
| RA-005 | Evidence-constrained drafting | Implemented | Prompt policy, evidence-ID validation and Repair workflow test | Partial | Backfilled | Hallucination and omission evaluation suite |
| RA-006 | Immutable-fact guard | Implemented | Rejects unsupported entries in tests | Partial | None | Add date/contact mutation cases and translated-name policy |
| RA-007 | Multi-style YAML/JSON/Markdown/HTML/LaTeX/PDF/DOCX/TXT/RTF/ODT rendering | Implemented for development | Preset metadata, real renderer/DOCX, fake PDF compiler tests and TXT/RTF/ODT semantic/package/reader tests | Partial | Backfilled | Real PDF sandbox, page-count/visual checks and broader cross-reader compatibility |
| RA-007C | Common document export expansion | Implemented for development | Shared full-section document model, safe RTF escaping, deterministic ODT package, ODF 1.3 validation and LibreOffice 24.2.7.2 round-trips | Partial | None | Word/WPS/Google Docs, browser download, performance and visual matrix |
| RA-008 | HTTP API | Implemented | End-to-end HTTP tests | Partial | None | Authentication, rate limits, request IDs, cancellation |
| RA-009 | Asynchronous runs, persistence and resume versions | Implemented for development; durable adapter opt-in | In-memory default, SQLite Run/task persistence and explicit restart drain, stage state machine, `POST/GET /v1/runs` and package/API tests | Partial | None | Wire a production worker, cancellation, retention and operational recovery |
| RA-010 | Agent evaluation and operational observability | Implemented for development | Deterministic runner, public-JD-derived synthetic corpus, required-keyword gold assertions, safe repeated campaign aggregation, versioned blinded human-review contract and structured-output telemetry | Partial | Backfilled | Valid Provider credentials/configuration, authorized anonymized candidate set, token/cost statistics and real human pilot/calibration |
| RA-011 | Human-in-the-loop clarification | Implemented for development; durable adapter opt-in | Typed controls, `needs_input`, durable checkpoint/receipt/task transaction, answer endpoint and restart tests | Partial | None | Production worker, authentication, file-answer loop and later-stage interrupts |
| RA-012 | Structured-output validation and bounded repair | Implemented | Shared module, three-boundary workflow tests, safe API error test | Covered | Backfilled | Operational provider comparison is tracked by RA-010 |
| RA-015A | Revision-safe RunStore and atomic answer acceptance | Implemented for development | Atomic in-memory create/CAS, deterministic concurrent answer tests, clone and privacy tests; durable realization tracked by RA-015B/C | Covered for one process | Backfilled | Operational multi-instance evidence remains RA-015D |
| RA-015B | Durable versioned RunStore | Implemented for development; not operational | SQLite schema introduced at v1, disk reopen, SQL CAS across connections, safe failure and privacy tests; current adapter migrated to v2 | Covered for one host | None | Async production driver, encryption and retention |
| RA-015C | Transactional Run outbox and restart recovery | Implemented for development; explicit drain only | Run + task atomic transactions, v1→v2 migration, lease/ack/release, lost-hint restart and terminal replay tests | Partial | None | Heartbeat/fencing supplied by RA-015E; no automatic poller, DLQ/backoff or operational evidence |
| RA-015D | Multi-worker lease takeover and fault verification | Implemented for development; same-host only | Claim-generation fencing, same-Run serialization, crash takeover, bounded batch/attempts and privacy tests | Partial | Reopened-by-change | Long-task heartbeat/fencing supplied by RA-015E; no DLQ/redrive, automatic worker or multi-host evidence |
| RA-015E | Run task lease heartbeat and lost-lease write isolation | Implemented for development; same-host only | Exact-generation renewal, Store-side leased CAS, deferred Provider/fake-clock takeover, renewal failure, shutdown and timer cleanup tests | Partial | Reopened-by-change | At-least-once Provider calls; RA-015F claim-ahead/automatic worker, metrics and multi-host adapter remain |
| RA-016 | Authentication, Run ownership and Provider credential vault | Implemented for development; backend enabled by default with explicit keyring | OWASP/Node evidence, scrypt users, digest-only opaque sessions, persistent login throttling, AES-GCM Provider vault, durable Run ownership, cookie/CORS HTTP and adversarial/restart tests | Partial | Backfilled | Frontend login, verification/reset/MFA, KMS, distributed rate limits, audit operations and Provider adapter consumption |

### RA-001B-A1 evidence detail

| Field | Evidence |
| --- | --- |
| Parent / lifecycle | untrusted candidate/JD upload → type detection → parser selection or safe rejection |
| User outcome | Signed and container formats cannot silently masquerade as text or select the wrong parser; failures are stable and do not reveal document content |
| Current state | Existing text/PDF/DOCX/image paths use content-aware detection; DOCX/ODT ZIP packages are distinguished; RTF header and bounded visible-text extraction are enabled for development; legacy DOC remains planned |
| Primary evidence | OWASP File Upload Cheat Sheet, OASIS OpenDocument 1.3 Packages, PKWARE ZIP APPNOTE, Node.js 22 `TextDecoder`/`zlib`, reviewed 2026-09-16 |
| Independent evidence | Existing `docx@9.7.1` and ODT writer packages, real PDF/image fixtures, Mammoth behavior, adversarial ZIP mutations and LibreOffice 24.2.7.2 as a later compatibility oracle |
| Decision | Combine allowlisted auxiliary claims with content evidence; adopt a bounded internal ZIP index; reject MIME-only routing, unknown-binary text fallback, transitive JSZip and implicit LibreOffice runtime conversion |
| Edge cases | MIME/extension conflict, extensionless signed file, unknown binary, UTF-8/UTF-16, empty text, DOCX/ODT confusion, unknown ZIP, traversal, duplicate entry, encryption, ZIP64, entry/expanded limits, CRC/inflate corruption and private parser errors |
| Acceptance | 27 focused input tests, async Run and HTTP error tests, complete Agent/API suites, package type/build/Biome/license/diff gates; exact results live in `resume-agent-common-document-ingestion.zh-CN.md` |
| Coverage | Partial: application-side A1 detection and error delivery are covered; CFB/DOC, real heterogeneous corpus, fuzz, time/memory isolation and operational telemetry are absent |
| Historical gap | Backfilled; inherited routing trusted caller MIME and defaulted unknown extensions/binary to text |
| Remaining gap | RTF real-provider/Run-restart evidence, legacy DOC parser isolation, cross-OS fixtures and production abuse evidence; ODT is tracked below |
| Last reviewed | 2026-09-16, Node 22.21.1, Mammoth 1.12.3, `docx` 9.7.1 |

### RA-001B-B evidence detail

| Field | Evidence |
| --- | --- |
| Parent / lifecycle | trusted ODT package → manifest/XML validation → visible text → candidate/JD normalization |
| User outcome | Users can submit ODT resumes and job descriptions without leaking review metadata, hidden content, scripts or embedded objects into the model context |
| Current state | ODT and RTF are enabled for development through `extractArtifact`, synchronous HTTP, asynchronous Run/restart and advertised capabilities/OpenAPI; legacy DOC remains planned |
| Primary evidence | OASIS OpenDocument 1.3 Parts 2/3, OWASP XML Security Cheat Sheet, PKWARE APPNOTE and Node.js 22 `TextDecoder`/`zlib`, reviewed 2026-09-16 |
| Independent evidence | Repository ODT exporter plus three system ODTs; LibreOffice 24.2.7.2 direct/PDF conversions and the existing PDF extractor |
| Decision | Reuse the bounded ZIP module and keep one deep internal namespace-aware XML scanner; reject transitive parser dependencies and implicit LibreOffice runtime conversion |
| Edge cases | Prefix aliases, foreign root, malformed/fatal UTF-8, DTD/entity, depth/element/output limits, manifest mismatch/encryption, `mimetype` local extra, hidden/review/object content and nested frame text boxes |
| Acceptance | Public input tests plus candidate/JD, HTTP and Run/restart tests; four independent ODT samples extract 191/4443/4310/65 characters; exact package gates live in the focused Feature Brief |
| Coverage | Partial: application behavior and bounded hostile fixtures are covered; style-derived visibility, cross-OS/corpus/fuzz, worker isolation and production telemetry are absent |
| Historical gap | None; added as an independently researched and tested format slice |
| Remaining gap | RTF and legacy DOC are separate slices; ODT still needs broader readers/corpus, fuzz, performance and operational evidence |
| Last reviewed | 2026-09-16, Node 22.21.1, ODF 1.3 and LibreOffice 24.2.7.2 |

### RA-010C evidence detail

| Field | Evidence |
| --- | --- |
| Parent / lifecycle | public job source → derived case → Agent execution → repeated safe aggregate |
| User outcome | Prompt, model and runtime revisions can be compared on the same traceable job-derived development corpus without committing real candidate data |
| Current state | Three versioned public-JD-derived cases, synthetic candidates, required job-keyword assertions, strict campaign metadata, bounded sequential repetitions and a versioned blinded human-review record/safe aggregate contract are exported from the package |
| Primary evidence | OpenAI Evaluation best practices; Greenhouse Job Board API and three first-party job-board responses; van der Lee 2019, Howcroft 2020 and Mousavi 2022 human-evaluation research, reviewed 2026-09-16 |
| Independent evidence | Production Resume Schema, full Agent seam, provenance/corpus/keyword/campaign/human-review RED → GREEN tests and two safe Provider execution attempts |
| Decision | Combine paraphrased public-job requirements with synthetic candidates; add task-specific keyword gold assertions; keep hidden held-out and real-candidate datasets separate; adapt four independent anchored human-review dimensions while declining ordinal means and unpiloted chance-corrected agreement/CI |
| Edge cases | HTTP source URL, invalid/unstable source dates, real-person flag, duplicate case IDs/keywords, case-insensitive matching, secret-bearing config, unbounded repetitions, execution failure, duplicate human assignments/reviewer-items, extra sensitive fields, unassessable ratings and single-reviewer agreement |
| Acceptance | 55 focused evaluation tests, human-review module 100% coverage, TypeScript, package build, targeted Biome and safe real-run failure reports |
| Coverage | Partial: application contracts and public-source development corpus are covered; model quality and representative candidate distribution are not |
| Historical gap | Backfilled; earlier RA-010 relied on one fictional case and model-self-referential coverage without job-keyword gold assertions |
| Remaining gap | Default Node fetch needs an experimental env-proxy switch here; current OpenAI credentials return 401 and Gemini-compatible configuration returns 400; no scored repeated baseline, token/cost rollup, authorized anonymized candidate set, held-out set, assignment UI, authorized blind pilot, chance-corrected IAA/CI, adjudication, review persistence or judge calibration |
| Last reviewed | 2026-09-16; source revisions and exact runtime evidence are in `resume-agent-public-job-evaluation.zh-CN.md` |

### RA-012 evidence detail

| Field | Evidence |
| --- | --- |
| Parent / lifecycle | LLM output ingestion: validate → normalize → Repair → accept or fail |
| User outcome | Parseable but malformed model JSON cannot silently enter matching, drafting, or rendering |
| Current state | `completeStructuredOutput` is shared by candidate normalization, JD analysis, and draft generation; default Repair limit is 1 |
| Primary evidence | OpenAI Structured Outputs documentation, reviewed 2026-09-16 |
| Independent evidence | Instructor validation-feedback retry design plus local fake-provider experiments |
| Decision | Adapt the validation-feedback pattern to the existing `LlmClient`; decline a framework dependency and unbounded retry |
| Edge cases | Valid first response, known envelopes, safe aliases, unknown enum, missing required field, image preservation, Repair success/exhaustion, zero Repair, partial usage metadata |
| Acceptance | Structured-output module tests, three workflow boundary tests, API data-leak regression test, TypeScript and repository gates |
| Coverage | Covered for the application-side code lifecycle |
| Historical gap | Backfilled; inherited direct `safeParse` calls and JD-only fallback previously lacked shared Repair |
| Remaining gap | None in RA-012 scope; anonymized real-provider rates and aggregate dashboards belong to RA-010 |
| Last reviewed | 2026-09-16, Zod 4.3.6 and current `LlmClient` contract |

### RA-007B evidence detail

| Field | Evidence |
| --- | --- |
| Parent / lifecycle | Style selection → deterministic render → encode/package → partial delivery |
| User outcome | Every variant identifies its actual preset; successful artifacts are non-empty and verifiable; one format cannot leak or destroy the others |
| Current state | RA-007B’s seven baseline formats use stable first-seen order; text formats render inside their own failure scope; DOCX is a real OOXML package; PDF uses an injected compiler adapter; RA-007C adds TXT/RTF/ODT at the same seam |
| Primary evidence | RFC 9512, IANA media registry, Node.js 22 Buffer, PKWARE APPNOTE, Microsoft WordprocessingML, reviewed 2026-09-16 |
| Independent evidence | Current `@yamlresume/core` source/tests, `docx@9.7.1`, real local render/package tests and controlled failure experiments |
| Decision | Adapt the existing deep render module; use preset as metadata source; retain only the real PDF compiler seam; reject framework/dependency expansion |
| Edge cases | Duplicate formats, non-ASCII bytes, multiple styles, DOCX package signature, PDF default/override timeout, compiler leak, text-renderer leak, partial success, source immutability |
| Acceptance | 18 focused tests across rendering/styles/workflow; complete Resume Agent package suite; TypeScript, Biome and diff checks |
| Coverage | Covered for application-side contracts in RA-007B; RA-007 aggregate remains partial |
| Historical gap | Backfilled; inherited rendering lacked adjacent tests and previously returned incorrect public metadata/raw error messages |
| Remaining gap | RTF/legacy DOC ingestion remains RA-001B; ODT input is development-grade and still lacks broader corpus/fuzz evidence; real PDF sandbox/page count and cross-reader DOCX/style fidelity are unverified |
| Last reviewed | 2026-09-16, Node 22, `@yamlresume/core@0.12.2`, `docx@9.7.1` |

### RA-007C evidence detail

| Field | Evidence |
| --- | --- |
| Parent / lifecycle | Resume semantic content → TXT/RTF/ODT writer → artifact metadata/package → reader compatibility |
| User outcome | Users can copy a markup-free resume or download traditional/open editable documents without losing YAMLResume fields or allowing RTF/XML structure injection |
| Current state | `txt`/`rtf`/`odt` are accepted by schema, API capabilities and OpenAPI; all use the shared internal document model and only appear in authoritative `artifacts`; ODT uses a fixed five-entry deterministic ZIP32 package |
| Primary evidence | RFC 8118/IANA `application/rtf`, Microsoft RTF guidance, OASIS OpenDocument 1.3, PKWARE APPNOTE and Node.js 22 Buffer semantics, reviewed 2026-09-16 |
| Independent evidence | Full YAMLResume field inventory; LibreOffice Writer 24.2.7.2 RTF/ODT round-trips; UnRTF 0.21.10; ODF Toolkit Validator 0.13.0 and Info-ZIP checks |
| Decision | Adapt the existing deep render module; combine all three formats around one semantic model; use a bounded fixed-entry STORE-only ODT writer; reject Markdown stripping, transitive JSZip, external runtime conversion and new legacy result fields |
| Edge cases | CJK, emoji/surrogates, braces, backslashes, fake RTF controls, XML markup/control injection, attribute escaping, fixed ZIP paths/order/time, detailed address, all section fields, URL, duplicate format, locale/order, byte size, deterministic bytes and source immutability |
| Acceptance | 17 focused render tests, API/OpenAPI tests, ODF 1.3 schema validation, Info-ZIP CRC, LibreOffice TXT/PDF/FODT round-trip, package type/build/Biome gates; exact commands/results are in `resume-agent-common-document-export.zh-CN.md` |
| Coverage | Covered for TXT development contract; partial for RTF/ODT external compatibility because only LibreOffice plus limited independent readers/validators were exercised; aggregate RA-007C is implemented but not operational |
| Historical gap | None; feature was planned with a ledger before implementation |
| Remaining gap | Word/WPS/Google Docs matrix; real browser download, ATS paste, visual/accessibility and large-resume performance evidence |
| Last reviewed | 2026-09-16, LibreOffice Writer 24.2.7.2, UnRTF 0.21.10, ODF Toolkit Validator 0.13.0, Node 22 |

### RA-015A evidence detail

| Field | Evidence |
| --- | --- |
| Parent / lifecycle | Run creation and every stored state transition use create or revision compare-and-set |
| User outcome | Concurrent answers cannot silently overwrite each other or schedule completion twice |
| Current state | `InMemoryRunStore` atomically checks revision and increments it; answer CAS losers re-read the winner |
| Primary evidence | RFC 9110 conditional request and idempotency semantics, reviewed 2026-09-16 |
| Independent evidence | AWS DynamoDB optimistic locking and Builders' Library idempotent API guidance plus deterministic local contention tests |
| Decision | Adapt versioned conditional writes to the existing Store port; reject last-writer-wins and blind answer retries |
| Edge cases | Duplicate create, matching/stale revision, clone isolation, same-key same/different answer, different competing commands, retained checkpoint/receipt/request |
| Acceptance | Focused Run tests, complete agent package tests, TypeScript, Biome and diff checks |
| Coverage | Covered for one `InMemoryRunStore` instance in one process |
| Historical gap | Backfilled; inherited `get → save` paths had no concurrent-answer evidence |
| Remaining gap | No database, process restart, multi-instance coordination, transactional outbox or operational concurrency evidence |
| Last reviewed | 2026-09-16 |

### RA-015C evidence detail

| Field | Evidence |
| --- | --- |
| Parent / lifecycle | Durable Run mutation → enqueue → claim → execute → ack/release → restart recovery |
| User outcome | A committed start or final answer cannot become permanently stuck only because its in-memory schedule hint was lost |
| Current state | SQLite schema v2 stores Run mutation and task in one transaction; services explicitly drain ready or expired tasks with bounded leases |
| Primary evidence | AWS transactional outbox and SQS visibility-timeout guidance; SQLite transactions and `RETURNING`, reviewed 2026-09-16 |
| Independent evidence | Real local SQLite close/reopen, two-connection contention, lease-expiry and lost-ack experiments |
| Decision | Adapt transactional outbox and visibility lease to the existing RunStore seam; reject exactly-once and hidden background timers |
| Edge cases | v1 migration, duplicate create, stale CAS, task collision rollback, two claimers, owner-only ack/release, lost schedule hints, expired terminal replay |
| Acceptance | 20 focused SQLite tests, 18 Run tests, 149-test package suite, TypeScript, build, Biome and diff checks |
| Coverage | Partial: covered for explicit same-host development recovery; not for long-running leases or production operation |
| Historical gap | None; RA-015B explicitly recorded the dual-write gap before RA-015C |
| Remaining gap | Claim-generation fencing is supplied by RA-015D and heartbeat/Run-write fencing by RA-015E; no Provider effect fencing, automatic poller, DLQ/backoff, multi-host adapter, power-loss injection, metrics or runbook |
| Last reviewed | 2026-09-16, Node 22.21.1 `node:sqlite`, schema v2 |

### RA-015D evidence detail

| Field | Evidence |
| --- | --- |
| Parent / lifecycle | task claim → execution → ack/release → expiry takeover → attempt exhaustion |
| User outcome | A stale worker cannot confirm a newer claim, one Run is not advanced by two leased tasks, and a pre-execution crash is recoverable |
| Current state | ack/release match task, owner and attempt; claim excludes another active task for the same Run; delivery attempts are bounded |
| Primary evidence | AWS SQS visibility timeout, latest receipt-handle deletion and DLQ/maxReceiveCount guidance; SQLite `RETURNING`, reviewed 2026-09-16 |
| Independent evidence | Real local SQLite two-connection races, same-owner reclaim, closed-holder takeover and fake-clock experiments |
| Decision | Adapt receipt handles to the existing attempt column; serialize per Run; bound delivery attempts; reject exactly-once and DLQ claims |
| Edge cases | same/different owner stale generation, two tasks for one Run, crash before callback, exact expiry, batch limit, invalid worker config, paused stale task, poison task, privacy marker |
| Acceptance | Focused SQLite/Run tests plus package TypeScript, build, Biome and diff gates; exact final counts in the Feature Brief |
| Coverage | Partial: covered for same-host development contention and injected lifecycle failures, not long-running execution or operations |
| Historical gap | Reopened-by-change; RA-015C owner-only ack did not distinguish repeated claims by the same worker ID |
| Remaining gap | Heartbeat/leased Run CAS is supplied by RA-015E; no external side-effect fencing, automatic polling, DLQ/redrive, metrics, multi-host adapter or OS/power-loss test |

### RA-015E evidence detail

| Field | Evidence |
| --- | --- |
| Parent / lifecycle | durable task claim → callback start → renew → workflow mutation → ack/release → lease loss/shutdown |
| User outcome | A long task keeps its lease while healthy; after renewal failure or takeover, the stale worker cannot overwrite status, checkpoint, result or failure |
| Current state | SQLite renewal matches task/run/owner/attempt and unexpired lease; leased CAS atomically checks revision and current claim; task-local heartbeat serializes renewal and mutations |
| Primary evidence | AWS SQS visibility timeout, ChangeMessageVisibility and latest ReceiptHandle semantics; Node 22.21.1 timers; SQLite transactions/UPDATE/RETURNING, reviewed 2026-09-16 |
| Independent evidence | Real local SQLite connections, fake clock/timers, deferred fake Provider, forced renewal conflict/error, takeover, ack-loss and close tests |
| Decision | Adapt heartbeat to `max(oldExpiry, now + duration)`; reject expired revival, memory-only fencing and exactly-once; defer claim-ahead lifecycle to RA-015F |
| Edge cases | missing/wrong identity, exact expiry, same owner old attempt, revision conflict, storage uncertainty, Provider in flight, ack false, close during renewal, invalid timer bounds, privacy markers |
| Acceptance | Focused Store/service and Run tests plus package TypeScript, build, Biome and diff gates; exact final results live in the Feature Brief |
| Coverage | Partial: covered for one-host development lifecycle, not Provider exactly-once or production operation |
| Historical gap | Reopened-by-change; RA-015C/D explicitly documented fixed-lease and mutation-fencing gaps |
| Remaining gap | RA-015F worker polling/claim-ahead/backpressure, Provider cancellation/idempotency, DLQ/backoff, metrics, multi-host time/database and runbook |
| Last reviewed | 2026-09-16, Node 22.21.1 `node:sqlite`, schema v2 |

## Learning roadmap

### Milestone 1: Reliable single run

- Run the backend against several real JDs and one source resume.
- Save the exact inputs and expected assertions as an evaluation set.
- Measure schema success, unsupported-claim rate, requirement coverage, latency,
  and token usage.

This milestone demonstrates structured generation, grounding, validation, and
model-provider abstraction.

### Milestone 2: Human-in-the-loop runs

- Development slice delivered: stable Run IDs, `needs_input`, typed controls,
  safe answer application, idempotency receipts, revision-safe in-memory
  updates, and resume from JD analysis.
- Development proof delivered: versioned durable conditional writes,
  transactional task dispatch, and explicit restart recovery on one host.
- Claim-generation fencing, same-Run serialization and local failure injection
  are delivered by RA-015D; RA-015E adds generation-safe heartbeat and lost-lease
  Run-write isolation. Next, design RA-015F claim-ahead/automatic worker lifecycle
  and DLQ without overclaiming operational readiness.
- Extend interrupts only when a separately researched later-stage use case
  requires them.
- Keep showing source-to-draft diff and evidence links in completed results.

This milestone demonstrates state machines, resumable workflows, idempotency,
and approval boundaries.

### Milestone 3: Evaluation-driven quality

- Build 20–50 anonymized JD/resume pairs.
- Add deterministic checks and LLM-as-judge only where deterministic checks are
  insufficient.
- Compare prompts and models using the same dataset.
- Track regressions in CI.

This milestone is more valuable on a technical resume than simply claiming
"prompt engineering" because it shows measurable agent quality work.

### Milestone 4: Production concerns

- Request IDs and structured logs without personal data.
- Per-stage latency and token accounting.
- Retries for transient model failures, but not validation failures.
- Cancellation and timeouts.
- Authentication, rate limiting, encrypted storage, and deletion controls.
- Isolated PDF compilation with CPU, memory, and execution limits.

### Milestone 5: Frontend

Choose an open-source Agent UI after the run protocol stabilizes. The frontend
should visualize stages, questions, evidence, diffs, previews, and downloadable
artifacts; it should not contain core agent decisions.
