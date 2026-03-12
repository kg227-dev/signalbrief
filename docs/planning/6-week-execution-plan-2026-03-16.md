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
- No single orchestrator/runtime composition file > 350 LOC in top critical paths.
- State backend can run behind a feature flag (file-store and DB-backed adapter).
- `qa:harness` composite score >= 75.

## Week-by-Week and Day-by-Day Backlog

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
- Split route bootstrap per domain (core/admin/public).

### Day 18
- Isolate auth/session/error policies.

### Day 19
- Route-level contract tests and failure-mode tests.

### Day 20
- File-size/complexity pass and cleanup.

## Week 5 (Apr 13-19) - State Backend Abstraction

### Day 21
- Introduce store interface and adapter boundary.

### Day 22
- Implement SQLite adapter in parallel with file-store behavior parity.

### Day 23
- Add migration utility (`file -> sqlite`) with idempotent replay.

### Day 24
- Dual-read compare mode in staging/local verification.

### Day 25
- Migration risk review and go/no-go checklist for cutover.

## Week 6 (Apr 20-26) - Controlled Cutover (Hybrid Complete)

### Day 26
- Deploy feature-flagged state backend path to production (dark).

### Day 27
- Enable backend for small cohort / shadow compare.

### Day 28
- Full enablement with rollback switch validated.

### Day 29
- Run live rollback drill and measure recovery time.

### Day 30
- Stabilization report, metrics closeout, and next-quarter infra decision.

## Progress Log

- [x] Day 1 started and executed: backup + restore drill tooling implemented with tests and npm commands.
- [x] Day 2 completed: runbook added (`docs/planning/reliability-floor-runbook.md`) and commands validated (`ops:backup:state`, `ops:drill:restore-state -- --latest --clean`).
- [x] Day 3 completed: deploy/runtime verification hardened with retry-aware public checks, richer failure diagnostics, and script contract tests.
- [x] Day 4 completed: scheduler watchdog diagnostics + run-reason metadata added and smoke test now deterministically validates stale scheduler health before recovery.
- [x] Day 5 completed: week freeze report added (`docs/planning/week1-freeze-2026-03-11.md`) with unresolved risks, Week 2 entry gate, and a runnable 7-day deploy + health checklist.
- [x] Day 6 completed: admin local bypass is now explicit non-production only and read-only route scoped; added regression contract test coverage and smoke-script/runtime docs updates.
- [x] Day 7 completed: startup config schema validation now fails fast on invalid `config.json` shape/values, with new critical-path coverage for schema pass/fail contracts.
- [x] Day 8 completed: added route-level admin auth regression coverage across protected `/api/admin/*` endpoints (stats, user/audit, run-digest, bulk, messaging, sandbox, mutating actions) plus `/api/admin/check` unauthenticated-state assertion.
