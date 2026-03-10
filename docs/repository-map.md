# Repository Map

Use this document when you are new to SignalBrief and need to know where to read or change code.

## Top-Level Layout

| Path | What it contains | Start here when you need to... |
| --- | --- | --- |
| `src/entrypoints/` | Runtime entry processes (`digest`, `bot`, `scheduler`) | understand how a process boots and dispatches work |
| `src/domains/` | Canonical domain import surfaces (`digest`, `reply`, `personalization`, `engagement`) | find the "official" entry module for domain logic |
| `src/platform/` | Canonical infrastructure import surfaces (`config`, `store`, `mailer`, `scheduler`, `types`) | integrate storage, mail, config, or scheduler behavior |
| `src/digest/` | Digest selection, formatting, and archive pipeline implementation | debug ranking/selection/output behavior |
| `src/runtime/` | Runtime implementation modules and compatibility layers | patch existing runtime behavior with minimal churn |
| `src/jobs/` | Background job orchestration (`digest-runner`, reengagement) | debug scheduled or batch execution flows |
| `web/api/` | Canonical API route grouping (`admin`, `core`, `public`) | modify route registration or API boundaries |
| `web/services/` | Service modules used by web/API layers (`admin`, `user`, `shared`) | change business logic behind routes |
| `web/client/` | Canonical client/page state/action grouping | update browser-facing UI behavior |
| `web/*.html`, `web/*.js`, `web/style.css` | Served static assets and compatibility runtime files | patch live page/UI behavior quickly |
| `tests/contracts/` | Contract and integration tests grouped by subsystem (`entrypoints`, `web-api`, `jobs`, `harness`) | validate import/runtime contracts after refactors |
| `test-harness/` | Deterministic quality harness and matrix tooling | run quality scoring and evaluation scenarios |
| `scripts/` | Utility scripts (`smoke-*`, `check-*`, `report-*`) | run quick checks, operational smokes, and reports |
| `docs/` | Engineering docs, onboarding, planning, and product notes | understand conventions and architecture decisions |
| `artifacts/` | Local generated outputs (ignored) | inspect generated local files without polluting root |

## Canonical vs Compatibility Paths

- Prefer canonical paths for new imports:
  - `src/domains/*`
  - `src/platform/*`
  - `web/api/*`
  - `web/services/*`
  - `web/client/*`
- Compatibility paths still exist for migration safety:
  - `src/runtime/*`
  - `src/digest/*`
  - `web/routes/*`
  - top-level runtime shim files

When touching old paths, update callsites toward canonical paths in the same change when practical.

## Process Entry Checklist

- Digest run: `src/entrypoints/digest.js`
- Bot process: `src/entrypoints/bot-server.js`
- Scheduler loop: `src/entrypoints/scheduler-worker.js`
- Web server: `web/server.js`

## Pair With

- [First 30 Minutes](./onboarding-first-30-minutes.md)
- [Change-to-Test Map](./change-to-test-map.md)
- [Path and Import Rules](./contributing-path-rules.md)
