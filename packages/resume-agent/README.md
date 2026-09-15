# @yamlresume/resume-agent

Job-tailored resume generation on top of `@yamlresume/core`.

This package intentionally keeps the LLM behind a small `LlmClient` interface:

- the agent owns the workflow and business rules;
- an LLM adapter only turns prompts into JSON;
- `@yamlresume/core` remains the source of truth for schema validation and rendering.

## Workflow

1. Validate or normalize candidate material into YAMLResume.
2. Build a source evidence index with stable candidate paths.
3. Analyze a job description into a structured `JobSpec`.
4. Match job requirements to candidate evidence.
5. Ask the LLM for a targeted YAMLResume draft.
6. Validate the draft and reject unsupported identity, contact, date, and entry facts.
7. Render the requested formats and style variants.

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
