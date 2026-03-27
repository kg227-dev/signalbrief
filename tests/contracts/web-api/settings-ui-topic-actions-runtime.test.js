"use strict";

const path = require("path");
const { assertNodeSyntaxFile, assertSourceIncludesFile } = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "web/settings-ui-topic-actions-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);

assertNodeSyntaxFile(TARGET_PATH);
assertSourceIncludesFile(TARGET_PATH, [
  "topicInputError",
  "You can select up to 3 topics.",
  "topic-group-label",
]);
