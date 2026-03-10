# Repository Map

## Runtime

- `src/entrypoints/`: runnable processes (`digest`, `bot`, `scheduler`)
- `src/domains/`: canonical domain imports (`digest`, `reply`, `personalization`, `engagement`)
- `src/platform/`: canonical platform imports (`config`, `store`, `mailer`, `scheduler`, `types`)
- `src/digest/` and `src/runtime/`: current implementation modules (migration-backed)
- `src/jobs/`: background job orchestration (`digest-runner`, reengagement)

## Web

- `web/server/`: canonical server runtime entrypoint exports
- `web/api/`: canonical API route grouping (`admin`, `core`, `public`)
- `web/services/`: service grouping indexes (`admin`, `user`, `shared`) and implementation files
- `web/client/`: canonical target for client-page/state/action modules
- `web/*.html` + static JS/CSS: compatibility static assets served in production

## Quality and Testing

- `tests/contracts/`: contract and integration tests
- `test-harness/`: quality harness and matrix suite runner
- `scripts/`: smoke, checks, and reporting scripts

## Docs and Collateral

- `docs/`: roadmap, planning, marketing, onboarding, and engineering guides
- `artifacts/` (ignored): generated local outputs
