# Runtime And Delivery

*Last reviewed: April 8, 2026*

Use this capsule when the task touches deploys, scheduler behavior, delivery records, production verification, backup/restore, or release safety.

## Goal

Keep the scheduled email path predictable: deploy safely, send on time, preserve recoverable state, and make production failures obvious and diagnosable.

## Current Status

The runtime path is materially stronger than it was earlier in March.

What is working:

- production deploy flow and verification are documented
- scheduler health has a clear API surface
- backup, restore, and rollback guidance exist
- scheduled runs are stable enough to support continuous quality validation

What still matters:

- release verification must stay disciplined on every runtime change
- health visibility is better than alerting depth
- quality regressions can still look like runtime failures if the evidence surface is not checked first

## Code Surfaces

Start in these areas:

- `src/entrypoints/`
- `src/platform/`
- `web/server.js`
- `web/api/health/`
- `scripts/` for deploy, smoke, and operational tooling

If older runtime behavior is involved, inspect `src/runtime/` and `web/routes/` carefully before changing anything.

## Source Of Truth

- ops hub: [`../../ops/README.md`](../../ops/README.md)
- release policy: [`../../ops/release-policy.md`](../../ops/release-policy.md)
- production topology: [`../../ops/production-cutover-ubuntu.md`](../../ops/production-cutover-ubuntu.md)
- restore and reliability floor: [`../../ops/reliability-floor-runbook.md`](../../ops/reliability-floor-runbook.md)
- product contract: [`../../reduced-scope-mvp.md`](../../reduced-scope-mvp.md)

## Default Verification Mindset

- confirm the relevant tests and smoke checks from `docs/change-to-test-map.md`
- verify `GET /api/health/scheduler`
- verify the public web surface after deploys
- separate runtime breakage from retrieval-quality degradation before changing infrastructure code
