"use strict";

const path = require("path");
const fs = require("fs");
const { assertNodeSyntaxFile, assertSourceIncludesFile, assertModuleExports } = require("../../../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/runtime/reply/onboarding-service-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const source = fs.readFileSync(TARGET_PATH, "utf8");
if (source.includes("validateCodeInput(codeRaw)")) {
  throw new Error("onboarding-service-runtime should delegate verification checks to unified flow");
}
assertSourceIncludesFile(TARGET_PATH, ["maxAttempts: MAX_VERIFY_ATTEMPTS", "withPendingVerificationResendAfter"]);
assertModuleExports(() => require(TARGET_PATH), TARGET_REL);
