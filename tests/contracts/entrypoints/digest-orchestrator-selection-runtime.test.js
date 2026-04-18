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
  assert.strictEqual(selectedOut.selectionDiagnostics.procedural_notice_selected_count || 0, 0);
  assert.deepStrictEqual(incidents, []);

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

  const proceduralCountRuntime = createDigestOrchestratorSelectionRuntime({
    CONFIG: {
      digest: {
        itemCount: 5,
        crossDayDedupDays: 3,
        minBackfillItemsAfterDedup: 3,
        maxItemsPerSourceDomain: 2,
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

  const proceduralCountOut = await proceduralCountRuntime.selectForEnrichment({
    allItems: [
      {
        url: "https://example.com/procedural",
        headline: "Notice of enforcement deadline raises compliance costs",
        summary: "The deadline moves within 90 days and raises compliance costs for lenders.",
        tag: "TECHNOLOGY",
        published_date: "2026-03-27T10:00:00.000Z",
        source_domain: "federalregister.gov",
        source_type: "primary_official",
      },
    ],
    selectionTarget: 5,
    tagPriority: { technology: 1 },
    runMode: "scheduled",
    digestDateKey: "2026-03-27",
    dueUsersCount: 1,
    standardFetchCallsPlanned: 1,
    nowMs,
  });
  assert.strictEqual(proceduralCountOut.selectionDiagnostics.procedural_notice_selected_count, 1);

  const lowSignalOut = await proceduralCountRuntime.selectForEnrichment({
    allItems: [
      {
        url: "https://example.com/notice-only",
        headline: "Conference notice for advisory council",
        summary: "The agency published an administrative update for an upcoming meeting.",
        tag: "TECHNOLOGY",
        published_date: "2026-03-27T10:00:00.000Z",
        source_domain: "federalregister.gov",
        source_type: "primary_official",
        procedural_notice: true,
      },
      {
        url: "https://example.com/real-signal",
        headline: "Vendor raises platform prices after compliance rule",
        summary: "The change lifts compliance costs and slows enterprise buying decisions.",
        tag: "TECHNOLOGY",
        published_date: "2026-03-27T09:00:00.000Z",
        source_domain: "theregister.com",
        source_type: "reported_media",
      },
    ],
    selectionTarget: 5,
    tagPriority: { technology: 1 },
    runMode: "scheduled",
    digestDateKey: "2026-03-27",
    dueUsersCount: 1,
    standardFetchCallsPlanned: 1,
    nowMs,
  });
  assert.strictEqual(lowSignalOut.selectionDiagnostics.strict_quality.signal_quality_prefilter.removed_count, 1);
  assert.strictEqual(lowSignalOut.selected.length, 1);
  assert.strictEqual(lowSignalOut.selectionDiagnostics.topic_selection_audit[0].topic_health, "THIN");

  function buildGuardrailRuntime() {
    return createDigestOrchestratorSelectionRuntime({
      CONFIG: {
        digest: {
          itemCount: 5,
          crossDayDedupDays: 3,
          minBackfillItemsAfterDedup: 3,
          maxItemsPerSourceDomain: 3,
          trustedSelectionFloor: {
            enabled: true,
            minTrustedItemsPerTopic: 4,
            activationStrongCandidateCount: 1,
          },
          trustGuardrail: {
            minTrustedItemsPerTopic: 4,
            aspirationalTrustedItemsPerTopic: 5,
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
  }

  function makeGuardrailItem(overrides = {}) {
    return {
      summary: "Operators are adjusting budgets and workflows around this development.",
      published_date: "2026-03-27T10:00:00.000Z",
      retrieval_origin: "broker_publisher_feed",
      source_type: "trade_specialist",
      source_tier: "strong",
      novelty_score: 0.8,
      topic_fit: 0.9,
      ...overrides,
    };
  }

  const industrialsRuntime = buildGuardrailRuntime();
  const industrialsOut = await industrialsRuntime.selectForEnrichment({
    allItems: [
      makeGuardrailItem({ url: "https://example.com/ind-1", headline: "Ocean freight contracts steer shipper margins", tag: "INDUSTRIALS", source_domain: "supplychaindive.com", _score: 0.95 }),
      makeGuardrailItem({ url: "https://example.com/ind-2", headline: "Factory automation budgets rise with component costs", tag: "INDUSTRIALS", source_domain: "manufacturingdive.com", _score: 0.93 }),
      makeGuardrailItem({ url: "https://example.com/ind-3", headline: "Distribution reshoring raises warehouse demand", tag: "INDUSTRIALS", source_domain: "supplychaindive.com", _score: 0.91 }),
      makeGuardrailItem({ url: "https://example.com/ind-4", headline: "Carrier procurement shifts after fuel surcharge reset", tag: "INDUSTRIALS", source_domain: "freightwaves.com", source_tier: "standard", _score: 0.90 }),
      makeGuardrailItem({ url: "https://example.com/ind-official", headline: "Drug Supply Chain Security Act Law and Policies", tag: "INDUSTRIALS", source_domain: "fda.gov", source_type: "primary_official", retrieval_origin: "broker_official", source_tier: "premium", summary: "FDA guidance for pharmaceutical manufacturers and distributors.", _score: 0.89 }),
      makeGuardrailItem({ url: "https://example.com/ind-reserve", headline: "J.B. Hunt resets trucking procurement strategy", tag: "INDUSTRIALS", source_domain: "freightwaves.com", _score: 0.88 }),
      makeGuardrailItem({ url: "https://example.com/ind-reserve-2", headline: "NSC cargo mix changes warehouse planning", tag: "INDUSTRIALS", source_domain: "supplychaindive.com", published_date: "2026-03-26T03:00:00.000Z", _score: 0.87 }),
    ],
    selectionTarget: 5,
    tagPriority: { industrials: 1 },
    runMode: "scheduled",
    digestDateKey: "2026-03-27",
    dueUsersCount: 1,
    standardFetchCallsPlanned: 1,
    nowMs,
  });
  assert.ok(!industrialsOut.selected.some((item) => item.url === "https://example.com/ind-official"));
  assert.ok(industrialsOut.selected.some((item) => item.url === "https://example.com/ind-reserve"));

  const technologyRuntime = buildGuardrailRuntime();
  const technologyOut = await technologyRuntime.selectForEnrichment({
    allItems: [
      makeGuardrailItem({ url: "https://example.com/tech-1", headline: "Ars enterprise AI infra story 1", tag: "TECHNOLOGY", source_domain: "arstechnica.com", source_type: "reported_media", _score: 0.97 }),
      makeGuardrailItem({ url: "https://example.com/tech-2", headline: "Ars enterprise AI infra story 2", tag: "TECHNOLOGY", source_domain: "arstechnica.com", source_type: "reported_media", _score: 0.96 }),
      makeGuardrailItem({ url: "https://example.com/tech-3", headline: "Ars enterprise AI infra story 3", tag: "TECHNOLOGY", source_domain: "arstechnica.com", source_type: "reported_media", _score: 0.95 }),
      makeGuardrailItem({ url: "https://example.com/tech-overflow", headline: "Ars enterprise AI infra story 4", tag: "TECHNOLOGY", source_domain: "arstechnica.com", source_type: "reported_media", _score: 0.94 }),
      makeGuardrailItem({ url: "https://example.com/tech-weak", headline: "Lower-value platform trend story", tag: "TECHNOLOGY", source_domain: "wired.com", source_type: "reported_media", _score: 0.80 }),
      makeGuardrailItem({ url: "https://example.com/tech-last", headline: "Another lower-value platform trend story", tag: "TECHNOLOGY", source_domain: "theverge.com", source_type: "reported_media", source_tier: "standard", _score: 0.78 }),
    ],
    selectionTarget: 5,
    tagPriority: { technology: 1 },
    runMode: "scheduled",
    digestDateKey: "2026-03-27",
    dueUsersCount: 1,
    standardFetchCallsPlanned: 1,
    nowMs,
  });
  assert.ok(technologyOut.selected.some((item) => item.url === "https://example.com/tech-overflow"));
  assert.strictEqual(technologyOut.selected.filter((item) => item.source_domain === "arstechnica.com").length, 4);

  const lifeSciencesRuntime = buildGuardrailRuntime();
  const lifeSciencesOut = await lifeSciencesRuntime.selectForEnrichment({
    allItems: [
      makeGuardrailItem({ url: "https://example.com/ls-1", headline: "Biotech funding slump reshapes startup runway", tag: "LIFE SCIENCES", source_domain: "fiercebiotech.com", _score: 0.95 }),
      makeGuardrailItem({ url: "https://example.com/ls-2", headline: "Large-cap pharma unit sale redirects oncology capital", tag: "LIFE SCIENCES", source_domain: "fiercepharma.com", _score: 0.93 }),
      makeGuardrailItem({ url: "https://example.com/ls-3", headline: "Cell therapy spinout takes Bristol assets", tag: "LIFE SCIENCES", source_domain: "biopharmadive.com", _score: 0.91 }),
      makeGuardrailItem({ url: "https://example.com/ls-official", headline: "Drug Master Files (DMFs)", tag: "LIFE SCIENCES", source_domain: "fda.gov", source_type: "primary_official", retrieval_origin: "broker_official", source_tier: "premium", summary: "FDA filing documentation for drug master files.", _score: 0.90 }),
      makeGuardrailItem({ url: "https://example.com/ls-weak", headline: "General biotech market tracker", tag: "LIFE SCIENCES", source_domain: "example.com", source_tier: "standard", _score: 0.82 }),
      makeGuardrailItem({ url: "https://example.com/ls-reserve", headline: "Reverse merger advances cell therapy pipeline", tag: "LIFE SCIENCES", source_domain: "biopharmadive.com", _score: 0.89 }),
      makeGuardrailItem({ url: "https://example.com/ls-reserve-2", headline: "Drug compounding startup raises follow-on round", tag: "LIFE SCIENCES", source_domain: "fiercebiotech.com", published_date: "2026-03-26T04:00:00.000Z", _score: 0.88 }),
    ],
    selectionTarget: 5,
    tagPriority: { "life sciences": 1 },
    runMode: "scheduled",
    digestDateKey: "2026-03-27",
    dueUsersCount: 1,
    standardFetchCallsPlanned: 1,
    nowMs,
  });
  assert.ok(!lifeSciencesOut.selected.some((item) => item.url === "https://example.com/ls-official"));
  assert.ok(lifeSciencesOut.selected.some((item) => item.url === "https://example.com/ls-reserve"));

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

  const rankingIncidents = [];
  const rankingRuntime = createDigestOrchestratorSelectionRuntime({
    CONFIG: {
      topics: [{ tag: "AI×TECH" }],
      digest: {
        itemCount: 5,
        crossDayDedupDays: 3,
        minBackfillItemsAfterDedup: 3,
        maxItemsPerSourceDomain: 2,
        ranking: {
          primary_version: "v2",
          shadow_version: "v1",
          live_topic_tags: ["AI×TECH"],
          same_domain_penalty: {
            enabled: true,
            min_competitive_gap_for_bypass: 0.10,
            penalties: { second: 0.03, third: 0.08, fourth_or_more: 0.15 },
          },
          same_domain_guardrail: {
            enabled: false,
            max_per_topic: 3,
          },
          kill_switch: {
            enabled: true,
            action: "fallback_to_v1",
            thresholds: {
              min_selection_overlap_pct: 0.40,
              max_trusted_share_drop_pct: 20,
              max_avg_final_rank_drop: 0.15,
            },
          },
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
    emitDigestIncident: async (type) => { rankingIncidents.push(type); },
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

  const rankingOut = await rankingRuntime.selectForEnrichment({
    allItems: [
      { url: "https://example.com/std1", headline: "Std 1", tag: "AI×TECH", published_date: "2026-03-27T11:55:00.000Z", source_domain: "std1.example.com", retrieval_origin: "broker_publisher_feed", source_type: "reported_media", source_tier: "standard", strategic_value: 0.95, source_authority: 0.45, final_rank_score: 0.95 },
      { url: "https://example.com/std2", headline: "Std 2", tag: "AI×TECH", published_date: "2026-03-27T11:54:00.000Z", source_domain: "std2.example.com", retrieval_origin: "broker_publisher_feed", source_type: "reported_media", source_tier: "standard", strategic_value: 0.94, source_authority: 0.45 },
      { url: "https://example.com/std3", headline: "Std 3", tag: "AI×TECH", published_date: "2026-03-27T11:53:00.000Z", source_domain: "std3.example.com", retrieval_origin: "broker_publisher_feed", source_type: "reported_media", source_tier: "standard", strategic_value: 0.93, source_authority: 0.45 },
      { url: "https://example.com/tr1", headline: "Trusted 1", tag: "AI×TECH", published_date: "2026-03-27T11:52:00.000Z", source_domain: "tr1.example.com", retrieval_origin: "broker_publisher_feed", source_type: "reported_media", source_tier: "strong", strategic_value: 0.70, source_authority: 0.9 },
      { url: "https://example.com/tr2", headline: "Trusted 2", tag: "AI×TECH", published_date: "2026-03-27T11:51:00.000Z", source_domain: "tr2.example.com", retrieval_origin: "broker_publisher_feed", source_type: "reported_media", source_tier: "strong", strategic_value: 0.69, source_authority: 0.9 },
      { url: "https://example.com/tr3", headline: "Trusted 3", tag: "AI×TECH", published_date: "2026-03-27T11:50:00.000Z", source_domain: "tr3.example.com", retrieval_origin: "broker_publisher_feed", source_type: "reported_media", source_tier: "strong", strategic_value: 0.68, source_authority: 0.9 },
      { url: "https://example.com/tr4", headline: "Trusted 4", tag: "AI×TECH", published_date: "2026-03-27T11:49:00.000Z", source_domain: "tr4.example.com", retrieval_origin: "broker_publisher_feed", source_type: "reported_media", source_tier: "strong", strategic_value: 0.67, source_authority: 0.9 },
    ],
    selectionTarget: 5,
    tagPriority: { "ai×tech": 1 },
    runMode: "scheduled",
    digestDateKey: "2026-03-27",
    dueUsersCount: 1,
    standardFetchCallsPlanned: 7,
    nowMs,
  });

  assert.ok(
    rankingOut.selectedByTopic["AI×TECH"].filter((item) => String(item?.source_tier || "").toLowerCase() !== "standard").length >= 4,
    "kill switch should fall back to V1 trusted mix"
  );
  assert.strictEqual(rankingOut.selectionDiagnostics.topic_selection_audit[0].kill_switch_triggered, true);
  assert.strictEqual(rankingOut.selectionDiagnostics.topic_selection_audit[0].ranking_primary_version, "v2");
  assert.strictEqual(rankingOut.selectionDiagnostics.topic_selection_audit[0].ranking_live_version, "v1");
})();
