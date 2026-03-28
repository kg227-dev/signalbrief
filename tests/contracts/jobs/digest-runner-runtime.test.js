"use strict";

const path = require("path");
const fs = require("fs");
const { assertNodeSyntaxFile, assertModuleExports } = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/jobs/digest-runner-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const source = fs.readFileSync(TARGET_PATH, "utf8");
if (!source.includes("module.exports = require(\"./digest-runner-core-runtime\");")) {
  throw new Error("digest-runner runtime should be a thin re-export of the core runtime");
}
if (source.includes("confirmQueuedRunStarted") || source.includes("queueDigestTrigger")) {
  throw new Error("digest-runner runtime should not carry the removed queued on-demand shim surface");
}
assertModuleExports(() => require(TARGET_PATH), TARGET_REL);
