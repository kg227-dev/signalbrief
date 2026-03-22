"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/runtime/digest-retry-state-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const { createDigestRetryStateRuntime } = runtime;

(() => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-digest-retry-state-"));
  try {
    const statePath = path.join(rootDir, "digest-retry-state.json");
    const retryStateRuntime = createDigestRetryStateRuntime({
      APP_ROOT: rootDir,
      digestRetryStatePath: statePath,
      fs,
      path,
      log: () => {},
    });

    retryStateRuntime.upsertRetryState({
      user_id: "user-1",
      date_et: "2099-03-22",
      attempt_count: 1,
      next_retry_at: "2099-03-22T11:20:00.000Z",
      delivery_outcome: "withheld_retry_pending",
      retry_pending: true,
    });
    const loaded = retryStateRuntime.getRetryState("user-1", "2099-03-22");
    assert.ok(loaded);
    assert.strictEqual(loaded.attempt_count, 1);
    assert.strictEqual(loaded.retry_pending, true);

    retryStateRuntime.clearRetryState("user-1", "2099-03-22");
    assert.strictEqual(retryStateRuntime.getRetryState("user-1", "2099-03-22"), null);

    retryStateRuntime.upsertRetryState({
      user_id: "user-2",
      date_et: "2000-01-01",
      attempt_count: 1,
      next_retry_at: "2000-01-01T11:20:00.000Z",
      delivery_outcome: "withheld_after_retry",
      retry_pending: false,
    });
    const state = retryStateRuntime.loadState();
    assert.strictEqual(state.entries["user-2::2000-01-01"], undefined, "old retry state should prune on load");
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
})();

process.stdout.write("[digest-retry-state-runtime] all assertions passed\n");
