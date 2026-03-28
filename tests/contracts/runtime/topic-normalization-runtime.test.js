"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/runtime/topic-normalization-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);

assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const {
  normalizeMatchText,
  normalizeTopicToken,
  topicsRelated,
} = runtime;

assert.strictEqual(normalizeMatchText(" AI×TECH  News! "), "ai tech news");
assert.strictEqual(normalizeTopicToken("custom_CONSUMER & RETAIL"), "consumer retail");
assert.strictEqual(topicsRelated("Technology", "AI×TECH"), true);
assert.strictEqual(topicsRelated("Healthcare", "Energy"), false);

process.stdout.write("[topic-normalization-runtime] all assertions passed\n");
