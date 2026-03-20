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
    selectItems: (items) => items.slice(0, 2),
    loadRecentArchiveItems: () => [],
    emitDigestIncident: async (...args) => {
      incidents.push(args);
    },
  });

  const selectedOut = await selectionRuntime.selectForEnrichment({
    allItems: [{ id: 1 }, { id: 2 }, { id: 3 }],
    selectionTarget: 5,
    customTags: ["GLP-1"],
    tagPriority: { strategy: 1 },
    runMode: "scheduled",
    dueUsersCount: 2,
    standardFetchCallsPlanned: 17,
  });

  assert.strictEqual(selectedOut.selected.length, 2);
  assert.strictEqual(selectedOut.repeatPenalty, 0.5);
  assert.strictEqual(selectedOut.rankingPolicy.minBaseScoreForFinal, 6.5);
  assert.strictEqual(selectedOut.depthPolicy.defaultItemCount, 5);
  assert.strictEqual(selectedOut.selectionDiagnostics.candidate_pool_before_dedup, 3);
  assert.strictEqual(selectedOut.selectionDiagnostics.candidate_pool_after_dedup, 3);
  assert.ok(logs.some((line) => line.includes("Cross-day dedup removed")));
  assert.ok(logs.some((line) => line.includes("Freshness penalty active")));
  assert.strictEqual(incidents.length, 0);

  const fallbackIncidents = [];
  const fallbackRuntime = createDigestOrchestratorSelectionRuntime({
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
    dedupAgainstRecentArchives: (items) => ({ items: items.slice(), removed: 0, archive_days_used: 3, backfilled: 0 }),
    buildRecentRepeatIndex: () => ({ days: 3, urlKeys: new Set(), headlineKeys: new Set() }),
    selectItems: (items) => (items.some((row) => row.from === "fallback") ? items.slice(0, 1) : []),
    loadRecentArchiveItems: () => [{ from: "fallback" }, { from: "fallback" }],
    emitDigestIncident: async (type) => {
      fallbackIncidents.push(type);
    },
  });

  const fallbackOut = await fallbackRuntime.selectForEnrichment({
    allItems: [{ from: "live" }],
    selectionTarget: 3,
    customTags: [],
    tagPriority: {},
    runMode: "scheduled",
    dueUsersCount: 1,
    standardFetchCallsPlanned: 17,
  });
  assert.strictEqual(fallbackOut.selected.length, 1);
  assert.deepStrictEqual(fallbackIncidents, ["archive-fallback-engaged"]);

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
    selectItems: () => [],
    loadRecentArchiveItems: () => [],
    emitDigestIncident: async (type) => {
      failIncidents.push(type);
    },
  });

  await assert.rejects(
    () => failRuntime.selectForEnrichment({
      allItems: [],
      selectionTarget: 3,
      customTags: [],
      tagPriority: {},
      runMode: "scheduled",
      dueUsersCount: 1,
      standardFetchCallsPlanned: 17,
    }),
    /No items available from live fetch or archive fallback/
  );
  assert.deepStrictEqual(failIncidents, ["no-selectable-items"]);
})();
