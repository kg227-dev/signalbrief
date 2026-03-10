"use strict";

const path = require("path");
const { assertNodeSyntaxFile, assertSourceIncludesFile, assertModuleExports } = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "test-harness/run-matrix.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
assertModuleExports(() => require(TARGET_PATH), TARGET_REL);

const RUNTIME_REL = "test-harness/runtime/matrix-runtime.js";
const RUNTIME_PATH = path.join(process.cwd(), RUNTIME_REL);
assertNodeSyntaxFile(RUNTIME_PATH);
assertSourceIncludesFile(RUNTIME_PATH, ["buildWindowPlan", "Matrix report written:"]);
assertModuleExports(() => require(RUNTIME_PATH), RUNTIME_REL);
