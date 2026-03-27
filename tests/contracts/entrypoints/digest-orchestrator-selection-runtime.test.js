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
const { createDigestOrchestratorSelectionRuntime, splitByFreshnessTiers } = runtime;
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

  const incidents = [];
  const selectionRuntime = createDigestOrchestratorSelectionRuntime({
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
  });

  const selectedOut = await selectionRuntime.selectForEnrichment({
    allItems: [
      { url: "https://example.com/h1", headline: "H1", tag: "HEALTHCARE", published_date: "2026-03-27T10:00:00.000Z" },
      { url: "https://example.com/h2", headline: "H2", tag: "HEALTHCARE", published_date: "2026-03-27T09:00:00.000Z" },
      { url: "https://example.com/h3", headline: "H3", tag: "HEALTHCARE", published_date: "2026-03-26T20:00:00.000Z" },
      { url: "https://example.com/t1", headline: "T1", tag: "TECHNOLOGY", published_date: "2026-03-27T08:00:00.000Z" },
      { url: "https://example.com/t2", headline: "T2", tag: "TECHNOLOGY", published_date: "2026-03-27T07:00:00.000Z" },
      { url: "https://example.com/t3", headline: "T3", tag: "TECHNOLOGY", published_date: "2026-03-26T18:00:00.000Z" },
    ],
    selectionTarget: 5,
    tagPriority: { healthcare: 1, technology: 1 },
    runMode: "scheduled",
    digestDateKey: "2026-03-27",
    dueUsersCount: 2,
    standardFetchCallsPlanned: 14,
  });

  assert.strictEqual(selectedOut.selected.length, 6);
  assert.strictEqual(selectedOut.selectionDiagnostics.topic_selection_audit.length, 2);
  assert.strictEqual(selectedOut.selectionDiagnostics.selection_rejection_counts.selection_not_selected || 0, 0);
  assert.deepStrictEqual(incidents, []);

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
