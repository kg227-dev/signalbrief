"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/digest/domain/storyline-domain-helpers-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const {
  appendUniqueCode,
  clamp,
  headlineTrigramOverlap,
  jaccard,
  stripHtml,
  tokenSet,
  uniqPreserveOrder,
  uniqSorted,
} = runtime;

assert.strictEqual(clamp(1.4, 0, 1), 1);
assert.strictEqual(stripHtml("<b>hello</b>").trim(), "hello");
assert.deepStrictEqual(uniqSorted(["b", "a", "", "b"]), ["a", "b"]);
assert.deepStrictEqual(uniqPreserveOrder(["a", "b", "a"]), ["a", "b"]);
assert.ok(tokenSet("Acme Corporation").has("acme"));
assert.ok(jaccard(["a", "b"], ["b", "c"]) > 0);
assert.ok(headlineTrigramOverlap({ headline: "AI supply chain risk" }, { headline: "AI supply chain risks rise" }) >= 0);
assert.deepStrictEqual(appendUniqueCode(["x"], "y"), ["x", "y"]);

process.stdout.write("[storyline-domain-helpers-runtime] all assertions passed\n");
