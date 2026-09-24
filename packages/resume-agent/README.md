# @yamlresume/resume-agent

Job-tailored resume generation on top of `@yamlresume/core`.

This package intentionally keeps the LLM behind a small `LlmClient` interface:

- the agent owns the workflow and business rules;
- an LLM adapter only turns prompts into JSON;
- `@yamlresume/core` remains the source of truth for schema validation and rendering.

## Workflow

1. Validate or normalize candidate material into YAMLResume.
2. For asynchronous Runs, pause at `needs_input` when normalization returns an
   important structured question; validate the answer and resume from the
   checkpoint.
3. Build a source evidence index with stable candidate paths.
4. Analyze a job description into a structured `JobSpec`.
5. Match job requirements to candidate evidence.
6. Ask the LLM for a targeted YAMLResume draft.
7. Validate the draft and reject unsupported identity, contact, date, and entry facts.
8. Render the requested formats and style variants.

The first version is deliberately a bounded workflow rather than an autonomous
ReAct loop. Resume generation benefits more from traceability and factual
constraints than from unrestricted tool use.

## LLM configuration

`OpenAICompatibleClient` works with OpenAI-compatible chat-completion endpoints:

```ts
import {
  OpenAICompatibleClient,
  ResumeTailoringAgent,
} from '@yamlresume/resume-agent'

const agent = new ResumeTailoringAgent(
  new OpenAICompatibleClient({
    apiKey: process.env.OPENAI_API_KEY!,
    baseUrl: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
    model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
  })
)
```

For tests, inject a fake `LlmClient`. This makes the workflow deterministic and
keeps provider-specific code out of the domain logic.

## Structured-output reliability

Candidate normalization, JD analysis, and draft generation all use
`completeStructuredOutput`. It validates the first response with Zod, accepts
only the documented one-level envelopes and compatibility mappings, then makes
at most one Repair call by default with field-level validation feedback.

Repair is distinct from provider transport retry. Trace metadata reports model
calls, Repair calls, transport attempts, duration, and returned token usage.
Neither trace metadata nor `StructuredOutputValidationError` contains prompts,
candidate data, image Data URLs, or raw model responses.

For retryable HTTP responses, the OpenAI-compatible adapter accepts strict
`Retry-After` seconds or HTTP dates, normalizes the value to a safe maximum of
30 seconds, and waits for the longer of that hint and its local transport
backoff. If transport attempts are exhausted, a durable Run uses the same safe
hint when choosing its persisted delivery time. Raw headers and Provider bodies
are never persisted. Durable tasks also have a 15-minute retry window derived
from their persisted creation time: the first delivery is allowed, but no later
delivery starts at or beyond that deadline. Durable Runs pass one cancellation
signal through normalization, Repair, JobSpec and Draft. The built-in
OpenAI-compatible adapter aborts an active fetch, response-body read or retry
wait when the service closes, its lease is lost or a retry deadline arrives.
Synchronous request disconnect binding, remote billing guarantees and exact
transport-attempt cost accounting are not implemented.

## Human-in-the-loop development slice

`ResumeAgentRunService` separates trusted store records from public Run
snapshots. It exposes one focused typed interaction at a time, validates and
applies answers only to existing `content.*` paths, records answer fingerprints
for idempotency, and resumes at JD analysis without repeating extraction or
normalization.

The core service still defaults to the in-memory store. The SQLite adapter adds
single-host development persistence, compare-and-set revisions, a transactional
task outbox, bounded leases, heartbeats, polling, persisted exponential
retry backoff for infrastructure and explicitly transient Provider failures,
bounded Provider `Retry-After` waits, a persisted retry deadline, and restart
recovery; the API runtime uses it by default. Multipart binary
answers are accepted by the API and re-ingested by the workflow. Multi-host
coordination, production operations, authentication inside this package,
Provider request idempotency, cancellation outside durable Runs, DLQ/redrive,
jitter, retention, and later-stage interrupts are not implemented. Date
controls currently use day-precision
`YYYY-MM-DD`; year/month precision requires a future control contract. Completed
public Runs include the tailored resume and rendered artifacts, but never expose
source requests, checkpoints, raw answers, or raw model completions.
