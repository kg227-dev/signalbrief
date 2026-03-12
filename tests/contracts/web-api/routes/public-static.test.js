"use strict";

const path = require("path");
const {
  assertNodeSyntaxFile,
  assertSourceIncludesFile,
  assertModuleExports,
} = require("../../../../test-support/module-contract-helper.js");

const TARGET_REL = "web/routes/public-static.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
assertModuleExports(() => require(TARGET_PATH), TARGET_REL);
assertSourceIncludesFile(TARGET_PATH, [
  "/settings-runtime.js",
  "/settings-ui-runtime.js",
  "/settings-ui-topic-actions-runtime.js",
  "/settings-ui-preferences-actions-runtime.js",
  "url.searchParams.get(\"run\")",
  "event_type",
  "digest_sent",
]);
