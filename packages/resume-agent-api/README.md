# @yamlresume/resume-agent-api

Minimal HTTP API for the YAMLResume tailoring agent. It is intentionally
frontend-agnostic so a future Agent UI can be swapped in without changing the
workflow.

## Run locally

```bash
export OPENAI_API_KEY=...
export OPENAI_BASE_URL=https://api.openai.com/v1
export OPENAI_MODEL=gpt-4o-mini
pnpm agent-api dev
```

The server listens on `http://localhost:8787` by default. Set `PORT` to change
it.

## Endpoints

### `GET /healthz`

Returns `{ "ok": true }`.

### `POST /v1/tailor-resume`

Request body:

```json
{
  "jobDescription": "完整 JD 文本，至少 20 个字符",
  "candidate": {
    "yaml": "... YAMLResume 文本 ..."
  },
  "preferences": {
    "language": "zh-CN",
    "template": "jake",
    "maxPages": 1
  }
}
```

The response includes the structured job analysis, match report, follow-up
questions, generated YAMLResume, HTML, LaTeX, and workflow trace.

### `POST /v1/runs`

Accepts the same JSON or multipart request and returns `202 Accepted` with a
queued run snapshot. Use this endpoint for long-running clients.

### `GET /v1/runs/{id}`

Returns the latest workflow stage and, after termination, either the completed
result or a data-safe failure. The default store is in-memory: runs do not
survive process restarts and are not shared across server instances.
