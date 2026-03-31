# GlossBot

Track deferred code suggestions and tech debt directly from pull request comments.

GlossBot helps teams capture "we should fix this later" feedback before it disappears after merge.

## Why GlossBot?

Suggestions from Copilot, CodeRabbit, and human reviewers often get deferred during PR reviews and then lost.

GlossBot keeps those suggestions alive with one lightweight command:

`@gloss track`

When used in a PR conversation, GlossBot stores the suggestion (with context) in `.glosslog` and a companion GitHub Action updates `GLOSS.md` so the backlog stays visible.

## How it works

GlossBot is designed as two components:

1. **GitHub App (Probot)**
   - Listens for `@gloss track` in PR comments
   - Parses overrides (`severity:*`, `tag:*`)
   - Appends an entry to `.glosslog` (JSON Lines)
   - Replies with confirmation and an entry ID

2. **GitHub Action (`glossbot/generate-gloss-md@v1`)**
   - Triggers when `.glosslog` changes
   - Reads open entries
   - Regenerates `GLOSS.md`

This separation keeps webhook handling stateless and makes report generation easy to customize in CI.

## Current status

GlossBot is public in the open and actively being built, but it is not install-ready yet.

- The v1 design is approved.
- The public repo foundation is being set up now.
- The GitHub App and companion Action have not been published yet.
- Early contributors are welcome, especially on docs, repo hygiene, tests, and implementation scaffolding.

If you are visiting this repository looking for a production-ready GitHub App to install today, check back after the first public implementation milestone lands.

## Planned Setup / Installation

These steps describe the intended install flow after the first public implementation milestone. They are not actionable yet on this branch.

### 1) Install GlossBot (GitHub App)

1. Open the GlossBot GitHub App page and click **Install**.
2. Choose your account or organization.
3. Select repositories (single repo or all repos) and confirm installation.
4. Ensure the app is granted repository access where you plan to use `@gloss track`.

After install, mention `@gloss track` in a PR comment to verify GlossBot is active.

### 2) Add the companion GitHub Action

Create a workflow file at `.github/workflows/glossbot.yml` in the target repository that uses the companion GitHub Action `glossbot/generate-gloss-md@v1`.

Typical behavior:

- Trigger when `.glosslog` is updated on the default branch.
- Read `.glosslog` entries with status `open`.
- Regenerate `GLOSS.md`.
- Commit updated `GLOSS.md` back to the repository.

### 3) Required permissions and secrets

- **GlossBot (GitHub App):** needs repository permissions to read PR comments/metadata and write `.glosslog` via the Contents API.
- **companion GitHub Action:** needs `contents: write` permission so it can update `GLOSS.md`.
- **Secrets / env vars:**
  - For standard usage of `glossbot/generate-gloss-md@v1`, no additional repository secrets are required beyond the default workflow token.
  - Self-hosted GlossBot deployments may require app credentials (for example App ID, private key, and webhook secret) managed as environment variables/secrets in the deployment platform.

### 4) Quick verification after setup

1. Add a PR comment starting with `@gloss track`.
2. Confirm GlossBot replies with an entry ID.
3. Confirm `.glosslog` receives a new JSONL entry.
4. Confirm the companion GitHub Action runs and updates `GLOSS.md`.

## Command quick reference

Supported command forms:

- `@gloss track`
- `@gloss track severity:high`
- `@gloss track severity:critical tag:v2 tag:backlog`
- `@gloss track severity:high tag:security`
- `@gloss track severity:medium follow up before launch`

Notes:

- Command matching is case-insensitive.
- `@gloss track` must appear at the start of a line.
- Inline or fenced code blocks containing `@gloss track` are ignored.
- `severity:` accepts: `low`, `medium`, `high`, `critical`.
- `tag:` values are free-form single tokens and preserve whatever follows `tag:`.
- Everything after the first colon in a tag is kept, so `tag:v2:experimental` becomes `v2:experimental`.
- Invalid `severity:` values are surfaced as unrecognized overrides; unknown `key:value` patterns stay in the note text.

## What gets stored

GlossBot writes to `.glosslog` (JSON Lines format):

- A metadata header line (`_type: "glosslog"`)
- Entry lines (`_type: "entry"`) with:
  - suggestion text and permalink
  - PR metadata
  - optional file/line context (for structured comments: GitHub review comments that carry file and line metadata)
    - Structured comments here means GitHub-style PR **review comments** (line/file anchored), not generic PR conversation comments.
    - GlossBot extracts this from webhook payload metadata (for example fields equivalent to `path`/`filePath` and `line`/`lineNumber`) and stores it as optional location context when present.
  - severity, tags, note
  - status (`open` in v1)

Concrete `.glosslog` JSON Lines example:

```json
{"_type":"glosslog","version":1,"repo":"octo-org/example-repo","initialized_at":"2026-03-31T14:05:00Z"}
{"_type":"entry","id":"g_a1b2c3","version":1,"type":"structured","repo":"octo-org/example-repo","created_at":"2026-03-31T14:22:00Z","source":"github-pr","suggestion":{"body":"Use parameterized query instead of string concat.","author":"reviewer","author_type":"human","url":"https://github.com/octo-org/example-repo/pull/42#discussion_r123456789"},"location":{"path":"src/db/query.ts","start_line":34,"end_line":34,"original_commit_sha":"abc1234"},"pr":{"number":42,"title":"Add user search","url":"https://github.com/octo-org/example-repo/pull/42"},"deferred_by":"mbatrakov","severity":"high","tags":["security","sql"],"note":null,"status":"open"}
```

## Project status

GlossBot is currently in **early v1 implementation**.

- ✅ Design approved
- 🚧 Public repo foundation in progress
- 🚧 Core implementation not merged yet
- 🎯 Scope focused on tracking deferred PR suggestions and generating `GLOSS.md`

## First public implementation milestone

This branch establishes the first public implementation slice:

- A TypeScript/Probot app scaffold under `src/`
- Initial schema, parser, and GitHub Contents API primitives
- Tests, CI, contributor setup, and repository templates
- The foundation for the `.glosslog` schema and `GLOSS.md` generation flow described above

Still to come:

- Full webhook handlers and end-to-end bot behavior
- The composite GitHub Action implementation under `action/`
- Install-ready GitHub App configuration and published action release

## Public roadmap (high-level)

Planned after v1:

- Resolve lifecycle (`@gloss resolve`)
- File-first reporting views
- Richer editor integrations

## Contributing

Contributions are welcome.

Right now, the highest-value contributions are:

- documentation clarity
- public repo setup
- implementation scaffolding
- tests and CI once the codebase lands

A fuller contributor setup guide will live in `CONTRIBUTING.md`.

## License

MIT
