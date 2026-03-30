# GlossBot Design Spec

**Date:** 2026-03-30
**Status:** Approved
**Author:** Michael Batrakov + Claude

## Overview

GlossBot is an open-source GitHub App that tracks deferred code improvements and tech debt directly from PR comments. When a developer comments `@gloss track` on a PR suggestion they want to defer, GlossBot captures it with full context and stores it in a `.glosslog` file (JSON Lines format). A companion GitHub Action auto-generates a human-readable `GLOSS.md` from the log.

### Core Value Proposition

Deferred suggestions from Copilot, CodeRabbit, and human reviewers disappear after a PR is merged. GlossBot ensures they don't — zero friction capture, full context preservation, one command.

### v1 Scope

- **In scope:** Tracking deferred suggestions from PR comments (structured and freeform), bot confirmation replies, auto-generated GLOSS.md, automatic installation setup
- **Out of scope:** Resolve/lifecycle management (v2), VS Code extension (v2), file-first GLOSS.md view (v2), comment edit tracking, multi-repo dashboard

---

## 1. Architecture

### Approach: Probot + GitHub Action

Two components with clean separation of concerns:

1. **Probot App (stateless)** — Handles GitHub webhooks. Parses `@gloss track` commands, writes entries to `.glosslog` via the GitHub Contents API, replies to confirm. Deployable to any serverless platform (Vercel, Railway, fly.io).
2. **GitHub Action (`glossbot/generate-gloss-md@v1`)** — Triggers on `.glosslog` changes to the default branch. Reads the log, generates `GLOSS.md`, commits it back. Published as a composite action from the GlossBot org.

### Why This Split

- Probot stays stateless — no cloning, no disk, no filesystem. Just webhook → API call → reply.
- GLOSS.md generation runs in the repo's own CI context — committing back is trivial, no extra auth.
- If GLOSS.md generation breaks, it doesn't take down the bot.
- Teams can customize or fork the Action without touching the bot.

### Data Flow

```
@gloss track comment
  → GitHub webhook fires
  → Probot receives event
  → Parse command + extract context
  → Append JSON line to .glosslog via Contents API (default branch)
  → Reply to comment with confirmation

.glosslog change on default branch
  → GitHub Action triggers
  → Read .glosslog, parse entries
  → Generate GLOSS.md
  → Commit GLOSS.md if changed
```

### Deployment Considerations

- **Cold starts:** Serverless free tiers may have slow first-webhook-after-idle. Mitigate with a keep-alive ping or use an always-on hobby plan. Decision deferred to deploy time, not an architecture concern.
- **Branch protection:** If the default branch requires PRs for all changes, the bot's installation token cannot push directly. Detected on install (see Section 5).

---

## 2. `.glosslog` Schema

### File Format

JSON Lines (`.jsonl` semantics, `.glosslog` extension). One JSON object per line. O(1) appends via Contents API.

### Metadata Header Line

The first line of every `.glosslog` file is a metadata header, written on install:

```json
{"_type":"glosslog","version":1,"repo":"org/repo","initialized_at":"2026-03-30T14:22:00Z"}
```

All consumers must skip lines where `_type` is not `"entry"`. This makes the file self-describing without breaking JSONL.

### Entry Schema (v1)

**Structured entry** (reply to a diff comment — the golden case):

```json
{
  "_type": "entry",
  "id": "g_a1b2c3d4",
  "version": 1,
  "type": "structured",
  "repo": "org/repo",
  "created_at": "2026-03-30T14:22:00Z",
  "source": "github-pr",
  "suggestion": {
    "body": "Consider using a Map here instead of a plain object for better key iteration performance",
    "author": "coderabbitai[bot]",
    "author_type": "bot",
    "url": "https://github.com/org/repo/pull/42#discussion_r1234567"
  },
  "location": {
    "path": "src/services/cache.ts",
    "start_line": 87,
    "end_line": 92,
    "original_commit_sha": "abc1234"
  },
  "pr": {
    "number": 42,
    "title": "Add caching layer",
    "url": "https://github.com/org/repo/pull/42"
  },
  "deferred_by": "mbatrakov",
  "severity": "medium",
  "tags": [],
  "note": null,
  "status": "open"
}
```

