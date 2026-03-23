# Reliability Recovery Phase 1 — Runtime Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the March 23 burn-loop failure mode structurally impossible by adding a pre-spend admission gate, spend guard hierarchy, global circuit breaker, and failure-class-aware retry policy.

**Architecture:** Four new/modified modules plugged into the existing orchestrator. The admission gate runs after `resolveDueUsers` and before `orchestrateFetch`. The circuit breaker evaluates after each delivery. The spend guard tracks zero-value run history in a new state file. The retry policy change removes non-transient failures from the retry queue.

**Tech Stack:** Node.js stdlib only (fs, path). All state in JSON files under `data/`. No new npm dependencies.

**Progress tracker:** `docs/reliability-recovery-progress.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `src/runtime/runtime-state-paths-runtime.js` | Add `spendGuardStatePath`, `circuitBreakerStatePath` |
| Create | `src/entrypoints/digest-orchestrator-spend-guard-runtime.js` | Zero-value spend tracking at per-user/date, rolling 6h, ET-date daily levels |
| Create | `tests/contracts/entrypoints/digest-orchestrator-spend-guard-runtime.test.js` | Spend guard contract + behavior tests |
| Create | `src/entrypoints/digest-orchestrator-circuit-breaker-runtime.js` | Open/closed state, trigger evaluation, sticky until admin resume |
| Create | `tests/contracts/entrypoints/digest-orchestrator-circuit-breaker-runtime.test.js` | Circuit breaker contract + behavior tests |
| Modify | `src/runtime/digest-delivery-policy-runtime.js` | Add `isRetryEligibleFailureClass()`, `TRANSIENT_FAILURE_CLASSES` |
| Modify | `src/entrypoints/digest-orchestrator-delivery-runtime.js` | Gate retry scheduling behind `isRetryEligibleFailureClass` |
| Modify | `src/entrypoints/digest-orchestrator-schedule-runtime.js` | Defense-in-depth: filter users with non-transient underfill in retry state |
| Create | `src/entrypoints/digest-orchestrator-admission-gate-runtime.js` | Pre-spend gate combining all guard checks |
| Create | `tests/contracts/entrypoints/digest-orchestrator-admission-gate-runtime.test.js` | Admission gate contract + behavior tests |
| Modify | `src/entrypoints/digest-orchestrator-core-runtime.js` | Wire gate + circuit breaker, record aborted runs |

---

## Task 1: New State Paths

**Files:**
- Modify: `src/runtime/runtime-state-paths-runtime.js`

- [ ] **Step 1: Write the failing test**

Add assertions to a temporary inline script (run manually, not committed):
```bash
node -e "
const { resolveSignalBriefRuntimePaths, listRuntimeStateTargets } = require('./src/runtime/runtime-state-paths-runtime');
const paths = resolveSignalBriefRuntimePaths({ appRoot: process.cwd() });
const assert = require('assert');
assert.ok(paths.spendGuardStatePath, 'spendGuardStatePath must exist');
assert.ok(paths.circuitBreakerStatePath, 'circuitBreakerStatePath must exist');
const targets = listRuntimeStateTargets(paths);
assert.ok(targets.some(t => t.key === 'spendGuardStatePath'), 'spendGuardStatePath in targets');
assert.ok(targets.some(t => t.key === 'circuitBreakerStatePath'), 'circuitBreakerStatePath in targets');
console.log('FAIL: expected assertions to throw before this line');
"
```
Expected: `AssertionError` — `spendGuardStatePath must exist`

- [ ] **Step 2: Implement**

In `resolveSignalBriefRuntimePaths`, add after `preferredSourcesPath`:
```js
const spendGuardStatePath = resolveOptionalPath(
  options.spendGuardStatePath || readEnvValue(env, "SIGNALBRIEF_SPEND_GUARD_STATE_PATH"),
  path.join(dataDir, "spend-guard-state.json")
);
const circuitBreakerStatePath = resolveOptionalPath(
  options.circuitBreakerStatePath || readEnvValue(env, "SIGNALBRIEF_CIRCUIT_BREAKER_STATE_PATH"),
  path.join(dataDir, "circuit-breaker.json")
);
```

Add both to the return object, to `listRuntimeStateTargets`, and to `describeRuntimePathAlignment`'s `componentRoots` and divergence checks.

In `listRuntimeStateTargets`, add:
```js
{ key: "spendGuardStatePath", path: paths.spendGuardStatePath, kind: "file" },
{ key: "circuitBreakerStatePath", path: paths.circuitBreakerStatePath, kind: "file" },
```

In `describeRuntimePathAlignment`, add to `componentRoots`:
```js
spend_guard: deriveComponentRoot(paths.spendGuardStatePath, dataRoot),
circuit_breaker: deriveComponentRoot(paths.circuitBreakerStatePath, dataRoot),
```

And add divergence checks:
```js
if (componentRoots.spend_guard !== dataRoot) divergentComponents.push("spend_guard");
if (componentRoots.circuit_breaker !== dataRoot) divergentComponents.push("circuit_breaker");
```

- [ ] **Step 3: Run to verify**

```bash
node -e "
const { resolveSignalBriefRuntimePaths, listRuntimeStateTargets } = require('./src/runtime/runtime-state-paths-runtime');
const paths = resolveSignalBriefRuntimePaths({ appRoot: process.cwd() });
const assert = require('assert');
assert.ok(paths.spendGuardStatePath, 'spendGuardStatePath must exist');
assert.ok(paths.circuitBreakerStatePath, 'circuitBreakerStatePath must exist');
const targets = listRuntimeStateTargets(paths);
assert.ok(targets.some(t => t.key === 'spendGuardStatePath'));
assert.ok(targets.some(t => t.key === 'circuitBreakerStatePath'));
console.log('PASS');
"
```
Expected: `PASS`

- [ ] **Step 4: npm test**

```bash
npm test
```
Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add src/runtime/runtime-state-paths-runtime.js
git commit -m "feat(reliability): add spend guard and circuit breaker state paths"
```

---

## Task 2: Spend Guard Runtime

