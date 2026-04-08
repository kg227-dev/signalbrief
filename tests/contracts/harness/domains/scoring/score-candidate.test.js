"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/domains/scoring/score-candidate.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
const { scoreCandidate } = runtime;
assertModuleExports(() => runtime, TARGET_REL);

const nowMs = Date.parse("2026-04-03T12:00:00.000Z");

const tradeItem = scoreCandidate({
  headline: "FiercePharma reports new oncology launch shifts commercial assumptions",
  summary: "FiercePharma says a launch update is shifting near-term commercial expectations.",
  tag: "LIFE SCIENCES",
  published_date: "2026-04-03T09:00:00.000Z",
  source_tier: 1,
  retrieval_origin: "broker_publisher_feed",
  source_type: "trade_specialist",
  topic_fit: 0.92,
}, { nowMs });

const officialFillerItem = scoreCandidate({
  headline: "Frequently requested or proactively posted drug-specific and other records",
  summary: "Frequently requested or proactively posted drug-specific and other records",
  tag: "LIFE SCIENCES",
  published_date: "2026-04-03T10:00:00.000Z",
  source_tier: 3,
  retrieval_origin: "broker_official",
  source_type: "primary_official",
  content_kind: "official_document",
  topic_fit: 0.54,
}, { nowMs });

assert.ok(
  tradeItem._score > officialFillerItem._score,
  "trade-specialist items with high topic fit should outrank official filler pages"
);
assert.ok(
  officialFillerItem._score_components.quality_adjustment < 0,
  "official filler should receive a negative quality adjustment"
);

const offTopicTechnologyItem = scoreCandidate({
  headline: "Best noise-canceling earbuds for spring travel",
  summary: "A roundup of shopping picks for readers looking for ANC earbuds.",
  tag: "TECHNOLOGY",
  published_date: "2026-04-03T10:00:00.000Z",
  source_tier: 2,
  retrieval_origin: "broker_publisher_feed",
  source_type: "reported_media",
  topic_fit: 0.22,
}, { nowMs });

assert.ok(
  offTopicTechnologyItem._score_components.quality_adjustment <= -0.2,
  "off-topic consumer-tech listicles should be penalized in Technology"
);

const consumerTechnologyItem = scoreCandidate({
  headline: "Users are mastering a Vision Pro Steam Link setup for travel",
  summary: "A consumer device culture story follows how people use the headset with a gaming app.",
  tag: "TECHNOLOGY",
  published_date: "2026-04-03T10:00:00.000Z",
  source_tier: 2,
  retrieval_origin: "broker_publisher_feed",
  source_type: "reported_media",
  topic_fit: 0.72,
}, { nowMs });

const strategicTechnologyItem = scoreCandidate({
  headline: "Anthropic details AI security controls as enterprise model risk rises",
  summary: "The frontier model provider outlined model safety and cybersecurity controls for enterprise buyers.",
  tag: "TECHNOLOGY",
  published_date: "2026-04-03T10:00:00.000Z",
  source_tier: 2,
  retrieval_origin: "broker_publisher_feed",
  source_type: "reported_media",
  topic_fit: 0.72,
}, { nowMs });

assert.ok(
  consumerTechnologyItem._score_components.quality_adjustment < 0,
  "consumer device/culture Technology stories should receive a negative adjustment"
);
assert.ok(
  strategicTechnologyItem._score > consumerTechnologyItem._score,
  "strategic AI security/platform stories should outrank consumer device/culture stories with otherwise similar inputs"
);

console.log("score candidate quality adjustments ✓");

// --- Change A: official lane bonus cap for primary_official ---

const nowFin = Date.parse("2026-04-06T12:00:00.000Z");

const tier2ReportedFin = scoreCandidate({
  headline: "Bloomberg: Fed signals pause in rate cycle",
  tag: "FINANCIAL SERVICES",
  published_date: "2026-04-06T08:00:00.000Z",
  source_tier: "strong",
  source_authority: 0.8,
  retrieval_origin: "broker_publisher_feed",
  source_type: "reported_media",
  topic_fit: 0.88,
}, { nowMs: nowFin, scoringConfig: { officialLaneBonusCap: true } });

const tier1OfficialFin = scoreCandidate({
  headline: "Federal Reserve issues statement on monetary policy",
  tag: "FINANCIAL SERVICES",
  published_date: "2026-04-06T08:00:00.000Z",
  source_tier: "premium",
  source_authority: 1.0,
  retrieval_origin: "broker_official",
  source_type: "primary_official",
  content_kind: "official_document",
  topic_fit: 0.85,
}, { nowMs: nowFin, scoringConfig: { officialLaneBonusCap: true } });

assert.ok(
  tier2ReportedFin._score > tier1OfficialFin._score,
  `tier-2 reported (${tier2ReportedFin._score}) should outscore tier-1 primary_official (${tier1OfficialFin._score}) with officialLaneBonusCap enabled`
);
assert.ok(
  tier1OfficialFin._score_components.lane_bonus <= 0.65,
  `primary_official broker_official lane bonus should be ≤0.65, got ${tier1OfficialFin._score_components.lane_bonus}`
);

// Without flag, official still wins (baseline preserved)
const tier1OfficialBaseline = scoreCandidate({
  headline: "Federal Reserve issues statement on monetary policy",
  tag: "FINANCIAL SERVICES",
  published_date: "2026-04-06T08:00:00.000Z",
  source_tier: "premium", source_authority: 1.0,
  retrieval_origin: "broker_official", source_type: "primary_official",
  topic_fit: 0.85,
}, { nowMs: nowFin });
assert.ok(
  tier1OfficialBaseline._score_components.lane_bonus > 0.9,
  `without flag, official lane bonus should remain high, got ${tier1OfficialBaseline._score_components.lane_bonus}`
);

// --- Change B: corporate_pr base penalty ---

const corporatePrFin = scoreCandidate({
  headline: "Acme Corp Announces Record Q1 Revenue",
  tag: "FINANCIAL SERVICES",
  published_date: "2026-04-06T08:00:00.000Z",
  source_tier: "standard", source_authority: 0.6,
  retrieval_origin: "broker_publisher_feed",
  source_type: "corporate_pr",
  topic_fit: 0.72,
}, { nowMs: nowFin, scoringConfig: { corporatePrPenalty: true } });

assert.ok(
  corporatePrFin._score_components.quality_adjustment <= -0.10,
  `corporate_pr with corporatePrPenalty flag should get ≤−0.10 quality adjustment, got ${corporatePrFin._score_components.quality_adjustment}`
);

// Without flag, no extra penalty
const corporatePrBaseline = scoreCandidate({
  headline: "Acme Corp Announces Record Q1 Revenue",
  tag: "FINANCIAL SERVICES",
  published_date: "2026-04-06T08:00:00.000Z",
  source_tier: "standard", source_authority: 0.6,
  retrieval_origin: "broker_publisher_feed", source_type: "corporate_pr",
  topic_fit: 0.72,
}, { nowMs: nowFin });

assert.ok(
  corporatePrBaseline._score_components.quality_adjustment > -0.10,
  `without flag, corporate_pr quality adjustment should not include extra penalty, got ${corporatePrBaseline._score_components.quality_adjustment}`
);

console.log("official lane bonus cap and corporate_pr penalty ✓");
