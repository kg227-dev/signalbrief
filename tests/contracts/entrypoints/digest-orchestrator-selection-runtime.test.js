"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/entrypoints/digest-orchestrator-selection-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
const {
  canonicalizeCandidateTopicTags,
  createDigestOrchestratorSelectionRuntime,
  prepareSelectionCandidates,
  splitByFreshnessTiers,
} = runtime;
assertModuleExports(() => runtime, TARGET_REL);

(async () => {
  const nowMs = Date.parse("2026-03-27T12:00:00.000Z");
  const tiers = splitByFreshnessTiers([
    { url: "https://example.com/1", published_date: "2026-03-27T08:00:00.000Z" },
    { url: "https://example.com/2", published_date: "2026-03-26T08:00:00.000Z" },
    { url: "https://example.com/3", published_date: "2026-03-24T08:00:00.000Z" },
  ], nowMs);
  assert.strictEqual(tiers.tier1.length, 1);
  assert.strictEqual(tiers.tier2.length, 1);
  assert.strictEqual(tiers.tier3.length, 1);
  assert.strictEqual(typeof canonicalizeCandidateTopicTags, "function");
  assert.strictEqual(typeof prepareSelectionCandidates, "function");

  const prepared = prepareSelectionCandidates([
    { tag: "TECHNOLOGY", headline: "Hospital software expansion", url: "https://example.com/topic-fit" },
  ], {
    configTopics: [{ tag: "HEALTHCARE" }, { tag: "TECHNOLOGY" }],
    annotateEditorialSignals: (items) => items.map((item) => ({
      ...item,
      storyline_key: "hospital-software-expansion",
      entity_keys: ["hospital"],
      content_flags: ["commercial_partnership"],
    })),
    buildStorylineCandidates: (items) => items,
    assignCanonicalTopic: () => "HEALTHCARE",
    scoreBestFitTopicTag: (tag) => (tag === "HEALTHCARE" ? 8 : 1),
  });
  assert.strictEqual(prepared.items[0].tag, "HEALTHCARE");
  assert.strictEqual(prepared.items[0].storyline_key, "hospital-software-expansion");
  assert.strictEqual(prepared.bestFitTopicReassignedCount, 1);

  const incidents = [];
  const selectionRuntime = createDigestOrchestratorSelectionRuntime({
    CONFIG: {
      topics: [{ tag: "HEALTHCARE" }, { tag: "TECHNOLOGY" }],
      digest: {
        itemCount: 5,
        crossDayDedupDays: 3,
        minBackfillItemsAfterDedup: 3,
        maxItemsPerSourceDomain: 2,
      },
    },
    log: () => {},
    createDigestPolicies: () => ({
      rankingPolicy: { repeatPenalty: 0.5, minBaseScoreForFinal: 6.5 },
      depthPolicy: { minFilteredItems: 3, defaultItemCount: 5 },
    }),
    dedupAgainstRecentArchives: (items) => ({
      items: items.slice(),
      removed: 0,
      archive_days_used: 3,
      backfilled: 0,
    }),
    buildRecentRepeatIndex: () => ({ days: 3, urlKeys: new Set(), headlineKeys: new Set() }),
    loadRecentArchiveByDate: () => [],
    buildRepeatHistory: () => new Map(),
    filterItemsAgainstHistory: (items) => ({
      items: items.slice(),
      suppressedCount: 0,
      suppressedFrequentCount: 0,
      streaks: [],
    }),
    buildRepetitionNote: () => "",
    selectItems: (items) => items.slice(0, 5),
    selectItemsDetailed: (items) => ({
      selected: items.slice(0, 5),
      rejected: items.slice(5).map((item) => ({ item, reason: "selection_not_selected" })),
    }),
    emitDigestIncident: async (type) => {
      incidents.push(type);
    },
    articleAgeTooOld: () => false,
    classifyStoryRelationship: () => "new",
    loadEditorialOverrides: () => ({ pins: [], excludes: [], source_suppressions: [] }),
    editorialOverridesPath: "/tmp/selection-runtime-test-editorial-overrides.json",
    isUrlExcluded: () => false,
    isDomainSuppressed: () => false,
    getPinsForDate: () => [],
    annotateEditorialSignals: (items) => items.slice(),
    buildStorylineCandidates: (items) => items.slice(),
  });

  const selectedOut = await selectionRuntime.selectForEnrichment({
    allItems: [
      { url: "https://example.com/h1", headline: "H1", tag: "HEALTHCARE", published_date: "2026-03-27T10:00:00.000Z", source_domain: "h1.example.com" },
      { url: "https://example.com/h2", headline: "H2", tag: "HEALTHCARE", published_date: "2026-03-27T09:00:00.000Z", source_domain: "h2.example.com" },
      { url: "https://example.com/h3", headline: "H3", tag: "HEALTHCARE", published_date: "2026-03-26T20:00:00.000Z", source_domain: "h3.example.com" },
      { url: "https://example.com/t1", headline: "T1", tag: "TECHNOLOGY", published_date: "2026-03-27T08:00:00.000Z", source_domain: "t1.example.com" },
      { url: "https://example.com/t2", headline: "T2", tag: "TECHNOLOGY", published_date: "2026-03-27T07:00:00.000Z", source_domain: "t2.example.com" },
      { url: "https://example.com/t3", headline: "T3", tag: "TECHNOLOGY", published_date: "2026-03-26T18:00:00.000Z", source_domain: "t3.example.com" },
    ],
    selectionTarget: 5,
    tagPriority: { healthcare: 1, technology: 1 },
    runMode: "scheduled",
    digestDateKey: "2026-03-27",
    dueUsersCount: 2,
    standardFetchCallsPlanned: 14,
    nowMs: Date.parse("2026-03-27T12:00:00.000Z"),
  });

  assert.strictEqual(selectedOut.selected.length, 6);
  assert.strictEqual(selectedOut.selectionDiagnostics.topic_selection_audit.length, 2);
  assert.strictEqual(selectedOut.selectionDiagnostics.selection_rejection_counts.selection_not_selected || 0, 0);
  assert.deepStrictEqual(incidents, []);

  const fallbackRuntime = createDigestOrchestratorSelectionRuntime({
    CONFIG: {
      digest: {
        itemCount: 5,
        crossDayDedupDays: 3,
        minBackfillItemsAfterDedup: 3,
        maxItemsPerSourceDomain: 2,
        maxDiscoveryItemsPerTopic: 1,
      },
    },
    log: () => {},
    createDigestPolicies: () => ({
      rankingPolicy: { repeatPenalty: 0, minBaseScoreForFinal: 6.5 },
      depthPolicy: { minFilteredItems: 3, defaultItemCount: 5 },
    }),
    dedupAgainstRecentArchives: (items) => ({
      items: items.slice(),
      removed: 0,
      archive_days_used: 3,
      backfilled: 0,
    }),
    buildRecentRepeatIndex: () => ({ days: 3, urlKeys: new Set(), headlineKeys: new Set() }),
    loadRecentArchiveByDate: () => [],
    buildRepeatHistory: () => new Map(),
    filterItemsAgainstHistory: (items) => ({
      items: items.slice(),
      suppressedCount: 0,
      suppressedFrequentCount: 0,
      streaks: [],
    }),
    buildRepetitionNote: () => "",
    emitDigestIncident: async () => {},
    articleAgeTooOld: () => false,
    classifyStoryRelationship: () => "new",
    loadEditorialOverrides: () => ({ pins: [], excludes: [], source_suppressions: [] }),
    editorialOverridesPath: "/tmp/selection-runtime-test-editorial-overrides.json",
    isUrlExcluded: () => false,
    isDomainSuppressed: () => false,
    getPinsForDate: () => [],
    annotateEditorialSignals: (items) => items.slice(),
    buildStorylineCandidates: (items) => items.slice(),
  });

  const fallbackOut = await fallbackRuntime.selectForEnrichment({
    allItems: [
      { url: "https://example.com/e1", headline: "Event 1", tag: "TECHNOLOGY", published_date: "2026-03-27T11:00:00.000Z", source_domain: "reuters.com", retrieval_origin: "broker_publisher_feed", source_type: "reported_media", _score: 0.95 },
      { url: "https://example.com/e2", headline: "Event 2", tag: "TECHNOLOGY", published_date: "2026-03-27T10:00:00.000Z", source_domain: "wsj.com", retrieval_origin: "broker_publisher_feed", source_type: "reported_media", _score: 0.92 },
      { url: "https://example.com/e3", headline: "Event 3", tag: "TECHNOLOGY", published_date: "2026-03-27T09:00:00.000Z", source_domain: "ft.com", retrieval_origin: "broker_publisher_feed", source_type: "reported_media", _score: 0.9 },
      { url: "https://example.com/e4", headline: "Event 4", tag: "TECHNOLOGY", published_date: "2026-03-26T15:00:00.000Z", source_domain: "bloomberg.com", retrieval_origin: "broker_publisher_feed", source_type: "reported_media", _score: 0.88 },
      { url: "https://example.com/c1/analysis", headline: "Commentary 1", tag: "TECHNOLOGY", published_date: "2026-03-26T14:00:00.000Z", source_domain: "stratechery.com", retrieval_origin: "discovery", source_type: "analysis_blog", originality_profile: "derived_synthesis", content_flags: ["generic_commentary"], _score: 0.87 },
      { url: "https://example.com/c2/analysis", headline: "Commentary 2", tag: "TECHNOLOGY", published_date: "2026-03-26T13:00:00.000Z", source_domain: "semianalysis.com", retrieval_origin: "discovery", source_type: "analysis_blog", originality_profile: "derived_synthesis", content_flags: ["generic_commentary"], _score: 0.86 },
    ],
    selectionTarget: 5,
    tagPriority: { technology: 1 },
    runMode: "scheduled",
    digestDateKey: "2026-03-27",
    dueUsersCount: 1,
    standardFetchCallsPlanned: 7,
    nowMs: Date.parse("2026-03-27T12:00:00.000Z"),
  });

  assert.strictEqual(fallbackOut.selected.length, 5, "fallback path should preserve the 5-item contract when 4 events + 1 commentary are available");
  assert.strictEqual(
    fallbackOut.selected.filter((item) => String(item?.source_type || "").trim().toLowerCase() === "analysis_blog").length,
    1,
    "selection must cap commentary fallback at one item"
  );
  assert.strictEqual(
    fallbackOut.selectionDiagnostics.topic_selection_audit[0].fallback_stage_counts.commentary_selected,
    1,
    "topic audit should record commentary fallback usage"
  );
  assert.strictEqual(
    fallbackOut.selectionDiagnostics.selection_rejection_counts.selection_commentary_cap || 0,
    1,
    "extra commentary items should be rejected explicitly once the fallback slot is used"
  );

  const strictPrefilterRuntime = createDigestOrchestratorSelectionRuntime({
    CONFIG: {
      digest: {
        itemCount: 5,
        crossDayDedupDays: 3,
        minBackfillItemsAfterDedup: 3,
        maxItemsPerSourceDomain: 2,
        strict_quality: {
          enabled: true,
          freshness_hours_cap: 48,
          topic_fit_min: 0.7,
        },
      },
    },
    log: () => {},
    createDigestPolicies: () => ({
      rankingPolicy: { repeatPenalty: 0, minBaseScoreForFinal: 6.5 },
      depthPolicy: { minFilteredItems: 3, defaultItemCount: 5 },
    }),
    dedupAgainstRecentArchives: (items) => ({ items: items.slice(), removed: 0, archive_days_used: 3, backfilled: 0 }),
    buildRecentRepeatIndex: () => ({ days: 3, urlKeys: new Set(), headlineKeys: new Set() }),
    loadRecentArchiveByDate: () => [],
    buildRepeatHistory: () => new Map(),
    filterItemsAgainstHistory: (items) => ({ items: items.slice(), suppressedCount: 0, suppressedFrequentCount: 0, streaks: [] }),
    buildRepetitionNote: () => "",
    emitDigestIncident: async () => {},
    articleAgeTooOld: () => false,
    classifyStoryRelationship: () => "new",
    loadEditorialOverrides: () => ({ pins: [], excludes: [], source_suppressions: [] }),
    editorialOverridesPath: "/tmp/selection-runtime-test-editorial-overrides.json",
    isUrlExcluded: () => false,
    isDomainSuppressed: () => false,
    getPinsForDate: () => [],
    annotateEditorialSignals: (items) => items.slice(),
    buildStorylineCandidates: (items) => items.slice(),
  });

  const strictPrefilterOut = await strictPrefilterRuntime.selectForEnrichment({
    allItems: [
      { url: "https://example.com/valid", headline: "Valid item", tag: "TECHNOLOGY", published_date: "2026-03-27T10:00:00.000Z", source_domain: "valid.example.com", source_type: "reported_media", topic_fit: 0.9 },
      { url: "https://example.com/stale", headline: "Stale item", tag: "TECHNOLOGY", published_date: "2026-03-24T01:00:00.000Z", source_domain: "stale.example.com", source_type: "reported_media", topic_fit: 0.9 },
      { url: "https://example.com/offtopic", headline: "Off-topic item", tag: "TECHNOLOGY", published_date: "2026-03-27T09:00:00.000Z", source_domain: "offtopic.example.com", source_type: "reported_media", topic_fit: 0.3 },
    ],
    selectionTarget: 5,
    tagPriority: { technology: 1 },
    runMode: "scheduled",
    digestDateKey: "2026-03-27",
    dueUsersCount: 1,
    standardFetchCallsPlanned: 7,
    nowMs,
  });

  assert.strictEqual(strictPrefilterOut.selectionDiagnostics.strict_quality.prefilter.removed_count, 2);
  assert.strictEqual(strictPrefilterOut.selectionDiagnostics.candidate_pool_after_pre_ranking_quality, 1);

  const failIncidents = [];
  const failRuntime = createDigestOrchestratorSelectionRuntime({
    CONFIG: { digest: { itemCount: 5, crossDayDedupDays: 3 } },
    log: () => {},
    createDigestPolicies: () => ({
      rankingPolicy: { repeatPenalty: 0, minBaseScoreForFinal: 6.5 },
      depthPolicy: { minFilteredItems: 3, defaultItemCount: 5 },
    }),
    dedupAgainstRecentArchives: () => ({ items: [], removed: 0, archive_days_used: 3, backfilled: 0 }),
    buildRecentRepeatIndex: () => ({ days: 3, urlKeys: new Set(), headlineKeys: new Set() }),
    loadRecentArchiveByDate: () => [],
    buildRepeatHistory: () => new Map(),
    filterItemsAgainstHistory: () => ({ items: [], suppressedCount: 0, suppressedFrequentCount: 0, streaks: [] }),
    buildRepetitionNote: () => "",
    selectItems: () => [],
    emitDigestIncident: async (type) => { failIncidents.push(type); },
    articleAgeTooOld: () => false,
    classifyStoryRelationship: () => "new",
    loadEditorialOverrides: () => ({ pins: [], excludes: [], source_suppressions: [] }),
    editorialOverridesPath: "/tmp/selection-runtime-test-editorial-overrides.json",
    isUrlExcluded: () => false,
    isDomainSuppressed: () => false,
    getPinsForDate: () => [],
    annotateEditorialSignals: (items) => items.slice(),
    buildStorylineCandidates: (items) => items.slice(),
  });

  await assert.rejects(
    () => failRuntime.selectForEnrichment({
      allItems: [],
      selectionTarget: 5,
      tagPriority: {},
      runMode: "scheduled",
      digestDateKey: "2026-03-27",
      dueUsersCount: 1,
      standardFetchCallsPlanned: 14,
    }),
    /No live items available after freshness and selection filters; digest aborted/
  );
  assert.deepStrictEqual(failIncidents, ["no-selectable-items"]);
})();