**Files:**
- Create: `src/entrypoints/digest-orchestrator-spend-guard-runtime.js`
- Create: `tests/contracts/entrypoints/digest-orchestrator-spend-guard-runtime.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/contracts/entrypoints/digest-orchestrator-spend-guard-runtime.test.js`:
```js
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { assertNodeSyntaxFile, assertModuleExports } = require("../../test-support/module-contract-helper.js");

const TARGET_REL = "src/entrypoints/digest-orchestrator-spend-guard-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);
const { createDigestOrchestratorSpendGuardRuntime } = runtime;
assert.strictEqual(typeof createDigestOrchestratorSpendGuardRuntime, "function", "must export factory");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-spend-guard-test-"));
const spendGuardStatePath = path.join(tmpDir, "spend-guard-state.json");

try {
  let fakeNow = new Date("2026-03-23T08:00:00.000Z");
  const guard = createDigestOrchestratorSpendGuardRuntime({
    fs,
    path,
    spendGuardStatePath,
    log: () => {},
    nowProvider: () => new Date(fakeNow),
  });

  // Rolling and daily spend start at 0
  assert.strictEqual(guard.queryRollingZeroValueSpend(6), 0, "initial rolling spend is 0");
  assert.strictEqual(guard.queryDailyZeroValueSpend("2026-03-23"), 0, "initial daily spend is 0");
  assert.strictEqual(guard.hasUserDateZeroValueAttempt("u1", "2026-03-23"), false, "no attempt initially");

  // Record one zero-value run
  guard.recordZeroValueRun({
    runId: "scheduled:run-1",
    dateEt: "2026-03-23",
    userId: "u1",
    failureClass: "retrieval_thin",
    costUsd: 0.15,
  });

  assert.ok(Math.abs(guard.queryRollingZeroValueSpend(6) - 0.15) < 0.0001, "rolling spend includes run");
  assert.ok(Math.abs(guard.queryDailyZeroValueSpend("2026-03-23") - 0.15) < 0.0001, "daily spend includes run");
  assert.strictEqual(guard.hasUserDateZeroValueAttempt("u1", "2026-03-23"), true, "user/date cap hit");
  assert.strictEqual(guard.hasUserDateZeroValueAttempt("u2", "2026-03-23"), false, "different user not hit");
  assert.strictEqual(guard.hasUserDateZeroValueAttempt("u1", "2026-03-24"), false, "different date not hit");

  // Rolling cap check
  const rolling = guard.checkRollingWindowCap(1.0, 6);
  assert.strictEqual(rolling.hit, false, "under rolling cap");
  assert.ok(Math.abs(rolling.spent - 0.15) < 0.0001);

  guard.recordZeroValueRun({ runId: "r2", dateEt: "2026-03-23", userId: "u2", failureClass: "retrieval_thin", costUsd: 0.90 });
  const rollingOver = guard.checkRollingWindowCap(1.0, 6);
  assert.strictEqual(rollingOver.hit, true, "over rolling cap after second run");

  // Daily cap check
  const daily = guard.checkDailyCap("2026-03-23", 2.5);
  assert.strictEqual(daily.hit, false, "under daily cap");

  guard.recordZeroValueRun({ runId: "r3", dateEt: "2026-03-23", userId: "u3", failureClass: "ranking_policy_limited", costUsd: 2.0 });
  const dailyOver = guard.checkDailyCap("2026-03-23", 2.5);
  assert.strictEqual(dailyOver.hit, true, "over daily cap");

  // Old runs (>6h) excluded from rolling window but not daily total
  fakeNow = new Date("2026-03-23T15:00:00.000Z"); // 7 hours later
  const guardLater = createDigestOrchestratorSpendGuardRuntime({
    fs,
    path,
    spendGuardStatePath,
    log: () => {},
    nowProvider: () => new Date(fakeNow),
  });
  const rollingLater = guardLater.queryRollingZeroValueSpend(6);
  // The runs from 08:00 are now >6h old at 15:00; rolling window should be 0
  assert.strictEqual(rollingLater, 0, "old runs outside rolling window");

  console.log("PASS: spend guard runtime");
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
```

- [ ] **Step 2: Run to verify it fails**

```bash
node tests/contracts/entrypoints/digest-orchestrator-spend-guard-runtime.test.js
```
Expected: `Error: Cannot find module` or `AssertionError`

- [ ] **Step 3: Create the implementation**

Create `src/entrypoints/digest-orchestrator-spend-guard-runtime.js`:
```js
"use strict";

const SPEND_GUARD_VERSION = 1;
const PRUNE_AFTER_HOURS = 24;

function createDigestOrchestratorSpendGuardRuntime(deps) {
  const {
    fs,
    path,
    spendGuardStatePath,
    log,
    nowProvider = () => new Date(),
  } = deps || {};
  const logger = typeof log === "function" ? log : () => {};

  function writeJsonAtomic(filePath, payload) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf8");
    fs.renameSync(tmp, filePath);
  }

  function loadState() {
    try {
      return JSON.parse(fs.readFileSync(spendGuardStatePath, "utf8"));
    } catch (e) {
      if (e && e.code !== "ENOENT") logger(`[spend-guard] load failed: ${e.message}`);
      return { version: SPEND_GUARD_VERSION, zero_value_runs: [] };
    }
  }

  function pruneRuns(runs, nowMs) {
    const cutoff = nowMs - PRUNE_AFTER_HOURS * 60 * 60 * 1000;
    return (Array.isArray(runs) ? runs : []).filter((run) => {
      const ts = Date.parse(String(run?.ts_utc || ""));
      return Number.isFinite(ts) && ts >= cutoff;
    });
  }

  function recordZeroValueRun(params = {}) {
    const { runId, dateEt, userId, failureClass, costUsd } = params;
    const now = nowProvider();
    const state = loadState();
    const runs = pruneRuns(state.zero_value_runs || [], now.getTime());
    runs.push({
      ts_utc: now.toISOString(),
      date_et: String(dateEt || "").trim(),
      run_id: String(runId || "").trim(),
      user_id: String(userId || "").trim(),
      failure_class: String(failureClass || "").trim(),
      cost_usd: Math.max(0, Number(costUsd || 0)),
    });
    writeJsonAtomic(spendGuardStatePath, {
      version: SPEND_GUARD_VERSION,
      updated_at: now.toISOString(),
      zero_value_runs: runs,
    });
  }

  function queryRollingZeroValueSpend(windowHours = 6) {
    const now = nowProvider();
    const cutoff = now.getTime() - Math.max(1, Number(windowHours || 6)) * 60 * 60 * 1000;
    return (loadState().zero_value_runs || []).reduce((sum, run) => {
      const ts = Date.parse(String(run?.ts_utc || ""));
      if (!Number.isFinite(ts) || ts < cutoff) return sum;
      return sum + Math.max(0, Number(run?.cost_usd || 0));
    }, 0);
  }

  function queryDailyZeroValueSpend(dateEt) {
    const target = String(dateEt || "").trim();
    return (loadState().zero_value_runs || []).reduce((sum, run) => {
      if (String(run?.date_et || "").trim() !== target) return sum;
      return sum + Math.max(0, Number(run?.cost_usd || 0));
    }, 0);
  }

  function hasUserDateZeroValueAttempt(userId, dateEt) {
    const uid = String(userId || "").trim();
    const date = String(dateEt || "").trim();
    if (!uid || !date) return false;
    return (loadState().zero_value_runs || []).some(
      (run) => String(run?.user_id || "").trim() === uid && String(run?.date_et || "").trim() === date
    );
  }

  function checkRollingWindowCap(thresholdUsd = 1.0, windowHours = 6) {
    const spent = queryRollingZeroValueSpend(windowHours);
    return { hit: spent >= Number(thresholdUsd || 0), spent, threshold: Number(thresholdUsd || 0) };
  }

  function checkDailyCap(dateEt, thresholdUsd = 2.5) {
    const spent = queryDailyZeroValueSpend(dateEt);
    return { hit: spent >= Number(thresholdUsd || 0), spent, threshold: Number(thresholdUsd || 0) };
  }

  return {
    recordZeroValueRun,
    queryRollingZeroValueSpend,
    queryDailyZeroValueSpend,
    hasUserDateZeroValueAttempt,
    checkRollingWindowCap,
    checkDailyCap,
  };
}

module.exports = { createDigestOrchestratorSpendGuardRuntime };
```

