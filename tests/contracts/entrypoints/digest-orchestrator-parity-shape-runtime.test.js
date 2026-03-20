"use strict";

const assert = require("assert");
const path = require("path");

const { createDigestOrchestratorFetchRuntime } = require(path.join(process.cwd(), "src/entrypoints/digest-orchestrator-fetch-runtime.js"));
const { createDigestOrchestratorSelectionRuntime } = require(path.join(process.cwd(), "src/entrypoints/digest-orchestrator-selection-runtime.js"));
const { createDigestOrchestratorEnrichmentRuntime } = require(path.join(process.cwd(), "src/entrypoints/digest-orchestrator-enrichment-runtime.js"));
const { createDigestOrchestratorDeliveryRankingRuntime } = require(path.join(process.cwd(), "src/entrypoints/digest-orchestrator-delivery-ranking-runtime.js"));

function sortedKeys(obj) {
  return Object.keys(obj || {}).sort();
}

(async () => {
  const fetchRuntime = createDigestOrchestratorFetchRuntime({
    CONFIG: {
      topics: [{ tag: "AI×TECH", queries: ["ai"] }],
      digest: {
        itemCount: 7,
        maxCustomFetchPerRun: 5,
      },
    },
    log: () => {},
    normalizeTopicToken: (value) => String(value || "").toLowerCase().trim(),
    fetchTopicNews: async (topic) => ({
      apiCalls: 1,
      items: [{ tag: topic.tag, headline: `${topic.tag} headline`, baseScore: 7.5 }],
    }),
    buildCustomTopicQueries: (keyword) => [`${keyword} query`],
    buildCustomRescueItemsFromStandard: () => [],
    emitDigestIncident: async () => {},
  });
  const fetchOut = await fetchRuntime.orchestrateFetch({
    dueUsers: [{ topics: ["AI×TECH"], preferences: { items_per_digest: 5 } }],
    targetChatId: "u1",
    runMode: "targeted",
  });
  assert.deepStrictEqual(
    sortedKeys(fetchOut),
    [
      "allItems",
      "customFetchCalls",
      "customTags",
      "fetchDiagnostics",
      "selectionTarget",
      "standardFetchCalls",
      "standardFetchCallsPlanned",
      "tagPriority",
    ],
    "fetch stage output shape must remain parity-stable"
  );

  const selectionRuntime = createDigestOrchestratorSelectionRuntime({
    CONFIG: {
      digest: {
        crossDayDedupDays: 3,
        minBackfillItemsAfterDedup: 3,
        maxItemsPerTag: 2,
        maxItemsPerSourceDomain: 2,
      },
    },
    log: () => {},
    createDigestPolicies: () => ({
      rankingPolicy: { repeatPenalty: 0.5, minBaseScoreForFinal: 6.5 },
      depthPolicy: { minFilteredItems: 3, defaultItemCount: 5 },
    }),
    dedupAgainstRecentArchives: (items) => ({ items, removed: 0, archive_days_used: 3, backfilled: 0 }),
    buildRecentRepeatIndex: () => ({ days: 3, urlKeys: new Set(), headlineKeys: new Set() }),
    selectItems: (items) => items.slice(0, 1),
    loadRecentArchiveItems: () => [],
    emitDigestIncident: async () => {},
  });
  const selectionOut = await selectionRuntime.selectForEnrichment({
    allItems: fetchOut.allItems,
    selectionTarget: fetchOut.selectionTarget,
    customTags: fetchOut.customTags,
    tagPriority: fetchOut.tagPriority,
    runMode: "targeted",
    dueUsersCount: 1,
    standardFetchCallsPlanned: fetchOut.standardFetchCallsPlanned,
  });
  assert.deepStrictEqual(
    sortedKeys(selectionOut),
    [
      "depthPolicy",
      "rankingPolicy",
      "repeatIndex",
      "repeatPenalty",
      "selected",
      "selectionDiagnostics",
    ],
    "selection stage output shape must remain parity-stable"
  );

  const enrichmentRuntime = createDigestOrchestratorEnrichmentRuntime({
    enrichItems: async (selected) => ({
      items: selected.map((item) => ({ ...item, wim: "ok" })),
      usage: { input_tokens: 10, output_tokens: 20 },
    }),
  });
  const enrichmentOut = await enrichmentRuntime.enrichSelectedItems({
    selected: selectionOut.selected,
  });
  assert.deepStrictEqual(
    sortedKeys(enrichmentOut),
    ["claudeUsage", "enriched"],
    "enrichment stage output shape must remain parity-stable"
  );
  assert.deepStrictEqual(
    sortedKeys(enrichmentOut.claudeUsage),
    ["input_tokens", "output_tokens"],
    "enrichment usage shape must remain parity-stable"
  );

  const deliveryRankingRuntime = createDigestOrchestratorDeliveryRankingRuntime({
    CONFIG: {
      digest: {
        perUserFreshnessMinItems: 3,
        perUserFreshnessDigests: 3,
      },
    },
    log: () => {},
    filterItemsByTopics: (items) => ({
      items,
      customKeywords: [],
      specialistMode: false,
      wasFiltered: false,
    }),
    applyTopicRelevanceScores: (items) => items.map((item, idx) => ({ ...item, relevanceScore: 10 - idx })),
    suppressRecentlySentForUser: (items) => ({ items, removed: 0, backfilled: 0 }),
    isRecentRepeatItem: () => false,
    parseSourceDomain: () => "example.com",
    reserveCustomKeywordSlot: (items) => items,
  });
  const deliveryOut = deliveryRankingRuntime.rankAndSuppressUserItems({
    user: {
      chatId: "u1",
      topics: ["AI×TECH"],
      preferences: { items_per_digest: 5 },
      topic_weights: {},
    },
    enriched: enrichmentOut.enriched,
    repeatIndex: selectionOut.repeatIndex,
    repeatPenalty: selectionOut.repeatPenalty,
    depthPolicy: selectionOut.depthPolicy,
    rankingPolicy: selectionOut.rankingPolicy,
  });
  assert.deepStrictEqual(
    sortedKeys(deliveryOut),
    ["diagnostics", "userItems", "wasFiltered"],
    "delivery ranking stage output shape must remain parity-stable"
  );
})();
