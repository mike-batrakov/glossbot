# Contributing to GlossBot

Thanks for your interest in GlossBot.

GlossBot is an open-source GitHub App plus a companion GitHub Action. The project is still early in its public v1 buildout, so contributor experience is intentionally simple and pragmatic for now.

## Before you start

- Read `README.md` first for the current project status.
- Check existing issues before starting new work.
- For larger changes, open an issue or draft discussion first so we can align on scope.

## Good first contributions

Early contributions that are especially helpful:

- README and documentation improvements
- issue and PR workflow polish
- TypeScript scaffold and test infrastructure
- focused bug fixes and small implementation tasks
- tests that reduce regression risk without adding noise

## Development workflow

Use a supported Node runtime locally: current Node 20 LTS (`20.18.1+`) or Node 22+.

Once the application scaffold is present, the expected local workflow is:

```bash
npm install
npm run typecheck
npm run lint
npm run test:coverage
```

If a task introduces or changes GitHub Action code, also run:

```bash
npm run build:action
```

## Project structure

The repository has two intentionally separate parts:

- `src/`: the Probot GitHub App runtime code
- `action/`: the GitHub Action that generates `GLOSS.md`

Do not add imports between `src/` and `action/`. That boundary is deliberate so the action can stay independently publishable. When action code changes, rebuild and commit `action/dist/` so the checked-in composite action stays runnable without a pre-build step.

## Testing expectations

- Prefer focused tests over broad, noisy coverage.
- Use Vitest for automated tests.
- Mock GitHub API interactions in tests. Do not make live GitHub API calls.
- Keep handlers thin and push logic into small testable modules.

## Pull requests

- Keep PRs focused and reasonably small.
- Include a short explanation of why the change is needed.
- Note any follow-up work or known limitations.
- Run the relevant checks locally before opening the PR.

## Security

Please do not report security issues in public GitHub issues. See `SECURITY.md` for the private reporting process.
