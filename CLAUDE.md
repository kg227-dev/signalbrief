# CLAUDE.md — SignalBrief

Agent overlay for this repository. This file is intentionally narrow: use it for working conventions, not as the primary architecture document.

## Read First

- [README.md](./README.md)
- [docs/INDEX.md](./docs/INDEX.md)
- [SPEC.md](./SPEC.md)
- [FORMAT-RULES.md](./FORMAT-RULES.md)
- [docs/features.md](./docs/features.md)

If your work needs March 2026 execution history, read:

- [March 2026 Planning Archive](./docs/archive/planning/2026-03/README.md)

## Repo Truths

- Runtime is Node.js stdlib-first; `eslint` is the only declared dev dependency.
- Canonical module surfaces are `src/domains/*`, `src/platform/*`, `web/api/*`, `web/services/*`, and `web/client/*`.
- Compatibility runtime modules still exist under `src/runtime/*`, `src/digest/*`, `web/routes/*`, and top-level shims. Do not expand those paths when a canonical surface exists.
- `docs/planning/` is reserved for future in-flight execution bundles; the closed March 2026 plan set now lives under `docs/archive/planning/2026-03/`.

## Current Entrypoints

- Digest: `src/entrypoints/digest.js`
- Worker: `src/entrypoints/scheduler-worker.js`
- Bot: `src/entrypoints/bot-server.js`
- Web: `web/server.js`

## Working Guidance

- Read the source files you plan to touch before editing.
- Prefer small, verifiable changes over speculative refactors.
- Run the relevant checks from [docs/change-to-test-map.md](./docs/change-to-test-map.md).
- Keep product and system behavior documented in [SPEC.md](./SPEC.md), not here.
- Keep editorial and output constraints documented in [FORMAT-RULES.md](./FORMAT-RULES.md), not here.

## Git

Commit and push completed work unless the user explicitly asks you not to.
