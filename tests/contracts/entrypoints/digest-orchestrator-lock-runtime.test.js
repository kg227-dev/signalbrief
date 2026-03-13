"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  LOCK_STATES,
  readDigestLockState,
  clearDigestLockFile,
  getDigestLockOwnerStatus,
} = require("../../../src/platform/scheduler");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/entrypoints/digest-orchestrator-lock-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
const { createDigestOrchestratorLockRuntime } = runtime;
assertModuleExports(() => runtime, TARGET_REL);

function testLockAcquireReleaseCycle() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-lock-runtime-"));
  const lockFilePath = path.join(tmpDir, "digest-run.lock");
  const lockRuntime = createDigestOrchestratorLockRuntime({
    fs,
    path,
    lockFilePath,
    lockStaleMs: 5 * 60 * 1000,
    lockStates: LOCK_STATES,
    readDigestLockState,
    clearDigestLockFile,
    getDigestLockOwnerStatus,
    log: () => {},
    getPid: () => process.pid,
    nowIso: () => new Date().toISOString(),
  });

  const first = lockRuntime.acquireDigestLock("scheduled");
  assert.strictEqual(first.ok, true, "first lock acquire should succeed");

  const second = lockRuntime.acquireDigestLock("scheduled");
  assert.strictEqual(second.ok, false, "second lock acquire should fail while held");
  assert.strictEqual(second.reason, "locked");

  lockRuntime.releaseDigestLock();
  const third = lockRuntime.acquireDigestLock("scheduled");
  assert.strictEqual(third.ok, true, "lock should be acquirable again after release");
  lockRuntime.releaseDigestLock();
}

testLockAcquireReleaseCycle();
