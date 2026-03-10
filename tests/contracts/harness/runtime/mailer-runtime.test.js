"use strict";

const path = require("path");
const fs = require("fs");
const { assertNodeSyntaxFile, assertSourceIncludesFile, assertModuleExports } = require("../../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/runtime/mailer/mailer-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const source = fs.readFileSync(TARGET_PATH, "utf8");
if (source.includes("function _unsubSecret(")) {
  throw new Error("mailer runtime should avoid opaque _unsubSecret naming");
}
assertSourceIncludesFile(TARGET_PATH, ["function getUnsubscribeSigningSecret(", "signUnsubEmail"]);
assertModuleExports(() => require(TARGET_PATH), TARGET_REL);
