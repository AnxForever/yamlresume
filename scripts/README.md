# Scripts

This directory contains utility scripts for the yamlresume project.

## Local app (`demo.sh`)

Starts the Career Agent API and workbench locally with accounts switched off
and a SQLite RunStore at `.data/resume-agent/local-app.sqlite`. Without a
`.env.local-app` file it uses the offline heuristic provider; when that private
file explicitly selects `openai-compatible`, the same command uses the
configured real provider. Completed Runs survive a restart. The launcher builds
`@yamlresume/core` and `@yamlresume/resume-agent` first, waits for the API health
check, then starts the Next dev server on port 3100.

The API runtime keeps the SQLite main file and its WAL/SHM sidecars at mode
0600. The database remains unencrypted personal data and must not be uploaded
or committed.

Run a read-only database preflight before starting the app:

```bash
pnpm local-app:doctor
```

The command does not start the API or Web app and does not load Provider
credentials. An existing database is opened with SQLite's immutable read-only
mode, checked with `quick_check`, and compared with the Store's supported schema
version. A missing database is reported as ready for first start without being
created. Stop the app before running the command: a non-empty WAL fails closed
instead of being ignored. Set `RESUME_AGENT_RUN_DB_PATH` to inspect a non-default
local Run database.

To verify the corrupt-database failure path through the real CLI process, run:

```bash
pnpm local-app:doctor-smoke
```

The smoke uses a synthetic corrupt file in a temporary private directory. It
requires a non-zero exit with only the stable database error, verifies that no
file contents or raw SQLite errors are exposed, and proves the source bytes,
permissions, and directory entries remain unchanged. It does not load
`.env.local-app` or pass Provider credentials to the child process.

```bash
pnpm local-app               # API on 127.0.0.1:8787, web on localhost:3100
PORT=9000 ./scripts/demo.sh  # move the API
```

Set `RESUME_AGENT_RUN_STORE=memory` only when an intentionally disposable Run
history is useful for a test.

To verify the smallest local workflow without opening the web interface or
calling a real model, run:

```bash
pnpm local-app:smoke
```

The command builds the API and its dependencies, starts an offline API process
with a temporary SQLite database, creates and polls one synthetic Run through
HTTP, stops the process, and starts a new process that must read back the same
completed Run and YAML artifact. It does not load `.env.local-app` or pass
Provider credentials to either API process, and it deletes the temporary data
afterward.

To exercise process-crash recovery without calling a real model, run:

```bash
pnpm local-app:crash-smoke
```

The command starts a local OpenAI-compatible mock and an API process backed by
a temporary SQLite database. It waits until the first Provider request is
in-flight, kills that API with `SIGKILL`, then starts a new API process against
the same database. The new worker must reclaim the task after its lease expires
and complete the original Run and YAML artifact. The mock must also observe the
first connection close. The drill uses only synthetic data, passes a synthetic
key directly to the child process, and does not load or inherit real Provider
credentials.

To verify the controlled SIGTERM path against the same failure point, run:

```bash
pnpm local-app:shutdown-smoke
```

This variant gives the mock Provider request a 60-second timeout, sends
SIGTERM while that request is in-flight, and requires the API to close its
owned resources, actively abort the built-in adapter connection and exit with
code 0 within five seconds. The mock must observe that disconnect. A new API
process must then reclaim the durable task and complete the original Run. It
uses the same synthetic-only credential and data boundary as the crash smoke.

To verify transient Provider recovery across the executable HTTP adapter and
SQLite worker without calling a real model, run:

```bash
pnpm local-app:provider-retry-smoke
```

The local mock returns three HTTP 503 responses with `Retry-After: 2`, exhausting
the configured transport retries. The command requires both transport gaps and
the persisted delivery gap to be at least 1.9 seconds, while the public Run
remains non-terminal and private-safe. It then accepts one successful JobSpec
request and one draft request; the original Run must complete with its YAML
artifact. The command builds and starts the production API entry, uses a
temporary SQLite database and a synthetic child-process key, does not load
`.env.local-app`, and closes every process, socket and temporary file afterward.

### Local data backup and restore

Create an online-consistent backup of the default local Run database:

```bash
pnpm local-app:backup
```

Backups are written under `.data/resume-agent/backups` with a mode-0600 file in
a mode-0700 directory. The command uses SQLite's online backup interface, so
the local app may remain open while creating a backup. A backup still contains
the original resume and Run data and is not encrypted; keep it private and do
not commit or upload it.

Stop `pnpm local-app` before restoring, then select a backup explicitly:

```bash
pnpm local-app:restore -- .data/resume-agent/backups/local-app-TIMESTAMP.sqlite
```

The restore command validates the selected database, refuses an active
WAL/SHM target, and preserves the current database as a separate mode-0600
backup before replacing it. It never overwrites an existing backup file. Set
`RESUME_AGENT_RUN_DB_PATH` to operate on a non-default local Run database.

Run the non-destructive recovery drill with synthetic data and a temporary
database:

```bash
pnpm local-app:data-smoke
```

The drill creates a Run through HTTP, backs up the live database, closes the
runtime, simulates loss of the original file, restores it, and verifies the
same Run and YAML through a restarted API. It calls no external Provider.

To use a real OpenAI-compatible provider, create a mode-0600 `.env.local-app`
that is kept out of Git:

```dotenv
RESUME_AGENT_LLM_PROVIDER=openai-compatible
OPENAI_API_KEY=replace-with-a-local-secret
OPENAI_BASE_URL=https://provider.example/v1
OPENAI_MODEL=provider-model-id
```

The file is optional. Removing it restores the explicit offline fallback; an
inherited API key alone never changes provider mode.

## project-metrics.mjs

Prints the size of the Career Agent packages — tracked source and test files
and lines, MIT headers excluded — plus the agent design docs and the number of
commits on top of `upstream/main`. The numbers quoted in the README's project
status section come from this script, so they can be regenerated rather than
estimated.

```bash
node scripts/project-metrics.mjs
```

## extract-changelog.sh

Extracts changelog entries for a specific version from `CHANGELOG.md`.

### Usage

```bash
# Extract to stdout
./scripts/extract-changelog.sh <version>

# Extract to file
./scripts/extract-changelog.sh <version> <output_file>
```

### Examples

```bash
# Extract changelog for version 0.4.1 to stdout
./scripts/extract-changelog.sh 0.4.1

# Extract changelog for version 0.4.1 to a file
./scripts/extract-changelog.sh 0.4.1 release_notes.md

# Works with 'v' prefix too
./scripts/extract-changelog.sh v0.4.1
```

### Features

- ✅ Handles version tags with or without 'v' prefix
- ✅ Extracts content between version headers
- ✅ Proper error handling for missing versions
- ✅ Can output to stdout or file
- ✅ Removes trailing empty lines
- ✅ Used in GitHub Actions for automated releases

### Exit Codes

- `0`: Success
- `1`: Version not found or no content found
- `1`: CHANGELOG.md file not found

### Integration

This script is used in the GitHub Actions workflow
(`.github/workflows/publish.yml`) to automatically extract release notes when
creating GitHub releases.
