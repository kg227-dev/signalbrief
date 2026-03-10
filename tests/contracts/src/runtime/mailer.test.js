"use strict";

const path = require("path");
const { assertNodeSyntaxFile, assertSourceIncludesFile, assertModuleExports } = require("../../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/runtime/mailer/mailer-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
assertModuleExports(() => require(TARGET_PATH), TARGET_REL);