- [ ] **Step 4: Run to verify tests pass**

```bash
node tests/contracts/entrypoints/digest-orchestrator-spend-guard-runtime.test.js
```
Expected: `PASS: spend guard runtime`

- [ ] **Step 5: npm test**

```bash
npm test
```
Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add src/entrypoints/digest-orchestrator-spend-guard-runtime.js \
        tests/contracts/entrypoints/digest-orchestrator-spend-guard-runtime.test.js
git commit -m "feat(reliability): add spend guard runtime with per-user/date, rolling, and daily zero-value caps"
```

---

## Task 3: Circuit Breaker Runtime

**Files:**
- Create: `src/entrypoints/digest-orchestrator-circuit-breaker-runtime.js`
- Create: `tests/contracts/entrypoints/digest-orchestrator-circuit-breaker-runtime.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/contracts/entrypoints/digest-orchestrator-circuit-breaker-runtime.test.js`:
```js
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { assertNodeSyntaxFile, assertModuleExports } = require("../../test-support/module-contract-helper.js");

const TARGET_REL = "src/entrypoints/digest-orchestrator-circuit-breaker-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);
const { createDigestOrchestratorCircuitBreakerRuntime, CB_STATUS_OPEN, CB_STATUS_CLOSED } = runtime;
assert.strictEqual(typeof createDigestOrchestratorCircuitBreakerRuntime, "function", "must export factory");
assert.strictEqual(CB_STATUS_OPEN, "OPEN");
assert.strictEqual(CB_STATUS_CLOSED, "CLOSED");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-cb-test-"));
const circuitBreakerStatePath = path.join(tmpDir, "circuit-breaker.json");

