"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { assertNodeSyntaxFile, assertModuleExports } = require("../../../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/runtime/digest-lock-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-lock-test-"));
const lockFile = path.join(tmpDir, "digest-run.lock");
try {
  const absent = runtime.clearDigestLockFile(lockFile);
  assert.strictEqual(absent.ok, true);
  assert.strictEqual(absent.code, "absent");

  fs.writeFileSync(lockFile, JSON.stringify({ startedAt: new Date().toISOString() }));
  const cleared = runtime.clearDigestLockFile(lockFile);
  assert.strictEqual(cleared.ok, true);
  assert.strictEqual(cleared.code, "cleared");
  assert.strictEqual(fs.existsSync(lockFile), false);

  const invalid = runtime.clearDigestLockFile("");
  assert.strictEqual(invalid.ok, false);
  assert.strictEqual(invalid.code, "invalid_lock_file");
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

