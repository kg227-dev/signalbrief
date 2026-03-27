"use strict";
const assert = require("assert");
const { createDigestOrchestratorSelectionRuntime } = require("./digest-orchestrator-selection-runtime");
const { articleAgeTooOld } = require("../digest/runtime/digest-data-fetch-items-runtime");

function makeDeps(overrides = {}) {
  return {
    CONFIG: { digest: { crossDayDedupDays: 3, maxItemsPerTag: 5, maxItemsPerSourceDomain: 2 } },
    log: () => {},
    createDigestPolicies: () => ({ rankingPolicy: { repeatPenalty: 0 }, depthPolicy: { defaultItemCount: 5 } }),
    dedupAgainstRecentArchives: (items) => ({ items, removed: 0, backfilled: 0, archive_days_used: 3 }),
    buildRecentRepeatIndex: () => ({ urlKeys: new Set(), headlineKeys: new Set(), days: 3 }),
    selectItems: (items, opts) => items.slice(0, opts.maxItems),
    selectItemsDetailed: null,
    loadRecentArchiveItems: () => [],
    loadRecentArchiveByDate: () => [],
    buildRepeatHistory: () => new Map(),
    filterItemsAgainstHistory: (items) => ({ items, suppressedCount: 0, suppressedFrequentCount: 0, streaks: [] }),
    buildRepetitionNote: () => "",
    emitDigestIncident: async () => {},
    articleAgeTooOld,
    isUrlExcluded: () => false,
    isDomainSuppressed: () => false,
    getPinsForDate: () => [],
    loadEditorialOverrides: () => ({ pins: [], excludes: [], source_suppressions: [] }),
    editorialOverridesPath: null,
    ...overrides,
  };
}

// Use real published_date timestamps because articleAgeTooOld reads item.published_date
function itemAgedHours(ageHours, tag, url) {
  const ts = new Date(Date.now() - ageHours * 3600 * 1000).toISOString();
  return { tag, url, headline: `Item from ${url}`, published_date: ts };
}

const tests = [];
let passed = 0;
let failed = 0;

async function run() {
  // Test 1: scheduled run uses the hard 48h gate.
  try {
    const runtime = createDigestOrchestratorSelectionRuntime(makeDeps({
      selectItemsDetailed: (items, opts) => ({
        selected: items.slice(0, opts.maxItems),
        rejected: items.slice(opts.maxItems).map((item) => ({ item, reason: "selection_not_selected" })),
      }),
    }));
    const stale = itemAgedHours(60, "TECHNOLOGY", "https://a.com/1");
    const fresh = itemAgedHours(10, "TECHNOLOGY", "https://a.com/2");
    const result = await runtime.selectForEnrichment({
      allItems: [stale, fresh],
      selectionTarget: 5,
      customTags: [],
      tagPriority: {},
      runMode: "scheduled",
      digestDateKey: "2026-03-25",
      dueUsersCount: 1,
      standardFetchCallsPlanned: 2,
    });
    assert.ok(!result.selected.some(i => i.url === stale.url), "60h item should be rejected in scheduled mode");
    assert.ok(result.selected.some(i => i.url === fresh.url), "10h item should be kept in scheduled mode");
    assert.ok(Array.isArray(result.selectionDiagnostics.topic_selection_audit), "topic_selection_audit should be present");
    console.log("✓ Test 1: scheduled 48h gate");
    passed++;
  } catch(e) {
    console.error("✗ Test 1:", e.message);
    failed++;
  }

  // Test 2: scheduled run with empty live + empty archive throws
  try {
    const incidents = [];
    const deps = makeDeps({
      emitDigestIncident: async (type) => { incidents.push(type); },
      selectItems: () => [],
      loadRecentArchiveItems: () => [],
    });
    let threw = false;
    try {
      await createDigestOrchestratorSelectionRuntime(deps).selectForEnrichment({
        allItems: [], selectionTarget: 5, customTags: [], tagPriority: {},
        runMode: "scheduled", digestDateKey: "2026-03-25", dueUsersCount: 1, standardFetchCallsPlanned: 2,
      });
    } catch(err) {
      threw = true;
      assert.ok(err.message.includes("aborted"), `Expected 'aborted' in error, got: ${err.message}`);
    }
    assert.ok(threw, "Should have thrown");
    console.log("✓ Test 2: empty scheduled run throws");
    passed++;
  } catch(e) {
    console.error("✗ Test 2:", e.message);
    failed++;
  }

  // Test 3: scheduled run with archive available still throws (no rescue)
  try {
    const incidents = [];
    const archiveItems = [itemAgedHours(10, "TECHNOLOGY", "https://archive.com/1")];
    let liveCalled = false;
    const deps = makeDeps({
      emitDigestIncident: async (type) => { incidents.push(type); },
      selectItems: (pool) => {
        if (!liveCalled) { liveCalled = true; return []; }
        return pool;
      },
      loadRecentArchiveItems: () => archiveItems,
    });
    let threw = false;
    try {
      await createDigestOrchestratorSelectionRuntime(deps).selectForEnrichment({
        allItems: [], selectionTarget: 5, customTags: [], tagPriority: {},
        runMode: "scheduled", digestDateKey: "2026-03-25", dueUsersCount: 1, standardFetchCallsPlanned: 2,
      });
    } catch(err) {
      threw = true;
      assert.ok(err.message.includes("aborted"), `Expected 'aborted', got: ${err.message}`);
    }
    assert.ok(threw, "Should have thrown");
    assert.ok(incidents.includes("no-selectable-items"), `Expected incident 'no-selectable-items', got: ${JSON.stringify(incidents)}`);
    console.log("✓ Test 3: scheduled run refuses archive rescue");
    passed++;
  } catch(e) {
    console.error("✗ Test 3:", e.message);
    failed++;
  }

  // Test 4: topic selection audit persists per-item rejection reasons
  try {
    const runtime = createDigestOrchestratorSelectionRuntime(makeDeps({
      selectItemsDetailed: (items) => ({
        selected: items.slice(0, 1),
        rejected: items.slice(1).map((item, index) => ({
          item,
          reason: index === 0 ? "selection_source_cap" : "selection_not_selected",
        })),
      }),
    }));
    const result = await runtime.selectForEnrichment({
      allItems: [
        itemAgedHours(2, "TECHNOLOGY", "https://audit.example.com/1"),
        itemAgedHours(3, "TECHNOLOGY", "https://audit.example.com/2"),
        itemAgedHours(4, "TECHNOLOGY", "https://audit.example.com/3"),
      ],
      selectionTarget: 5,
      customTags: [],
      tagPriority: {},
      runMode: "scheduled",
      digestDateKey: "2026-03-25",
      dueUsersCount: 1,
      standardFetchCallsPlanned: 1,
    });
    const topicAudit = result.selectionDiagnostics.topic_selection_audit[0];
    assert.strictEqual(topicAudit.selected_count, 1, "selected_count should reflect detailed selector output");
    assert.strictEqual(topicAudit.rejection_reason_counts.selection_source_cap, 1, "should count source-cap rejection");
    assert.strictEqual(topicAudit.rejection_reason_counts.selection_not_selected, 1, "should count not-selected rejection");
    assert.strictEqual(topicAudit.candidates.filter((item) => item.selected === true).length, 1, "one candidate selected");
    assert.strictEqual(topicAudit.candidates.filter((item) => item.selected !== true).length, 2, "two candidates rejected");
    console.log("✓ Test 4: topic audit carries rejection reasons");
    passed++;
  } catch (e) {
    console.error("✗ Test 4:", e.message);
    failed++;
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run();
