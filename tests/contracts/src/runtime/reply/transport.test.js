"use strict";

const path = require("path");
const { assertNodeSyntaxFile, assertSourceIncludesFile, assertModuleExports } = require("../../../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/runtime/reply/transport.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
assertSourceIncludesFile(TARGET_PATH, ['kind: "json"', 'kind: "text"']);
assertModuleExports(() => require(TARGET_PATH), TARGET_REL);