try {
  let fakeNow = new Date("2026-03-23T07:00:00.000Z");
  const cb = createDigestOrchestratorCircuitBreakerRuntime({
    fs,
    path,
    circuitBreakerStatePath,
    log: () => {},
    nowProvider: () => new Date(fakeNow),
  });

  // Starts closed
  assert.strictEqual(cb.isOpen(), false, "starts closed");
  assert.strictEqual(cb.getState().status, CB_STATUS_CLOSED);

  // Open manually
  cb.openCircuit({ reason: "test_open", triggeredBy: "test", dateEt: "2026-03-23" });
  assert.strictEqual(cb.isOpen(), true, "open after openCircuit");
  assert.strictEqual(cb.getState().opened_reason, "test_open");

  // Close (admin resume)
  cb.closeCircuit();
  assert.strictEqual(cb.isOpen(), false, "closed after closeCircuit");
  assert.strictEqual(cb.getState().opened_at, null);
  assert.deepStrictEqual(cb.getState().recent_zero_serve_runs, []);

  // Trigger 1: ≥3 users targeted, 0 served, non-transient failure
  const result1 = cb.evaluateRunOutcome({
    dueCount: 3, servedCount: 0, dominantFailureClass: "retrieval_thin",
    runId: "run-1", dateEt: "2026-03-23",
  });
  assert.ok(result1, "should open on trigger 1");
  assert.strictEqual(cb.isOpen(), true, "open after trigger 1");
  cb.closeCircuit();

  // Trigger 1 does NOT fire for transient failures
  const result1t = cb.evaluateRunOutcome({
    dueCount: 3, servedCount: 0, dominantFailureClass: "transient",
    runId: "run-t", dateEt: "2026-03-23",
  });
  assert.strictEqual(result1t, null, "should not open for transient");
  assert.strictEqual(cb.isOpen(), false);

  // Trigger 1 does NOT fire when <3 users targeted
  cb.closeCircuit();
  const result1s = cb.evaluateRunOutcome({
    dueCount: 2, servedCount: 0, dominantFailureClass: "retrieval_thin",
    runId: "run-s", dateEt: "2026-03-23",
  });
  assert.strictEqual(result1s, null, "does not open for <3 users");

  // Trigger 2: two consecutive zero-serve runs within 60 minutes
  cb.closeCircuit();
  fakeNow = new Date("2026-03-23T09:00:00.000Z");
  const r2a = cb.evaluateRunOutcome({
    dueCount: 1, servedCount: 0, dominantFailureClass: "retrieval_thin",
    runId: "run-2a", dateEt: "2026-03-23",
  });
  assert.strictEqual(r2a, null, "first zero-serve does not open");
  assert.strictEqual(cb.isOpen(), false);

  fakeNow = new Date("2026-03-23T09:30:00.000Z");
  const r2b = cb.evaluateRunOutcome({
    dueCount: 1, servedCount: 0, dominantFailureClass: "retrieval_thin",
    runId: "run-2b", dateEt: "2026-03-23",
  });
  assert.ok(r2b, "second consecutive zero-serve opens circuit");
  assert.strictEqual(cb.isOpen(), true, "open after two consecutive zero-serve");

  // Successful serve clears zero-serve streak
  cb.closeCircuit();
  fakeNow = new Date("2026-03-23T10:00:00.000Z");
  cb.evaluateRunOutcome({ dueCount: 1, servedCount: 0, dominantFailureClass: "retrieval_thin", runId: "r3a", dateEt: "2026-03-23" });
  assert.strictEqual(cb.isOpen(), false, "still closed after 1 zero-serve");
  cb.evaluateRunOutcome({ dueCount: 1, servedCount: 1, dominantFailureClass: null, runId: "r3b", dateEt: "2026-03-23" });
  assert.strictEqual(cb.isOpen(), false, "still closed after successful serve clears streak");
  cb.evaluateRunOutcome({ dueCount: 1, servedCount: 0, dominantFailureClass: "retrieval_thin", runId: "r3c", dateEt: "2026-03-23" });
  assert.strictEqual(cb.isOpen(), false, "streak reset; one zero-serve again does not open");

  // Two zero-serve more than 60 min apart do NOT trigger
  cb.closeCircuit();
  fakeNow = new Date("2026-03-23T11:00:00.000Z");
  cb.evaluateRunOutcome({ dueCount: 1, servedCount: 0, runId: "r4a", dateEt: "2026-03-23" });
  fakeNow = new Date("2026-03-23T12:05:00.000Z"); // >60 min later
  const r4b = cb.evaluateRunOutcome({ dueCount: 1, servedCount: 0, runId: "r4b", dateEt: "2026-03-23" });
  assert.strictEqual(r4b, null, "two zero-serve >60 min apart do not open circuit");
  assert.strictEqual(cb.isOpen(), false);

  // Trigger 3: rolling spend cap
  cb.closeCircuit();
  const r5 = cb.evaluateRunOutcome({
    dueCount: 1, servedCount: 0, runId: "r5", dateEt: "2026-03-23",
    rollingZeroValueSpend: 1.05, rollingCap: 1.0,
  });
  assert.ok(r5, "opens on rolling spend cap");
  assert.strictEqual(cb.isOpen(), true);

  console.log("PASS: circuit breaker runtime");
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
```

- [ ] **Step 2: Run to verify it fails**

```bash
node tests/contracts/entrypoints/digest-orchestrator-circuit-breaker-runtime.test.js
```
Expected: `Error: Cannot find module`

- [ ] **Step 3: Create the implementation**

Create `src/entrypoints/digest-orchestrator-circuit-breaker-runtime.js`:
```js
"use strict";

const CB_STATUS_OPEN = "OPEN";
const CB_STATUS_CLOSED = "CLOSED";
const CB_VERSION = 1;

function createDigestOrchestratorCircuitBreakerRuntime(deps) {
  const {
    fs,
    path,
    circuitBreakerStatePath,
    log,
    nowProvider = () => new Date(),
  } = deps || {};
  const logger = typeof log === "function" ? log : () => {};

  function writeJsonAtomic(filePath, payload) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf8");
    fs.renameSync(tmp, filePath);
  }

  function emptyState() {
    return {
      version: CB_VERSION,
      status: CB_STATUS_CLOSED,
      opened_at: null,
      opened_reason: null,
      triggered_by: null,
      date_et: null,
      recent_zero_serve_runs: [],
      updated_at: null,
    };
  }

  function loadState() {
    try {
      return JSON.parse(fs.readFileSync(circuitBreakerStatePath, "utf8"));
    } catch (e) {
      if (e && e.code !== "ENOENT") logger(`[circuit-breaker] load failed: ${e.message}`);
      return emptyState();
    }
  }

  function saveState(state) {
    writeJsonAtomic(circuitBreakerStatePath, { ...state, updated_at: nowProvider().toISOString() });
  }

  function isOpen() {
    return String(loadState()?.status || "") === CB_STATUS_OPEN;
  }

  function getState() {
    return loadState();
  }

  function openCircuit({ reason, triggeredBy, dateEt } = {}) {
    const state = loadState();
    const next = {
      ...state,
      status: CB_STATUS_OPEN,
      opened_at: nowProvider().toISOString(),
      opened_reason: String(reason || "").trim(),
      triggered_by: String(triggeredBy || "").trim(),
      date_et: String(dateEt || "").trim(),
    };
    saveState(next);
    logger(`[circuit-breaker] OPENED: ${reason}`);
    return next;
  }

  function closeCircuit() {
    const next = emptyState();
    saveState(next);
    logger(`[circuit-breaker] CLOSED (admin resume)`);
    return next;
  }

  function evaluateRunOutcome(params = {}) {
    const {
      dueCount, servedCount, dominantFailureClass,
      runId, dateEt,
      rollingZeroValueSpend, rollingCap,
      dailyZeroValueSpend, dailyCap,
    } = params;
    const now = nowProvider();
    const due = Math.max(0, Number(dueCount || 0));
    const served = Math.max(0, Number(servedCount || 0));
    const isNonTransient = dominantFailureClass && dominantFailureClass !== "transient";

    // Trigger 1: ≥3 users, 0 served, non-transient dominant failure
    if (due >= 3 && served === 0 && isNonTransient) {
      return openCircuit({
        reason: `targeted_${due}_served_0_${dominantFailureClass}`,
        triggeredBy: runId,
        dateEt,
      });
    }

    // Trigger 2: two consecutive zero-serve runs within 60 minutes
    const state = loadState();
    const windowMs = 60 * 60 * 1000;
    const recent = (state.recent_zero_serve_runs || []).filter((r) => {
      const ts = Date.parse(String(r?.ts_utc || ""));
      return Number.isFinite(ts) && (now.getTime() - ts) <= windowMs;
    });

    if (served === 0) {
      const updated = [...recent, { ts_utc: now.toISOString(), run_id: String(runId || "") }];
      if (updated.length >= 2) {
        saveState({ ...state, recent_zero_serve_runs: updated });
        return openCircuit({ reason: "two_consecutive_zero_serve_within_60min", triggeredBy: runId, dateEt });
      }
      saveState({ ...state, recent_zero_serve_runs: updated });
    } else {
      saveState({ ...state, recent_zero_serve_runs: [] });
    }

    // Trigger 3: rolling spend cap exceeded
    if (Number.isFinite(rollingZeroValueSpend) && Number.isFinite(rollingCap) && rollingZeroValueSpend >= rollingCap) {
      return openCircuit({
        reason: `rolling_zero_value_${rollingZeroValueSpend.toFixed(4)}_gte_cap_${rollingCap}`,
        triggeredBy: runId,
        dateEt,
      });
    }

    // Trigger 4: daily spend cap exceeded
    if (Number.isFinite(dailyZeroValueSpend) && Number.isFinite(dailyCap) && dailyZeroValueSpend >= dailyCap) {
      return openCircuit({
        reason: `daily_zero_value_${dailyZeroValueSpend.toFixed(4)}_gte_cap_${dailyCap}`,
        triggeredBy: runId,
        dateEt,
      });
    }

    return null;
  }

  return {
    isOpen,
    getState,
    openCircuit,
    closeCircuit,
    evaluateRunOutcome,
    CB_STATUS_OPEN,
    CB_STATUS_CLOSED,
  };
}

module.exports = {
  createDigestOrchestratorCircuitBreakerRuntime,
  CB_STATUS_OPEN,
  CB_STATUS_CLOSED,
};
```

- [ ] **Step 4: Run to verify tests pass**

```bash
node tests/contracts/entrypoints/digest-orchestrator-circuit-breaker-runtime.test.js
```
Expected: `PASS: circuit breaker runtime`

- [ ] **Step 5: npm test**

```bash
npm test
```
Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add src/entrypoints/digest-orchestrator-circuit-breaker-runtime.js \
        tests/contracts/entrypoints/digest-orchestrator-circuit-breaker-runtime.test.js
git commit -m "feat(reliability): add circuit breaker runtime with four trigger conditions"
```

---

## Task 4: Failure-Class-Aware Retry Policy

**Files:**
- Modify: `src/runtime/digest-delivery-policy-runtime.js`
- Modify: `src/entrypoints/digest-orchestrator-delivery-runtime.js`
- Modify: `src/entrypoints/digest-orchestrator-schedule-runtime.js`

