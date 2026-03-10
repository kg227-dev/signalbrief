"use strict";

const path = require("path");
const { assertNodeSyntaxFile, assertSourceIncludesFile, assertModuleExports } = require("../../../../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/runtime/reply/onboarding/link-verification-flow.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
assertSourceIncludesFile(TARGET_PATH, [
  "maxAttempts = 5",
  "Too many incorrect attempts. Start again with `/start your@email.com`.",
]);
assertModuleExports(() => require(TARGET_PATH), TARGET_REL);
