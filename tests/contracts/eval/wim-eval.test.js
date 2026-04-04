"use strict";

const path = require("path");
const { assertNodeSyntaxFile, assertModuleExports } = require("../../../test-support/module-contract-helper.js");

const ROOT = path.join(__dirname, "../../..");

function checkModule(rel) {
  const abs = path.join(ROOT, rel);
  assertNodeSyntaxFile(abs);
  assertModuleExports(() => require(abs), rel);
}

checkModule("src/eval/wim/manifest-runtime.js");
