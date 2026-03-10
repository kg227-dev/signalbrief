"use strict";

const path = require("path");
const { assertNodeSyntaxFile, assertModuleExports } = require("../../../../test-support/module-contract-helper.js");

const TARGET_REL = "test-harness/cache/cache-perplexity-parser.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
assertModuleExports(() => require(TARGET_PATH), TARGET_REL);
