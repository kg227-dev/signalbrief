# Repository Map

*Last reviewed: March 20, 2026*

Use this document when you need to know where code should live or where to start reading.

## Canonical Surfaces

| Path | Use it for |
| --- | --- |
| `src/entrypoints/` | runtime bootstraps for digest and worker processes |
| `src/domains/` | stable domain-level imports for digest and engagement logic |
| `src/platform/` | stable infrastructure imports for config, store, mailer, scheduler, and shared types |
| `web/api/` | API route grouping boundaries |
| `web/services/` | web business logic behind routes |
| `web/client/` | browser-side page, state, and action modules |

## Implementation Areas

| Path | What is there now |
| --- | --- |
| `src/digest/` | digest policy and runtime implementation modules |
| `src/runtime/` | compatibility runtime modules that still back parts of the app |
| `src/jobs/` | background job runtime for scheduled digest execution |
| `web/server/` | web server composition helpers |
| `web/routes/` | compatibility route modules still in use during migration |
| `web/*.html`, `web/*.js`, `web/style.css` | static assets served directly in production |
| `tests/contracts/` | contract tests — verify module syntax, exports, and integration shape |
| `test-harness/` | QA pipeline — evaluates digest quality and replay regressions |
| `test-support/` | shared test utilities used by contract and harness suites |
| `scripts/` | smoke checks, reports, deploy tooling, and operational utilities |

## Documentation Areas

| Path | Purpose |
| --- | --- |
| `docs/` | canonical engineering docs and the primary docs router |
| `docs/ops/` | live operational runbooks, release procedures, and credential guidance |
| `docs/planning/` | reserved for in-flight execution plan bundles only |
| `docs/strategy/` | living strategy, marketing, KPI, and private business docs |
| `docs/archive/` | historical source material retained for context |
| `artifacts/` | ignored generated outputs for local analysis and testing |

## Start Here

- [Documentation Index](./INDEX.md)
- [First 30 Minutes](./onboarding-first-30-minutes.md)
- [Change-to-Test Map](./change-to-test-map.md)
- [Path and Import Rules](./contributing-path-rules.md)
