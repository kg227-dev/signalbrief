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


## vexp <!-- vexp v1.3.11 -->

**MANDATORY: use `run_pipeline` — do NOT grep or glob the codebase.**
vexp returns pre-indexed, graph-ranked context in a single call.

### Workflow
1. `run_pipeline` with your task description — ALWAYS FIRST (replaces all other tools)
2. Make targeted changes based on the context returned
3. `run_pipeline` again only if you need more context
### Available MCP tools
- `run_pipeline` — **PRIMARY TOOL**. Runs capsule + impact + memory in 1 call.
  Auto-detects intent. Includes file content. Example: `run_pipeline({ "task": "fix auth bug" })`
- `get_context_capsule` — lightweight, for simple questions only
- `get_impact_graph` — impact analysis of a specific symbol
- `search_logic_flow` — execution paths between functions
- `get_skeleton` — compact file structure
- `index_status` — indexing status
- `get_session_context` — recall observations from sessions
- `search_memory` — cross-session search
- `save_observation` — persist insights (prefer run_pipeline's observation param)

### Agentic search
- Do NOT use built-in file search, grep, or codebase indexing — always call `run_pipeline` first
- If you spawn sub-agents or background tasks, pass them the context from `run_pipeline`
  rather than letting them search the codebase independently

### Smart Features
Intent auto-detection, hybrid ranking, session memory, auto-expanding budget.

### Multi-Repo
`run_pipeline` auto-queries all indexed repos. Use `repos: ["alias"]` to scope. Run `index_status` to see aliases.
<!-- /vexp -->
