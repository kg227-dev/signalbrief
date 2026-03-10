"use strict";

const path = require("path");
const fs = require("fs");
const { assertNodeSyntaxFile, assertModuleExports, assertSourceIncludesFile } = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/entrypoints/scheduler-worker.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
assertSourceIncludesFile(TARGET_PATH, ["function getWorkerConfig()", "function startSchedulerWorker()"]);
const source = fs.readFileSync(TARGET_PATH, "utf8");
if (source.includes("const POLL_MS =") || source.includes("const RUN_TIMEOUT_MS =")) {
  throw new Error("scheduler-worker should avoid import-time env snapshots");
}
if (!source.includes("lock_unhealthy_blocked") || !source.includes("function resetSchedulerBlockState(")) {
  throw new Error("scheduler-worker should provide lock_unhealthy blocked mode and manual reset API");
}
const worker = require(TARGET_PATH);
assertModuleExports(() => worker, TARGET_REL);
[
  "getWorkerConfig",
  "getLockUnhealthyBlockThreshold",
  "getSchedulerWorkerState",
  "resetSchedulerWorkerState",
  "resetSchedulerBlockState",
  "runDigest",
  "writeHeartbeat",
  "startSchedulerWorker",
  "stopSchedulerWorker",
  "shutdown",
].forEach((name) => {
  if (typeof worker[name] !== "function") {
    throw new Error(`Expected scheduler-worker export '${name}' to be a function`);
  }
});
