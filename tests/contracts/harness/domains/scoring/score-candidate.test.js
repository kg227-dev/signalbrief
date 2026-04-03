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

console.log("score candidate quality adjustments ✓");
