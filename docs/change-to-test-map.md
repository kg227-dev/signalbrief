# Change-to-Test Map

Use this as the default "what should I run?" guide before opening a PR.

## Fast Rule

- Always run `npm test`.
- Add only the subsystem checks that match your changes.

## Subsystem Test Matrix

| If you changed... | Run these commands | Why |
| --- | --- | --- |
| `src/digest/*`, `src/domains/digest/*`, selection/scoring logic | `npm test` + `npm run qa:harness` + `npm run qa:matrix` | validates ranking quality and matrix stability |
| `src/runtime/reply/*`, `src/domains/reply/*`, bot command handling | `npm test` + `npm run smoke:worker` | catches reply-command and scheduler-trigger regressions |
| `src/platform/mailer/*`, `src/runtime/mailer*`, email formatting/sending | `npm test` + `npm run smoke:worker` | verifies delivery pathway and worker-run flow |
| `src/platform/store/*`, `src/runtime/store*`, user/archive persistence | `npm test` | validates core state contracts and storage behavior |
| `web/server*`, `web/api/*`, `web/routes/*`, `web/services/*` | `npm test` + `npm run smoke:admin-scheduler` | verifies API wiring and admin scheduler behavior |
| `web/*.html`, `web/*.js`, settings/onboarding client flow | `npm test` + `npm run smoke:admin-scheduler` | catches UI/runtime integration breaks through route checks |
| `test-harness/*` | `npm test` + `npm run qa:harness` + `npm run qa:matrix` | ensures harness and matrix behavior remain consistent |
| `scripts/smoke-*`, `scripts/check-*`, `scripts/report-*` | `npm test` + script-specific command | confirms script contract stays runnable |
| `*.md`, doc moves, doc indexes | manual link/path verification | confirm canonical docs remain reachable from `README.md` or `docs/INDEX.md` and moved markdown links still resolve |

## Contract Test Locations

- Entrypoints: `tests/contracts/entrypoints/`
- Web API: `tests/contracts/web-api/`
- Jobs: `tests/contracts/jobs/`
- Harness: `tests/contracts/harness/`

If you move modules, run `npm test` to confirm contract imports still resolve.
