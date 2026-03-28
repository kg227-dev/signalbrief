"use strict";

const path = require("path");
const fs = require("fs");
const { assertNodeSyntaxFile, assertModuleExports } = require("../../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/runtime/runtime-types.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const source = fs.readFileSync(TARGET_PATH, "utf8");
if (
  !source.includes("@typedef {Object} UserRecord")
) {
  throw new Error("runtime-types should define shared runtime JSDoc contracts");
}
assertModuleExports(() => require(TARGET_PATH), TARGET_REL);
