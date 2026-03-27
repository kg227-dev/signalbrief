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
const { createDigestOrchestratorSelectionRuntime, computeMaxCustomItems } = runtime;
assertModuleExports(() => runtime, TARGET_REL);

(async () => {
  assert.strictEqual(
    computeMaxCustomItems({ configuredMaxCustom: 4, selectionTarget: 10, customTags: ["A"] }),
    4
  );
  assert.strictEqual(
    computeMaxCustomItems({ configuredMaxCustom: NaN, selectionTarget: 10, customTags: ["A"] }),
    4
  );

  const incidents = [];
  const logs = [];
  const selectionRuntime = createDigestOrchestratorSelectionRuntime({
    CONFIG: {
      digest: {
        crossDayDedupDays: 3,
        minBackfillItemsAfterDedup: 3,
        maxItemsPerTag: 2,
        maxItemsPerSourceDomain: 2,
        maxCustomItemsPerRun: 3,
      },
    },
    log: (line) => logs.push(String(line || "")),
    createDigestPolicies: () => ({
      rankingPolicy: { repeatPenalty: 0.5, minBaseScoreForFinal: 6.5 },
      depthPolicy: { minFilteredItems: 3, defaultItemCount: 5 },
    }),
    dedupAgainstRecentArchives: (items) => ({
      items: items.slice(),
      removed: 1,
      archive_days_used: 3,
      backfilled: 0,
    }),
    buildRecentRepeatIndex: () => ({
      days: 3,
      urlKeys: new Set(["u"]),
      headlineKeys: new Set(),
    }),
    loadRecentArchiveByDate: () => [],
    buildRepeatHistory: () => new Map(),
    filterItemsAgainstHistory: (items) => ({
      items: items.slice(),
      suppressedCount: 0,
      suppressedFrequentCount: 0,
      streaks: [],
    }),
    buildRepetitionNote: () => "Repeat handling active",
    selectItems: (items) => items.slice(0, 2),
    selectItemsDetailed: (items) => ({
      selected: items.slice(0, 2),
      rejected: items.slice(2).map((item) => ({ item, reason: "selection_not_selected" })),
    }),
    emitDigestIncident: async (...args) => {
      incidents.push(args);
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
      { id: 1, url: "https://example.com/1", published_date: "2026-03-26T10:00:00.000Z" },
      { id: 2, url: "https://example.com/2", published_date: "2026-03-26T09:00:00.000Z" },
      { id: 3, url: "https://example.com/3", published_date: "2026-03-26T08:00:00.000Z" },
    ],
    selectionTarget: 5,
    customTags: ["GLP-1"],
    tagPriority: { technology: 1 },
    runMode: "scheduled",
    digestDateKey: "2026-03-26",
    dueUsersCount: 2,
    standardFetchCallsPlanned: 17,
  });

  assert.strictEqual(selectedOut.selected.length, 2);
  assert.strictEqual(selectedOut.repeatPenalty, 0.5);
  assert.strictEqual(selectedOut.rankingPolicy.minBaseScoreForFinal, 6.5);
  assert.strictEqual(selectedOut.depthPolicy.defaultItemCount, 5);
  assert.strictEqual(selectedOut.selectionDiagnostics.candidate_pool_before_dedup, 3);
  assert.strictEqual(selectedOut.selectionDiagnostics.candidate_pool_after_dedup, 3);
  assert.strictEqual(selectedOut.selectionDiagnostics.selection_rejection_counts.selection_not_selected, 1);
  assert.strictEqual(selectedOut.selectionDiagnostics.topic_selection_audit.length, 1);
  assert.strictEqual(selectedOut.selectionDiagnostics.topic_selection_audit[0].candidates.length, 3);
  assert.ok(logs.some((line) => line.includes("Cross-day dedup removed")));
  assert.ok(logs.some((line) => line.includes("Freshness penalty active")));
  assert.strictEqual(incidents.length, 0);

  const failIncidents = [];
  const failRuntime = createDigestOrchestratorSelectionRuntime({
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
    emitDigestIncident: async (type) => {
      failIncidents.push(type);
    },
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
      selectionTarget: 3,
      customTags: [],
      tagPriority: {},
      runMode: "scheduled",
      digestDateKey: "2026-03-26",
      dueUsersCount: 1,
      standardFetchCallsPlanned: 17,
    }),
    /No live items available after freshness and selection filters; digest aborted/
  );
  assert.deepStrictEqual(failIncidents, ["no-selectable-items"]);
})();
