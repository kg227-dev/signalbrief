# Context Router

*Last reviewed: April 8, 2026*

This directory is the default starting point for new work in SignalBrief.

Use it to load the smallest useful context before opening large plans, archives, or runtime mirrors.

## Default Load Order

1. [`current-state.md`](./current-state.md) — short repo and product snapshot
2. One relevant workstream capsule:
   - [`workstreams/retrieval-quality.md`](./workstreams/retrieval-quality.md)
   - [`workstreams/runtime-and-delivery.md`](./workstreams/runtime-and-delivery.md)
   - [`workstreams/admin-and-growth.md`](./workstreams/admin-and-growth.md)
3. One task-specific source of truth:
   - product contract: [`../reduced-scope-mvp.md`](../reduced-scope-mvp.md)
   - ops loop: [`../ops/retrieval-eval-worklog.md`](../ops/retrieval-eval-worklog.md)
   - active plan bundle: [`../planning/README.md`](../planning/README.md)
   - repository structure: [`../repository-map.md`](../repository-map.md)

## Load Only When Needed

- `docs/planning/reduced-scope-mvp-validation/README.md`
- `docs/superpowers/plans/*.md`
- `docs/specs/*.md`
- `docs/archive/**`
- `data/retrieval-evals/worklog.md`

Those files are still useful, but they are not the default context surface. Read them only when a task needs detailed provenance, day-by-day history, or a full implementation spec.

## Stable Rules

- Keep this directory compact and current.
- Prefer short summaries plus links over repeating long history.
- Move closed narrative history into `docs/archive/`.
- Update the relevant workstream capsule when the current focus changes materially.
- Add durable decisions to [`decision-log.md`](./decision-log.md) instead of burying them inside long plans.
