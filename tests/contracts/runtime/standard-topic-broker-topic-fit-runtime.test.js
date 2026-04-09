"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/runtime/standard-topic-broker-topic-fit-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const {
  assignCanonicalTopic,
  chooseBestFitTopicTag,
  normalizeTopicTag,
  scoreBestFitTopicTag,
} = runtime;

assert.strictEqual(normalizeTopicTag("healthcare"), "HEALTHCARE");
assert.strictEqual(assignCanonicalTopic(["TECHNOLOGY"]), "TECHNOLOGY");
assert.strictEqual(assignCanonicalTopic([], { headline: "ignored" }), null);
assert.ok(scoreBestFitTopicTag("HEALTHCARE", "hospital payer reimbursement care delivery") > scoreBestFitTopicTag("TECHNOLOGY", "hospital payer reimbursement care delivery"));
assert.strictEqual(chooseBestFitTopicTag(["HEALTHCARE", "TECHNOLOGY"], { headline: "Hospital payer reimbursement care delivery" }), "HEALTHCARE");

process.stdout.write("[standard-topic-broker-topic-fit-runtime] all assertions passed\n");
