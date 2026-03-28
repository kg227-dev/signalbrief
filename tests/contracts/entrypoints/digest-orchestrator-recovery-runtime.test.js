"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { assertNodeSyntaxFile, assertModuleExports } = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/entrypoints/digest-orchestrator-recovery-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);
const { createDigestOrchestratorRecoveryRuntime } = runtime;
assert.strictEqual(typeof createDigestOrchestratorRecoveryRuntime, "function", "must export factory");

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sb-recovery-rt-"));
}

function makeRuntime(tmpDir, overrides) {
  return createDigestOrchestratorRecoveryRuntime({
    fs,
    path,
    circuitBreakerStatePath: path.join(tmpDir, "circuit-breaker.json"),
    incidentStorePath: path.join(tmpDir, "incident-store.json"),
    spendGuardStatePath: path.join(tmpDir, "spend-guard-state.json"),
    costLogPath: path.join(tmpDir, "cost-log.jsonl"),
    digestRetryStatePath: path.join(tmpDir, "digest-retry-state.json"),
    recoveryQueuePath: path.join(tmpDir, "recovery-queue.json"),
    log: () => {},
    nowProvider: () => new Date("2026-03-23T12:00:00.000Z"),
    ...overrides,
  });
}

async function testSnapshotEmptyState() {
  const tmpDir = makeTmpDir();
  try {
    const rt = makeRuntime(tmpDir);
    const snapshot = rt.takeSystemSnapshot();
    assert.strictEqual(snapshot.circuit_breaker.status, "CLOSED", "CB should default to CLOSED");
    assert.strictEqual(snapshot.circuit_breaker.opened_at, null);
    assert.deepStrictEqual(snapshot.active_incidents, [], "no active incidents");
    assert.strictEqual(snapshot.spend_guard.rolling_6h_usd, 0);
    assert.strictEqual(snapshot.spend_guard.daily_usd, 0);
    assert.deepStrictEqual(snapshot.recent_runs, [], "no recent runs");
    assert.strictEqual(snapshot.retry_state.users_with_pending_retry, 0);
    assert.strictEqual(snapshot.retry_state.users_with_exhausted_budget, 0);
    assert.strictEqual(snapshot.recovery_queue.pending, 0);
    assert.deepStrictEqual(snapshot.recovery_queue.items, []);
    console.log("PASS testSnapshotEmptyState");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function testSnapshotCircuitBreakerOpen() {
  const tmpDir = makeTmpDir();
  try {
    const cbPath = path.join(tmpDir, "circuit-breaker.json");
    const now = new Date("2026-03-23T11:00:00.000Z");
    fs.writeFileSync(
      cbPath,
      JSON.stringify({
        version: 1,
        status: "OPEN",
        opened_at: now.toISOString(),
        opened_reason: "test",
        triggered_by: "run-abc",
        updated_at: now.toISOString(),
      }),
      "utf8"
    );
    const rt = makeRuntime(tmpDir);
    const snapshot = rt.takeSystemSnapshot();
    assert.strictEqual(snapshot.circuit_breaker.status, "OPEN");
    assert.strictEqual(snapshot.circuit_breaker.opened_reason, "test");
    console.log("PASS testSnapshotCircuitBreakerOpen");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function testSnapshotActiveIncidents() {
  const tmpDir = makeTmpDir();
  try {
    const storePath = path.join(tmpDir, "incident-store.json");
    fs.writeFileSync(
      storePath,
      JSON.stringify({
        version: 1,
        updated_at: new Date().toISOString(),
        incidents: {
          "scheduled:circuit_breaker_opened:2026-03-23": {
            fingerprint: "scheduled:circuit_breaker_opened:2026-03-23",
            status: "OPEN",
            severity: "WARNING",
            type: "circuit_breaker_opened",
            date_et: "2026-03-23",
            occurrence_count: 1,
            first_seen: "2026-03-23T10:00:00.000Z",
            last_seen: "2026-03-23T10:00:00.000Z",
          },
          "scheduled:provider_timeout:2026-03-22": {
            fingerprint: "scheduled:provider_timeout:2026-03-22",
            status: "RESOLVED",
            severity: "WARNING",
            type: "provider_timeout",
            date_et: "2026-03-22",
            occurrence_count: 1,
            first_seen: "2026-03-22T10:00:00.000Z",
            last_seen: "2026-03-22T10:00:00.000Z",
          },
        },
      }),
      "utf8"
    );
    const rt = makeRuntime(tmpDir);
    const snapshot = rt.takeSystemSnapshot();
    assert.strictEqual(snapshot.active_incidents.length, 1, "only 1 OPEN incident should be active");
    assert.strictEqual(snapshot.active_incidents[0].type, "circuit_breaker_opened");
    console.log("PASS testSnapshotActiveIncidents");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function testSnapshotSpendGuard() {
  const tmpDir = makeTmpDir();
  try {
    const sgPath = path.join(tmpDir, "spend-guard-state.json");
    // now = 2026-03-23T12:00:00Z
    // recent = within 6h = after 2026-03-23T06:00:00Z
    const recentTs = new Date("2026-03-23T10:00:00.000Z").toISOString();
    const oldTs = new Date("2026-03-23T04:00:00.000Z").toISOString();
    fs.writeFileSync(
      sgPath,
      JSON.stringify({
        version: 1,
        zero_value_runs: [
          { ts_utc: recentTs, date_et: "2026-03-23", run_id: "r1", user_id: "u1", failure_class: "transient", cost_usd: 0.012 },
          { ts_utc: oldTs, date_et: "2026-03-23", run_id: "r2", user_id: "u2", failure_class: "transient", cost_usd: 0.008 },
        ],
      }),
      "utf8"
    );
    const rt = makeRuntime(tmpDir);
    const snapshot = rt.takeSystemSnapshot();
    // Only the recent entry is in the 6h window
    assert.ok(
      Math.abs(snapshot.spend_guard.rolling_6h_usd - 0.012) < 0.0001,
      `rolling_6h_usd should be 0.012, got ${snapshot.spend_guard.rolling_6h_usd}`
    );
    console.log("PASS testSnapshotSpendGuard");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function testSnapshotCostLog() {
  const tmpDir = makeTmpDir();
  try {
    const costLogPath = path.join(tmpDir, "cost-log.jsonl");
    const lines = [];
    for (let i = 1; i <= 7; i++) {
      lines.push(
        JSON.stringify({
          date: "2026-03-23",
          run_at_et: `2026-03-23 0${i}:00 AM ET`,
          total_cost_usd: i * 0.01,
          users_served: i,
          users_targeted: 10,
          run_value_state: "positive",
        })
      );
    }
    fs.writeFileSync(costLogPath, lines.join("\n") + "\n", "utf8");
    const rt = makeRuntime(tmpDir);
    const snapshot = rt.takeSystemSnapshot();
    assert.strictEqual(snapshot.recent_runs.length, 5, "should return last 5 lines only");
    console.log("PASS testSnapshotCostLog");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function testSnapshotRecoveryQueue() {
  const tmpDir = makeTmpDir();
  try {
    const rt = makeRuntime(tmpDir);
    rt.enqueueRecoveryAction({ action: "close_circuit", by: "admin", reason: "manual" });
    rt.enqueueRecoveryAction({ action: "clear_incidents", by: "admin", reason: "test" });
    const snapshot = rt.takeSystemSnapshot();
    assert.strictEqual(snapshot.recovery_queue.pending, 2);
    assert.strictEqual(snapshot.recovery_queue.items.length, 2);
    console.log("PASS testSnapshotRecoveryQueue");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function testFormatSnapshotMessage() {
  const tmpDir = makeTmpDir();
  try {
    const rt = makeRuntime(tmpDir);
    const snapshot = rt.takeSystemSnapshot();
    const msg = rt.formatSnapshotMessage(snapshot);
    assert.strictEqual(typeof msg, "string", "formatSnapshotMessage should return a string");
    assert.ok(msg.includes("Circuit Breaker"), "message should include 'Circuit Breaker'");
    assert.ok(msg.includes("Active Incidents"), "message should include 'Active Incidents'");
    console.log("PASS testFormatSnapshotMessage");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function testEnqueueAction() {
  const tmpDir = makeTmpDir();
  try {
    const rt = makeRuntime(tmpDir);
    const queuePath = path.join(tmpDir, "recovery-queue.json");
    rt.enqueueRecoveryAction({ action: "close_circuit", by: "admin", reason: "manual resume" });
    rt.enqueueRecoveryAction({ action: "flush_retry_state", by: "ops", reason: "cleanup" });
    const queue = JSON.parse(fs.readFileSync(queuePath, "utf8"));
    assert.strictEqual(queue.items.length, 2, "should have 2 items in queue");
    assert.strictEqual(queue.items[0].status, "pending");
    assert.strictEqual(queue.items[1].status, "pending");
    console.log("PASS testEnqueueAction");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function testDrainSuccess() {
  const tmpDir = makeTmpDir();
  try {
    const rt = makeRuntime(tmpDir);
    const queuePath = path.join(tmpDir, "recovery-queue.json");
    rt.enqueueRecoveryAction({ action: "close_circuit" });
    rt.enqueueRecoveryAction({ action: "close_circuit" });

    const result = await rt.drainRecoveryQueue({
      close_circuit: async () => {},
    });
    assert.strictEqual(result.processed, 2);
    assert.strictEqual(result.succeeded, 2);
    assert.strictEqual(result.failed, 0);
    assert.deepStrictEqual(result.errors, []);

    const queue = JSON.parse(fs.readFileSync(queuePath, "utf8"));
    assert.ok(queue.items.every((i) => i.status === "done"), "all items should be done");
    console.log("PASS testDrainSuccess");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function testDrainHandlerError() {
  const tmpDir = makeTmpDir();
  try {
    const rt = makeRuntime(tmpDir);
    rt.enqueueRecoveryAction({ action: "close_circuit" });

    const result = await rt.drainRecoveryQueue({
      close_circuit: async () => {
        throw new Error("handler failed");
      },
    });
    assert.strictEqual(result.processed, 1);
    assert.strictEqual(result.succeeded, 0);
    assert.strictEqual(result.failed, 1);
    assert.strictEqual(result.errors.length, 1);
    assert.ok(result.errors[0].error_message.includes("handler failed"));
    console.log("PASS testDrainHandlerError");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function testDrainEmptyQueue() {
  const tmpDir = makeTmpDir();
  try {
    const rt = makeRuntime(tmpDir);
    // No queue file exists
    const result = await rt.drainRecoveryQueue({ close_circuit: async () => {} });
    assert.strictEqual(result.processed, 0);
    assert.strictEqual(result.succeeded, 0);
    assert.strictEqual(result.failed, 0);
    assert.deepStrictEqual(result.errors, []);
    console.log("PASS testDrainEmptyQueue");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function testDrainUnknownAction() {
  const tmpDir = makeTmpDir();
  try {
    const rt = makeRuntime(tmpDir);
    rt.enqueueRecoveryAction({ action: "unknown_action_type" });

    const result = await rt.drainRecoveryQueue({});
    // Unknown action type — handler not found, skipped, not counted as processed
    assert.strictEqual(result.processed, 0, "unknown actions should be skipped, not counted as processed");
    console.log("PASS testDrainUnknownAction");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function main() {
  await testSnapshotEmptyState();
  await testSnapshotCircuitBreakerOpen();
  await testSnapshotActiveIncidents();
  await testSnapshotSpendGuard();
  await testSnapshotCostLog();
  await testSnapshotRecoveryQueue();
  await testFormatSnapshotMessage();
  await testEnqueueAction();
  await testDrainSuccess();
  await testDrainHandlerError();
  await testDrainEmptyQueue();
  await testDrainUnknownAction();
  console.log("ALL TESTS PASSED");
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
