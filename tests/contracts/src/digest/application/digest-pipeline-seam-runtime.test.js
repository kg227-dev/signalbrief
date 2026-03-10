"use strict";

const path = require("path");
const { assertNodeSyntaxFile, assertModuleExports } = require("../../../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/digest/application/digest-pipeline-seam-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const seam = require(TARGET_PATH);
assertModuleExports(() => seam, TARGET_REL);
if (typeof seam.selectDigestItems !== "function") {
  throw new Error("digest pipeline seam should export selectDigestItems");
}
if (typeof seam.createDigestPolicies !== "function") {
  throw new Error("digest pipeline seam should export createDigestPolicies");
}
