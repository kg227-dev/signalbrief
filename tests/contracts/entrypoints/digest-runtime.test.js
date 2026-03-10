"use strict";

const path = require("path");
const fs = require("fs");
const { assertNodeSyntaxFile, assertSourceIncludesFile, assertModuleExports } = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/entrypoints/digest-orchestrator-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const source = fs.readFileSync(TARGET_PATH, "utf8");
if (source.includes("const CONFIG = loadConfig()") || source.includes("const EMAIL_TEMPLATE = fs.readFileSync(")) {
  throw new Error("digest orchestrator should avoid import-time config/template snapshots");
}
if (
  source.includes("../digest/domain/selection-domain-runtime")
  || source.includes("../digest/domain/digest-policy-domain-runtime")
) {
  throw new Error("digest orchestrator should consume digest pipeline seam, not domain internals");
}
assertSourceIncludesFile(TARGET_PATH, ["function getConfig()", "function getEmailTemplate()", "function getBaseUrl()"]);
assertSourceIncludesFile(TARGET_PATH, ["../digest/application/digest-pipeline-seam-runtime"]);
assertModuleExports(() => require(TARGET_PATH), TARGET_REL);
