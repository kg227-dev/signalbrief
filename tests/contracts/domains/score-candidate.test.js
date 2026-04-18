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
  computeFinalRankScore,
  computeStoryQualityScore,
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

const technologyFalsePositive = scoreCandidate({
  headline: "Florida surgeon charged with killing man after removing liver instead of spleen",
  summary: "A criminal case against a surgeon triggered a hospital review after the wrong organ was removed.",
  source_domain: "arstechnica.com",
  source_type: "reported_media",
  source_tier: "strong",
  retrieval_origin: "broker_publisher_feed",
  published_date: "2026-04-11T10:00:00.000Z",
  tag: "TECHNOLOGY",
  novelty_score: 0.8,
  topic_fit: 0.9,
}, { nowMs });
assert.ok(
  Number(technologyFalsePositive._score_components.story_shape_penalty || 0) <= -0.3,
  "obvious medical-crime false positives should be heavily penalized in technology"
);

const energyFalsePositive = scoreCandidate({
  headline: "New 3D map of Universe could solve dark energy mystery",
  summary: "Cosmologists said a new map of the universe may reshape theory on dark energy over time.",
  source_domain: "arstechnica.com",
  source_type: "reported_media",
  source_tier: "strong",
  retrieval_origin: "broker_publisher_feed",
  published_date: "2026-04-11T10:00:00.000Z",
  tag: "ENERGY",
  novelty_score: 0.8,
  topic_fit: 0.9,
}, { nowMs });
assert.ok(
  Number(energyFalsePositive._score_components.story_shape_penalty || 0) <= -0.4,
  "astronomy stories should be heavily penalized when tagged as energy"
);

const industrialOfficialFalsePositive = scoreCandidate({
  headline: "Drug Supply Chain Security Act Law and Policies",
  summary: "FDA guidance on the Drug Supply Chain Security Act requires pharmaceutical manufacturers and distributors to implement serialization.",
  source_domain: "fda.gov",
  source_type: "primary_official",
  source_tier: "premium",
  retrieval_origin: "broker_official",
  published_date: "2026-04-11T10:00:00.000Z",
  tag: "INDUSTRIALS",
  novelty_score: 0.8,
  topic_fit: 0.9,
}, { nowMs });
assert.ok(
  Number(industrialOfficialFalsePositive._score_components.story_shape_penalty || 0) <= -0.3,
  "pharma official guidance should be heavily penalized when tagged as industrials"
);

const v2Candidate = {
  headline: "Bank reprices warehouse lines after funding costs jump",
  summary: "Lenders raised pricing and tightened terms, forcing fintech partners to reset unit economics.",
  source_domain: "reuters.com",
  source_type: "reported_media",
  source_tier: 2,
  retrieval_origin: "broker_publisher_feed",
  strategic_value: 0.9,
  originality_signal: 0.9,
  cross_source_count: 2,
  topic_fit: 0.9,
  published_date: "2026-04-11T10:00:00.000Z",
  novelty_score: 0.8,
  content_flags: ["regulatory"],
  entity_keys: ["bank"],
};
const storyQuality = computeStoryQualityScore(v2Candidate);
const finalRank = computeFinalRankScore(v2Candidate, { nowMs });
assert.ok(storyQuality.total > 0.7, `story quality should be explicit and strong, got ${storyQuality.total}`);
assert.strictEqual(finalRank.components.strategic_value, 0.9);
assert.strictEqual(finalRank.components.story_quality_score, storyQuality.total);
assert.ok(finalRank.total <= 1 && finalRank.total >= 0, "final rank should clamp to [0,1]");

process.stdout.write("[score-candidate] all assertions passed\n");
