"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { assertNodeSyntaxFile, assertModuleExports } = require("../../../test-support/module-contract-helper.js");

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

  // Rolling cap check - under threshold
  const rolling = guard.checkRollingWindowCap(1.0, 6);
  assert.strictEqual(rolling.hit, false, "under rolling cap");
  assert.ok(Math.abs(rolling.spent - 0.15) < 0.0001);

  // Push over rolling cap
  guard.recordZeroValueRun({ runId: "r2", dateEt: "2026-03-23", userId: "u2", failureClass: "retrieval_thin", costUsd: 0.90 });
  const rollingOver = guard.checkRollingWindowCap(1.0, 6);
  assert.strictEqual(rollingOver.hit, true, "over rolling cap after second run");

  // Daily cap check - under threshold
  const daily = guard.checkDailyCap("2026-03-23", 2.5);
  assert.strictEqual(daily.hit, false, "under daily cap");

  // Push over daily cap
  guard.recordZeroValueRun({ runId: "r3", dateEt: "2026-03-23", userId: "u3", failureClass: "ranking_policy_limited", costUsd: 2.0 });
  const dailyOver = guard.checkDailyCap("2026-03-23", 2.5);
  assert.strictEqual(dailyOver.hit, true, "over daily cap");

  // Old runs (>6h) excluded from rolling window but daily total is unchanged
  fakeNow = new Date("2026-03-23T15:00:00.000Z"); // 7 hours later
  const guardLater = createDigestOrchestratorSpendGuardRuntime({
    fs,
    path,
    spendGuardStatePath,
    log: () => {},
    nowProvider: () => new Date(fakeNow),
  });
  const rollingLater = guardLater.queryRollingZeroValueSpend(6);
  // The runs from 08:00 are >6h old at 15:00 — rolling window should be 0
  assert.strictEqual(rollingLater, 0, "old runs outside rolling window");

  console.log("PASS: spend guard runtime");
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
