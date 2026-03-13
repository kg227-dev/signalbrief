# SignalBrief 6-Week Execution Plan

Start date: **March 16, 2026**  
End date: **April 26, 2026**  
Owner: Platform/Runtime

## Goal

Stabilize production reliability first, then decouple core runtime seams, then ship a safe state-backend migration path.  
Do **not** replatform compute during this window.

## Success Criteria (End of Week 6)

- Production recovery drill from backup completes in < 30 minutes.
- Deploy path is one-command (`npm run ops:deploy:prod`) with verification gates passing.
- Prod deploys are merge-gated by CI (no direct local-only push-to-prod path).
- Staging/preview environment exists and is required for runtime-behavior changes before prod.
- No single orchestrator/runtime composition file > 350 LOC in top critical paths.
- State backend can run behind a feature flag (file-store and DB-backed adapter).
- `qa:harness` composite score >= 75.
- Release path supports canary + one-command rollback by commit SHA.

## Week-by-Week and Day-by-Day Backlog

### Engineering Setup Gaps This Plan Now Explicitly Fixes (added Mar 12, 2026)

- Local machine -> prod VM coupling on small changes:
  - Fix: CI-gated merge-to-prod policy, staging verification lane, and canary rollout path.
- Missing repository CI workflows:
  - Fix: Add PR-required checks for tests, smoke contracts, and deploy verification dry-runs.
- Single-VM shared-state operational fragility:
  - Fix: Keep VM in this 6-week window, but isolate state concerns via store adapter + controlled backend cutover.
- Architecture still mid-migration:
  - Fix: Continue decomposition work on web/runtime seams with hard file-size and contract-test gates.
- High orphan/coupling and test-health debt:
  - Fix: Add explicit weekly burn-down targets and gate cutover on coverage/contract thresholds.

### Current Runtime Architecture Snapshot (audit observed Mar 13, 2026)

```text
root shims
  digest.js / bot-server.js / scheduler-worker.js
        |
        v
  src/entrypoints/*
        |
        +--> src/jobs/digest-runner-core-runtime
        |        |
        |        +--> src/entrypoints/digest-orchestrator-core-runtime
        |        |        |
        |        |        +--> src/digest/runtime/*
        |        |        +--> src/entrypoints/digest-orchestrator-delivery-runtime
        |        |        +--> src/runtime/quality-score.js
        |        |        +--> src/runtime/engagement/*
        |        |        +--> src/runtime/store-*.js
        |        |                 |
        |        |                 +--> src/platform/store/*
        |        |
        |        +--> lock / run-state files
        |
        +--> src/entrypoints/bot-server.js
        |        |
        |        +--> src/runtime/reply/*
        |
        +--> src/entrypoints/scheduler-worker.js
                 |
                 +--> src/jobs/digest-runner-core-runtime

web/server.js
  -> web/server-runtime.js
      -> web/server-runtime-deps-runtime.js   <--- actual DI hub
          |
          +--> web/api/core/index.js
          +--> web/api/admin/index.js
          +--> web/routes/*
                 |
                 +--> web/services/*
                        |
                        +--> src/domains/digest/*
                        +--> src/platform/store/*
                        +--> src/runtime/*

scripts/*
  -> deploy-production / staging / watchdog / backup / restore
  -> directly inspect runtime state, logs, and docker/ssh surfaces

test-harness/*
  -> runtime/pipeline.js
  -> suites/*

tests/contracts/*
  -> many import/export and existence assertions
```

## Week 1 (Mar 16-22) - Reliability Floor

### Day 1 (Mar 16) - Backups + Restore Drill (Start execution now)
- Files:
  - `scripts/backup-state.js`
  - `scripts/restore-state-drill.js`
  - `package.json`
  - `tests/contracts/harness/scripts/backup-state.test.js`
  - `tests/contracts/harness/scripts/restore-state-drill.test.js`
- Deliverables:
  - State backup script for `data/` + `archive/` with checksum manifest.
  - Restore-drill script that extracts backup to safe temp path and verifies checksums.
  - npm command wiring and contract tests.
- Exit criteria:
  - `npm run ops:backup:state` produces a timestamped archive.
  - `npm run ops:drill:restore-state -- --latest --clean` verifies manifest successfully.

