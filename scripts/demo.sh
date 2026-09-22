#!/usr/bin/env bash
#
# Run the Career Agent locally with no model credentials, no accounts and no
# database: the offline heuristic provider answers every model call, so the
# whole pipeline (matching, validation, diff, quality report, rendering) runs
# end to end on your own machine.
#
#   ./scripts/demo.sh            # API on 127.0.0.1:8787, web on localhost:3100
#   PORT=9000 ./scripts/demo.sh  # move the API
#
# What you get is the real workflow with a stand-in for the model: resume text
# is not rewritten and job analysis is a line splitter with a keyword lexicon.
# Point OPENAI_* at a provider and start the API without this script for real
# model quality.
set -euo pipefail
cd "$(dirname "$0")/.."

export RESUME_AGENT_LLM_PROVIDER=offline
export RESUME_AGENT_AUTH_MODE=disabled
export RESUME_AGENT_RUN_STORE=memory
export RESUME_AGENT_HOST=127.0.0.1
export PORT="${PORT:-8787}"
# Make sure a key in the shell cannot silently turn this into a real run.
unset OPENAI_API_KEY OPENAI_BASE_URL OPENAI_MODEL

echo "▸ building @yamlresume/core and @yamlresume/resume-agent"
pnpm --filter @yamlresume/core build >/dev/null
pnpm --filter @yamlresume/resume-agent build >/dev/null

pnpm --filter @yamlresume/resume-agent-api dev &
API_PID=$!
trap 'kill "$API_PID" 2>/dev/null || true' EXIT

# --noproxy: a shell-wide http_proxy (common on WSL behind Clash) would send
# even loopback requests to the proxy and turn a healthy API into a 502.
for _ in $(seq 1 30); do
  if curl -sf --noproxy '*' "http://127.0.0.1:${PORT}/healthz" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
if ! curl -sf --noproxy '*' "http://127.0.0.1:${PORT}/healthz" >/dev/null 2>&1; then
  echo "API did not become healthy on port ${PORT}" >&2
  exit 1
fi

echo
echo "▸ API   http://127.0.0.1:${PORT}   (offline provider, auth disabled, in-memory runs)"
echo "▸ Web   http://localhost:3100      (opens once Next has compiled)"
echo "  Paste a job description in the chat, attach a resume as a candidate file, press 生成."
echo

pnpm --filter @yamlresume/agent-web dev
