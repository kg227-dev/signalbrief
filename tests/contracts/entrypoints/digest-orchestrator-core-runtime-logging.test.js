"use strict";

const path = require("path");
const {
  assertNodeSyntaxFile,
  assertSourceIncludesFile,
} = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/entrypoints/digest-orchestrator-core-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
assertSourceIncludesFile(TARGET_PATH, [
  "createStructuredLogger",
  "digest.run.started",
  "digest.run.completed",
  "digest.delivery.ops_alert",
  "digest.delivery.email",
  "run_id",
  "provider",
  "outcome",
]);