### Day 2 (Mar 17) - Operational runbook and drill procedure
- Files:
  - `docs/planning/reliability-floor-runbook.md` (new)
  - `README.md`
- Deliverables:
  - Explicit backup cadence, retention policy, and restore drill checklist.
  - Host-level cron/systemd examples for backup execution.
- Exit criteria:
  - Another engineer can run backup + drill with docs only.

### Day 3 (Mar 18) - Deploy verification hardening
- Files:
  - `scripts/deploy-production.js`
  - `scripts/verify-runtime.js`
  - `tests/contracts/harness/scripts/*.test.js`
- Deliverables:
  - Stronger verification output and failure context on remote/public checks.
  - Explicit nonzero exit if any required gate fails.
- Exit criteria:
  - Verification failures return actionable diagnostics in one run.

### Day 4 (Mar 19) - Runtime health telemetry checks
- Files:
  - `scripts/watchdog-scheduler.js`
  - `web/routes/core-api*.js` (health payload only if needed)
  - `tests/contracts/web-api/routes/*.test.js`
- Deliverables:
  - Scheduler watchdog diagnostics and run-reason metadata.
  - Validation for stale heartbeat and restart flow.
- Exit criteria:
  - Smoke test catches stale scheduler state deterministically.

### Day 5 (Mar 20) - Week 1 verification + freeze
- Files:
  - `docs/planning/6-week-execution-plan-2026-03-16.md` (status update)
  - `docs/features.md` (if applicable)
- Deliverables:
  - Summarized week output + unresolved risks + next-week gate.
- Exit criteria:
  - 7-day deploy + health checklist defined and runnable.

## Week 2 (Mar 23-29) - Security + Config Hardening

### Day 6
- Enforce admin exposure defaults and remove unsafe bypass paths in production mode.

### Day 7
- Add startup config schema validation (fail-fast).

### Day 8
- Add route-level auth regression tests for admin and privileged APIs.

### Day 9
- Normalize settings input validation (`topics`, `days_of_week`, `items_per_digest`) server-side.

### Day 10
- Security hardening review and merge gate.

## Week 3 (Mar 30-Apr 5) - Digest Orchestrator Decomposition

### Day 11
- Split fetch/query orchestration out of `src/entrypoints/digest-orchestrator-core-runtime.js`.

### Day 12
- Split ranking/selection and repeat-suppression stage into dedicated modules.

### Day 13
- Split enrichment request/response handling.

### Day 14
- Introduce orchestrator seam tests for each stage.

### Day 15
- Parity run: compare output shape before/after refactor.

## Week 4 (Apr 6-12) - Web Runtime Decomposition

### Day 16
- Extract dependency composition blocks from `web/server-runtime.js`.

### Day 17
- Split route bootstrap per domain (core/admin/public) and enforce import-boundary checks.
- Add/enable repo CI workflow for PR checks (`npm test`, `smoke:worker`, `smoke:admin-scheduler`, targeted contract suites).
- Exit criteria:
  - PR checks run in CI and fail closed on regressions.
  - Direct pushes to `main` are no longer required for normal iteration.

### Day 18
- Isolate auth/session/error policies.
- Stand up staging/preview deploy target (same runtime shape as prod, lower blast radius).
- Exit criteria:
  - Runtime behavior changes can be validated on staging before prod deploy.
  - Staging has `/`, cache-busted asset render, and `/api/health/scheduler` checks wired.

### Day 19
- Route-level contract tests and failure-mode tests.
- Introduce release policy doc: when to ship immediately vs batch, required gates, rollback owner.
- Exit criteria:
  - Release policy is documented and linked from `README.md`.
  - Contract tests cover core/admin/public failure paths for auth/session/serialization.

### Day 20
- File-size/complexity pass and cleanup.
- Add explicit coupling/orphan reduction pass for `web/**` and `src/entrypoints/**`.
- Exit criteria:
  - Web/runtime critical files meet size target.
  - Measurable reduction in coupling/orphan findings from baseline scan.

## Week 5 (Apr 13-19) - State Backend Abstraction

### Day 21
- Introduce store interface and adapter boundary.

### Day 22
- Implement SQLite adapter in parallel with file-store behavior parity.
- Include write-path contention and recovery tests to retire shared-file fragility risks.

