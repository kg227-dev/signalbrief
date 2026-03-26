"use strict";

const assert = require("assert");
const { createDigestOrchestratorSelectionRuntime } = require("./digest-orchestrator-selection-runtime");

async function main() {
  let archiveFallbackCalls = 0;
  const incidents = [];

  const runtime = createDigestOrchestratorSelectionRuntime({
    CONFIG: {
      digest: {
        scoring: {},
        itemCount: 5,
        maxDiscoveryItemsPerTopic: 1,
      },
    },
    log() {},
    createDigestPolicies() {
      return {
        rankingPolicy: { repeatPenalty: 0 },
        depthPolicy: { defaultItemCount: 5 },
      };
    },
    dedupAgainstRecentArchives(items) {
      return {
        items,
        removed: 0,
        archive_days_used: 0,
        backfilled: 0,
      };
    },
    buildRecentRepeatIndex() {
      return { urlKeys: new Set(), headlineKeys: new Set(), days: 3 };
    },
    selectItems(items, opts = {}) {
      return (Array.isArray(items) ? items : []).slice(0, Number(opts.maxItems || 5));
    },
    loadRecentArchiveItems() {
      archiveFallbackCalls += 1;
      return [{
        tag: "TECHNOLOGY",
        headline: "Archive rescue item",
        url: "https://archive.example.com/1",
      }];
    },
    loadRecentArchiveByDate() {
      return [];
    },
    buildRepeatHistory() {
      return new Map();
    },
    filterItemsAgainstHistory(items) {
      return { items, suppressedCount: 0, suppressedFrequentCount: 0, streaks: [] };
    },
    buildRepetitionNote() {
      return "";
    },
    async emitDigestIncident(code, message, metadata) {
      incidents.push({ code, message, metadata });
    },
    articleAgeTooOld(item, maxAgeHours) {
      const ts = Date.parse(String(item?.published_date || ""));
      const now = Date.parse("2026-03-25T12:00:00.000Z");
      const ageHours = (now - ts) / (1000 * 60 * 60);
      return ageHours > maxAgeHours;
    },
    classifyStoryRelationship() {
      return "new";
    },
    loadEditorialOverrides() {
      return { pins: [], excludes: [], source_suppressions: [] };
    },
    editorialOverridesPath: "/tmp/unused-editorial-overrides.json",
    isUrlExcluded() {
      return false;
    },
    isDomainSuppressed() {
      return false;
    },
    getPinsForDate() {
      return [];
    },
  });

  await assert.rejects(
    runtime.selectForEnrichment({
      allItems: [{
        tag: "TECHNOLOGY",
        headline: "Stale targeted item",
        summary: "Older than 48h and should be rejected even off-schedule.",
        url: "https://example.com/stale",
        source_domain: "example.com",
        published_date: "2026-03-22T00:00:00.000Z",
      }],
      selectionTarget: 5,
      customTags: [],
      tagPriority: ["TECHNOLOGY"],
      runMode: "targeted",
      digestDateKey: "2026-03-25",
      dueUsersCount: 1,
      standardFetchCallsPlanned: 1,
      scoringConfig: {},
    }),
    /No live items available after freshness and selection filters; digest aborted/,
    "targeted runs must obey the hard 48h freshness cap and abort instead of falling back to archive content"
  );

  assert.strictEqual(archiveFallbackCalls, 0, "selection runtime must not use archive rescue fallback in the active path");
  assert.deepStrictEqual(
    incidents.map((entry) => entry.code),
    ["no-selectable-items"],
    "selection runtime should emit the no-selectable-items incident when live candidates are empty"
  );

  console.log("selection runtime enforces live-only 48h freshness in MVP mode ✓");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