**Context:** Currently `computeRetryDelayMinutes` returns a non-null delay even for `retrieval_thin` and `ranking_policy_limited`. The plan requires that ONLY `transient` failures are eligible for retry. We enforce this at two points: when deciding to schedule a retry (delivery runtime) and when admitting users into a run (schedule runtime).

- [ ] **Step 1: Add `isRetryEligibleFailureClass` to delivery policy**

In `src/runtime/digest-delivery-policy-runtime.js`, add after `DELIVERY_POLICY`:
```js
const TRANSIENT_FAILURE_CLASSES = Object.freeze(new Set(["transient"]));

function isRetryEligibleFailureClass(failureClass) {
  return TRANSIENT_FAILURE_CLASSES.has(String(failureClass || "").trim());
}
```

Add `isRetryEligibleFailureClass` and `TRANSIENT_FAILURE_CLASSES` to `module.exports`.

- [ ] **Step 2: Verify with quick syntax check**

```bash
node -e "const m = require('./src/runtime/digest-delivery-policy-runtime'); require('assert').strictEqual(typeof m.isRetryEligibleFailureClass, 'function'); require('assert').strictEqual(m.isRetryEligibleFailureClass('transient'), true); require('assert').strictEqual(m.isRetryEligibleFailureClass('retrieval_thin'), false); console.log('PASS');"
```
Expected: `PASS`

- [ ] **Step 3: Gate retry scheduling on failure class in delivery runtime**

In `src/entrypoints/digest-orchestrator-delivery-runtime.js`, add to the imports at top:
```js
const {
  DELIVERY_POLICY,
  classifyRetryFailureClass,
  computeRetryDelayMinutes,
  countRecentLowerConfidenceAssist,
  deriveInternalThinnessLabel,
  getCustomTopicMetadata,
  isRetryEligibleFailureClass,
  listTrustedOnlyCustomKeywords,
  selectDeliveryItems,
} = require("../runtime/digest-delivery-policy-runtime");
```

Find the section that sets `retryableScheduledAttempt`:
```js
const retryableScheduledAttempt = deliveryMode === "scheduled" && attemptCount === 1;
```
Change to:
```js
const retryableScheduledAttempt = deliveryMode === "scheduled"
  && attemptCount === 1
  && isRetryEligibleFailureClass(failureClass);
```

- [ ] **Step 4: Add defense-in-depth filter in schedule runtime**

In `src/entrypoints/digest-orchestrator-schedule-runtime.js`, in `resolveDueUsers` where it filters users, add a check for non-transient underfill in retry state. After the `isTerminalRetryOutcome` check, add:

```js
// Block users whose retry state records a non-transient underfill (defense-in-depth)
if (retryState?.underfill_reason
  && !NON_RETRYABLE_UNDERFILL_REASONS.has(String(retryState.underfill_reason))) {
  // transient — allow through normal retry_pending check
} else if (retryState?.underfill_reason
  && NON_RETRYABLE_UNDERFILL_REASONS.has(String(retryState.underfill_reason))) {
  return false;
}
```

This requires defining at the top of `digest-orchestrator-schedule-runtime.js`:
```js
const NON_RETRYABLE_UNDERFILL_REASONS = new Set([
  "retrieval_thin",
  "ranking_policy_limited",
  "quality_below_floor",
  "empty_items",
  "zero_standard_results",
  "no_selectable_items",
]);
```

Also add the same set to the status log so it shows correctly:
In the `parts.map` section near the bottom of `resolveDueUsers`, update the halt label to include `halted(non_transient_underfill)`.

The full filter block in the `dueUsers` filter (around line 79) becomes:
```js
if (!hasScheduledDeliveryChannel(user)) {
  return false;
}
if (isTerminalRetryOutcome(retryState?.delivery_outcome)) {
  return false;
}
if (hasExhaustedScheduledRetryBudget(retryState)) {
  return false;
}
if (retryState?.underfill_reason && NON_RETRYABLE_UNDERFILL_REASONS.has(String(retryState.underfill_reason))) {
  return false;
}
if (retryState?.retry_pending === true) {
  const nextRetryAt = Date.parse(String(retryState?.next_retry_at || ""));
  if (Number.isFinite(nextRetryAt) && now.getTime() < nextRetryAt) return false;
  return true;
}
```

And in the status log `parts.map` section, add a check before the retry check:
```js
if (retryState?.underfill_reason && NON_RETRYABLE_UNDERFILL_REASONS.has(String(retryState.underfill_reason))) {
  return `${user.email || user.chatId}: halted(non_transient_underfill:${retryState.underfill_reason})`;
}
```

- [ ] **Step 5: npm test**

```bash
npm test
```
Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add src/runtime/digest-delivery-policy-runtime.js \
        src/entrypoints/digest-orchestrator-delivery-runtime.js \
        src/entrypoints/digest-orchestrator-schedule-runtime.js
git commit -m "feat(reliability): enforce transient-only retry policy — non-transient failures no longer schedule retry"
```

---

## Task 5: Admission Gate Runtime

**Files:**
- Create: `src/entrypoints/digest-orchestrator-admission-gate-runtime.js`
- Create: `tests/contracts/entrypoints/digest-orchestrator-admission-gate-runtime.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/contracts/entrypoints/digest-orchestrator-admission-gate-runtime.test.js`:
```js
"use strict";

const assert = require("assert");
const path = require("path");
const { assertNodeSyntaxFile, assertModuleExports } = require("../../test-support/module-contract-helper.js");

const TARGET_REL = "src/entrypoints/digest-orchestrator-admission-gate-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);
const {
  createDigestOrchestratorAdmissionGateRuntime,
  RUN_VALUE_STATE_ABORTED,
  RUN_VALUE_STATE_ALLOWED,
} = runtime;
assert.strictEqual(typeof createDigestOrchestratorAdmissionGateRuntime, "function");
assert.strictEqual(RUN_VALUE_STATE_ABORTED, "aborted_non_deliverable_pre_spend");
assert.strictEqual(RUN_VALUE_STATE_ALLOWED, "pending_delivery");

const DUE_USERS = [
  { chatId: "u1", email: "a@test.com" },
  { chatId: "u2", email: "b@test.com" },
];

// Helper: stub spend guard
function makeSpendGuard({ rollingHit = false, dailyHit = false, userDateHit = false } = {}) {
  return {
    checkRollingWindowCap: () => ({ hit: rollingHit, spent: rollingHit ? 1.1 : 0.1, threshold: 1.0 }),
    checkDailyCap: () => ({ hit: dailyHit, spent: dailyHit ? 2.6 : 0.5, threshold: 2.5 }),
    hasUserDateZeroValueAttempt: () => userDateHit,
  };
}

// Helper: stub circuit breaker
function makeCb(open = false) {
  return { isOpen: () => open };
}

