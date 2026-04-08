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

const {
  buildDigestDataExtractionPrompt,
  buildDigestDataFormattingRetryPrompt,
  buildDigestDataWimPrompt,
  buildDigestDataWimRepairPrompt,
} = runtime;

const item = {
  headline: "Nvidia expands Blackwell supply",
  summary: "Capacity commitments tighten near-term GPU supply.",
  tag: "AI",
};

const extractionPrompt = buildDigestDataExtractionPrompt(item);
assert.ok(extractionPrompt.includes("Extract key facts from this article."));
assert.ok(extractionPrompt.includes('"what_happened"'));
assert.ok(extractionPrompt.includes('"mechanism"'));
assert.ok(extractionPrompt.includes('"who_it_impacts"'));
assert.ok(extractionPrompt.includes('"implication"'));
assert.ok(extractionPrompt.includes('"confidence"'));
assert.ok(extractionPrompt.includes("No text outside JSON"));
assert.ok(extractionPrompt.includes("Nvidia expands Blackwell supply"));

const retryPrompt = buildDigestDataFormattingRetryPrompt("```json\n{bad-json\n```");
assert.ok(retryPrompt.includes("Return ONLY valid JSON. Fix formatting. No extra text."));
assert.ok(retryPrompt.includes("{bad-json"));

const wimPrompt = buildDigestDataWimPrompt(item, {
  what_happened: "Blackwell supply expands",
  mechanism: "capacity commitments are tightening supply",
  who_it_impacts: "GPU buyers",
  implication: "buyers may face tighter allocation and higher pricing",
});
assert.ok(wimPrompt.includes('write a "Why it matters"'));
assert.ok(wimPrompt.includes("Maximum 2 sentences"));
assert.ok(wimPrompt.includes("Maximum 2 clauses per sentence"));
assert.ok(wimPrompt.includes("pricing, margin, capex, competition, regulation, or operations"));
assert.ok(wimPrompt.includes("Avoid vague actors"));
assert.ok(wimPrompt.includes('"wim"'));
assert.ok(wimPrompt.includes("who_it_impacts: GPU buyers"));

const repairPrompt = buildDigestDataWimRepairPrompt(item, {
  what_happened: "Blackwell supply expands",
  mechanism: "capacity commitments are tightening supply",
  who_it_impacts: "GPU buyers",
  implication: "buyers may face tighter allocation and higher pricing",
}, ["sentence_clause_overload", "missing_lever"], "Too long and generic.");
assert.ok(repairPrompt.includes('Rewrite this "Why it matters" so it passes validation.'));
assert.ok(repairPrompt.includes("Simplify while preserving mechanism and implication."));
assert.ok(repairPrompt.includes("Max 2 clauses per sentence"));
assert.ok(repairPrompt.includes("Validation failures to fix"));

process.stdout.write("[digest-data-enrich-prompt-runtime] all assertions passed\n");
