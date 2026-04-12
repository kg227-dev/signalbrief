"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { assertNodeSyntaxFile, assertModuleExports } = require("../../../test-support/module-contract-helper.js");

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

  cb.openCircuit({ reason: "overnight_test", triggeredBy: "test", dateEt: "2026-03-23" });
  assert.strictEqual(cb.isOpen(), true, "breaker opens for stale-close test");
  fakeNow = new Date("2026-03-24T11:00:00.000Z");
  assert.strictEqual(cb.isOpen(), false, "breaker auto-closes on the next ET day");
  assert.strictEqual(cb.getState().status, CB_STATUS_CLOSED, "state resets after auto-close");
  fakeNow = new Date("2026-03-23T12:00:00.000Z");

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
