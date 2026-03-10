"use strict";

const path = require("path");
const fs = require("fs");
const { assertNodeSyntaxFile, assertModuleExports } = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/jobs/digest-runner-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const source = fs.readFileSync(TARGET_PATH, "utf8");
if (!source.includes("function confirmQueuedRunStarted(")) {
  throw new Error("digest-runner runtime should confirm queued start against lock ownership");
}
assertModuleExports(() => require(TARGET_PATH), TARGET_REL);
