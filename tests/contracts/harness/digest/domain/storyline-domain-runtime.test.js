"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/digest/domain/storyline-domain-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const {
  buildStorylineCandidates,
  applyStrategicQualityGate,
  classifySourceTier,
  detectLocalContentFlags,
} = runtime;

assert.strictEqual(typeof buildStorylineCandidates, "function");

const pfizerItems = [
  {
    tag: "PFIZER",
    headline: "Pfizer Fast-Tracks Obesity Programs in Race Against Patent Cliff",
    summary: "Pfizer accelerated a lead obesity asset into Phase III to offset looming patent cliff losses.",
    wim: "The move brings Pfizer's obesity pipeline forward and sharpens the post-Covid repositioning story.",
    source: "BioSpace",
    source_domain: "biospace.com",
    baseScore: 9.2,
    strategic_value: 0.88,
  },
  {
    tag: "PFIZER",
    headline: "J.P. Morgan 2026: Pfizer's Pivot from Covid to Pipeline Execution",
    summary: "Pfizer is shifting from Covid volatility toward pipeline execution and acquisitions.",
    wim: "Management is framing obesity and oncology as the path through the patent cliff.",
    source: "Pharm Exec",
    source_domain: "pharmexec.com",
    baseScore: 9.0,
    strategic_value: 0.85,
  },
  {
    tag: "PFIZER",
    headline: "Pfizer declares $0.43 quarterly dividend payable in March 2026",
    summary: "Pfizer announced its next quarterly dividend payable to shareholders of record.",
    wim: "This is a routine capital-return announcement with limited strategic value.",
    source: "Investing",
    source_domain: "ng.investing.com",
    baseScore: 4.2,
    strategic_value: 0.12,
  },
];

const storylineCandidates = buildStorylineCandidates(pfizerItems);
assert.strictEqual(storylineCandidates.length, 2, "pipeline/patent-cliff coverage should cluster into one storyline");

const retained = applyStrategicQualityGate(storylineCandidates, {
  minStrategicValue: 0.34,
  maxRoutineScore: 0.74,
  minKeep: 1,
});
assert.strictEqual(retained.length, 1, "routine dividend coverage should be filtered by the strategic gate");
assert.ok(String(retained[0].headline || "").toLowerCase().includes("pfizer"));
assert.ok((retained[0].cross_source_count || 0) >= 2, "clustered storyline should retain cross-source evidence");

const flags = detectLocalContentFlags(pfizerItems[2]);
assert.ok(flags.includes("routine_dividend"));

const corporateTier = classifySourceTier("pfizer.com");
assert.strictEqual(corporateTier.source_tier, "corporate");
assert.ok(corporateTier.source_authority < 0.5);
