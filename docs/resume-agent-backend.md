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

This is a development proof, not durable orchestration. The default adapter is
in-memory and has no transactional compare-and-set, restart recovery,
multi-instance coordination, authentication, retention, or binary file-answer
loop. Completed public snapshots intentionally contain the generated resume
and artifacts for the user; source requests, checkpoints, raw answers, and raw
model completions remain private.

## Feature evidence ledger

| ID | Capability | Delivery | Evidence | Coverage | Historical gap | Next acceptance evidence |
| --- | --- | --- | --- | --- | --- | --- |
| RA-001 | Validate candidate and API input | Implemented | Unit and API tests | Partial | None | Fuzz malformed YAML and oversized bodies |
| RA-002 | Structured JD analysis | Implemented | Zod contract, compatibility and Repair workflow tests | Partial | Backfilled | Golden JD evaluation set with field-level accuracy |
| RA-003 | Candidate evidence index | Implemented | Stable source paths used by workflow test | Partial | Backfilled | Test every YAMLResume content section |
| RA-004 | Requirement matching | Implemented | Deterministic lexical matcher | Gap | Inherited-unassessed | Compare lexical, embedding, and LLM reranking on eval set |
| RA-005 | Evidence-constrained drafting | Implemented | Prompt policy, evidence-ID validation and Repair workflow test | Partial | Backfilled | Hallucination and omission evaluation suite |
| RA-006 | Immutable-fact guard | Implemented | Rejects unsupported entries in tests | Partial | None | Add date/contact mutation cases and translated-name policy |
| RA-007 | YAML/HTML/LaTeX rendering | Implemented | Uses `@yamlresume/core`; package tests | Partial | None | Add PDF compilation and page-count checks |
| RA-008 | HTTP API | Implemented | End-to-end HTTP tests | Partial | None | Authentication, rate limits, request IDs, cancellation |
| RA-009 | Asynchronous runs, persistence and resume versions | Implemented for development; not durable | In-memory `RunStore`, stage state machine, `POST/GET /v1/runs` and package/API tests | Partial | None | Add durable checkpoint storage, cancellation, retention and restart recovery |
| RA-010 | Agent evaluation and operational observability | Implemented for development | Deterministic EvalCase runner, fictional fixture, safe aggregates and structured-output telemetry | Partial | None | Real-model adapter, authorized anonymized dataset, repeated sampling, cost and human calibration |
| RA-011 | Human-in-the-loop clarification | Implemented for development; not durable | Typed controls, `needs_input`, checkpoint, answer endpoint, validation/idempotency and resume tests | Partial | None | Durable transactional store, restart recovery, authentication, file-answer loop and later-stage interrupts |
| RA-012 | Structured-output validation and bounded repair | Implemented | Shared module, three-boundary workflow tests, safe API error test | Covered | Backfilled | Operational provider comparison is tracked by RA-010 |

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
  safe answer application, idempotency receipts, and resume from JD analysis.
- Next, replace the in-memory adapter with durable, versioned checkpoint
  storage and prove restart and concurrent-answer recovery.
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
