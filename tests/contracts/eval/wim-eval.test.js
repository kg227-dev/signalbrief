"use strict";

const path = require("path");
const { assertNodeSyntaxFile, assertModuleExports } = require("../../../test-support/module-contract-helper.js");

const ROOT = path.join(__dirname, "../../..");

function checkModule(rel) {
  const abs = path.join(ROOT, rel);
  assertNodeSyntaxFile(abs);
  assertModuleExports(() => require(abs), rel);
}

checkModule("src/eval/wim/manifest-runtime.js");

checkModule("src/eval/wim/dataset-builder.js");

// Unit tests for proposeGoldSet
const assert = require("assert");
const { proposeGoldSet } = require("../../../src/eval/wim/dataset-builder.js");

function makeItem(overrides) {
  return Object.assign({
    id: "2026-04-01:HEALTHCARE:0",
    date: "2026-04-01",
    topic: "HEALTHCARE",
    headline: "Test headline",
    baseScore: 6.0,
    strategic_value: 0.6,
    signal_shift: "something shifted",
    writeup_status: "model_pass",
    writeup_rejection_reasons: [],
    cross_source_count: 1,
    content_flags: [],
    storyline_hints: [],
  }, overrides);
}

// Build 30 items across 5 topics
const topics = ["HEALTHCARE", "TECHNOLOGY", "ENERGY", "FINANCIALS", "CONSUMER"];
const testItems = [];
for (const topic of topics) {
  for (let i = 0; i < 6; i++) {
    testItems.push(makeItem({
      id: `2026-04-01:${topic}:${i}`,
      topic,
      baseScore: 5 + i,
      strategic_value: 0.5 + i * 0.05,
      writeup_status: i === 3 ? "repair_pass" : "model_pass",
      writeup_rejection_reasons: i === 4 ? ["brief_generic"] : [],
      signal_shift: i === 5 ? null : "real signal",
    }));
  }
}

const goldSet = proposeGoldSet(testItems, 20);

// Every item in gold set must come from testItems
const validIds = new Set(testItems.map(i => i.id));
for (const g of goldSet) {
  assert.ok(validIds.has(g.id), `Gold set item ${g.id} not in testItems`);
}

// Must have at least one item per topic
for (const topic of topics) {
  const hasTopic = goldSet.some(g => g.topic === topic);
  assert.ok(hasTopic, `Gold set missing topic: ${topic}`);
}

// Must not exceed targetSize
assert.ok(goldSet.length <= 20, `Gold set length ${goldSet.length} exceeds target 20`);

// Every item must have required fields
for (const g of goldSet) {
  assert.ok(g.id, "Gold set item missing id");
  assert.ok(g.topic, "Gold set item missing topic");
  assert.ok(typeof g.selectionReason === "string", "Gold set item missing selectionReason");
  assert.ok(typeof g.notes === "string", "Gold set item missing notes field");
}

// No duplicate ids
const goldIds = goldSet.map(g => g.id);
const uniqueIds = new Set(goldIds);
assert.strictEqual(uniqueIds.size, goldIds.length, "Gold set has duplicate ids");

process.stdout.write("[wim-eval] proposeGoldSet unit tests: PASS\n");

checkModule("src/eval/wim/generator-runtime.js");

const { assemblePrompt, parseWimResponse } = require("../../../src/eval/wim/generator-runtime.js");

// assemblePrompt: minimal mode — no excerpt
const promptFile = { prompt: "INSTRUCTIONS\n\n" };
const item = { headline: "Big Deal Announced", summary: "Company A acquires Company B.", excerpt: "Long article text..." };
const minimalPrompt = assemblePrompt(promptFile, item, "minimal");
assert.ok(minimalPrompt.includes("Big Deal Announced"), "minimal prompt must include headline");
assert.ok(minimalPrompt.includes("Company A acquires Company B."), "minimal prompt must include summary");
assert.ok(!minimalPrompt.includes("Long article text"), "minimal prompt must NOT include excerpt");

// assemblePrompt: enhanced mode — excerpt included
const enhancedPrompt = assemblePrompt(promptFile, item, "enhanced");
assert.ok(enhancedPrompt.includes("Long article text"), "enhanced prompt must include excerpt");

// parseWimResponse: clean JSON
const cleanResponse = '{"wim_brief":"Short punchline.","wim":"This signals a shift."}';
const parsed = parseWimResponse(cleanResponse);
assert.strictEqual(parsed.wim, "This signals a shift.");
assert.strictEqual(parsed.wim_brief, "Short punchline.");

// parseWimResponse: JSON wrapped in markdown fences
const fencedResponse = '```json\n{"wim_brief":"Short.","wim":"Signals shift."}\n```';
const parsedFenced = parseWimResponse(fencedResponse);
assert.strictEqual(parsedFenced.wim, "Signals shift.");

// parseWimResponse: malformed returns nulls
const malformed = parseWimResponse("not json at all");
assert.strictEqual(malformed.wim, null);

process.stdout.write("[wim-eval] generator-runtime unit tests: PASS\n");