**Freeform entry** (top-level PR comment — no file/line context):

```json
{
  "_type": "entry",
  "id": "g_e5f6g7h8",
  "version": 1,
  "type": "freeform",
  "repo": "org/repo",
  "created_at": "2026-03-30T14:25:00Z",
  "source": "github-pr",
  "suggestion": {
    "body": "We should refactor the entire auth module before adding OAuth",
    "author": "teammate",
    "author_type": "human",
    "url": "https://github.com/org/repo/pull/42#issuecomment-9876543"
  },
  "location": null,
  "pr": {
    "number": 42,
    "title": "Add caching layer",
    "url": "https://github.com/org/repo/pull/42"
  },
  "deferred_by": "mbatrakov",
  "severity": "high",
  "tags": [],
  "note": null,
  "status": "open"
}
```

### Field Reference

| Field | Type | Description |
|-------|------|-------------|
| `_type` | `"entry"` | Discriminator. Always `"entry"` for gloss entries. |
| `id` | `string` | `g_` + 8-char random hex. ~4B combinations per repo. Sufficient for single-repo use. Cross-repo ID collision is a conscious non-goal for v1. |
| `version` | `number` | Schema version. Always `1` in v1. Enables future migration: "if version < 2, apply defaults." |
| `type` | `"structured" \| "freeform"` | Explicit, not inferred from `location` nullability. |
| `repo` | `string` | `"org/repo"` format. Makes the file self-describing outside git context. Free multi-repo setup for v2. |
| `created_at` | `string` | ISO 8601 UTC timestamp. |
| `source` | `string` | `"github-pr"` in v1. Extensible to `"vscode-copilot"`, `"cursor"` in v2. |
| `suggestion.body` | `string` | The parent comment text — the thing being deferred. This is the implicit reason for deferral. |
| `suggestion.author` | `string` | GitHub username of the suggestion author. |
| `suggestion.author_type` | `"bot" \| "human"` | Detected from GitHub's `user.type` field. Drives severity inference. |
| `suggestion.url` | `string` | Permalink to the original comment. |
| `location` | `object \| null` | `null` for freeform entries. |
| `location.path` | `string` | File path relative to repo root. |
| `location.start_line` | `number` | First line of the suggestion range. |
| `location.end_line` | `number` | Last line of the suggestion range. |
| `location.original_commit_sha` | `string` | The commit the reviewer was looking at when making the suggestion. Uses GitHub's `original_commit_id`, not `commit_id` — these diverge after force pushes. |
| `pr.number` | `number` | PR number. |
| `pr.title` | `string` | PR title at time of tracking. |
| `pr.url` | `string` | PR permalink. |
| `deferred_by` | `string` | GitHub username of the developer who ran `@gloss track`. |
| `severity` | `"critical" \| "high" \| "medium" \| "low"` | Auto-inferred or manually overridden. See Section 3 for inference rules. |
| `tags` | `string[]` | Free-form strings. Empty array by default. Overridable via `tag:value`. No fixed enum — teams define their own vocabulary. |
| `note` | `string \| null` | Additional context added by the developer. `null` when absent. Distinct from `suggestion.body` which is the original suggestion text. |
| `status` | `"open"` | Always `"open"` in v1. Field exists for forward-compatibility with v2 lifecycle. No machinery changes it yet. |

### Fields Deliberately Excluded (v2)

- `resolved_by`, `resolved_at`, `resolution_pr` — lifecycle fields, add when resolve ships
- `priority` separate from `severity` — one axis is enough for v1
- `category`, `effort_estimate` — YAGNI, teams can use tags

---

## 3. Comment Parser & Bot Reply

### Trigger Events

GlossBot listens for:
- `issue_comment.created` — top-level PR comments and replies in review threads
- `pull_request_review_comment.created` — inline comments on diffs

**Explicitly out of scope in v1:** `issue_comment.edited` — editing a comment to add `@gloss track` after posting will not trigger tracking. Documented in README to prevent confusion.

