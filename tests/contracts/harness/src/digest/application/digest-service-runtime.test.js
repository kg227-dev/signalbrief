"use strict";

const path = require("path");
const { assertNodeSyntaxFile, assertModuleExports } = require("../../../../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/digest/application/digest-service-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

