# Path and Import Rules

These rules keep the project navigable for new engineers and prevent structure drift.

## 1) Import From Canonical Surfaces First

For new code, prefer imports from:

- `src/domains/*` for domain logic
- `src/platform/*` for infrastructure adapters
- `web/api/*` for route registration boundaries
- `web/services/*` for web business logic
- `web/client/*` for browser state/actions

Avoid introducing new imports to legacy compatibility paths unless no canonical module exists yet.

## 2) Compatibility Paths Are Transitional

These paths still exist and are valid, but should not be expanded:

- `src/runtime/*`
- `src/digest/*`
- `web/routes/*`
- top-level runtime shim files

If you touch one of these areas, prefer adding or updating a canonical module and keep a thin compatibility re-export where needed.

## 3) Naming Conventions

- orchestration modules: `*-service.js`
- boundary adapters: `*-gateway.js` or `*-io.js`
- route handlers: `*-route.js`
- pure logic modules: `*.core.js`

Use suffixes consistently so grep-based discovery remains reliable.

## 4) Test Placement

- contract/integration tests: `tests/contracts/<entrypoints|web-api|jobs|harness>/`
- unit tests (new): colocate as `*.unit.test.js` beside source modules

When moving files, update test paths in the same PR and run `npm test`.

## 5) Script Organization

- checks: `scripts/check-*`
- smokes: `scripts/smoke-*`
- reports: `scripts/report-*`

Keep existing `npm run` script names stable unless there is an explicit migration plan.

## 6) PR Hygiene

- Split move-only and behavior-changing edits into separate commits.
- Preserve external route contracts and top-level runtime commands.
- Include an explicit test command list in the PR description using [Change-to-Test Map](./change-to-test-map.md).
