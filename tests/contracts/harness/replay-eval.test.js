"use strict";

const path = require("path");
const {
  assertNodeSyntaxFile,
  assertSourceIncludesFile,
  assertModuleExports,
} = require("../../../test-support/module-contract-helper.js");

const CLI_REL = "test-harness/replay-eval.js";
const CLI_PATH = path.join(process.cwd(), CLI_REL);
assertNodeSyntaxFile(CLI_PATH);
assertModuleExports(() => require(CLI_PATH), CLI_REL);

const RUNTIME_REL = "test-harness/runtime/replay-runtime.js";
const RUNTIME_PATH = path.join(process.cwd(), RUNTIME_REL);
assertNodeSyntaxFile(RUNTIME_PATH);
assertSourceIncludesFile(RUNTIME_PATH, ["SignalBrief Replay Eval", "Scheduled duplicate days"]);
assertModuleExports(() => require(RUNTIME_PATH), RUNTIME_REL);
