"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Module = require("module");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/entrypoints/scheduler-worker.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);

function withEnv(overrides, fn) {
  const keys = Object.keys(overrides || {});
  const previous = {};
  for (const key of keys) {
    previous[key] = process.env[key];
    const value = overrides[key];
    if (value == null) delete process.env[key];
    else process.env[key] = String(value);
  }
  const restore = () => {
    for (const key of keys) {
      const value = previous[key];
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  };
  try {
    return fn();
  } catch (error) {
    throw error;
  } finally {
    restore();
  }
}

function loadSchedulerWorkerWithStub(runDigestTrigger) {
  const originalLoad = Module._load;
  delete require.cache[TARGET_PATH];
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "../jobs/digest-runner-runtime") {
      return {
        DIGEST_LOCK_EXIT_CODE: 4,
        runDigestTrigger,
      };
    }
    return originalLoad.apply(this, arguments);
  };

  try {
    const worker = require(TARGET_PATH);
    assertModuleExports(() => worker, TARGET_REL);
    return worker;
  } finally {
    Module._load = originalLoad;
    delete require.cache[TARGET_PATH];
  }
}

function resolvedThenable(value) {
  return {
    then(onFulfilled) {
      if (typeof onFulfilled === "function") onFulfilled(value);
      return {
        catch() {
          return this;
        },
      };
    },
    catch() {
      return this;
    },
  };
}

function testConfigIsReadAtCallTime() {
  const worker = loadSchedulerWorkerWithStub(async () => ({
    ok: true,
    busy: false,
    lockUnhealthy: false,
    lockState: "absent",
    lockError: null,
    exitCode: 0,
    signal: null,
  }));

  withEnv({
    DIGEST_POLL_MS: "180000",
    DIGEST_RUN_TIMEOUT_MS: "120000",
    DIGEST_WORKER_ARGS: "--chatId 12345 --dry-run --chat-id=999 --mode=scheduled",
  }, () => {
    const first = worker.getWorkerConfig();
    assert.strictEqual(first.pollMs, 180000);
    assert.strictEqual(first.runTimeoutMs, 120000);
    assert.deepStrictEqual(first.workerArgs, ["--dry-run", "--mode=scheduled"]);

    process.env.DIGEST_POLL_MS = "420000";
    process.env.DIGEST_RUN_TIMEOUT_MS = "240000";
    const second = worker.getWorkerConfig();
    assert.strictEqual(second.pollMs, 420000);
    assert.strictEqual(second.runTimeoutMs, 240000);
    assert.deepStrictEqual(second.workerArgs, ["--dry-run", "--mode=scheduled"]);
  });
}

function testLockUnhealthyBlocksAndManualResetClearsState() {
  let triggerCalls = 0;
  const worker = loadSchedulerWorkerWithStub(() => {
    triggerCalls += 1;
    return resolvedThenable({
      ok: false,
      busy: false,
      lockUnhealthy: true,
      lockState: "invalid_json",
      code: "invalid_json",
      lockError: "corrupt lock payload",
      exitCode: 4,
      signal: null,
    });
  });

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-worker-contract-"));
  const heartbeatFile = path.join(tempDir, "scheduler-heartbeat.json");
  const controlFile = path.join(tempDir, "scheduler-control.json");

  withEnv({
    SCHEDULER_HEARTBEAT_FILE: heartbeatFile,
    SCHEDULER_CONTROL_FILE: controlFile,
    DIGEST_LOCK_UNHEALTHY_BLOCK_THRESHOLD: "1",
    DIGEST_POLL_MS: "300000",
    DIGEST_RUN_TIMEOUT_MS: "120000",
    DIGEST_WORKER_ARGS: "--dry-run",
  }, () => {
    worker.resetSchedulerWorkerState();
    const config = worker.getWorkerConfig();
    worker.runDigest("contract-lock-unhealthy", config);

    assert.strictEqual(worker.getSchedulerWorkerState().blocked, true, "scheduler should enter blocked mode");
    assert.strictEqual(triggerCalls, 1);

    const blockedState = worker.getSchedulerWorkerState().blockedState;
    assert.strictEqual(blockedState.reason, "lock_unhealthy_threshold");
    assert.strictEqual(blockedState.lock_state, "invalid_json");
    assert.strictEqual(blockedState.consecutive_lock_unhealthy, 1);

    const heartbeat = JSON.parse(fs.readFileSync(heartbeatFile, "utf8"));
    assert.strictEqual(heartbeat.status, "blocked");
    assert.strictEqual(heartbeat.skip_reason, "lock_unhealthy_blocked");
    assert.strictEqual(heartbeat.blocked, true);

    worker.runDigest("contract-second-run-skipped", config);
    assert.strictEqual(triggerCalls, 1, "blocked scheduler should not trigger additional digest runs");

    worker.resetSchedulerBlockState("contract-reset", config);
    const resetState = worker.getSchedulerWorkerState();
    assert.strictEqual(resetState.blocked, false);
    assert.strictEqual(resetState.consecutiveLockUnhealthy, 0);

    const resetHeartbeat = JSON.parse(fs.readFileSync(heartbeatFile, "utf8"));
    assert.strictEqual(resetHeartbeat.status, "ready");
    assert.strictEqual(resetHeartbeat.reset_note, "contract-reset");
  });

  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // ignore cleanup failure in contract test
  }
}

testConfigIsReadAtCallTime();
testLockUnhealthyBlocksAndManualResetClearsState();
