"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../test-support/module-contract-helper.js");
const {
  buildSemanticRepeatIndex,
} = require(path.join(process.cwd(), "src/digest/runtime/repeat-freshness-runtime.js"));

const TARGET_REL = "src/entrypoints/digest-orchestrator-delivery-ranking-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
const { createDigestOrchestratorDeliveryRankingRuntime } = runtime;
assertModuleExports(() => runtime, TARGET_REL);

(async () => {
  const logs = [];
  let scoreCallCount = 0;
  const rankingRuntime = createDigestOrchestratorDeliveryRankingRuntime({
    CONFIG: {
      digest: {
        perUserFreshnessMinItems: 3,
        perUserFreshnessDigests: 3,
        perUserEntityHistoryDigests: 3,
        maxSignalsPerEntity: 1,
      },
    },
    log: (line) => logs.push(String(line || "")),
    filterItemsByTopics: () => ({
      items: [
        { tag: "AI×TECH", baseScore: 9.2, strategic_value: 0.86, routine_item_score: 0.1, entity_keys: ["nvidia"] },
        { tag: "STRATEGY", baseScore: 5.5, strategic_value: 0.18, routine_item_score: 0.88, why_shown: ["custom_keyword"], entity_keys: ["pfizer"] },
        { tag: "HEALTHCARE", baseScore: 8.4, strategic_value: 0.79, routine_item_score: 0.12, entity_keys: ["nvidia"] },
      ],
      standardTopicsLower: ["ai tech"],
      customKeywords: [],
      specialistMode: false,
      wasFiltered: true,
    }),
    applyTopicRelevanceScores: (items) => {
      scoreCallCount += 1;
      return items.map((item, idx) => ({ ...item, relevanceScore: 10 - idx }));
    },
    buildRecentEntityHistory: () => ({ entityCounts: {}, storylineKeys: new Set() }),
    suppressRecentlySentForUser: (items) => ({
      items,
      removed: 0,
      backfilled: 0,
    }),
    isRecentRepeatItem: () => false,
    parseSourceDomain: () => "example.com",
    applyEntityCoverageCap: (items, limit) => {
      const seen = new Set();
      return items.filter((item) => {
        const key = (item.entity_keys || [])[0] || item.tag;
        if (seen.has(key) && limit === 1) return false;
        seen.add(key);
        return true;
      });
    },
    reserveCustomKeywordSlot: (items, count) => items.slice(0, count),
  });

  const ranked = rankingRuntime.rankAndSuppressUserItems({
    user: {
      email: "ranked@example.com",
      topics: ["AI×TECH"],
      preferences: { items_per_digest: 5 },
      topic_weights: { ai: 1 },
    },
    enriched: [],
    repeatIndex: { days: 3, urlKeys: new Set(), headlineKeys: new Set() },
    repeatPenalty: 0.5,
    depthPolicy: { minFilteredItems: 3, defaultItemCount: 5 },
    rankingPolicy: { minSignalScoreForFinal: 6.2 },
    recentDigestRecords: [],
    nowIso: "2026-03-13T11:00:00.000Z",
  });

  assert.strictEqual(scoreCallCount, 1);
  assert.strictEqual(ranked.wasFiltered, true);
  assert.strictEqual(ranked.userItems.length, 1);
  assert.strictEqual(ranked.userItems[0].tag, "AI×TECH");
  assert.strictEqual(ranked.diagnostics.requested_count, 5);
  let emergencyScoreCalls = 0;
  const emergencyRuntime = createDigestOrchestratorDeliveryRankingRuntime({
    CONFIG: {
      digest: {
        perUserFreshnessMinItems: 3,
        perUserFreshnessDigests: 3,
        perUserEntityHistoryDigests: 3,
        maxSignalsPerEntity: 1,
      },
    },
    log: () => {},
    filterItemsByTopics: () => ({
      items: [],
      customKeywords: [],
      specialistMode: false,
      wasFiltered: false,
    }),
    applyTopicRelevanceScores: () => {
      emergencyScoreCalls += 1;
      if (emergencyScoreCalls === 1) return [];
      return [{ tag: "AI×TECH", baseScore: 7, relevanceScore: 8, strategic_value: 0.7, routine_item_score: 0.2, entity_keys: ["nvidia"] }];
    },
    buildRecentEntityHistory: () => ({ entityCounts: {}, storylineKeys: new Set() }),
    suppressRecentlySentForUser: (items) => ({ items, removed: 0, backfilled: 0 }),
    isRecentRepeatItem: () => false,
    parseSourceDomain: () => "example.com",
    applyEntityCoverageCap: (items) => items,
    reserveCustomKeywordSlot: (items) => items,
  });

  const emergencyOut = emergencyRuntime.rankAndSuppressUserItems({
    user: {
      chatId: "chat-1",
      topics: ["AI×TECH"],
      preferences: { items_per_digest: 5 },
      topic_weights: {},
    },
    enriched: [{ tag: "AI×TECH", baseScore: 7 }],
    repeatIndex: { days: 3, urlKeys: new Set(), headlineKeys: new Set() },
    repeatPenalty: 0.5,
    depthPolicy: { minFilteredItems: 3, defaultItemCount: 5 },
    rankingPolicy: { minSignalScoreForFinal: 6.2 },
    recentDigestRecords: [],
    nowIso: "2026-03-13T11:00:00.000Z",
  });

  assert.strictEqual(emergencyScoreCalls, 2);
  assert.strictEqual(emergencyOut.wasFiltered, false);
  assert.strictEqual(emergencyOut.userItems.length, 1);
  assert.strictEqual(emergencyOut.diagnostics.fallback_reason, "emergency_fallback");

  const customPrecisionRuntime = createDigestOrchestratorDeliveryRankingRuntime({
    CONFIG: {
      digest: {
        perUserFreshnessMinItems: 2,
        perUserFreshnessDigests: 3,
        perUserEntityHistoryDigests: 3,
        maxSignalsPerEntity: 3,
      },
    },
    log: () => {},
    filterItemsByTopics: () => ({
      items: [
        { tag: "STRATEGY", headline: "General strategy item", strategic_value: 0.8, routine_item_score: 0.1, url: "https://example.com/strategy" },
        { tag: "NVIDIA", headline: "Nvidia launches Blackwell service", strategic_value: 0.9, routine_item_score: 0.1, url: "https://example.com/nvidia" },
      ],
      standardTopicsLower: ["strategy"],
      customKeywords: ["nvidia"],
      specialistMode: true,
      wasFiltered: true,
    }),
    applyTopicRelevanceScores: (items) => items.map((item) => ({
      ...item,
      relevanceScore: item.tag === "NVIDIA" ? 9.5 : 8.8,
      why_shown: item.tag === "NVIDIA" ? ["custom_keyword"] : ["topic_match"],
    })),
    buildRecentEntityHistory: () => ({ entityCounts: {}, storylineKeys: new Set() }),
    suppressRecentlySentForUser: (items) => ({ items, removed: 0, backfilled: 0 }),
    isRecentRepeatItem: () => false,
    parseSourceDomain: () => "example.com",
    applyEntityCoverageCap: (items) => items,
    reserveCustomKeywordSlot: (items) => items,
  });

  const customPrecisionOut = customPrecisionRuntime.rankAndSuppressUserItems({
    user: {
      chatId: "custom-precision",
      topics: ["STRATEGY", "custom_nvidia"],
      preferences: { items_per_digest: 3 },
      topic_weights: {},
    },
    enriched: [
      { tag: "STRATEGY", headline: "Broad filler", relevanceScore: 7.2, strategic_value: 0.7, routine_item_score: 0.1, url: "https://example.com/filler" },
    ],
    repeatIndex: { days: 3, urlKeys: new Set(), headlineKeys: new Set() },
    repeatPenalty: 0.2,
    depthPolicy: { minFilteredItems: 2, defaultItemCount: 3 },
    rankingPolicy: { minSignalScoreForFinal: 0 },
    recentDigestRecords: [],
    nowIso: "2026-03-13T11:00:00.000Z",
    deliveryMode: "scheduled",
  });

  assert.strictEqual(customPrecisionOut.userItems.length, 2);
  assert.strictEqual(customPrecisionOut.userItems[0].tag, "NVIDIA");
  assert.strictEqual(customPrecisionOut.userItems[1].tag, "STRATEGY");
  assert.strictEqual(customPrecisionOut.diagnostics.custom_precision_mode, false);
  assert.strictEqual(customPrecisionOut.diagnostics.custom_precision_applied, false);
  assert.strictEqual(customPrecisionOut.diagnostics.short_digest_accepted, true);

  const strictCustomRuntime = createDigestOrchestratorDeliveryRankingRuntime({
    CONFIG: {
      digest: {
        perUserFreshnessMinItems: 2,
        perUserFreshnessDigests: 3,
        perUserEntityHistoryDigests: 3,
        maxSignalsPerEntity: 3,
      },
    },
    log: () => {},
    filterItemsByTopics: () => ({
      items: [
        { tag: "AI×TECH", headline: "Anchor-topic AI item", strategic_value: 0.8, routine_item_score: 0.1, url: "https://example.com/ai" },
      ],
      standardTopicsLower: ["ai tech"],
      customKeywords: ["doge"],
      specialistMode: true,
      wasFiltered: true,
    }),
    applyTopicRelevanceScores: (items) => items.map((item) => ({
      ...item,
      relevanceScore: 8.6,
      why_shown: ["topic_match"],
    })),
    buildRecentEntityHistory: () => ({ entityCounts: {}, storylineKeys: new Set() }),
    suppressRecentlySentForUser: (items) => ({ items, removed: 0, backfilled: 0 }),
    isRecentRepeatItem: () => false,
    parseSourceDomain: () => "example.com",
    applyEntityCoverageCap: (items) => items,
    reserveCustomKeywordSlot: (items) => items,
  });

  const strictCustomOut = strictCustomRuntime.rankAndSuppressUserItems({
    user: {
      chatId: "strict-custom",
      topics: ["AI×TECH", "custom_doge"],
      preferences: { items_per_digest: 3 },
      topic_weights: {},
    },
    enriched: [
      { tag: "AI×TECH", headline: "Broad AI filler", relevanceScore: 8, strategic_value: 0.8, routine_item_score: 0.1, url: "https://example.com/filler" },
    ],
    repeatIndex: { days: 3, urlKeys: new Set(), headlineKeys: new Set() },
    repeatPenalty: 0.2,
    depthPolicy: { minFilteredItems: 2, defaultItemCount: 3 },
    rankingPolicy: { minSignalScoreForFinal: 0 },
    recentDigestRecords: [],
    nowIso: "2026-03-13T11:00:00.000Z",
    deliveryMode: "scheduled",
  });
  assert.strictEqual(strictCustomOut.userItems.length, 1);
  assert.strictEqual(strictCustomOut.userItems[0].tag, "AI×TECH");
  assert.strictEqual(strictCustomOut.diagnostics.custom_precision_mode, false);

  const repeatLogs = [];
  const freshnessRuntime = createDigestOrchestratorDeliveryRankingRuntime({
    CONFIG: {
      digest: {
        perUserFreshnessMinItems: 3,
        perUserFreshnessDigests: 3,
        perUserEntityHistoryDigests: 3,
        maxSignalsPerEntity: 1,
      },
    },
    log: (line) => repeatLogs.push(String(line || "")),
    filterItemsByTopics: (items) => ({
      items,
      customKeywords: [],
      specialistMode: false,
      wasFiltered: true,
    }),
    applyTopicRelevanceScores: (items) => items.map((item, idx) => ({ ...item, relevanceScore: 10 - idx })),
    buildRecentEntityHistory: () => ({ entityCounts: {}, storylineKeys: new Set() }),
    suppressRecentlySentForUser: (items) => ({ items, removed: 0, backfilled: 0 }),
    isRecentRepeatItem: (item, repeatIndex) => {
      return buildSemanticRepeatIndex([item]).repeatKeys.size > 0
        && repeatIndex?.repeatKeys instanceof Set
        && [...repeatIndex.repeatKeys].some((key) => buildSemanticRepeatIndex([item]).repeatKeys.has(key));
    },
    parseSourceDomain: () => "example.com",
    applyEntityCoverageCap: (items) => items,
    reserveCustomKeywordSlot: (items) => items,
  });

  const recentUserRecords = [{
    items: [{
      tag: "SUSTAINABILITY",
      headline: "California Sets August 2026 Deadline for First Corporate Climate Reports",
      url: "https://www.esgtoday.com/california-sets-august-2026-deadline-for-first-corporate-climate-reports/",
    }],
  }];
  const globalRepeatIndex = buildSemanticRepeatIndex([{
    tag: "TECHNOLOGY",
    headline: "Why the 2026 Hardware Crisis Will Accelerate Adoption of Modern Private Cloud - Broadcom",
    url: "https://news.broadcom.com/cloud/2026-hardware-crisis-modern-private-cloud-adoption",
  }]);

  const freshnessOut = freshnessRuntime.rankAndSuppressUserItems({
    user: {
      email: "freshness@example.com",
      topics: ["SUSTAINABILITY", "TECHNOLOGY"],
      preferences: { items_per_digest: 3 },
      topic_weights: {},
    },
    enriched: [
      {
        tag: "SUSTAINABILITY",
        headline: "California Sets August 2026 Deadline for Corporate Climate Reports Under SB 253 and SB 261",
        url: "https://www.esgtoday.com/california-sets-august-2026-deadline-for-corporate-climate-reports-under-sb-253-and-sb-261/",
        strategic_value: 0.9,
        routine_item_score: 0.1,
      },
      {
        tag: "TECHNOLOGY",
        headline: "Why the 2026 Hardware Crisis Will Accelerate Adoption of Modern Private Cloud - Broadcom",
        url: "https://news.broadcom.com/cloud/2026-hardware-crisis-modern-private-cloud-adoption",
        strategic_value: 0.9,
        routine_item_score: 0.1,
      },
      {
        tag: "ENERGY",
        headline: "PJM Approves New Transmission Buildout for Grid Reliability",
        url: "https://example.com/pjm-grid-reliability",
        strategic_value: 0.9,
        routine_item_score: 0.1,
      },
    ],
    repeatIndex: {
      days: 3,
      ...globalRepeatIndex,
    },
    repeatPenalty: 0.5,
    depthPolicy: { minFilteredItems: 3, defaultItemCount: 3 },
    rankingPolicy: { minSignalScoreForFinal: 0 },
    recentDigestRecords: recentUserRecords,
    nowIso: "2026-03-20T11:00:00.000Z",
    deliveryMode: "scheduled",
  });

  assert.strictEqual(freshnessOut.userItems.length, 1);
  assert.strictEqual(freshnessOut.userItems[0].headline, "PJM Approves New Transmission Buildout for Grid Reliability");
  assert.strictEqual(freshnessOut.diagnostics.freshness_block_count, 2);
  assert.strictEqual(freshnessOut.diagnostics.dominant_failure_mode, "thin_pool");
  assert.ok(repeatLogs.some((line) => line.includes("[freshness-semantic]")));
})();

