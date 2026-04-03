"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/digest/runtime/digest-item-ordering-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
const { readItemScore, sortDigestItemsByScoreDescending } = runtime;
assertModuleExports(() => runtime, TARGET_REL);

assert.strictEqual(readItemScore({ relevanceScore: 7.6 }), 7.6);
assert.strictEqual(readItemScore({ relevance_score: 6.8 }), 6.8);
assert.strictEqual(readItemScore({ relevanceScore: "x" }), null);
assert.strictEqual(readItemScore({ relevanceScore: null }), null);
assert.strictEqual(readItemScore({ relevance_score: "" }), null);

const original = [
  { headline: "Second", relevanceScore: 6.8 },
  { headline: "First", relevance_score: 7.6 },
  { headline: "Third", relevanceScore: 6.8 },
  { headline: "Unscored" },
];
const sorted = sortDigestItemsByScoreDescending(original);

assert.deepStrictEqual(
  sorted.map((item) => item.headline),
  ["First", "Second", "Third", "Unscored"]
);
assert.deepStrictEqual(
  original.map((item) => item.headline),
  ["Second", "First", "Third", "Unscored"]
);
