# SignalBrief Reliability Recovery — Progress Tracker

> Recovery plan: [V3 plan](../docs/SPEC.md) | Implementation plan: [Phase 1 plan](superpowers/plans/2026-03-23-reliability-phase1.md)
> Started: 2026-03-23

---

## Phase 0 — Immediate Containment
**Status: COMPLETE** (pre-existing work from commits 8eaafcb, e9d78ea)

- [x] Cap scheduled digest retries at one rerun (commit 8eaafcb)
- [x] Stop scheduler loops after delivery failure (commit e9d78ea)
- [x] Feature freeze acknowledged

---

## Phase 1 — Runtime Controls
**Status: COMPLETE** (2026-03-23)
**Goal:** Make repeat burn loops structurally impossible.

### Task 1: New state paths ✅ commit 990e061
- [x] Add `spendGuardStatePath` and `circuitBreakerStatePath` to `runtime-state-paths-runtime.js`
- [x] Add both to `listRuntimeStateTargets` and `describeRuntimePathAlignment`

### Task 2: Spend guard runtime ✅
- [x] Create `src/entrypoints/digest-orchestrator-spend-guard-runtime.js`
- [x] Create `tests/contracts/entrypoints/digest-orchestrator-spend-guard-runtime.test.js`
- [x] All spend guard tests pass (`PASS: spend guard runtime`)

### Task 3: Circuit breaker runtime ✅ commit 527f327
- [x] Create `src/entrypoints/digest-orchestrator-circuit-breaker-runtime.js`
- [x] Create `tests/contracts/entrypoints/digest-orchestrator-circuit-breaker-runtime.test.js`
- [x] All circuit breaker tests pass (`PASS: circuit breaker runtime`)

### Task 4: Failure-class-aware retry ✅ commit 6a4681c
- [x] Add `isRetryEligibleFailureClass()` to `digest-delivery-policy-runtime.js`
- [x] Fix retry scheduling in `digest-orchestrator-delivery-runtime.js` to block non-transient
- [x] Add defense-in-depth filter in `digest-orchestrator-schedule-runtime.js`
- [x] `npm test` passes

### Task 5: Admission gate runtime ✅ commit b76f5ac
- [x] Create `src/entrypoints/digest-orchestrator-admission-gate-runtime.js`
- [x] Create `tests/contracts/entrypoints/digest-orchestrator-admission-gate-runtime.test.js`
- [x] All admission gate tests pass (`PASS: admission gate runtime`)

### Task 6: Wire into core orchestrator ✅
- [x] Initialize spend guard, circuit breaker, admission gate in `digest-orchestrator-core-runtime.js`
- [x] Inject admission gate check before fetch (scheduled runs only)
- [x] Wire circuit breaker evaluation after each delivery run
- [x] Record aborted runs in cost log with `run_value_state: aborted_non_deliverable_pre_spend`
- [x] `npm test` passes

### Phase 1 Exit Gate ✅
- [x] All new contracts pass (`PASS: admission gate runtime`, `PASS: circuit breaker runtime`, `PASS: spend guard runtime`)
- [x] 217 sidecar module contracts pass
- [x] `npm test` exits 0

---

## Phase 2 — Incident System
**Status: COMPLETE** (2026-03-23)
**Goal:** Replace hourly event deduplication with a persistent incident lifecycle (one root cause → one incident).

### Task P2-1: incidentStorePath in runtime paths ✅ commit c51d97f
- [x] Add `incidentStorePath` to `runtime-state-paths-runtime.js`
- [x] Add to `listRuntimeStateTargets` and `describeRuntimePathAlignment`

### Task P2-2: Persistent incident lifecycle runtime ✅ commits e7a27bd, 0fbdfe4
- [x] Rewrite `src/entrypoints/digest-orchestrator-incident-runtime.js`
- [x] Fingerprint-keyed store: `${mode}:${type}:${dateEt}`
- [x] OPEN → ESCALATED → RESOLVED lifecycle with severity WARNING/CRITICAL/FATAL
- [x] Telegram notifies only on lifecycle transitions (no hourly repeat spam)
- [x] Exported: `INCIDENT_STATUS_*`, `INCIDENT_SEVERITY_*` constants
- [x] Methods: `emitDigestIncident`, `resolveIncident`, `getActiveIncidents`
- [x] In-memory fallback per factory instance (isolation fix)
- [x] Rewrite `tests/contracts/entrypoints/digest-orchestrator-incident-runtime.test.js`
- [x] 5 contract test scenarios pass

### Task P2-3: Wire into core orchestrator ✅ commit 18609f9
- [x] Pass `incidentStorePath` to incident runtime factory in core orchestrator
- [x] Resolve active incidents when delivery succeeds (resolve-on-success)

### Phase 2 Exit Gate ✅
- [x] All new contract tests pass (5 scenarios)
- [x] All existing contracts pass
- [x] `npm test` exits 0

## Phase 3 — Recovery Tooling
**Status: NOT STARTED**
Deliver: snapshot-first recovery, recovery queue, admin actions

## Phase 4 — Dashboard and Economics
**Status: NOT STARTED**
Deliver: wasted spend metrics, spend by failure class, cost per successful digest

## Phase 5 — Guarded Production Validation
**Status: NOT STARTED**
Deliver: daily review, weekly recovery drill, staging chaos validation