### Day 23
- Add migration utility (`file -> sqlite`) with idempotent replay.
- Add release artifact + migration preflight checklist for VM execution safety.

### Day 24
- Dual-read compare mode in staging/local verification.
- Add CI job for dual-read parity contracts on representative fixture set.

### Day 25
- Migration risk review and go/no-go checklist for cutover.
- Include explicit rollback-to-file-store path and verification script.

## Week 6 (Apr 20-26) - Controlled Cutover (Hybrid Complete)

### Day 26
- Deploy feature-flagged state backend path to production (dark).
- Add canary cohort + automated rollback trigger thresholds.

### Day 27
- Enable backend for small cohort / shadow compare.
- Require CI green + staging green before each cohort expansion.

### Day 28
- Full enablement with rollback switch validated.
- Enforce release batching cadence (non-hotfix changes shipped in planned windows).

### Day 29
- Run live rollback drill and measure recovery time.
- Validate one-command rollback by commit SHA + post-rollback health checklist.

### Day 30
- Stabilization report, metrics closeout, and next-quarter infra decision.
- Include decision memo: stay single-VM hardened vs managed-platform migration trigger conditions.

## Audit-Derived Carry-Forward Backlog (added Mar 13, 2026)

These items extend the existing execution plan without replacing completed day goals. Keep them priority-ordered and fold them into the next available reliability, security, runtime-decomposition, and cutover windows.

- [ ] P1 `Security` remove tracked secrets from runtime config, rotate exposed admin/provider credentials, and move runtime secret loading to environment/secret storage.
  - Files: `config.json`, `config.example.json`, `README.md`
  - Target window: immediate hotfix before further prod changes
  - Recommendation: scrub tracked secret material, document env-based setup, and verify no secret-bearing config remains in git history going forward.
  - Status (Mar 13, 2026): env-first secret loading implemented in `src/runtime/config-provider.js`, `config.json` confirmed ignored/untracked for local-only use, and `.env.example` + README secret setup guidance added. External provider/admin credential rotation is still required and remains open.
- [x] P2 `Security` restrict CORS to explicit trusted origins and stop returning full user records from bearer-token query access.
  - Files: `web/server-request-runtime.js`, `web/server-runtime-request-policy-runtime.js`, `web/routes/core-api.js`
  - Target window: Week 2 spillover
  - Recommendation: replace `Access-Control-Allow-Origin: *` on privileged JSON surfaces, and require a narrower authenticated/signed-user fetch path.
  - Status (Mar 13, 2026): wildcard CORS removed in runtime response helpers and preflight policy now enforces explicit trusted origins (`TRUSTED_CORS_ORIGINS` / `CORS_ALLOWED_ORIGINS`); `/api/user` now returns a sanitized public user record instead of full stored user data.
- [x] P3 `Security` replace weak unsubscribe signing and retire the legacy email+signature unsubscribe bridge after a migration window.
  - Files: `src/runtime/mailer/mailer-runtime.js`, `web/routes/core-api-unsubscribe-actions-runtime.js`
  - Target window: Week 2 spillover
  - Recommendation: use a dedicated unsubscribe secret or nonce-backed token and remove compatibility routes once old links expire.
  - Status (Mar 13, 2026): unsubscribe signing now uses dedicated secret input (`SIGNALBRIEF_UNSUBSCRIBE_SIGNING_SECRET`) with verifier support for both new and legacy signatures; legacy email+sig routes are now retirement-gated by `UNSUBSCRIBE_LEGACY_RETIRE_AFTER_UTC` (plus force enable/disable flags) and return `410` after retirement.
- [ ] P4 `Architecture` make module-linkage enforcement real again and fail CI on actual boundary violations.
  - Files: `package.json`, `scripts/check-module-linkage.mjs`, `scripts/module-linkage.mjs`, `src/dependency-links.mjs`
  - Target window: Week 4 follow-up
  - Recommendation: execute the real graph checker in CI, repair stale imports, and keep worktree mirrors out of canonical dependency analysis.
- [ ] P5 `Architecture` split `web/server-runtime-deps-runtime.js` into smaller bounded registries so web-core, admin, digest, and store concerns stop flowing through one dependency hub.
  - Files: `web/server-runtime-deps-runtime.js`, `web/server-runtime.js`, `web/api/**`, `web/routes/**`
  - Target window: Week 4 spillover
  - Recommendation: reduce the DI surface to explicit registries and route bundles with import-boundary contract tests per registry.
