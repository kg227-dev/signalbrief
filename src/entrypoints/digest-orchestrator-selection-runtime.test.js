"use strict";
const assert = require("assert");
const {
  canonicalizeCandidateTopicTags,
  createDigestOrchestratorSelectionRuntime,
  prepareSelectionCandidates,
} = require("./digest-orchestrator-selection-runtime");
const { articleAgeTooOld } = require("../digest/runtime/digest-data-fetch-items-runtime");

function makeDeps(overrides = {}) {
  return {
    CONFIG: {
      topics: [
        { tag: "HEALTHCARE" },
        { tag: "LIFE SCIENCES" },
        { tag: "TECHNOLOGY" },
      ],
      digest: { crossDayDedupDays: 3, maxItemsPerTag: 5, maxItemsPerSourceDomain: 2 },
    },
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
    classifyStoryRelationship: () => "new",
    isUrlExcluded: () => false,
    isDomainSuppressed: () => false,
    getPinsForDate: () => [],
    loadEditorialOverrides: () => ({ pins: [], excludes: [], source_suppressions: [] }),
    editorialOverridesPath: null,
    annotateEditorialSignals: (items) => items,
    buildStorylineCandidates: (items) => items,
    assignCanonicalTopic: (topicTags, item) => item?.tag || (Array.isArray(topicTags) ? topicTags[0] : null),
    scoreBestFitTopicTag: () => 0,
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

  // Test 5: best-fit topic reassignment only happens when the new topic scores higher
  try {
    const original = {
      tag: "TECHNOLOGY",
      headline: "Hospital software merger expands provider network",
      url: "https://topic-fit.example.com/1",
    };
    const result = canonicalizeCandidateTopicTags([original], {
      configTopics: [{ tag: "HEALTHCARE" }, { tag: "TECHNOLOGY" }],
      assignCanonicalTopic: () => "HEALTHCARE",
      scoreBestFitTopicTag: (tag) => (tag === "HEALTHCARE" ? 10 : 2),
    });
    assert.strictEqual(result.bestFitTopicReassignedCount, 1, "should count best-fit topic reassignment");
    assert.strictEqual(result.items[0].tag, "HEALTHCARE", "should move item to stronger topic");
    assert.strictEqual(result.items[0].original_tag, "TECHNOLOGY", "should preserve original tag for auditability");

    const noChange = canonicalizeCandidateTopicTags([original], {
      configTopics: [{ tag: "HEALTHCARE" }, { tag: "TECHNOLOGY" }],
      assignCanonicalTopic: () => "HEALTHCARE",
      scoreBestFitTopicTag: () => 4,
    });
    assert.strictEqual(noChange.bestFitTopicReassignedCount, 0, "should not reassign when score is not stronger");
    assert.strictEqual(noChange.items[0].tag, "TECHNOLOGY", "should keep original topic when fit is not stronger");
    console.log("✓ Test 5: best-fit topic reassignment is score-gated");
    passed++;
  } catch (e) {
    console.error("✗ Test 5:", e.message);
    failed++;
  }

  // Test 6: candidate preparation collapses same-story duplicates and attaches repeat metadata
  try {
    const prepared = prepareSelectionCandidates([
      {
        tag: "TECHNOLOGY",
        headline: "AI startup signs hospital deal",
        url: "https://story.example.com/1",
      },
      {
        tag: "TECHNOLOGY",
        headline: "AI startup signs hospital deal update",
        url: "https://story.example.com/1?dup=1",
      },
    ], {
      configTopics: [{ tag: "HEALTHCARE" }, { tag: "TECHNOLOGY" }],
      buildStorylineCandidates: (items) => [items[0]],
      annotateEditorialSignals: (items) => items.map((item, index) => ({
        ...item,
        storyline_key: `story-${index + 1}`,
        entity_keys: ["hospital"],
        content_flags: ["m_and_a"],
      })),
      assignCanonicalTopic: () => "HEALTHCARE",
      scoreBestFitTopicTag: (tag) => (tag === "HEALTHCARE" ? 9 : 3),
    });
    assert.strictEqual(prepared.storylineClusterRemovedCount, 1, "should collapse duplicate story candidates");
    assert.strictEqual(prepared.bestFitTopicReassignedCount, 1, "should track reassigned topic count");
    assert.strictEqual(prepared.items.length, 1, "should keep one representative candidate");
    assert.strictEqual(prepared.items[0].tag, "HEALTHCARE", "should carry best-fit topic into prepared pool");
    assert.strictEqual(prepared.items[0].storyline_key, "story-1", "should attach storyline metadata before history filter");
    assert.deepStrictEqual(prepared.items[0].entity_keys, ["hospital"], "should attach entity keys before history filter");
    assert.deepStrictEqual(prepared.items[0].content_flags, ["m_and_a"], "should attach content flags before history filter");
    console.log("✓ Test 6: preparation collapses duplicates and annotates repeat metadata");
    passed++;
  } catch (e) {
    console.error("✗ Test 6:", e.message);
    failed++;
  }

  // Test 7: live selection path carries prepared metadata into repeat-history filtering
  try {
    const historyInputs = [];
    const runtime = createDigestOrchestratorSelectionRuntime(makeDeps({
      buildStorylineCandidates: (items) => [items[0]],
      annotateEditorialSignals: (items) => items.map((item) => ({
        ...item,
        storyline_key: "provider-ai-deal",
        entity_keys: ["hospital", "ai startup"],
        content_flags: ["commercial_partnership"],
      })),
      assignCanonicalTopic: () => "HEALTHCARE",
      scoreBestFitTopicTag: (tag) => (tag === "HEALTHCARE" ? 12 : 1),
      filterItemsAgainstHistory: (items) => {
        historyInputs.push(...items);
        return { items, suppressedCount: 0, suppressedFrequentCount: 0, streaks: [] };
      },
      selectItemsDetailed: (items, opts) => ({
        selected: items.slice(0, opts.maxItems),
        rejected: items.slice(opts.maxItems).map((item) => ({ item, reason: "selection_not_selected" })),
      }),
    }));
    const result = await runtime.selectForEnrichment({
      allItems: [
        itemAgedHours(2, "TECHNOLOGY", "https://selection.example.com/1"),
        itemAgedHours(3, "TECHNOLOGY", "https://selection.example.com/1?dup=1"),
      ].map((item, index) => ({
        ...item,
        headline: index === 0
          ? "AI startup signs hospital deal"
          : "AI startup signs hospital deal follow-on",
      })),
      selectionTarget: 5,
      customTags: [],
      tagPriority: {},
      runMode: "scheduled",
      digestDateKey: "2026-03-25",
      dueUsersCount: 1,
      standardFetchCallsPlanned: 1,
    });
    assert.strictEqual(historyInputs.length, 1, "history filter should see clustered candidate pool");
    assert.strictEqual(historyInputs[0].storyline_key, "provider-ai-deal", "history filter should receive storyline metadata");
    assert.strictEqual(historyInputs[0].tag, "HEALTHCARE", "history filter should receive best-fit topic");
    assert.strictEqual(result.selectionDiagnostics.storyline_cluster_removed_count, 1, "should surface collapsed storyline count");
    assert.strictEqual(result.selectionDiagnostics.best_fit_topic_reassigned_count, 1, "should surface best-fit topic count");
    assert.strictEqual(result.selected.length, 1, "selection should operate on prepared pool");
    assert.strictEqual(result.selected[0].tag, "HEALTHCARE", "selected item should retain reassigned topic");
    console.log("✓ Test 7: live selection path uses prepared topic and repeat metadata");
    passed++;
  } catch (e) {
    console.error("✗ Test 7:", e.message);
    failed++;
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run();
