# @yamlresume/resume-agent-api

Minimal HTTP API for the YAMLResume tailoring agent. It is intentionally
frontend-agnostic so a future Agent UI can be swapped in without changing the
workflow.

## Run locally

```bash
# Generate this once, then place the real value in a local mode-0600 env file.
openssl rand -base64 32
export RESUME_AGENT_CREDENTIAL_KEYS='{"local-v1":"<base64-output>"}'
export RESUME_AGENT_CREDENTIAL_ACTIVE_KEY_ID=local-v1
export RESUME_AGENT_ALLOWED_ORIGIN=http://localhost:5173

# The current OpenAI-compatible adapter still reads process-level credentials.
export OPENAI_API_KEY=...
export OPENAI_BASE_URL=https://api.openai.com/v1
export OPENAI_MODEL=gpt-4o-mini
pnpm agent-api dev
```

The server listens on `http://localhost:8787` by default. Set `PORT` to change
it. Authentication is enabled by default and startup fails closed if the
credential-encryption keyring is missing or invalid. Only local development
that deliberately needs the legacy anonymous API should set
`RESUME_AGENT_AUTH_MODE=disabled`.

## Endpoints

### `GET /healthz`

Returns `{ "ok": true }`.

### Authentication and Provider credentials

- `POST /v1/auth/register`
- `POST /v1/auth/login`
- `GET /v1/auth/me`
- `POST /v1/auth/logout`
- `GET /v1/provider-credentials`
- `PUT /v1/provider-credentials/{providerId}`
- `DELETE /v1/provider-credentials/{providerId}`

Sessions use an HttpOnly, SameSite=Lax opaque cookie. In production HTTPS set
`RESUME_AGENT_SECURE_COOKIES=true`, which also switches to a `__Host-` cookie.
Browser clients must send credentials and use the exact
`RESUME_AGENT_ALLOWED_ORIGIN`.

Provider API keys are encrypted per user with AES-256-GCM and are never
returned by HTTP. This vault prepares future Provider adapters; it does not yet
make the current OpenAI-compatible adapter consume a user's stored key.

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
result or a data-safe failure. The local runtime uses SQLite by default so runs
and ownership survive process restarts on one host; set
`RESUME_AGENT_RUN_STORE=memory` only for explicit ephemeral development.

### `POST /v1/runs/{id}/answers`

Accepts the active interaction ID, a client-generated idempotency key, and the
control-specific value. A valid answer returns `202` with either the next
focused interaction or a run that is resuming at JD analysis. Invalid values
return `400`; unknown runs return `404`; stale interactions, wrong run states,
and idempotency conflicts return `409`.

This Human-in-the-loop loop is development-only. The SQLite adapter persists
checkpoints, answer receipts, and recoverable tasks on one host; an automatic
production worker, multi-host coordination, cancellation, and retention are
still absent.
Completed public snapshots intentionally include the generated resume and
rendered artifacts for retrieval, but never include the source request,
checkpoint, raw answer values, or raw model output. File controls currently
accept references to previously uploaded files only; the binary upload and
re-normalization loop is deferred.
