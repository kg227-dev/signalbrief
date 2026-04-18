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

  // Test 4: topic selection audit persists per-item rejection reasons from the active fallback selector
  try {
    const runtime = createDigestOrchestratorSelectionRuntime(makeDeps());
    const result = await runtime.selectForEnrichment({
      allItems: [
        {
          ...itemAgedHours(2, "TECHNOLOGY", "https://audit.example.com/1"),
          source_domain: "news.example.com",
          source_type: "reported_media",
        },
        {
          ...itemAgedHours(3, "TECHNOLOGY", "https://audit.example.com/2/analysis"),
          source_domain: "analysis-a.example.com",
          source_type: "analysis_blog",
          originality_profile: "derived_synthesis",
          content_flags: ["generic_commentary"],
        },
        {
          ...itemAgedHours(4, "TECHNOLOGY", "https://audit.example.com/3/analysis"),
          source_domain: "analysis-b.example.com",
          source_type: "analysis_blog",
          originality_profile: "derived_synthesis",
          content_flags: ["generic_commentary"],
        },
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
    assert.strictEqual(topicAudit.selected_count, 2, "selected_count should reflect the active fallback selector output");
    assert.ok(
      (topicAudit.rejection_reason_counts.selection_commentary_cap || topicAudit.rejection_reason_counts.selection_not_selected) === 1,
      "should retain the rejected commentary candidate in audit counts"
    );
    assert.strictEqual(topicAudit.candidates.filter((item) => item.selected === true).length, 2, "two candidates selected");
    assert.strictEqual(topicAudit.candidates.filter((item) => item.selected !== true).length, 1, "one candidate rejected");
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

  // Test 8: trust guardrail can exceed source cap by one to replace a weaker standard slot with a trusted reserve item
  try {
    const runtime = createDigestOrchestratorSelectionRuntime(makeDeps({
      CONFIG: {
        topics: [{ tag: "TECHNOLOGY" }],
        digest: {
          crossDayDedupDays: 3,
          maxItemsPerTag: 5,
          maxItemsPerSourceDomain: 3,
          trustGuardrail: {
            minTrustedItemsPerTopic: 4,
            aspirationalTrustedItemsPerTopic: 4,
          },
        },
      },
    }));
    const result = await runtime.selectForEnrichment({
      allItems: [
        {
          ...itemAgedHours(1, "TECHNOLOGY", "https://tech.example.com/std-1"),
          headline: "Standard but higher raw score",
          source_domain: "std.example.com",
          source_type: "reported_media",
          source_tier: "standard",
          _score: 0.95,
        },
        {
          ...itemAgedHours(2, "TECHNOLOGY", "https://tech.example.com/trusted-1"),
          headline: "Trusted 1",
          source_domain: "ars.example.com",
          source_type: "reported_media",
          source_tier: "strong",
          _score: 0.92,
        },
        {
          ...itemAgedHours(3, "TECHNOLOGY", "https://tech.example.com/trusted-2"),
          headline: "Trusted 2",
          source_domain: "ars.example.com",
          source_type: "reported_media",
          source_tier: "strong",
          _score: 0.91,
        },
        {
          ...itemAgedHours(4, "TECHNOLOGY", "https://tech.example.com/trusted-3"),
          headline: "Trusted 3",
          source_domain: "ars.example.com",
          source_type: "reported_media",
          source_tier: "strong",
          _score: 0.90,
        },
        {
          ...itemAgedHours(5, "TECHNOLOGY", "https://tech.example.com/trusted-4"),
          headline: "Trusted 4",
          source_domain: "ars.example.com",
          source_type: "reported_media",
          source_tier: "strong",
          _score: 0.86,
        },
        {
          ...itemAgedHours(6, "TECHNOLOGY", "https://tech.example.com/std-2"),
          headline: "Standard filler",
          source_domain: "filler.example.com",
          source_type: "reported_media",
          source_tier: "standard",
          _score: 0.54,
        },
        {
          ...itemAgedHours(7, "TECHNOLOGY", "https://tech.example.com/trusted-5"),
          headline: "Trusted 5",
          source_domain: "wired.example.com",
          source_type: "reported_media",
          source_tier: "strong",
          _score: 0.85,
        },
      ],
      selectionTarget: 5,
      customTags: [],
      tagPriority: { technology: 1 },
      runMode: "scheduled",
      digestDateKey: "2026-03-25",
      dueUsersCount: 1,
      standardFetchCallsPlanned: 1,
    });
    assert.strictEqual(result.selected.length, 5);
    assert.strictEqual(result.selected.filter((item) => item.source_tier === "strong").length, 5);
    assert.ok(result.selected.some((item) => item.url === "https://tech.example.com/trusted-4"));
    assert.ok(result.selected.some((item) => item.url === "https://tech.example.com/trusted-5"));
    assert.ok(!result.selected.some((item) => item.url === "https://tech.example.com/std-1"));
    console.log("✓ Test 8: guardrail upgrades a standard slot with capped trusted reserve");
    passed++;
  } catch (e) {
    console.error("✗ Test 8:", e.message);
    failed++;
  }

  // Test 9: trust guardrail can replace a low-signal official trusted item with a better trusted reserve item
  try {
    const runtime = createDigestOrchestratorSelectionRuntime(makeDeps({
      CONFIG: {
        topics: [{ tag: "INDUSTRIALS" }],
        digest: {
          crossDayDedupDays: 3,
          maxItemsPerTag: 5,
          maxItemsPerSourceDomain: 3,
          trustGuardrail: {
            minTrustedItemsPerTopic: 4,
            aspirationalTrustedItemsPerTopic: 4,
          },
        },
      },
    }));
    const result = await runtime.selectForEnrichment({
      allItems: [
        {
          ...itemAgedHours(1, "INDUSTRIALS", "https://industrial.example.com/trusted-1"),
          headline: "Supply chain trusted 1",
          source_domain: "supply.example.com",
          source_type: "trade_specialist",
          source_tier: "strong",
          _score: 0.93,
        },
        {
          ...itemAgedHours(2, "INDUSTRIALS", "https://industrial.example.com/trusted-2"),
          headline: "Supply chain trusted 2",
          source_domain: "supply.example.com",
          source_type: "trade_specialist",
          source_tier: "strong",
          _score: 0.92,
        },
        {
          ...itemAgedHours(3, "INDUSTRIALS", "https://industrial.example.com/trusted-3"),
          headline: "Supply chain trusted 3",
          source_domain: "supply.example.com",
          source_type: "trade_specialist",
          source_tier: "strong",
          _score: 0.91,
        },
        {
          ...itemAgedHours(4, "INDUSTRIALS", "https://industrial.example.com/trusted-4"),
          headline: "Supply chain trusted 4",
          source_domain: "supply.example.com",
          source_type: "trade_specialist",
          source_tier: "strong",
          _score: 0.87,
        },
        {
          ...itemAgedHours(5, "INDUSTRIALS", "https://industrial.example.com/official"),
          headline: "Notice of rulemaking for industrial tariff cost recovery",
          summary: "The rule changes pricing and compliance costs for factory operators.",
          source_domain: "federalregister.gov",
          source_type: "primary_official",
          source_tier: "premium",
          procedural_notice: true,
          procedural_notice_has_strategic_shift: true,
          _score: 0.84,
        },
        {
          ...itemAgedHours(6, "INDUSTRIALS", "https://industrial.example.com/std-1"),
          headline: "Industrial standard filler",
          source_domain: "filler.example.com",
          source_type: "reported_media",
          source_tier: "standard",
          _score: 0.83,
        },
        {
          ...itemAgedHours(7, "INDUSTRIALS", "https://industrial.example.com/trusted-5"),
          headline: "Supply chain trusted 5",
          source_domain: "manufacturing.example.com",
          source_type: "trade_specialist",
          source_tier: "strong",
          _score: 0.86,
        },
      ],
      selectionTarget: 5,
      customTags: [],
      tagPriority: { industrials: 1 },
      runMode: "scheduled",
      digestDateKey: "2026-03-25",
      dueUsersCount: 1,
      standardFetchCallsPlanned: 1,
    });
    assert.strictEqual(result.selected.length, 5);
    assert.strictEqual(result.selected.filter((item) => item.source_tier === "strong").length, 5);
    assert.ok(result.selected.some((item) => item.url === "https://industrial.example.com/trusted-4"));
    assert.ok(result.selected.some((item) => item.url === "https://industrial.example.com/trusted-5"));
    assert.ok(!result.selected.some((item) => item.url === "https://industrial.example.com/official"));
    console.log("✓ Test 9: guardrail upgrades out low-signal official trusted slots");
    passed++;
  } catch (e) {
    console.error("✗ Test 9:", e.message);
    failed++;
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run();
