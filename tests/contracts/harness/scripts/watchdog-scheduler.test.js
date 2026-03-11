"use strict";

const path = require("path");
const { assertNodeSyntaxFile, assertSourceIncludesFile } = require("../../../../test-support/module-contract-helper.js");

const TARGET_REL = "scripts/watchdog-scheduler.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
assertSourceIncludesFile(TARGET_PATH, [
  "SCHEDULER_WATCHDOG_RUN_REASON",
  "reasonCode",
  "post-restart health check",
  "recovered (",
]);