(() => {
  const officialCapRuntime = createDigestOrchestratorDeliveryRankingRuntime({
    CONFIG: {
      digest: {
        perUserFreshnessMinItems: 3,
        perUserFreshnessDigests: 3,
        perUserEntityHistoryDigests: 3,
        maxSignalsPerEntity: 5,
      },
    },
    log: () => {},
    filterItemsByTopics: () => ({
      items: [
        {
          tag: "HEALTHCARE",
          headline: "FDA approves first therapy",
          url: "https://www.fda.gov/approvals/one",
          source_type: "primary_official",
          content_kind: "official_document",
          source_policy: "preferred",
          source_authority: 0.95,
          strategic_value: 0.8,
          routine_item_score: 0.1,
          topicMatch: 9,
        },
        {
          tag: "HEALTHCARE",
          headline: "FDA issues guidance",
          url: "https://www.fda.gov/guidance/two",
          source_type: "primary_official",
          content_kind: "official_document",
          source_policy: "preferred",
          source_authority: 0.95,
          strategic_value: 0.79,
          routine_item_score: 0.1,
          topicMatch: 9,
        },
        {
          tag: "HEALTHCARE",
          headline: "CMS expands model",
          url: "https://www.cms.gov/model/three",
          source_type: "primary_official",
          content_kind: "official_document",
          source_policy: "preferred",
          source_authority: 0.93,
          strategic_value: 0.78,
          routine_item_score: 0.1,
          topicMatch: 9,
        },
        {
          tag: "HEALTHCARE",
          headline: "STAT explains the market impact",
          url: "https://www.statnews.com/2026/03/22/market-impact/",
          source_type: "reported_media",
          content_kind: "article",
          source_policy: "preferred",
          source_authority: 0.88,
          strategic_value: 0.82,
          routine_item_score: 0.1,
          topicMatch: 9,
        },
        {
          tag: "HEALTHCARE",
          headline: "Reuters on payer response",
          url: "https://www.reuters.com/world/us/payer-response/",
          source_type: "reported_media",
          content_kind: "article",
          source_policy: "preferred",
          source_authority: 0.95,
          strategic_value: 0.83,
          routine_item_score: 0.1,
          topicMatch: 9,
        },
      ],
      standardTopicsLower: ["healthcare"],
      customKeywords: [],
      specialistMode: false,
      wasFiltered: true,
    }),
    applyTopicRelevanceScores: (items) => items.map((item, index) => ({
      ...item,
      relevanceScore: 10 - index,
      why_shown: ["topic_match"],
    })),
    buildRecentEntityHistory: () => ({ entityCounts: {}, storylineKeys: new Set() }),
    suppressRecentlySentForUser: (items) => ({ items, removed: 0, backfilled: 0 }),
    isRecentRepeatItem: () => false,
    parseSourceDomain: () => "example.com",
    applyEntityCoverageCap: (items) => items,
    reserveCustomKeywordSlot: (items) => items,
  });

  const officialCapOut = officialCapRuntime.rankAndSuppressUserItems({
    user: {
      chatId: "official-cap",
      topics: ["HEALTHCARE"],
      preferences: { items_per_digest: 5 },
      topic_weights: {},
    },
    enriched: [],
    repeatIndex: { days: 3, urlKeys: new Set(), headlineKeys: new Set() },
    repeatPenalty: 0.2,
    depthPolicy: { minFilteredItems: 3, defaultItemCount: 5 },
    rankingPolicy: { minSignalScoreForFinal: 0 },
    recentDigestRecords: [],
    nowIso: "2026-03-23T11:00:00.000Z",
    captureDiagnostics: true,
  });

  assert.strictEqual(
    officialCapOut.userItems.filter((item) => String(item?.source_type || "").trim().toLowerCase() === "primary_official").length,
    2
  );
  assert.ok(
    Array.isArray(officialCapOut.diagnostics.item_trace?.transitions)
      && officialCapOut.diagnostics.item_trace.transitions.some((row) => row.reason === "removed_by_official_document_cap")
  );
})();
