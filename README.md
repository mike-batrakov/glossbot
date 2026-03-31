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

## Command quick reference

Supported command forms:

- `@gloss track`
- `@gloss track severity:high`
- `@gloss track tag:v2 tag:backlog`
- `@gloss track severity:high tag:security`
- `@gloss track severity:high follow up before launch`

Notes:

- Command matching is case-insensitive.
- `@gloss track` must appear at the start of a line.
- Inline or fenced code blocks containing `@gloss track` are ignored.

## What gets stored

GlossBot writes to `.glosslog` (JSON Lines format):

- A metadata header line (`_type: "glosslog"`)
- Entry lines (`_type: "entry"`) with:
  - suggestion text and permalink
  - PR metadata
  - optional file/line context (for structured comments)
  - severity, tags, note
  - status (`open` in v1)

## Project status

GlossBot is currently in **v1 implementation**.

- ✅ Design approved
- 🚧 Core implementation in progress
- 🎯 Scope focused on tracking deferred PR suggestions and generating `GLOSS.md`

## Public roadmap (high-level)

Planned after v1:

- Resolve lifecycle (`@gloss resolve`)
- File-first reporting views
- Richer editor integrations

## Contributing

Contributions are welcome. As the core implementation stabilizes, we’ll publish a full contributor setup guide and testing workflow.

## License

MIT