- [ ] P6 `Architecture` continue digest runtime decomposition until fetch, enrich, archive, cost, and delivery coordination no longer live in one orchestrator file.
  - Files: `src/entrypoints/digest-orchestrator-core-runtime.js`, `src/entrypoints/digest-orchestrator-delivery-runtime.js`, `src/digest/runtime/**`
  - Target window: Week 3 spillover
  - Recommendation: keep the orchestrator as a thin coordinator and move IO-heavy behavior into narrowly scoped runtimes with parity tests.
- [ ] P7 `Resilience` add provider-specific timeout budgets, 429/5xx retry rules, and partial-delivery degradation when Anthropic or Perplexity are unhealthy.
  - Files: `src/digest/runtime/digest-data-enrich-runtime.js`, `src/digest/runtime/digest-data-fetch-runtime.js`, `src/entrypoints/digest-orchestrator-core-runtime.js`
  - Target window: Week 3 / Week 4 reliability spillover
  - Recommendation: treat provider failure as a graded incident path instead of an all-or-nothing digest failure.
- [ ] P8 `Resilience` move `/digest` cooldown from process memory to the persistent lock/lease mechanism so multi-process or restarted runtimes cannot bypass the throttle window.
  - Files: `src/runtime/reply/reply-command-digest-runtime.js`, `src/jobs/digest-runner-core-runtime.js`
  - Target window: Week 1 or Week 3 spillover
  - Recommendation: unify user-facing cooldown and actual run-lock semantics in one source of truth.
- [ ] P9 `State Backend` make SQLite the default production backend path once parity evidence is stable, keeping file-store rollback as an explicit emergency fallback only.
  - Files: `src/runtime/store-core-runtime.js`, `scripts/migrate-store-file-to-sqlite.js`, `scripts/store-dual-read-compare.js`, `scripts/store-rollback-sqlite-to-file.js`
  - Target window: Week 6 cutover continuation
  - Recommendation: complete the migration by changing the production default after sustained canary parity and rollback drills.
- [ ] P10 `Performance` remove whole-file scans from user lookup, engagement analysis, and archive reads on hot paths.
  - Files: `src/runtime/store-record-runtime.js`, `src/runtime/engagement/engagement-events-runtime.js`, `web/routes/core-api-archive-runtime.js`
  - Target window: Week 5 / Week 6 spillover
  - Recommendation: replace directory scans and full-file loads with indexed queries, pagination, or bounded reads.
- [ ] P11 `Observability` convert runtime logging to structured events with stable `run_id`, `user_id`, provider, and outcome fields.
  - Files: `src/entrypoints/digest-orchestrator-core-runtime.js`, `web/server-runtime.js`, `start.sh`
  - Target window: Week 1 / Week 4 spillover
  - Recommendation: move from ad hoc line logging to machine-parseable events that can support incident reconstruction.
- [ ] P12 `QA` replace syntax-only contract checks on hot paths with behavior-oriented assertions for digest output, auth, retries, and failure handling.
  - Files: `tests/contracts/entrypoints/*.test.js`, `tests/contracts/harness/**/*.test.js`, `scripts/test-critical-paths.js`
  - Target window: Week 4 / Week 5 spillover
  - Recommendation: keep import smoke checks if useful, but shift the merge gate toward behavioral contracts and runtime parity assertions.
- [ ] P13 `Release Process` enforce staging-before-prod in automation instead of relying only on documentation and operator discipline.
  - Files: `package.json`, `scripts/deploy-production.js`, `scripts/deploy-staging.js`, `docs/planning/release-policy.md`
  - Target window: Week 4 / Week 6 spillover
  - Recommendation: require passing staging verification or an explicit override before `ops:deploy:prod` can proceed.
- [ ] P14 `DevOps` harden the container build with multi-stage image construction, pinned install behavior, and explicit readiness expectations.
  - Files: `Dockerfile`, `docker-compose.yml`
  - Target window: Week 1 or Week 6 spillover
  - Recommendation: shrink and harden the runtime image so local/staging/prod behavior is more reproducible.
