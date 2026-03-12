"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../test-support/module-contract-helper.js");

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
      },
    },
    log: (line) => logs.push(String(line || "")),
    filterItemsByTopics: () => ({
      items: [
        { tag: "AI×TECH", baseScore: 9.2, why_shown: [] },
        { tag: "STRATEGY", baseScore: 5.5, why_shown: ["custom_keyword"] },
      ],
      customKeywords: ["glp_1"],
      specialistMode: false,
      wasFiltered: true,
    }),
    applyTopicRelevanceScores: (items) => {
      scoreCallCount += 1;
      return items.map((item, idx) => ({ ...item, relevanceScore: 10 - idx }));
    },
    suppressRecentlySentForUser: (items) => ({
      items,
      removed: 0,
      backfilled: 0,
    }),
    isRecentRepeatItem: () => false,
    parseSourceDomain: () => "example.com",
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
    rankingPolicy: { minBaseScoreForFinal: 6.5 },
  });

  assert.strictEqual(scoreCallCount, 1);
  assert.strictEqual(ranked.wasFiltered, true);
  assert.strictEqual(ranked.userItems.length, 2);
  assert.ok(logs.some((line) => line.includes("[pre-sort]")));
  assert.ok(logs.some((line) => line.includes("[post-sort]")));

  let emergencyScoreCalls = 0;
  const emergencyRuntime = createDigestOrchestratorDeliveryRankingRuntime({
    CONFIG: {
      digest: {
        perUserFreshnessMinItems: 3,
        perUserFreshnessDigests: 3,
      },
    },
    log: () => {},
    filterItemsByTopics: () => ({
      items: [],
      customKeywords: [],
      specialistMode: false,
      wasFiltered: true,
    }),
    applyTopicRelevanceScores: () => {
      emergencyScoreCalls += 1;
      if (emergencyScoreCalls === 1) return [];
      return [{ tag: "AI×TECH", baseScore: 7, relevanceScore: 8 }];
    },
    suppressRecentlySentForUser: (items) => ({ items, removed: 0, backfilled: 0 }),
    isRecentRepeatItem: () => false,
    parseSourceDomain: () => "example.com",
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
    rankingPolicy: { minBaseScoreForFinal: 6.5 },
  });

  assert.strictEqual(emergencyScoreCalls, 2);
  assert.strictEqual(emergencyOut.wasFiltered, false);
  assert.strictEqual(emergencyOut.userItems.length, 1);
})();