// Helper: stub retry state runtime
function makeRetryState(stateByUserId = {}) {
  return { getRetryState: (userId) => stateByUserId[userId] || null };
}

// 1. Circuit open blocks run
{
  const gate = createDigestOrchestratorAdmissionGateRuntime({
    circuitBreakerRuntime: makeCb(true),
    spendGuardRuntime: makeSpendGuard(),
    log: () => {},
  });
  const result = gate.checkScheduledAdmission({ dueUsers: DUE_USERS, dateEt: "2026-03-23", retryStateRuntime: makeRetryState() });
  assert.strictEqual(result.allowed, false);
  assert.strictEqual(result.blockedReason, "circuit_breaker_open");
  assert.strictEqual(result.runValueState, RUN_VALUE_STATE_ABORTED);
  assert.deepStrictEqual(result.eligibleUsers, []);
}

// 2. Rolling window cap hit blocks run
{
  const gate = createDigestOrchestratorAdmissionGateRuntime({
    circuitBreakerRuntime: makeCb(false),
    spendGuardRuntime: makeSpendGuard({ rollingHit: true }),
    log: () => {},
  });
  const result = gate.checkScheduledAdmission({ dueUsers: DUE_USERS, dateEt: "2026-03-23", retryStateRuntime: makeRetryState() });
  assert.strictEqual(result.allowed, false);
  assert.ok(result.blockedReason.startsWith("rolling_window_cap_hit"));
}

// 3. Daily cap hit blocks run
{
  const gate = createDigestOrchestratorAdmissionGateRuntime({
    circuitBreakerRuntime: makeCb(false),
    spendGuardRuntime: makeSpendGuard({ dailyHit: true }),
    log: () => {},
  });
  const result = gate.checkScheduledAdmission({ dueUsers: DUE_USERS, dateEt: "2026-03-23", retryStateRuntime: makeRetryState() });
  assert.strictEqual(result.allowed, false);
  assert.ok(result.blockedReason.startsWith("daily_cap_hit"));
}

// 4. User with non-transient underfill in retry state is filtered
{
  const gate = createDigestOrchestratorAdmissionGateRuntime({
    circuitBreakerRuntime: makeCb(false),
    spendGuardRuntime: makeSpendGuard(),
    log: () => {},
  });
  const retryState = makeRetryState({ u1: { underfill_reason: "retrieval_thin", retry_pending: true } });
  const result = gate.checkScheduledAdmission({ dueUsers: DUE_USERS, dateEt: "2026-03-23", retryStateRuntime: retryState });
  assert.strictEqual(result.allowed, true, "run allowed because u2 is still eligible");
  assert.strictEqual(result.eligibleUsers.length, 1, "only u2 eligible");
  assert.strictEqual(result.eligibleUsers[0].chatId, "u2");
}

// 5. All users filtered → blocked
{
  const gate = createDigestOrchestratorAdmissionGateRuntime({
    circuitBreakerRuntime: makeCb(false),
    spendGuardRuntime: makeSpendGuard({ userDateHit: true }),
    log: () => {},
  });
  const result = gate.checkScheduledAdmission({ dueUsers: DUE_USERS, dateEt: "2026-03-23", retryStateRuntime: makeRetryState() });
  assert.strictEqual(result.allowed, false);
  assert.strictEqual(result.blockedReason, "all_users_at_zero_value_cap");
}

// 6. All clear → allowed with all due users
{
  const gate = createDigestOrchestratorAdmissionGateRuntime({
    circuitBreakerRuntime: makeCb(false),
    spendGuardRuntime: makeSpendGuard(),
    log: () => {},
  });
  const result = gate.checkScheduledAdmission({ dueUsers: DUE_USERS, dateEt: "2026-03-23", retryStateRuntime: makeRetryState() });
  assert.strictEqual(result.allowed, true);
  assert.strictEqual(result.eligibleUsers.length, 2);
  assert.strictEqual(result.runValueState, RUN_VALUE_STATE_ALLOWED);
}

// 7. On-demand runs bypass all gates
{
  const gate = createDigestOrchestratorAdmissionGateRuntime({
    circuitBreakerRuntime: makeCb(true),
    spendGuardRuntime: makeSpendGuard({ rollingHit: true, dailyHit: true }),
    log: () => {},
  });
  const result = gate.checkOnDemandAdmission({ dueUsers: DUE_USERS });
  assert.strictEqual(result.allowed, true, "on-demand bypasses all gates");
  assert.strictEqual(result.eligibleUsers.length, 2);
}

console.log("PASS: admission gate runtime");
```

- [ ] **Step 2: Run to verify it fails**

```bash
node tests/contracts/entrypoints/digest-orchestrator-admission-gate-runtime.test.js
```
Expected: `Error: Cannot find module`

- [ ] **Step 3: Create the implementation**

Create `src/entrypoints/digest-orchestrator-admission-gate-runtime.js`:
```js
"use strict";

const RUN_VALUE_STATE_ABORTED = "aborted_non_deliverable_pre_spend";
const RUN_VALUE_STATE_ALLOWED = "pending_delivery";

const NON_TRANSIENT_UNDERFILL_REASONS = new Set([
  "retrieval_thin",
  "ranking_policy_limited",
  "quality_below_floor",
  "empty_items",
  "zero_standard_results",
  "no_selectable_items",
]);

