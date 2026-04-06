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
      topics: [{ tag: "TECHNOLOGY", queries: ["ai"] }],
      digest: {
        itemCount: 5,
      },
    },
    log: () => {},
    normalizeTopicToken: (value) => String(value || "").toLowerCase().trim(),
    fetchTopicNews: async () => ({
      apiCalls: 1,
      items: [],
      diagnostics: {
        provider: "perplexity",
        successful_calls: 1,
        failed_calls: 0,
        transport_errors: 0,
        status_counts: {},
      },
    }),
    standardTopicBrokerRuntime: {
      fetchBrokerCandidates: async () => ({
        topicItems: {
          TECHNOLOGY: [{
            tag: "TECHNOLOGY",
            headline: "TECHNOLOGY headline",
            baseScore: 7.5,
            summary: "Summary",
            url: "https://example.com/technology",
            canonical_url: "https://example.com/technology",
            source: "example.com",
            source_domain: "example.com",
            published_date: "2026-03-27T10:00:00.000Z",
            retrieval_origin: "broker_publisher_feed",
            source_type: "reported_media",
            source_tier: "strong",
          }],
        },
        diagnostics: {
          enabled: true,
          config_source: "test",
          active_path: "/tmp/test-broker.json",
          active_topic_tags: ["TECHNOLOGY"],
          lane_counts: { publisher_feed: 1, official: 0 },
          source_fetch_count: 1,
          source_success_count: 1,
          source_failure_count: 0,
          source_diagnostics: [],
          topic_diagnostics: {},
        },
      }),
    },
    emitDigestIncident: async () => {},
  });
  const fetchOut = await fetchRuntime.orchestrateFetch({
    dueUsers: [{ topics: ["TECHNOLOGY"], preferences: {} }],
    runMode: "scheduled",
  });
  assert.deepStrictEqual(
    sortedKeys(fetchOut),
    [
      "allItems",
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
    loadRecentArchiveByDate: () => [],
    buildRepeatHistory: () => new Map(),
    filterItemsAgainstHistory: (items) => ({ items, suppressedCount: 0, suppressedFrequentCount: 0, streaks: [] }),
    buildRepetitionNote: () => "",
    emitDigestIncident: async () => {},
    articleAgeTooOld: () => false,
    classifyStoryRelationship: () => "new",
    loadEditorialOverrides: () => ({ pins: [], excludes: [], source_suppressions: [] }),
    editorialOverridesPath: "/tmp/parity-shape-editorial-overrides.json",
    isUrlExcluded: () => false,
    isDomainSuppressed: () => false,
    getPinsForDate: () => [],
    annotateEditorialSignals: (items) => items.slice(),
    buildStorylineCandidates: (items) => items.slice(),
  });
  const selectionOut = await selectionRuntime.selectForEnrichment({
    allItems: fetchOut.allItems,
    selectionTarget: fetchOut.selectionTarget,
    tagPriority: fetchOut.tagPriority,
    runMode: "scheduled",
    dueUsersCount: 1,
    standardFetchCallsPlanned: fetchOut.standardFetchCallsPlanned,
    nowMs: Date.parse("2026-03-27T12:00:00.000Z"),
  });
  assert.deepStrictEqual(
    sortedKeys(selectionOut),
    [
      "depthPolicy",
      "rankingPolicy",
      "repeatIndex",
      "repeatPenalty",
      "repetitionNote",
      "reserveByTopic",
      "selected",
      "selectedByTopic",
      "selectionDiagnostics",
      "writeupBackfillPolicy",
    ],
    "selection stage output shape must remain parity-stable"
  );

  const enrichmentRuntime = createDigestOrchestratorEnrichmentRuntime({
    enrichItems: async (selected) => ({
      items: selected.map((item) => ({
        ...item,
        signal_shift: "Example Corp repriced a contract",
        implication_type: "cost",
        wim_brief: "The repricing tightens customer budgets immediately.",
        wim: "Example Corp repriced a contract, which changes near-term spend assumptions for buyers.",
        writeup_status: "model_pass",
        writeup_attempt_count: 1,
        writeup_rejection_reasons: [],
        writeup_version: "v2",
      })),
      usage: { input_tokens: 10, output_tokens: 20 },
    }),
    emitDigestIncident: async () => false,
    getBackfillRejectionReason: () => null,
  });
  const enrichmentOut = await enrichmentRuntime.enrichSelectedItems({
    selected: selectionOut.selected,
    selectedByTopic: selectionOut.selectedByTopic,
    reserveByTopic: selectionOut.reserveByTopic,
    selectionDiagnostics: selectionOut.selectionDiagnostics,
    writeupBackfillPolicy: selectionOut.writeupBackfillPolicy,
  });
  assert.deepStrictEqual(
    sortedKeys(enrichmentOut),
    [
      "claudeUsage",
      "degradation",
      "degraded",
      "enriched",
      "enrichmentDiagnostics",
      "failedByTopic",
      "finalSelectedByTopic",
      "selectionDiagnostics",
      "writeupDiagnostics",
    ],
    "enrichment stage output shape must remain parity-stable"
  );
  assert.deepStrictEqual(
    sortedKeys(enrichmentOut.claudeUsage),
    ["input_tokens", "output_tokens"],
    "enrichment usage shape must remain parity-stable"
  );
  assert.deepStrictEqual(
    sortedKeys(enrichmentOut.writeupDiagnostics),
    [
      "allow_underfill_topic_tags",
      "attempted_count",
      "drop_count",
      "dropped_share_pct",
      "final_selected_count",
      "first_pass_failure_count",
      "first_pass_success_count",
      "first_pass_success_rate_pct",
      "items_per_topic_target",
      "model_generated_count",
      "model_generated_share_pct",
      "repair_attempted_count",
      "repair_pass_success_rate_pct",
      "repair_success_count",
      "repeated_phrase_rejection_count",
      "topic_stats",
      "underfill_due_writeup_count",
    ],
    "enrichment writeup diagnostics shape must remain parity-stable"
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
      topics: ["TECHNOLOGY"],
      preferences: {},
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
