# Repository Map

*Last reviewed: March 13, 2026*

Use this document when you need to know where code should live or where to start reading.

## Canonical Surfaces

| Path | Use it for |
| --- | --- |
| `src/entrypoints/` | runtime bootstraps for digest, worker, and bot processes |
| `src/domains/` | stable domain-level imports for digest, reply, personalization, and engagement |
| `src/platform/` | stable infrastructure imports for config, store, mailer, scheduler, and shared types |
| `web/api/` | API route grouping boundaries |
| `web/services/` | web business logic behind routes |
| `web/client/` | browser-side page, state, and action modules |

## Implementation Areas

| Path | What is there now |
| --- | --- |
| `src/digest/` | digest policy and runtime implementation modules |
| `src/runtime/` | compatibility runtime modules that still back parts of the app |
| `src/jobs/` | background jobs such as reengagement |
| `web/server/` | web server composition helpers |
| `web/routes/` | compatibility route modules still in use during migration |
| `web/*.html`, `web/*.js`, `web/style.css` | static assets served directly in production |
| `tests/contracts/` | contract and integration coverage grouped by subsystem |
| `test-harness/` | deterministic quality harness and matrix tooling |
| `scripts/` | smoke checks, reports, and operational utilities |

## Documentation Areas

| Path | Purpose |
| --- | --- |
| `docs/` | canonical engineering and planning docs |
| `docs/strategy/` | living strategy and marketing docs |
| `docs/archive/` | historical source material retained for context |
| `artifacts/` | ignored generated outputs for local analysis and testing |

## Start Here

- [Documentation Index](./INDEX.md)
- [First 30 Minutes](./onboarding-first-30-minutes.md)
- [Change-to-Test Map](./change-to-test-map.md)
- [Path and Import Rules](./contributing-path-rules.md)
