"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "web/server-runtime-scheduler-control-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
const { createSchedulerWorkerRestartRequester } = runtime;
assertModuleExports(() => runtime, TARGET_REL);

assert.throws(() => createSchedulerWorkerRestartRequester({}), /fs/);
assert.throws(() => createSchedulerWorkerRestartRequester({ fs, path: null, schedulerControlFile: "/tmp/x" }), /path/);
assert.throws(() => createSchedulerWorkerRestartRequester({ fs, path, schedulerControlFile: "" }), /schedulerControlFile/);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-scheduler-control-"));
const controlFile = path.join(tempDir, "nested", "scheduler-control.json");
const requestRestart = createSchedulerWorkerRestartRequester({
  fs,
  path,
  schedulerControlFile: controlFile,
});

const result = requestRestart({
  reason: "smoke_test",
  source: "contract",
  requestedBy: "tester",
});
assert.strictEqual(result.control_file, controlFile);
assert.ok(result.request_id.startsWith("restart_"));
assert.ok(/\d{4}-\d{2}-\d{2}T/.test(result.requested_at));

const payload = JSON.parse(fs.readFileSync(controlFile, "utf8"));
assert.strictEqual(payload.restart_worker.reason, "smoke_test");
assert.strictEqual(payload.restart_worker.source, "contract");
assert.strictEqual(payload.restart_worker.requested_by, "tester");
