"use strict";

const path = require("path");
const fs = require("fs");
const { assertNodeSyntaxFile, assertModuleExports } = require("../../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/digest/runtime/digest-data-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const source = fs.readFileSync(TARGET_PATH, "utf8");
if (source.includes(".__apiCalls")) {
  throw new Error("digest-data-runtime should expose explicit fetch metadata, not array side-channel properties");
}
assertModuleExports(() => require(TARGET_PATH), TARGET_REL);
