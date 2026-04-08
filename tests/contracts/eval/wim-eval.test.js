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
const cleanResponse = '{"finalWimBrief":"Short punchline.","finalWim":"This signals a shift."}';
const parsed = parseWimResponse(cleanResponse);
assert.strictEqual(parsed.wim, "This signals a shift.");
assert.strictEqual(parsed.wim_brief, "Short punchline.");
assert.strictEqual(parsed.finalWim, "This signals a shift.");
assert.strictEqual(parsed.finalWimBrief, "Short punchline.");

// parseWimResponse: JSON wrapped in markdown fences
const fencedResponse = '```json\n{"wim_brief":"Short.","wim":"Signals shift."}\n```';
const parsedFenced = parseWimResponse(fencedResponse);
assert.strictEqual(parsedFenced.wim, "Signals shift.");
assert.strictEqual(parsedFenced.finalWim, "Signals shift.");

// parseWimResponse: malformed returns nulls
const malformed = parseWimResponse("not json at all");
assert.strictEqual(malformed.wim, null);

process.stdout.write("[wim-eval] generator-runtime unit tests: PASS\n");

checkModule("src/eval/wim/judge-runtime.js");

const { computeOverallScore, parseJudgeResponse, buildJudgePrompt } = require("../../../src/eval/wim/judge-runtime.js");

// computeOverallScore: mean of 5 dimensions, 1 decimal
const scores = { specificity: 4, insightDepth: 3, strategicRelevance: 5, nonRedundancy: 4, clarityTightness: 3 };
assert.strictEqual(computeOverallScore(scores), 3.8);

const perfectScores = { specificity: 5, insightDepth: 5, strategicRelevance: 5, nonRedundancy: 5, clarityTightness: 5 };
assert.strictEqual(computeOverallScore(perfectScores), 5.0);

// parseJudgeResponse: valid JSON
const validJudge = JSON.stringify({
  passFail: "fail",
  scores: { specificity: 2, insightDepth: 2, strategicRelevance: 2, nonRedundancy: 3, clarityTightness: 2 },
  failureTags: ["GENERIC", "RESTATES_HEADLINE"],
  isCatastrophicFailure: false,
  primaryFailureReason: "Restates headline with no added insight.",
  judgeRationale: "WIM does not go beyond the headline.",
});
const judgeResult = parseJudgeResponse(validJudge);
assert.strictEqual(judgeResult.passFail, "fail");
assert.deepStrictEqual(judgeResult.failureTags, ["GENERIC", "RESTATES_HEADLINE"]);
assert.strictEqual(judgeResult.isCatastrophicFailure, false);
assert.strictEqual(judgeResult.primaryFailureReason, "Restates headline with no added insight.");

// parseJudgeResponse: catastrophic tag must override isCatastrophicFailure=false
const catastrophicJudge = JSON.stringify({
  passFail: "fail",
  scores: { specificity: 1, insightDepth: 1, strategicRelevance: 1, nonRedundancy: 1, clarityTightness: 1 },
  failureTags: ["WRONG_IMPLICATION"],
  isCatastrophicFailure: false,
  primaryFailureReason: "Wrong implication stated.",
  judgeRationale: "Factually incorrect.",
});
const catastrophicResult = parseJudgeResponse(catastrophicJudge);
assert.strictEqual(catastrophicResult.isCatastrophicFailure, true, "WRONG_IMPLICATION must set isCatastrophicFailure=true");

// buildJudgePrompt: contains headline and wim, not excerpt in minimal mode
const rubric = {
  passFail: { criteria: ["States implication", "Is specific", "Adds info", "Grounded", "Concise"] },
  scoreDimensions: [
    { key: "specificity", label: "Specificity" },
    { key: "insightDepth", label: "Insight Depth" },
    { key: "strategicRelevance", label: "Strategic Relevance" },
    { key: "nonRedundancy", label: "Non-Redundancy" },
    { key: "clarityTightness", label: "Clarity / Tightness" },
  ],
  failureTags: ["GENERIC", "RESTATES_HEADLINE"],
  catastrophicCriteria: { tags: ["WRONG_IMPLICATION", "OVERCONFIDENT", "NOT_GROUNDED_IN_ARTICLE"] },
};
const judgePrompt = buildJudgePrompt(rubric, { headline: "Big Deal", summary: "Co A buys Co B.", excerpt: "Full text." }, "This signals margin pressure.", "minimal");
assert.ok(judgePrompt.includes("Big Deal"), "judge prompt must include headline");
assert.ok(judgePrompt.includes("This signals margin pressure."), "judge prompt must include WIM");
assert.ok(!judgePrompt.includes("Full text."), "minimal mode judge prompt must not include excerpt");

process.stdout.write("[wim-eval] judge-runtime unit tests: PASS\n");

checkModule("src/eval/wim/report-runtime.js");

const { buildReportCsv, buildSummaryMd, computeAggregates, formatPct } = require("../../../src/eval/wim/report-runtime.js");