### Command Syntax

```
@gloss track                                    → all defaults
@gloss track severity:high                      → override severity
@gloss track tag:v2 tag:backlog                 → multiple tags
@gloss track severity:high tag:v2               → both
@gloss track this needs fixing soon             → free text → note
@gloss track severity:high fix before launch    → override + remaining text → note
```

Case-insensitive matching on `@gloss track`.

### Command Position

`@gloss track` must appear at the **start of a line** (after optional whitespace) to trigger. This prevents false positives from:
- Quoted text: `> @gloss track` in a blockquote does NOT trigger (the `>` prefix means it's quoting someone else)
- Code blocks: `` `@gloss track` `` or fenced code blocks are ignored
- Mid-sentence mentions: "I agree with this, @gloss track" does NOT trigger

The regex pattern: `/^\s*@gloss\s+track\b/im` — multiline mode, case-insensitive, word boundary after "track."

### Who Can Track

Any user who can comment on the PR can run `@gloss track`. No additional permissions required beyond GitHub's own comment permissions. On public repos, this means any GitHub user can create entries. This is acceptable for v1 — the value of low friction outweighs the spam risk. If abuse becomes a problem, v2 can restrict to collaborators.

### Parsing Rules

Left-to-right processing:

1. Strip `@gloss track` prefix (case-insensitive)
2. Tokenize remaining text by whitespace
3. For each token, check if it matches `key:value` format where key is a known key
4. Known keys: `severity`, `tag`
5. `severity:value` — value must be one of `critical`, `high`, `medium`, `low`. Invalid values are flagged (see Typo Detection below).
6. `tag:value` — free-form, any string accepted. Everything after the first colon is the value (e.g., `tag:v2:experimental` → tag is `"v2:experimental"`).
7. Tokens that look like `key:value` but have an unknown key (e.g., `foo:bar`) stay in the remaining text and become part of the note.
8. All remaining non-key:value text is concatenated and stored as `note`. If empty, `note` is `null`.

### Typo Detection

When a known key has an invalid value (e.g., `severity:hihg`):

1. **Minimum length guard:** Only run fuzzy matching if the invalid value is >= 4 characters. Short values like `lo`, `hi` produce too many false positive suggestions.
2. **Levenshtein distance:** Compare against valid values for that key. If distance <= 2 from a valid value, suggest it in the reply.
3. **No suggestion:** If no close match, just flag as unrecognized.

The invalid `key:value` token is stored in `note` as raw text. It is NOT silently applied.

### Structured vs Freeform Detection

| Event | Entry Type | How |
|-------|-----------|-----|
| `pull_request_review_comment` | `structured` | GitHub provides `path`, `line`, `original_commit_id` directly on the payload. |
| `issue_comment` with `in_reply_to_id` | `structured` | Walk the reply chain: fetch the parent review comment via `GET /repos/{owner}/{repo}/pulls/{pr}/comments/{in_reply_to_id}` to recover `path`, `line`, `original_commit_id`. |
| `issue_comment` without `in_reply_to_id` | `freeform` | No file/line context available. |

**Thread-walking safety:** The `in_reply_to_id` field on `issue_comment` is not always populated consistently by GitHub's API. The handler must:
1. Check if `in_reply_to_id` exists
2. If yes, attempt to fetch the parent review comment
3. If the fetch fails (404, timeout, missing fields), fall back to `freeform` gracefully
4. Never let a failed parent lookup cause the entire tracking operation to fail silently — always produce an entry, even if it's freeform

### Suggestion Source Resolution

The `suggestion.body` field must contain the **original suggestion text**, not the `@gloss track` command itself. The triggering comment's body is the command — the suggestion is the comment being replied to.

Resolution logic:

| Scenario | `suggestion.body` source | `suggestion.author` source |
|----------|-------------------------|---------------------------|
| `pull_request_review_comment` with `in_reply_to_id` | Fetch the parent comment via `in_reply_to_id`; use its `body` | Parent comment's `user.login` |
| `pull_request_review_comment` without `in_reply_to_id` (standalone) | The triggering comment's own `body` (strip the `@gloss track` prefix) | The triggering comment's `user.login` |
| `issue_comment` with `in_reply_to_id` | Fetch the parent review comment; use its `body` | Parent comment's `user.login` |
| `issue_comment` without `in_reply_to_id` | The triggering comment's own `body` (strip the `@gloss track` prefix) | The triggering comment's `user.login` |

The key distinction: when `@gloss track` is a **reply**, the suggestion is the parent. When it's **standalone** (no parent), the remaining text after `@gloss track` becomes `suggestion.body` and `note` is set to `null`. There is no duplication — `suggestion.body` always holds the suggestion content, `note` is only for *additional* developer context beyond the suggestion itself. In the standalone case, the developer's text *is* the suggestion. If there's no text beyond `@gloss track` in a standalone comment, `suggestion.body` is set to the full comment body (which is just the command) as a fallback so the entry is never empty.

### Duplicate Tracking

If the same user runs `@gloss track` twice on the same suggestion, two entries are created. This is accepted v1 behavior — deduplication adds complexity (matching by parent comment URL) for a case that rarely happens. Each entry gets a unique ID regardless. If duplicates become a real problem, v2 can deduplicate by `suggestion.url`.

### Severity Inference

When severity is not explicitly overridden:

| `suggestion.author_type` | Relationship to PR | Default Severity |
|---|---|---|
| `bot` | — | `medium` |
| `human` | Not the PR author | `high` |
| `human` | Is the PR author (self-deferral) | `low` |

"Is the PR author" is checked by comparing `suggestion.author` against the PR's `user.login`.

### Bot Reply Format

**Structured, defaults:**
```
Tracked `src/services/cache.ts:87` · g_a1b2c3d4
severity: medium · tags: none
Deferred by @mbatrakov on PR #42
```

**Structured, with overrides and note:**
```
Tracked `src/services/cache.ts:87` · g_a1b2c3d4
severity: high · tags: v2
Deferred by @mbatrakov on PR #42
```

**Freeform:**
```
Tracked (freeform) · g_e5f6g7h8
severity: high · tags: none
Deferred by @mbatrakov on PR #42
```

**With typo nudge:**
```
Tracked `src/services/cache.ts:87` · g_a1b2c3d4
severity: medium · tags: none
Deferred by @mbatrakov on PR #42

Unrecognized: `severity:hihg` — did you mean `severity:high`?
```

The entry ID is always on the first line — scannable, searchable, and referenceable for `@gloss resolve` in v2.

---

## 4. `.glosslog` File Operations & Concurrency

### File Location

`.glosslog` at repository root. Not configurable in v1.

### Branch Targeting

GlossBot writes to the repository's **default branch**, not the PR branch.

**Rationale:**
- `.glosslog` is a project-level artifact, not a PR-level one
- Writing to PR branches creates merge conflicts when multiple PRs track entries
- All entries land in one place immediately
- Trade-off: commits appear on the default branch outside of PRs. Acceptable for a metadata file — same pattern as bots updating lock files or changelogs.

### Append Operation (Contents API)

For each `@gloss track`:

1. `GET /repos/{owner}/{repo}/contents/.glosslog?ref={default_branch}` — returns current content + SHA
2. Decode base64 content, append new JSON line + `\n`
3. `PUT /repos/{owner}/{repo}/contents/.glosslog` with new content + the SHA from step 1
4. If **409 Conflict** (SHA mismatch from concurrent write) → add random jitter (`Math.random() * 100`ms), retry from step 1. Max 3 attempts.
5. If **404** on GET (file doesn't exist) → create with metadata header + entry via PUT (no SHA needed)
6. If all retries exhausted → reply with error:

```
Failed to track — concurrent write conflict. Please try again.
```

No silent failure. The developer always knows whether tracking succeeded or not.

**Why jitter:** Three retries with zero delay means concurrent writers all retry at exactly the same time and collide again. Random jitter (not exponential backoff) is sufficient since the conflict window is small (~1-2 seconds).

### Commit Message Format

```
gloss: track g_a1b2c3d4 in src/services/cache.ts:87
```

For freeform:
```
gloss: track g_a1b2c3d4 (freeform)
```

Prefixed with `gloss:` so teams can filter in `git log`. The bot commits using the GitHub App's installation token — commits show as `glossbot[bot]`.

---

## 5. Installation Flow

### On `installation.created` Event

GlossBot creates two files via the Contents API, with independent existence checks for each:

1. **`.glosslog`** — metadata header line only:
   ```json
   {"_type":"glosslog","version":1,"repo":"org/repo","initialized_at":"2026-03-30T14:22:00Z"}
   ```

2. **`.github/workflows/glossbot.yml`** — the Action workflow (see Section 6). The `templates/glossbot.yml` template uses a `{{defaultBranch}}` placeholder. The install handler reads `repository.default_branch` from the installation event payload and substitutes it before committing. This ensures repos using `master`, `develop`, or any other default branch get a working workflow.

Each file gets an independent GET check. If `.glosslog` exists but the workflow doesn't, only the workflow is created. This handles reinstall scenarios and teams who manually deleted the workflow.

**Note:** The Contents API does not support multi-file atomic commits. Each file is a separate PUT, resulting in up to two commits. This is acceptable for a one-time setup operation. Commit messages:
```
gloss: initialize .glosslog
gloss: initialize glossbot workflow
```
If only one file needs creating, only one commit is made.

### Branch Protection Detection

After the init commit attempt, if the Contents API returns **403** (insufficient permissions due to branch protection rules), GlossBot does not fail silently. It creates a **GitHub Issue** in the repo:

- **Title:** `GlossBot: Setup required — branch protection`
- **Label:** `glossbot` (created if it doesn't exist)
- **Assignee:** `sender.login` from the installation event (the user who installed the app)
- **Body:**
  > GlossBot needs push access to your default branch (`{defaultBranch}`). Please add an exception for the GlossBot app in your branch protection rules.
  > See: [Setup Guide](https://github.com/glossbot/glossbot#branch-protection)

**Fallback:** If the repo has Issues disabled, the issue creation will also fail (404). In this case, GlossBot logs the error server-side. The first `@gloss track` attempt will also fail with a 403 and reply with a clear error message, so the team will discover the problem at that point. This is an acceptable degradation — repos with both branch protection and Issues disabled are rare.

### First Action Trigger Sequence

The install commit creates both `.glosslog` and `.github/workflows/glossbot.yml` simultaneously. Since the Action workflow may not exist when the commit lands, the first `.glosslog` write from install may not trigger GLOSS.md generation. Expected sequence:

1. Install event → init commit creates both files
2. First `@gloss track` → appends to `.glosslog` → Action triggers (workflow now exists) → `GLOSS.md` generated
3. The init-only `.glosslog` (just the metadata header) does not need a `GLOSS.md` — there are no entries to render

This is the correct behavior. No special handling needed.

---

## 6. GitHub Action & `GLOSS.md` Generation

### Workflow Definition

Installed as `.github/workflows/glossbot.yml` in target repos. References the published composite action:

```yaml
name: GlossBot — Update GLOSS.md
on:
  push:
    branches: [main]  # Example: actual value is substituted from {{defaultBranch}} at install time
    paths: ['.glosslog']

permissions:
  contents: write

jobs:
  update-gloss:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: glossbot/generate-gloss-md@v1
```

### Generation Logic

The composite action (`glossbot/generate-gloss-md@v1`):

1. Read `.glosslog` line by line
2. Skip lines where `_type` is not `"entry"`
3. Parse all entries, filter to `status: "open"`
4. Group by severity (critical → high → medium → low), then by file path within each group
5. Collect freeform entries into a separate section
6. Compute summary stats: total open, count per severity, oldest entry date
7. Generate `GLOSS.md` using template literals in `generate.ts` (no template engine dependency)
8. Compare generated content to existing `GLOSS.md`
9. If different, commit and push. If identical, skip (prevents empty commits)

### `GLOSS.md` Format

```markdown
# Tech Debt Tracker

> Auto-generated by [GlossBot](https://github.com/glossbot/glossbot) from `.glosslog`.
> **Edits will be overwritten on the next `@gloss track`.** Manage entries via `.glosslog` directly.

**12 open items** · 2 critical · 4 high · 5 medium · 1 low · oldest: 2025-09-14

---

## Critical (2)

### `src/auth/middleware.ts:44` · g_a1b2c3d4
> Consider using constant-time comparison for token validation to prevent timing attacks
— *coderabbitai[bot]* on [PR #42](https://github.com/org/repo/pull/42) · deferred by @mbatrakov · 2026-03-28

### `src/payments/stripe.ts:112` · g_e5f6g7h8
> The error handling here swallows the Stripe API error code — surface it to the caller
— *jsmith* on [PR #51](https://github.com/org/repo/pull/51) · deferred by @mbatrakov · 2026-03-29

---

## High (4)

### `src/services/cache.ts:87` · g_i9j0k1l2
> This service should validate input types before caching — passing undefined keys silently corrupts the cache
— *senior-dev* on [PR #42](https://github.com/org/repo/pull/42) · deferred by @teammate · 2026-03-28
> **Note:** shipping v1 first, revisit after launch

...

---

## Medium (5)

...

---

## Low (1)

...

---

## Freeform (unlinked)

These entries have no file/line context. Consider adding specifics when revisiting.

- **g_m3n4o5p6** · "We should refactor the entire auth module before adding OAuth"
  — *teammate* on [PR #42](https://github.com/org/repo/pull/42) · deferred by @mbatrakov · 2026-03-30

---

*Last updated: 2026-03-30T14:35:00Z · [What is GlossBot?](https://github.com/glossbot/glossbot)*
```

### Format Decisions

- **Severity-first grouping** — the primary question is "what's most urgent," not "what's in this file." File path is in each entry for scanning. File-first view is a planned v2 feature.
- **Freeform entries in a separate section** — they lack file:line anchoring. Mixing them into severity groups clutters the structured entries.
- **Summary line with staleness signal** — "oldest: 2025-09-14" tells teams at a glance whether they're looking at active debt or ancient history.
- **Empty severity sections omitted** — if no critical items exist, the Critical section doesn't render.
- **Note shown inline when present** — only rendered if `note !== null`.
- **Sharpened "do not edit" warning** — tells developers *when* their edits will be lost, not just that they will be.

### Action Commit Behavior

Commits as `github-actions[bot]`. Message:
```
gloss: update GLOSS.md (12 open items)
```

**Infinite loop prevention:** The `paths: ['.glosslog']` filter prevents the Action from re-triggering on its own `GLOSS.md` commits. The diff check before committing is a safety net.

### Customization

Teams who want different GLOSS.md formatting can:
1. Fork `glossbot/generate-gloss-md` and reference their fork
2. Replace the `uses:` step with a custom script
3. The workflow is intentionally simple enough to read and modify

---

## 7. Repo Structure

```
glossbot/
├── .github/
│   └── workflows/
│       └── ci.yml                    # Lint, test, typecheck on PR
├── src/
│   ├── index.ts                      # Probot app entry — registers event handlers
│   ├── handlers/
│   │   ├── track.ts                  # @gloss track command handler
│   │   └── install.ts                # installation event — init files
│   ├── parser/
│   │   ├── command.ts                # Parse @gloss track + overrides from comment body
│   │   └── levenshtein.ts            # Typo detection for severity values
│   ├── github/
│   │   ├── contents.ts               # Read/write .glosslog via Contents API
│   │   ├── comments.ts               # Post bot reply to PR comment
│   │   └── context.ts                # Extract location data, walk reply threads
│   └── schema/
│       └── entry.ts                  # GlossEntry, GlossMetadata types + validation
├── action/                           # Published as glossbot/generate-gloss-md@v1
│   ├── action.yml                    # Composite action definition
│   └── generate.ts                   # Read .glosslog → produce GLOSS.md (template literals)
├── templates/
│   └── glossbot.yml                  # Workflow file installed into target repos
├── test/
│   ├── handlers/
│   │   ├── track.test.ts
│   │   └── install.test.ts
│   ├── parser/
│   │   └── command.test.ts
│   ├── github/
│   │   ├── contents.test.ts
│   │   └── context.test.ts
│   ├── schema/
│   │   └── entry.test.ts
│   └── fixtures/
│       ├── payloads/                 # Sample GitHub webhook payloads
│       │   ├── review-comment.json
│       │   ├── review-comment-bot-author.json
│       │   ├── issue-comment.json
│       │   ├── issue-comment-reply.json
│       │   ├── issue-comment-with-overrides.json
│       │   └── installation.json
│       └── glosslog/                 # Sample .glosslog files for Action tests
│           ├── single-entry.jsonl
│           ├── multi-severity.jsonl
│           └── with-freeform.jsonl
├── .env.example                      # APP_ID, PRIVATE_KEY, WEBHOOK_SECRET
├── .eslintrc.json
├── tsconfig.json
├── package.json
├── CONTRIBUTING.md
├── LICENSE
└── README.md
```

### Key Decisions

- **TypeScript throughout** — Probot has first-class TS support, Octokit types catch schema drift at compile time.
- **`src/` mirrors `test/`** — every module has a corresponding test file.
- **Types live in `src/schema/entry.ts`** — canonical type definitions for `GlossEntry` and `GlossMetadata`. Imported by all modules that need them. No separate `types.ts`.
- **`action/` is isolated** — no imports between `src/` and `action/`. If `generate.ts` needs the `GlossEntry` type, it has its own copy. This boundary means the eventual repo split is a file move, not a refactor.
- **No Handlebars or template engine** — `GLOSS.md` and the workflow file are generated with template literals. One less dependency.
- **Handlers are thin** — `track.ts` orchestrates: calls parser, calls contents API, calls comment API. Each concern is a separate, independently testable module.

### Dependencies

- `probot` — webhook framework
- Dev: `vitest`, `eslint`, `typescript`

No ORM, no database, no Express (Probot handles HTTP), no template engine. Deliberately minimal.

---

## 8. Technical Risks & Unknowns

| Risk | Severity | Mitigation |
|------|----------|------------|
| **Contents API concurrent writes** | Medium | Retry with jitter (max 3). Explicit error reply on failure. |
| **Branch protection blocks bot pushes** | High | Detect 403 on install, surface clear setup instructions. |
| **`in_reply_to_id` inconsistency** | Medium | Graceful fallback to freeform. Never fail silently. |
| **Large `.glosslog` files** | Low | JSONL is line-oriented — GitHub Contents API handles files up to 100MB. Unlikely to hit this in practice. If a repo accumulates thousands of entries, the base64 encode/decode on every append becomes slow. v2 mitigation: archive resolved entries to `.glosslog.archive`. |
| **GitHub API rate limits** | Low | Each `@gloss track` makes 2-3 API calls (read file, write file, post comment). GitHub Apps get 5,000 requests/hour per installation. Would need ~1,600 tracks/hour to hit limits. |
| **Serverless cold starts** | Low | Deploy-time decision. Keep-alive ping or always-on plan. |
| **Action not present on first install commit** | Low | Expected behavior. First `@gloss track` after install triggers the action correctly. Documented in spec. |

---

## 9. v2 Roadmap (Out of Scope, Documented for Context)

- **Resolve lifecycle:** `@gloss resolve #id`, auto-detect on merge (line-range diffing), `resolved_by`/`resolved_at`/`resolution_pr` fields
- **VS Code extension:** Capture dismissed Copilot/Cursor suggestions via keyboard shortcut → append to `.glosslog`
- **File-first GLOSS.md view:** Group by file path instead of severity
- **Multi-repo dashboard:** Aggregate `.glosslog` files across repos using the `repo` field
- **Comment edit tracking:** Listen for `issue_comment.edited` events
- **Freeform enrichment:** Prompt developers to add file/line context to freeform entries
