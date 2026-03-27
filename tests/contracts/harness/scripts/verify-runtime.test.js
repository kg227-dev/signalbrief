"use strict";

const path = require("path");
const { assertNodeSyntaxFile, assertSourceIncludesFile } = require("../../../../test-support/module-contract-helper.js");

const TARGET_REL = "scripts/verify-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
assertSourceIncludesFile(TARGET_PATH, [
  "SCHEDULER_HEALTH_RETRIES",
  "--container-mode",
  "Container mode: skipping docker compose host checks",
  "--expected-store-backend",
  "--expected-sqlite-path",
  "expected store backend",
  "expected sqlite path",
  "scheduler health did not become healthy within retry window",
  "docker compose logs --no-color --tail",
]);
