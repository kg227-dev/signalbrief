"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/domains/scoring/score-candidate.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
const {
  classifyProceduralNotice,
  scoreCandidate,
} = runtime;
assertModuleExports(() => runtime, TARGET_REL);

const nowMs = Date.parse("2026-04-11T12:00:00.000Z");

const procedural = {
  headline: "Combined Notice of Filings #1",
  summary: "Federal Register notice of conference and procedural filings update.",
  source_domain: "federalregister.gov",
  source_type: "primary_official",
  source_tier: 2,
  retrieval_origin: "official",
  published_date: "2026-04-11T10:00:00.000Z",
  tag: "FINANCIAL SERVICES",
  novelty_score: 0.8,
  topic_fit: 0.9,
};

const strategicNotice = {
  ...procedural,
  headline: "Notice of enforcement deadline raises compliance costs for regional lenders",
  summary: "The agency moved the effective date within 90 days, increasing compliance costs and creating timeline pressure for lenders.",
};

const strongSignal = {
  headline: "Regional lenders reprice warehouse lines after new funding shock",
  summary: "Banks raised warehouse pricing after funding costs jumped, forcing fintech partners to renegotiate unit economics.",
  source_domain: "reuters.com",
  source_type: "reported_media",
  source_tier: 2,
  retrieval_origin: "broker_publisher_feed",
  published_date: "2026-04-11T10:00:00.000Z",
  tag: "FINANCIAL SERVICES",
  novelty_score: 0.8,
  topic_fit: 0.9,
};

const proceduralAssessment = classifyProceduralNotice(procedural);
assert.strictEqual(proceduralAssessment.proceduralNotice, true);
assert.strictEqual(proceduralAssessment.hasStrategicShift, false);

const strategicAssessment = classifyProceduralNotice(strategicNotice);
assert.strictEqual(strategicAssessment.proceduralNotice, true);
assert.strictEqual(strategicAssessment.hasStrategicShift, true);

const weakScore = scoreCandidate(procedural, { nowMs });
const strategicNoticeScore = scoreCandidate(strategicNotice, { nowMs });
const strongScore = scoreCandidate(strongSignal, { nowMs });

assert.strictEqual(weakScore.procedural_notice, true);
assert.ok(weakScore._score < strategicNoticeScore._score, "procedural notice with strategic shift should outrank a generic notice");
assert.ok(weakScore._score < strongScore._score, "generic notice should rank below a stronger strategic candidate");
assert.ok(
  Math.abs(Number(weakScore._score_components.story_shape_penalty || 0)) > Math.abs(Number(weakScore._score_components.domain_penalty || 0)),
  "story-shape penalties should dominate domain penalties for procedural notices"
);

const industrialWeakDomain = scoreCandidate({
  headline: "Freight market update shifts shipper contract expectations",
  summary: "FreightWaves reports contract pressure as carriers reset industrial logistics pricing.",
  source_domain: "freightwaves.com",
  source_type: "trade_specialist",
  source_tier: "standard",
  retrieval_origin: "broker_publisher_feed",
  published_date: "2026-04-11T10:00:00.000Z",
  tag: "INDUSTRIALS",
  novelty_score: 0.8,
  topic_fit: 0.9,
}, { nowMs });
assert.ok(
  Number(industrialWeakDomain._score_components.domain_penalty || 0) < 0,
  "topic-aware weak domains should receive a negative domain penalty"
);

process.stdout.write("[score-candidate] all assertions passed\n");
