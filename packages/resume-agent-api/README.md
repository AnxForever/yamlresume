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
# Required on Node 22 when outbound HTTPS depends on HTTP(S)_PROXY.
export NODE_OPTIONS=--use-env-proxy
pnpm agent-api dev
```

Omit `NODE_OPTIONS` when the host has direct outbound access. Without
`--use-env-proxy`, `curl` may work through a shell proxy while Node's built-in
`fetch` still times out; verify the Provider endpoint and model match the key
instead of assuming that any non-empty key belongs to the default OpenAI URL.

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

Authenticated requests that start new model work share a persistent
per-account fixed-window allowance across `POST /v1/chat`,
`POST /v1/tailor-resume`, and `POST /v1/runs`. The default is 10 accepted
requests per 15 minutes. Set `RESUME_AGENT_WORK_RATE_LIMIT` (1–1000) and
`RESUME_AGENT_WORK_RATE_WINDOW_MS` (1000–86400000) to change it; invalid values
fail startup. A rejected request returns `429 work_rate_limited` with an
integer-seconds `Retry-After` header. Invalid bodies, Run reads, and answers
that continue an admitted Run do not consume another slot. The counter lives
in the authentication SQLite database, so this is a single-host safety limit,
not a distributed or token/cost budget. Explicit anonymous development with
`RESUME_AGENT_AUTH_MODE=disabled` has no account quota.

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

When the candidate upload is exactly one valid YAML or JSON YAMLResume, the
workflow treats that structured document as the canonical profile instead of
asking the Provider to re-extract its fields. Mixed candidate materials still
use the normalization workflow and require review.

### `GET /v1/runs/{id}`

Returns the latest workflow stage and, after termination, either the completed
result or a data-safe failure. The local runtime uses SQLite by default so runs
and ownership survive process restarts on one host; set
`RESUME_AGENT_RUN_STORE=memory` only for explicit ephemeral development.
The runtime creates its database directory with mode 0700 when absent and
repairs the SQLite main, WAL, and SHM files to mode 0600 whenever it opens the
Store. A permission failure prevents the HTTP listener from opening.
`checkLocalRunDatabase(path)` provides a separate immutable, read-only preflight:
it returns `missing` or the supported schema version, rejects corruption and
future schemas with stable errors, and refuses a non-empty WAL rather than
silently checking an incomplete main file.
When the executable server receives SIGINT or SIGTERM, it stops HTTP intake,
asks active durable Run Provider requests to abort, abandons their task
heartbeats, closes its owned stores, and then exits explicitly. A later worker
can retry the task after lease expiry. `pnpm local-app:shutdown-smoke` verifies
that the built-in adapter disconnects from a local mock before the process
exits, then recovers the same Run with synthetic data.

### `POST /v1/runs/{id}/answers`

Accepts the active interaction ID, a client-generated idempotency key, and the
control-specific value. A valid answer returns `202` with either the next
focused interaction or a run that is resuming at JD analysis. Invalid values
return `400`; unknown runs return `404`; stale interactions, wrong run states,
and idempotency conflicts return `409`.

This Human-in-the-loop loop is development-only. The SQLite adapter persists
checkpoints, answer receipts, and recoverable tasks on one host; an automatic
worker polls for expired or newly committed tasks. Infrastructure releases use
persisted exponential backoff from one to 30 seconds. Explicitly transient
Provider failures use the same delivery path and honor bounded `Retry-After`
advice. A persisted task-age deadline prevents another delivery from starting
after its retry window and aborts an active retry delivery when the window
expires. Multi-host coordination, synchronous-request disconnect binding,
Provider idempotency, DLQ/redrive, jitter, exact cost accounting, and retention
are still absent.
Completed public snapshots intentionally include the generated resume and
rendered artifacts for retrieval, but never include the source request,
checkpoint, raw answer values, or raw model output. File controls accept
multipart binaries keyed by the answer's file references; accepted files are
added to the candidate evidence and the profile is re-normalized. This remains
a development contract rather than a production upload service.

## Optional runtime switches

- `RESUME_AGENT_LLM_PROVIDER=offline` answers every model call with the
  deterministic heuristic provider (no key, no network). It exists for the
  local demo (`scripts/demo.sh`) and browser smoke runs; it does not rewrite
  resume text.
- `RESUME_AGENT_TASK_LEASE_MS` (default `60000`, range `100`–`86400000`) and
  `RESUME_AGENT_TASK_POLL_MS` (default `1000`, range `10`–`60000`) tune the
  single-host durable worker in milliseconds. Invalid values fail before the
  HTTP listener opens; the short values used by `local-app:crash-smoke` are for
  deterministic fault injection, not recommended runtime defaults.
- `RESUME_AGENT_TASK_RETRY_ELAPSED_MS` (default `900000`, range
  `1000`–`86400000`) is the persisted retry window measured from task creation.
  The first delivery is still allowed for an old queued task; subsequent
  deliveries may begin only before the deadline, and an active retry delivery
  is asked to abort at the exact deadline. This is local transport cancellation,
  not proof that the remote Provider stopped work or billing.
- `RESUME_AGENT_SEMANTIC_MATCHING=transformers` adds embedding-based evidence
  retrieval for the requirements the keyword matcher leaves missing, running
  `Xenova/multilingual-e5-small` in this process (the first call downloads
  about 130 MB; set `NODE_OPTIONS=--use-env-proxy` behind a proxy). `hash`
  selects the deterministic n-gram embedding for tests. Unset keeps matching
  keyword-only, which is also what the evaluation judge uses. When on, the
  value appears in `GET /v1/capabilities` as `runtime.semanticMatching`.
