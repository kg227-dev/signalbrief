"use strict";

const path = require("path");
const {
  assertNodeSyntaxFile,
  assertSourceIncludesFile,
} = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "web/server-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
assertSourceIncludesFile(TARGET_PATH, [
  "createStructuredLogger",
  "web.request.error",
  "web.process.uncaught_exception",
  "web.process.unhandled_rejection",
  "run_id",
  "provider",
  "outcome",
]);
