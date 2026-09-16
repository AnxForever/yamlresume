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

## Human-in-the-loop development slice

`ResumeAgentRunService` separates trusted store records from public Run
snapshots. It exposes one focused typed interaction at a time, validates and
applies answers only to existing `content.*` paths, records answer fingerprints
for idempotency, and resumes at JD analysis without repeating extraction or
normalization.

The default store is in-memory. Restart recovery, multi-instance coordination,
transactional answer locking, authentication, retention, binary file answers,
and later-stage interrupts are not implemented. Date controls currently use
day-precision `YYYY-MM-DD`; year/month precision requires a future control
contract. Completed public Runs include the tailored resume and rendered
artifacts, but never expose source requests, checkpoints, raw answers, or raw
model completions.