function createDigestOrchestratorAdmissionGateRuntime(deps) {
  const {
    circuitBreakerRuntime,
    spendGuardRuntime,
    rollingWindowCapUsd = 1.0,
    rollingWindowHours = 6,
    dailyCapUsd = 2.5,
    log,
  } = deps || {};
  const logger = typeof log === "function" ? log : () => {};

  function filterEligibleUsers(dueUsers, dateEt, retryStateRuntime) {
    return (Array.isArray(dueUsers) ? dueUsers : []).filter((user) => {
      const userId = String(user?.chatId || user?.email || "").trim();

      // Filter users with non-transient underfill in retry state
      if (retryStateRuntime && typeof retryStateRuntime.getRetryState === "function") {
        const retryState = retryStateRuntime.getRetryState(userId, dateEt);
        if (retryState?.underfill_reason && NON_TRANSIENT_UNDERFILL_REASONS.has(String(retryState.underfill_reason))) {
          return false;
        }
      }

      // Filter users already at per-user/date zero-value cap
      if (spendGuardRuntime && typeof spendGuardRuntime.hasUserDateZeroValueAttempt === "function") {
        if (spendGuardRuntime.hasUserDateZeroValueAttempt(userId, dateEt)) {
          return false;
        }
      }

      return true;
    });
  }

  function checkScheduledAdmission({ dueUsers, dateEt, retryStateRuntime } = {}) {
    // 1. Circuit breaker
    if (circuitBreakerRuntime && circuitBreakerRuntime.isOpen()) {
      logger(`[admission-gate] BLOCKED: circuit breaker open`);
      return { allowed: false, blockedReason: "circuit_breaker_open", runValueState: RUN_VALUE_STATE_ABORTED, eligibleUsers: [] };
    }

    // 2. Rolling window cap
    if (spendGuardRuntime) {
      const rolling = spendGuardRuntime.checkRollingWindowCap(rollingWindowCapUsd, rollingWindowHours);
      if (rolling.hit) {
        logger(`[admission-gate] BLOCKED: rolling zero-value spend $${rolling.spent.toFixed(4)} >= $${rolling.threshold}`);
        return { allowed: false, blockedReason: `rolling_window_cap_hit_${rolling.spent.toFixed(4)}`, runValueState: RUN_VALUE_STATE_ABORTED, eligibleUsers: [] };
      }

      // 3. Daily cap
      const daily = spendGuardRuntime.checkDailyCap(dateEt, dailyCapUsd);
      if (daily.hit) {
        logger(`[admission-gate] BLOCKED: daily zero-value spend $${daily.spent.toFixed(4)} >= $${daily.threshold}`);
        return { allowed: false, blockedReason: `daily_cap_hit_${daily.spent.toFixed(4)}`, runValueState: RUN_VALUE_STATE_ABORTED, eligibleUsers: [] };
      }
    }

    // 4. Per-user/date cap and non-transient underfill filter
    const eligibleUsers = filterEligibleUsers(dueUsers, dateEt, retryStateRuntime);
    if (eligibleUsers.length === 0) {
      logger(`[admission-gate] BLOCKED: no eligible users after user/date cap filter`);
      return { allowed: false, blockedReason: "all_users_at_zero_value_cap", runValueState: RUN_VALUE_STATE_ABORTED, eligibleUsers: [] };
    }

    return { allowed: true, blockedReason: null, runValueState: RUN_VALUE_STATE_ALLOWED, eligibleUsers };
  }

  function checkOnDemandAdmission({ dueUsers } = {}) {
    // On-demand runs are conscious user-triggered actions — bypass all safety gates
    return { allowed: true, blockedReason: null, runValueState: RUN_VALUE_STATE_ALLOWED, eligibleUsers: Array.isArray(dueUsers) ? dueUsers : [] };
  }

  return {
    checkScheduledAdmission,
    checkOnDemandAdmission,
    RUN_VALUE_STATE_ABORTED,
    RUN_VALUE_STATE_ALLOWED,
    NON_TRANSIENT_UNDERFILL_REASONS,
  };
}

module.exports = {
  createDigestOrchestratorAdmissionGateRuntime,
  RUN_VALUE_STATE_ABORTED,
  RUN_VALUE_STATE_ALLOWED,
  NON_TRANSIENT_UNDERFILL_REASONS,
};
```

- [ ] **Step 4: Run to verify tests pass**

```bash
node tests/contracts/entrypoints/digest-orchestrator-admission-gate-runtime.test.js
```
Expected: `PASS: admission gate runtime`

- [ ] **Step 5: npm test**

```bash
npm test
```
Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add src/entrypoints/digest-orchestrator-admission-gate-runtime.js \
        tests/contracts/entrypoints/digest-orchestrator-admission-gate-runtime.test.js
git commit -m "feat(reliability): add admission gate — blocks provider calls when circuit open or spend caps hit"
```

---

## Task 6: Wire Controls Into Core Orchestrator

**Files:**
- Modify: `src/entrypoints/digest-orchestrator-core-runtime.js`

This task wires the three new runtimes into the orchestrator. Only scheduled runs go through the admission gate. Both scheduled and targeted runs trigger circuit breaker evaluation after delivery.

- [ ] **Step 1: Add imports at the top of `digest-orchestrator-core-runtime.js`**

After the existing runtime imports (around line 100–107), add:
```js
const { createDigestOrchestratorSpendGuardRuntime } = require("./digest-orchestrator-spend-guard-runtime");
const { createDigestOrchestratorCircuitBreakerRuntime } = require("./digest-orchestrator-circuit-breaker-runtime");
const { createDigestOrchestratorAdmissionGateRuntime } = require("./digest-orchestrator-admission-gate-runtime");
```

- [ ] **Step 2: Add new state paths and cache variables**

After existing cache variables (around line 141), add:
```js
let digestOrchestratorSpendGuardRuntimeCache = null;
let digestOrchestratorCircuitBreakerRuntimeCache = null;
```

After the `DIGEST_INCIDENT_LOG` constant definition, add:
```js
const SPEND_GUARD_STATE = RUNTIME_PATHS.spendGuardStatePath;
const CIRCUIT_BREAKER_STATE = RUNTIME_PATHS.circuitBreakerStatePath;
const ROLLING_ZERO_VALUE_CAP_USD = parseFloat(process.env.ROLLING_ZERO_VALUE_CAP_USD || "1.00");
const DAILY_ZERO_VALUE_CAP_USD = parseFloat(process.env.DAILY_ZERO_VALUE_CAP_USD || "2.50");
const ROLLING_ZERO_VALUE_WINDOW_HOURS = parseInt(process.env.ROLLING_ZERO_VALUE_WINDOW_HOURS || "6", 10);
```

- [ ] **Step 3: Add runtime factory functions**

After `getDigestOrchestratorIncidentRuntime()`, add:
```js
function getDigestOrchestratorSpendGuardRuntime() {
  if (!digestOrchestratorSpendGuardRuntimeCache) {
    digestOrchestratorSpendGuardRuntimeCache = createDigestOrchestratorSpendGuardRuntime({
      fs,
      path,
      spendGuardStatePath: SPEND_GUARD_STATE,
      log,
    });
  }
  return digestOrchestratorSpendGuardRuntimeCache;
}

function getDigestOrchestratorCircuitBreakerRuntime() {
  if (!digestOrchestratorCircuitBreakerRuntimeCache) {
    digestOrchestratorCircuitBreakerRuntimeCache = createDigestOrchestratorCircuitBreakerRuntime({
      fs,
      path,
      circuitBreakerStatePath: CIRCUIT_BREAKER_STATE,
      log,
    });
  }
  return digestOrchestratorCircuitBreakerRuntimeCache;
}
```

- [ ] **Step 4: Add admission gate check in `main()` — after due users are resolved, before fetch**

Find the block starting around line 677:
```js
if (dueUsers.length === 0) {
```

