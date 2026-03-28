"use strict";

const assert = require("assert");
const { createDigestOrchestratorDeliveryRankingRuntime } = require("./digest-orchestrator-delivery-ranking-runtime");

const nowIso = "2026-03-25T12:00:00.000Z";
let capturedWeights = null;
let capturedOptions = null;

const rankingRuntime = createDigestOrchestratorDeliveryRankingRuntime({
  CONFIG: {
    digest: {
      maxSignalsPerEntity: 1,
      minTopFitItems: 3,
      minStrategicValue: 0.34,
      maxRoutineScore: 0.65,
      minSignalScoreForFinal: 5,
      scheduledFreshnessWindowDays: 5,
      perUserFreshnessDigests: 3,
      perUserFreshnessMinItems: 3,
    },
  },
  log() {},
  filterItemsByTopics(items) {
    return {
      items,
      wasFiltered: true,
      customKeywords: [],
      specialistMode: false,
      standardTopicsLower: ["technology"],
    };
  },
  applyTopicRelevanceScores(items, _topics, weights, opts) {
    capturedWeights = weights;
    capturedOptions = opts;
    return items.map((item) => ({
      ...item,
      relevanceScore: Number(item.baseScore || 0) + 1,
      topicMatch: 10,
      strategic_value: 0.95,
      routine_item_score: 0.05,
      source_policy: "preferred",
      source_authority: 0.9,
    }));
  },
  buildRecentEntityHistory() {
    return { entityCounts: {}, storylineKeys: new Set() };
  },
  suppressRecentlySentForUser(items) {
    return {
      items,
      removed: 0,
      storyline_suppressed: 0,
      freshness_suppressed: 0,
      semantic_suppressed: 0,
    };
  },
  isRecentRepeatItem() {
    return false;
  },
  parseSourceDomain(item) {
    return item.source_domain || "example.com";
  },
  applyEntityCoverageCap(items) {
    return items;
  },
  reserveCustomKeywordSlot(items) {
    return items;
  },
});

const enriched = Array.from({ length: 5 }, (_, index) => ({
  tag: "TECHNOLOGY",
  headline: `Headline ${index + 1}`,
  summary: `Summary ${index + 1}`,
  url: `https://example.com/${index + 1}`,
  source: "Example",
  source_domain: "example.com",
  baseScore: 8 - (index * 0.1),
  published_date: "2026-03-25T10:00:00.000Z",
}));

const result = rankingRuntime.rankAndSuppressUserItems({
  user: {
    chatId: "user-1",
    email: "user@example.com",
    topics: ["TECHNOLOGY"],
    topic_weights: { TECHNOLOGY: 5 },
    preferences: {
      items_per_digest: 12,
    },
    source_preferences: {
      blocked_sources: ["example.com"],
      trusted_sources: ["example.com"],
    },
  },
  enriched,
  repeatIndex: null,
  repeatPenalty: 0,
  depthPolicy: {
    minFilteredItems: 1,
    defaultItemCount: 9,
  },
  rankingPolicy: {},
  recentDigestRecords: [],
  nowIso,
  deliveryMode: "scheduled",
  runDiagnostics: {},
});

assert.ok(capturedWeights && Object.keys(capturedWeights).length === 0, "delivery ranking must ignore deprecated topic weights");
assert.strictEqual(capturedOptions?.blockedSources, undefined, "delivery ranking must ignore deprecated source preference blocks");
assert.strictEqual(capturedOptions?.trustedSources, undefined, "delivery ranking must ignore deprecated source preference trusts");
assert.strictEqual(result.diagnostics.requested_count, 5, "delivery ranking must use the MVP fixed 5-item target");
assert.strictEqual(result.diagnostics.candidate_pool_target_count, 7, "delivery ranking must keep the fixed candidate pool target");

console.log("delivery ranking ignores deprecated weights and fixed item-count overrides ✓");
