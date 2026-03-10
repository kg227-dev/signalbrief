"use strict";

const path = require("path");
const fs = require("fs");
const { assertNodeSyntaxFile, assertSourceIncludesFile, assertModuleExports } = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "reengagement.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtimePath = path.join(process.cwd(), "src/jobs/reengagement-runtime.js");
assertSourceIncludesFile(runtimePath, ["function ensureStoreInitialized()", "ensureStoreInitialized();"]);
const runtimeSource = fs.readFileSync(runtimePath, "utf8");
if (runtimeSource.includes("\ninitStore();\n")) {
  throw new Error("reengagement runtime should not initialize store at import time");
}
assertModuleExports(() => require(TARGET_PATH), TARGET_REL);
