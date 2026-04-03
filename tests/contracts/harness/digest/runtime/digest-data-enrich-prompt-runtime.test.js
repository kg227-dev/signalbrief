"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/digest/runtime/digest-data-enrich-prompt-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const prompt = runtime.buildDigestDataEnrichPrompt([
  {
    headline: "Nvidia expands Blackwell supply",
    summary: "Capacity commitments tighten near-term GPU supply.",
    tag: "AI",
  },
]);

assert.ok(prompt.includes('writing the "Why It Matters" layer for SignalBrief'));
assert.ok(prompt.includes("interpretation, not summary"));
assert.ok(prompt.includes('"signal_shift"'));
assert.ok(prompt.includes('"implication_type"'));
assert.ok(prompt.includes('"wim_brief"'));
assert.ok(prompt.includes('"wim"'));
assert.ok(prompt.includes('Do NOT start a sentence with "For X teams, this matters for..."'));
assert.ok(prompt.includes("Return ONLY a JSON array"));
assert.ok(prompt.includes('"topic_fit": null'));
assert.ok(!prompt.includes("five fresh signals for one sector topic at a time"));

process.stdout.write("[digest-data-enrich-prompt-runtime] all assertions passed\n");
