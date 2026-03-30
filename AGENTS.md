# AGENTS.md

## Git Workflow Default

- After completing requested edits, automatically run `git add` for only the files changed by the agent, then `git commit`, then `git push`.
- Do not stage or commit unrelated working tree changes.
- If the user explicitly says not to commit or not to push, follow the user request for that turn.

## Production Deploy Contract (Required)

- For any change that touches runtime behavior (`web/**`, `src/**`, `scripts/**`, `docker-compose.yml`, `package*.json`), do not stop at `git push`.
- After push, run `npm run ops:deploy:prod` (or equivalent flags) so deploy + verification is one command.
- A task is not complete until production checks pass:
  - `GET /` is `200`
  - cache-busted landing script is present (`index.js?v=...`) and rendered (no raw `__ASSET_VERSION__`)
  - `GET /api/health/scheduler` returns `{"ok": true}`
- If deploy/verify fails, report failure and continue remediation; do not claim completion.
- Final response must include deployed commit SHA and verification outcome.
