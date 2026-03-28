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

assert.ok(prompt.includes("five fresh signals for one sector topic at a time"));
assert.ok(prompt.includes("operators, founders, investors, and functional leaders"));
assert.ok(prompt.includes("not consulting-speak, generic macro filler"));
assert.ok(prompt.includes("decision relevance for a serious sector reader"));
assert.ok(prompt.includes("\"ops lead\", \"founder\", \"deal team\", \"supply chain lead\""));
assert.ok(!prompt.includes("senior strategy consultants"));
assert.ok(!prompt.includes("MBB, Big 4"));
assert.ok(!prompt.includes("PE/investment shops"));
assert.ok(!prompt.includes("client meetings"));

process.stdout.write("[digest-data-enrich-prompt-runtime] all assertions passed\n");