function makeRow(overrides) {
  return Object.assign({
    id: "2026-04-01:HEALTHCARE:0",
    topic: "HEALTHCARE",
    variant: "variant-a",
    inputMode: "minimal",
    passFail: "pass",
    overallScore: 4.0,
    failureTags: [],
    isCatastrophicFailure: false,
    inGoldSet: false,
  }, overrides);
}

const rows = [
  makeRow({
    id: "a:T1:0",
    topic: "T1",
    variant: "baseline",
    passFail: "pass",
    overallScore: 3.5,
    failureTags: [],
    candidateTier: "strong",
    finalStatus: "model_pass",
    parseFailureType: null,
    repairType: null,
    firstPassSucceeded: true,
    finalWim: "Strong WIM one.",
    finalWimBrief: "Strong WIM one.",
    stages: {
      extraction: { status: "model_pass" },
      generation: { status: "model_pass" },
      repair: { status: "not_started" },
    },
  }),
  makeRow({
    id: "a:T1:0",
    topic: "T1",
    variant: "variant-a",
    passFail: "pass",
    overallScore: 4.5,
    failureTags: [],
    candidateTier: "strong",
    finalStatus: "repair_pass",
    parseFailureType: "validator_mismatch",
    repairType: "simplify_preserve_mechanism",
    firstPassSucceeded: false,
    finalWim: "Strong WIM one, repaired.",
    finalWimBrief: "Strong WIM one, repaired.",
    stages: {
      extraction: { status: "retry_pass" },
      generation: { status: "retry_pass" },
      repair: { status: "model_pass" },
    },
  }),
  makeRow({ id: "a:T2:0", topic: "T2", variant: "baseline", passFail: "fail", overallScore: 2.0, failureTags: ["GENERIC"], candidateTier: "standard", finalStatus: "failed_dropped", parseFailureType: "malformed_json", stages: { extraction: { status: "failed" }, generation: { status: "failed" }, repair: { status: "not_started" } } }),
  makeRow({ id: "a:T2:0", topic: "T2", variant: "variant-a", passFail: "pass", overallScore: 3.8, failureTags: [], candidateTier: "standard", finalStatus: "model_pass", parseFailureType: null, stages: { extraction: { status: "model_pass" }, generation: { status: "model_pass" }, repair: { status: "not_started" } } }),
  makeRow({ id: "a:T1:1", topic: "T1", variant: "baseline", passFail: "fail", overallScore: 1.5, failureTags: ["CATEGORY_CLICHE"], isCatastrophicFailure: false, candidateTier: "strong", finalStatus: "failed_dropped", parseFailureType: "empty_response", stages: { extraction: { status: "failed" }, generation: { status: "failed" }, repair: { status: "not_started" } } }),
  makeRow({ id: "a:T1:1", topic: "T1", variant: "variant-a", passFail: "fail", overallScore: 2.0, failureTags: ["VAGUE_IMPLICATION"], isCatastrophicFailure: false, candidateTier: "strong", finalStatus: "failed_dropped", parseFailureType: "truncation", stages: { extraction: { status: "model_pass" }, generation: { status: "failed" }, repair: { status: "not_started" } } }),
];

const agg = computeAggregates(rows, "baseline", "variant-a");

assert.strictEqual(agg.byVariant["baseline"].passCount, 1);
assert.strictEqual(agg.byVariant["baseline"].total, 3);
assert.strictEqual(agg.byVariant["variant-a"].passCount, 2);
assert.ok(agg.byVariant["baseline"].genericClicheRate > 0.6, "baseline generic/cliche rate should be > 0.6");
assert.ok(agg.byTopic["T1"], "T1 topic missing from breakdown");
assert.ok(agg.byTopic["T2"], "T2 topic missing from breakdown");

assert.strictEqual(formatPct(0.75, 12, 16), "75% (12/16)");
assert.strictEqual(formatPct(1, 3, 3), "100% (3/3)");
assert.strictEqual(agg.stageStats.extraction.success_count, 4);
assert.strictEqual(agg.stageStats.repair.success_count, 1);
assert.strictEqual(agg.stageStats.strong_tier.attempted_count, 4);
assert.ok(agg.stageStats.parse_failure_counts.validator_mismatch > 0);

const csv = buildReportCsv(rows, [{ id: "a:T1:0", date: "2026-04-01", topic: "T1", source_domain: "example.com", url: "https://example.com" }], "baseline");
assert.ok(csv.includes("finalWim"));
assert.ok(csv.includes("finalWimBrief"));
assert.ok(csv.includes("generationStatus"));

const summary = buildSummaryMd(agg, { runId: "run-1", judgeModel: "judge", generationModel: "gen", rubricVersion: "v1", compareAgainst: "baseline" }, rows, [], { shipGate: { minPassRate: 0.75, genericClicheMaxRate: 0.1 } });
assert.ok(summary.includes("Stage Metrics"), "summary should include staged WIM metrics when present");
assert.ok(summary.includes("Strong-tier attempted"));

process.stdout.write("[wim-eval] report-runtime unit tests: PASS\n");

checkModule("src/entrypoints/wim-eval.js");
