"use strict";

const path = require("path");
const { assertNodeSyntaxFile, assertModuleExports, assertSourceIncludesFile } = require("../../../../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/runtime/reply/onboarding/pending-verification.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
assertSourceIncludesFile(TARGET_PATH, [
  "@typedef {import(\"../../runtime-types\").PendingVerification} PendingVerification",
  "createPendingVerification",
]);
assertModuleExports(() => require(TARGET_PATH), TARGET_REL);