Immediately **before** the dry-run check (around line 693), add the admission gate check:
```js
  // ── Pre-spend admission gate (scheduled runs only) ───────────────────────
  if (!targetChatId) {
    const spendGuard = getDigestOrchestratorSpendGuardRuntime();
    const circuitBreaker = getDigestOrchestratorCircuitBreakerRuntime();
    const admissionGate = createDigestOrchestratorAdmissionGateRuntime({
      circuitBreakerRuntime: circuitBreaker,
      spendGuardRuntime: spendGuard,
      rollingWindowCapUsd: ROLLING_ZERO_VALUE_CAP_USD,
      rollingWindowHours: ROLLING_ZERO_VALUE_WINDOW_HOURS,
      dailyCapUsd: DAILY_ZERO_VALUE_CAP_USD,
      log,
    });
    const gate = admissionGate.checkScheduledAdmission({
      dueUsers,
      dateEt: digestDateKey,
      retryStateRuntime: getDigestRetryStateRuntime(),
    });
    if (!gate.allowed) {
      logEvent("warn", "digest.run.blocked", {
        provider: "admission-gate",
        outcome: gate.runValueState,
        blocked_reason: gate.blockedReason,
        due_users: dueUsers.length,
        date_et: digestDateKey,
      });
      log(`⛔ Admission gate blocked run: ${gate.blockedReason} (${dueUsers.length} due users, date=${digestDateKey})`);
      recordRunCost({
        now: new Date(),
        runId,
        targetChatId: null,
        standardFetchCalls: 0,
        customFetchCalls: 0,
        claudeUsage: {},
        dueUsers,
        deliveredUsers: [],
        failedUsers: [],
        publicDigestUrl: "",
        runValueState: gate.runValueState,
        blockedReason: gate.blockedReason,
      });
      releaseDigestLock(runMode);
      process.exit(0);
    }
    // Use the gate's filtered user list (removes already-burned user/dates)
    if (gate.eligibleUsers.length < dueUsers.length) {
      const filtered = dueUsers.length - gate.eligibleUsers.length;
      log(`[admission-gate] filtered ${filtered} user(s) already at zero-value cap`);
      dueUsers = gate.eligibleUsers;
    }
  }
```

- [ ] **Step 5: Wire circuit breaker evaluation after delivery**

Find the `try { const deliveryResult = await deliveryRuntime.deliverDueUsers(...)` block. After the `recordRunCost(...)` call in the `finally` block, add (within the try block after delivery completes):

```js
  // ── Circuit breaker evaluation (after delivery) ─────────────────────────
  if (!targetChatId) {
    const cbRuntime = getDigestOrchestratorCircuitBreakerRuntime();
    const spendRuntime = getDigestOrchestratorSpendGuardRuntime();
    const dominantFailure = failedUsers.length > 0
      ? (failedUsers[0]?.withheld_reason || null)
      : null;
    const rollingSpend = spendRuntime.queryRollingZeroValueSpend(ROLLING_ZERO_VALUE_WINDOW_HOURS);
    const dailySpend = spendRuntime.queryDailyZeroValueSpend(digestDateKey);
    const cbResult = cbRuntime.evaluateRunOutcome({
      dueCount: dueUsers.length,
      servedCount: deliveredUsers.length,
      dominantFailureClass: dominantFailure,
      runId,
      dateEt: digestDateKey,
      rollingZeroValueSpend: rollingSpend,
      rollingCap: ROLLING_ZERO_VALUE_CAP_USD,
      dailyZeroValueSpend: dailySpend,
      dailyCap: DAILY_ZERO_VALUE_CAP_USD,
    });
    if (cbResult) {
      logEvent("warn", "digest.circuit_breaker.opened", {
        provider: "circuit-breaker",
        outcome: "opened",
        reason: cbResult.opened_reason,
        run_id: runId,
        date_et: digestDateKey,
      });
      log(`⛔ Circuit breaker OPENED: ${cbResult.opened_reason}`);
      await emitDigestIncident(
        "circuit_breaker_opened",
        `Circuit breaker opened: ${cbResult.opened_reason}`,
        { run_id: runId, date_et: digestDateKey, reason: cbResult.opened_reason }
      );
    }

    // Record zero-value runs per user to spend guard
    if (Array.isArray(failedUsers) && failedUsers.length > 0) {
      const { perplexityCost } = require("./digest-orchestrator-cost-runtime").calculateRunCosts({
        standardFetchCalls: standardFetchCalls || 0,
        customFetchCalls: customFetchCalls || 0,
      });
      const costPerUser = failedUsers.length > 0 ? perplexityCost / failedUsers.length : 0;
      for (const failed of failedUsers) {
        spendRuntime.recordZeroValueRun({
          runId,
          dateEt: digestDateKey,
          userId: String(failed?.userId || failed?.chatId || ""),
          failureClass: String(failed?.withheld_reason || "unknown"),
          costUsd: costPerUser,
        });
      }
    }
  }
```

Note: `standardFetchCalls` and `customFetchCalls` are already in scope from the fetch result destructuring.

- [ ] **Step 6: Update `recordRunCost` to accept `runValueState` and `blockedReason`**

In `src/entrypoints/digest-orchestrator-cost-runtime.js`, in `recordRunCost`, accept optional `runValueState` and `blockedReason` params and include them in the cost log entry:
```js
function recordRunCost(params = {}) {
  const {
    ...existing params...,
    runValueState,
    blockedReason,
  } = params;
  // ... existing cost calc ...
  appendCostLog({
    ...existing fields...,
    run_value_state: runValueState ? String(runValueState) : (deliveredUsers?.length > 0 ? "delivered" : "zero_value"),
    blocked_reason: blockedReason ? String(blockedReason) : null,
  });
}
```

- [ ] **Step 7: npm test**

```bash
npm test
```
Expected: all tests pass

- [ ] **Step 8: Commit**

```bash
git add src/entrypoints/digest-orchestrator-core-runtime.js \
        src/entrypoints/digest-orchestrator-cost-runtime.js
git commit -m "feat(reliability): wire admission gate and circuit breaker into orchestrator main loop"
```

---

## Task 7: Final Validation

- [ ] **Step 1: Full test suite**

```bash
npm test
```
Expected: all tests pass

- [ ] **Step 2: Verify admission gate blocks a simulated zero-due-users run**

```bash
node -e "
process.env.NODE_ENV = 'test';
process.env.SIGNALBRIEF_DATA_DIR = '/tmp/sb-phase1-test-' + Date.now();
// ... integration smoke check via digest-runner or direct call
console.log('Manual verification: run npm test and check cost-log.json for run_value_state fields');
"
```

- [ ] **Step 3: Update progress tracker**

Update `docs/reliability-recovery-progress.md` — mark all Phase 1 tasks complete.

- [ ] **Step 4: Final commit and push**

```bash
git add docs/reliability-recovery-progress.md
git commit -m "docs: mark Phase 1 complete in reliability recovery progress tracker"
git push
```

---

## Phase 1 Exit Gate Checklist

Before declaring Phase 1 done, verify:
- [ ] `npm test` passes clean
- [ ] Cost log contains `run_value_state` field for both admitted and blocked runs
- [ ] Circuit breaker state file is created and persists correctly between runs
- [ ] Spend guard state file prunes runs older than 24h
- [ ] A run targeting 0 eligible users exits before calling any provider
- [ ] A run where the circuit is open exits before calling any provider