- [ ] P15 `Debt Burn-Down` remove legacy compatibility surface still carried by root entry shims, old bot-token fallback logic, and deprecated unsubscribe routes once replacement paths are fully stable.
  - Files: `digest.js`, `bot-server.js`, `scheduler-worker.js`, `src/entrypoints/bot-server.js`, `web/routes/core-api-unsubscribe-actions-runtime.js`
  - Target window: after Week 6 stabilization report
  - Recommendation: define retirement criteria for each compatibility path and delete them once observability confirms no remaining callers.

## Progress Log

- [x] Day 1 started and executed: backup + restore drill tooling implemented with tests and npm commands.
- [x] Day 2 completed: runbook added (`docs/planning/reliability-floor-runbook.md`) and commands validated (`ops:backup:state`, `ops:drill:restore-state -- --latest --clean`).
- [x] Day 3 completed: deploy/runtime verification hardened with retry-aware public checks, richer failure diagnostics, and script contract tests.
- [x] Day 4 completed: scheduler watchdog diagnostics + run-reason metadata added and smoke test now deterministically validates stale scheduler health before recovery.
- [x] Day 5 completed: week freeze report added (`docs/planning/week1-freeze-2026-03-11.md`) with unresolved risks, Week 2 entry gate, and a runnable 7-day deploy + health checklist.
- [x] Day 6 completed: admin local bypass is now explicit non-production only and read-only route scoped; added regression contract test coverage and smoke-script/runtime docs updates.
- [x] Day 7 completed: startup config schema validation now fails fast on invalid `config.json` shape/values, with new critical-path coverage for schema pass/fail contracts.
- [x] Day 8 completed: added route-level admin auth regression coverage across protected `/api/admin/*` endpoints (stats, user/audit, run-digest, bulk, messaging, sandbox, mutating actions) plus `/api/admin/check` unauthenticated-state assertion.
- [x] Day 9 completed: `/api/settings` now canonicalizes and validates topics, enforces non-empty normalized `days_of_week` (0-6 sorted/deduped), and clamps `items_per_digest` to supported settings bounds; added handler + critical-path regression coverage.
- [x] Day 10 completed: security hardening review published with explicit merge-gate contract and verification evidence (`docs/planning/week2-security-hardening-review-2026-03-12.md`).
- [x] Day 11 completed: fetch/query orchestration extracted from `digest-orchestrator-core-runtime` into `digest-orchestrator-fetch-runtime` with parity contract coverage for targeted-topic fetch scoping, custom-topic fan-out, and zero-result incident signaling.
- [x] Day 12 completed: ranking/selection and repeat-suppression stages extracted into dedicated runtime modules (`digest-orchestrator-selection-runtime`, `digest-orchestrator-delivery-ranking-runtime`) with contract coverage for fallback/incident paths and per-user freshness behavior.
- [x] Day 13 completed: enrichment request/response handling extracted into `digest-orchestrator-enrichment-runtime` so orchestration normalizes enriched payload + Claude token usage through a dedicated stage contract.
- [x] Day 14 completed: added orchestrator seam coverage that executes fetch -> selection -> enrichment -> delivery-ranking stage contracts end-to-end with deterministic stubs to guard stage interface regressions.
- [x] Day 15 completed: added parity-shape contract coverage that locks stage output schemas (fetch, selection, enrichment, delivery-ranking) so refactor follow-ups preserve runtime interface compatibility.
- [x] Day 16 completed: extracted web runtime dependency composition blocks into `web/server-runtime-deps-runtime.js`, keeping route wiring behavior intact while reducing `web/server-runtime.js` coupling; added route-composition contract coverage.
- [x] Day 17 completed: split web route bootstrap dispatch into `web/server-runtime-route-bootstrap-runtime.js`, added import-boundary contract coverage for server/runtime route composition seams, and enabled CI PR gates via `.github/workflows/ci.yml` (`check:module-linkage`, `npm test`, `smoke:worker`, `smoke:admin-scheduler`).
- [x] Day 18 completed: isolated web auth/session policy (`web/server-runtime-auth-session-policy-runtime.js`) and request/error transport policy (`web/server-runtime-request-policy-runtime.js`) from server composition flow, added seam contracts, and introduced a staging deploy lane (`npm run ops:deploy:staging`) with documented pre-prod gates in `README.md`.
- [x] Day 19 completed: expanded route-level contract and failure-mode coverage for core/admin/public handlers (`tests/contracts/web-api/routes/*.test.js`) and published a staging-first release policy with hotfix path + rollback requirements (`docs/planning/release-policy.md`, linked from `README.md`).
- [x] Day 20 completed: extracted scheduler-control orchestration out of `web/server-runtime.js` into `web/server-runtime-scheduler-control-runtime.js` (server runtime reduced to 341 LOC from 361), added scheduler-control seam contracts, and revalidated module-linkage + critical-path + smoke gates.
- [x] Day 21 completed: introduced explicit store adapter boundary via `store-adapter-contract-runtime` + `store-adapter-file-runtime`, wired `createStore` to use adapter factories (default file-store adapter), and added adapter contract/injection tests for parity-safe backend substitution.
- [x] Day 22 completed: implemented opt-in SQLite store adapter (`store-adapter-sqlite-runtime`) behind the adapter boundary with backend selection (`SIGNALBRIEF_STORE_BACKEND=sqlite`) and parity-focused contract coverage while keeping file-store as default.
- [x] Day 23 completed: shipped `scripts/migrate-store-file-to-sqlite.js` (idempotent file->sqlite replay with preflight gating + release artifact output), added npm entrypoints (`ops:store:migrate:file-to-sqlite*`), and documented VM execution checklist/evidence contract (`docs/planning/week5-day23-store-migration-preflight.md`).
- [x] Day 24 completed: added `scripts/store-dual-read-compare.js` parity mode for local/staging verification (file vs sqlite) with JSON artifact output, introduced representative fixtures under `tests/fixtures/store-dual-read/data`, and wired CI gate job `store-dual-read-parity` to enforce migration+compare parity before merge.
- [x] Day 25 completed: added explicit rollback runtime (`scripts/store-rollback-sqlite-to-file.js`) with strict post-rollback verification (`scripts/store-rollback-verify.js`), and published migration risk review + go/no-go/rollback checklist (`docs/planning/week5-day25-cutover-risk-review.md`).
- [x] Day 26 completed: introduced canary backend routing mode (`SIGNALBRIEF_STORE_BACKEND=canary`) with cohort targeting + mirror-write support, added threshold-based canary guard automation (`scripts/store-canary-guard.js`), and documented dark-deploy/canary operations (`docs/planning/week6-day26-canary-dark-deploy.md`).
- [x] Day 27 completed: added canary cohort expansion gate automation (`scripts/store-canary-cohort-update.js`) that blocks cohort growth unless CI-equivalent checks and staging health gates pass, with artifacted evidence + rollout exports documented in `docs/planning/week6-day27-canary-cohort-expansion.md`.
- [x] Day 28 completed: enforced production release batching windows directly in `ops:deploy:prod` (hotfix/manual overrides explicit), added full-enable readiness validation (`scripts/store-full-enable-validate.js`) with rollback-switch safety checks, and documented operations in `docs/planning/week6-day28-full-enable-release-batching.md`.
- [x] Day 29 completed: shipped one-command rollback by SHA (`ops:rollback:sha`) with commit-archive deploy path + post-rollback health checklist validation, and executed a live rollback drill (`f5951c5` -> `d8701dc`) with artifacted timings in `artifacts/releases/week6-day29-live-drill-r3.json` (`rollback=37.692s`, `restore=34.812s`).
- [x] Day 30 completed: published stabilization metrics closeout (`docs/planning/week6-day30-stabilization-report.md`) and infra decision memo with explicit managed-platform migration triggers (`docs/planning/week6-day30-infra-decision-memo.md`).
- [x] Carry-forward P1 (phase 1) started: moved runtime secret resolution to env-first config provider (`SIGNALBRIEF_*` overrides), confirmed `config.json` remains local-only via `.gitignore`, and added contract coverage in `tests/contracts/harness/runtime/config-provider.test.js`; external key rotation remains a required manual follow-up.
- [x] Carry-forward P2 completed: CORS now allows only explicit trusted origins (no wildcard defaults), and `/api/user` now returns a redacted public profile payload instead of full persisted user records.
- [x] Carry-forward P3 completed: added dedicated unsubscribe signing secret support, upgraded legacy signature verification, and introduced env-driven retirement controls for legacy email+signature unsubscribe routes.
