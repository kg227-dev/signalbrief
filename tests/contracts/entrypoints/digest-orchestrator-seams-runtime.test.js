"use strict";

const assert = require("assert");
const path = require("path");
const { assertNodeSyntaxFile } = require("../../../test-support/module-contract-helper.js");

const FETCH_REL = "src/entrypoints/digest-orchestrator-fetch-runtime.js";
const SELECTION_REL = "src/entrypoints/digest-orchestrator-selection-runtime.js";
const ENRICHMENT_REL = "src/entrypoints/digest-orchestrator-enrichment-runtime.js";
const DELIVERY_RANK_REL = "src/entrypoints/digest-orchestrator-delivery-ranking-runtime.js";

const FETCH_PATH = path.join(process.cwd(), FETCH_REL);
const SELECTION_PATH = path.join(process.cwd(), SELECTION_REL);
const ENRICHMENT_PATH = path.join(process.cwd(), ENRICHMENT_REL);
const DELIVERY_RANK_PATH = path.join(process.cwd(), DELIVERY_RANK_REL);

assertNodeSyntaxFile(FETCH_PATH);
assertNodeSyntaxFile(SELECTION_PATH);
assertNodeSyntaxFile(ENRICHMENT_PATH);
assertNodeSyntaxFile(DELIVERY_RANK_PATH);

const { createDigestOrchestratorFetchRuntime } = require(FETCH_PATH);
const { createDigestOrchestratorSelectionRuntime } = require(SELECTION_PATH);
const { createDigestOrchestratorEnrichmentRuntime } = require(ENRICHMENT_PATH);
const { createDigestOrchestratorDeliveryRankingRuntime } = require(DELIVERY_RANK_PATH);

(async () => {
  const fetchRuntime = createDigestOrchestratorFetchRuntime({
    CONFIG: {
      topics: [{ tag: "TECHNOLOGY", queries: ["technology"] }],
      digest: {
        itemCount: 7,
      },
    },
    log: () => {},
    normalizeTopicToken: (value) => String(value || "").toLowerCase().trim(),
    fetchTopicNews: async (topic) => ({
      apiCalls: 1,
      items: [{ tag: topic.tag, headline: `${topic.tag} headline`, baseScore: 7.5 }],
    }),
    emitDigestIncident: async () => {},
  });

  const fetchOut = await fetchRuntime.orchestrateFetch({
    dueUsers: [{
      chatId: "u1",
      topics: ["TECHNOLOGY"],
      preferences: {},
    }],
    runMode: "scheduled",
  });
  assert.ok(fetchOut.allItems.length > 0, "fetch seam should produce candidate items");

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
    loadRecentArchiveByDate: () => [],
    buildRepeatHistory: () => new Map(),
    filterItemsAgainstHistory: (items) => ({ items, suppressedCount: 0, suppressedFrequentCount: 0, streaks: [] }),
    buildRepetitionNote: () => "",
    selectItems: (items) => items.slice(0, 1),
    emitDigestIncident: async () => {},
    articleAgeTooOld: () => false,
    classifyStoryRelationship: () => "new",
    loadEditorialOverrides: () => ({ pins: [], excludes: [], source_suppressions: [] }),
    editorialOverridesPath: "/tmp/seams-runtime-editorial-overrides.json",
    isUrlExcluded: () => false,
    isDomainSuppressed: () => false,
    getPinsForDate: () => [],
  });

  const selectionOut = await selectionRuntime.selectForEnrichment({
    allItems: fetchOut.allItems,
    selectionTarget: fetchOut.selectionTarget,
    tagPriority: fetchOut.tagPriority,
    runMode: "scheduled",
    dueUsersCount: 1,
    standardFetchCallsPlanned: fetchOut.standardFetchCallsPlanned,
  });
  assert.strictEqual(selectionOut.selected.length, 1, "selection seam should trim to selected items");

  const enrichmentRuntime = createDigestOrchestratorEnrichmentRuntime({
    enrichItems: async (selected) => ({
      items: selected.map((item) => ({ ...item, wim: "enriched" })),
      usage: { input_tokens: 10, output_tokens: 20 },
    }),
  });
  const enrichmentOut = await enrichmentRuntime.enrichSelectedItems({
    selected: selectionOut.selected,
  });
  assert.strictEqual(enrichmentOut.enriched[0].wim, "enriched", "enrichment seam should normalize response");

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

  const deliveryRankingOut = deliveryRankingRuntime.rankAndSuppressUserItems({
    user: {
      chatId: "u1",
      topics: ["TECHNOLOGY"],
      preferences: {},
    },
    enriched: enrichmentOut.enriched,
    repeatIndex: selectionOut.repeatIndex,
    repeatPenalty: selectionOut.repeatPenalty,
    depthPolicy: selectionOut.depthPolicy,
    rankingPolicy: selectionOut.rankingPolicy,
  });
  assert.strictEqual(deliveryRankingOut.userItems.length, 1, "delivery-ranking seam should emit deliverable items");
})();
