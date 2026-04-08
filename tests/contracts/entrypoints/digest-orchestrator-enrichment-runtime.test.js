"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/entrypoints/digest-orchestrator-enrichment-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
const { createDigestOrchestratorEnrichmentRuntime } = runtime;
assertModuleExports(() => runtime, TARGET_REL);

function makeSelectedCandidate(url, headline) {
  return {
    url,
    headline,
    tag: "TECHNOLOGY",
    source_domain: new URL(url).hostname,
    retrieval_origin: "broker_publisher_feed",
    source_type: "reported_media",
    source_policy: "preferred",
    source_tier: 1,
    source_authority: 0.92,
    topic_fit: 0.9,
    published_date: "2026-03-27T10:00:00.000Z",
    baseScore: 8.2,
    strategic_value: 0.82,
    cross_source_count: 2,
    _score: 0.82,
  };
}

function withPassingWriteup(item, overrides = {}) {
  return {
    ...item,
    summary: "Acme repriced enterprise AI contracts for new buyers.",
    signal_shift: "Acme repriced AI contracts",
    implication_type: "cost",
    wim_brief: "Acme pricing reset tightens enterprise software budgets this quarter.",
    wim: "Acme repriced AI contracts, forcing CIO procurement teams to cut lower priority deployments as enterprise software pricing rises this quarter.",
    writeup_status: "model_pass",
    writeup_attempt_count: 1,
    writeup_rejection_reasons: [],
    writeup_version: "v2",
    ...overrides,
  };
}

function makeReserveState(strongReserve = [], standardReserve = []) {
  return {
    strongReserve: strongReserve.slice(),
    standardReserve: standardReserve.slice(),
    allReserve: [...strongReserve, ...standardReserve],
  };
}

async function testBackfillsDroppedWriteupWithSameTopicReserve() {
  const firstBatch = [
    { ...makeSelectedCandidate("https://example.com/1", "One"), wim: "One", wim_brief: "One", signal_shift: "One changed", implication_type: "competition", writeup_status: "model_pass", writeup_attempt_count: 1, writeup_rejection_reasons: [], writeup_version: "v2" },
    { ...makeSelectedCandidate("https://example.com/2", "Two"), wim: null, wim_brief: null, signal_shift: null, implication_type: null, writeup_status: "failed_dropped", writeup_attempt_count: 1, writeup_rejection_reasons: ["generic_language"], writeup_version: "v2" },
    { ...makeSelectedCandidate("https://example.com/3", "Three"), wim: "Three", wim_brief: "Three", signal_shift: "Three changed", implication_type: "capital", writeup_status: "model_pass", writeup_attempt_count: 1, writeup_rejection_reasons: [], writeup_version: "v2" },
    { ...makeSelectedCandidate("https://example.com/4", "Four"), wim: "Four", wim_brief: "Four", signal_shift: "Four changed", implication_type: "workflow", writeup_status: "model_pass", writeup_attempt_count: 1, writeup_rejection_reasons: [], writeup_version: "v2" },
    { ...makeSelectedCandidate("https://example.com/5", "Five"), wim: "Five", wim_brief: "Five", signal_shift: "Five changed", implication_type: "cost", writeup_status: "model_pass", writeup_attempt_count: 1, writeup_rejection_reasons: [], writeup_version: "v2" },
  ];
  const reserveBatch = [
    { ...makeSelectedCandidate("https://example.com/6", "Reserve"), wim: "Reserve item", wim_brief: "Reserve brief", signal_shift: "Reserve changed", implication_type: "competition", writeup_status: "model_pass", writeup_attempt_count: 1, writeup_rejection_reasons: [], writeup_version: "v2" },
  ];

  let callCount = 0;
  const enrichmentRuntime = createDigestOrchestratorEnrichmentRuntime({
    enrichItems: async (items) => {
      callCount += 1;
      if (callCount === 1) {
        return {
          items: firstBatch,
          usage: { input_tokens: 10, output_tokens: 5 },
          degraded: false,
          degradation: null,
        };
      }
      return {
        items: reserveBatch,
        usage: { input_tokens: 3, output_tokens: 2 },
        degraded: false,
        degradation: null,
      };
    },
    emitDigestIncident: async () => false,
    getBackfillRejectionReason: () => null,
  });

  const selectionDiagnostics = {
    topic_selection_audit: [{
      tag: "TECHNOLOGY",
      total_candidates: 6,
      selected_count: 5,
      rejected_count: 1,
      rejection_reason_counts: { selection_pool_full: 1 },
      candidates: [
        { url: "https://example.com/1", headline: "One", selected: true, selection_reason: null },
        { url: "https://example.com/2", headline: "Two", selected: true, selection_reason: null },
        { url: "https://example.com/3", headline: "Three", selected: true, selection_reason: null },
        { url: "https://example.com/4", headline: "Four", selected: true, selection_reason: null },
        { url: "https://example.com/5", headline: "Five", selected: true, selection_reason: null },
        { url: "https://example.com/6", headline: "Reserve", selected: false, selection_reason: "selection_pool_full" },
      ],
    }],
  };

  const out = await enrichmentRuntime.enrichSelectedItems({
    selected: firstBatch.map((item) => ({ ...item })),
    selectedByTopic: {
      TECHNOLOGY: firstBatch.map((item) => makeSelectedCandidate(item.url, item.headline)),
    },
    reserveByTopic: {
      TECHNOLOGY: makeReserveState([makeSelectedCandidate("https://example.com/6", "Reserve")], []),
    },
    selectionDiagnostics,
    writeupBackfillPolicy: {
      itemsPerTopic: 5,
      maxItemsPerSourceDomain: 5,
      maxDiscoveryPerTopic: 1,
      commentaryCapPerTopic: 1,
    },
    runMode: "scheduled",
    dueUsersCount: 1,
  });

  assert.strictEqual(callCount, 2, "failed writeups should trigger same-topic reserve enrichment");
  assert.strictEqual(out.enriched.length, 5);
  assert.ok(out.enriched.some((item) => item.url === "https://example.com/6"), "reserve candidate should backfill dropped writeup");
  assert.ok(out.failedByTopic.TECHNOLOGY.some((item) => item.url === "https://example.com/2"), "failed item should remain inspectable");
  assert.strictEqual(out.selectionDiagnostics.topic_selection_audit[0].selected_count, 5);
  const droppedCandidate = out.selectionDiagnostics.topic_selection_audit[0].candidates.find((candidate) => candidate.url === "https://example.com/2");
  assert.strictEqual(droppedCandidate.selection_reason, "writeup_failed");
  assert.strictEqual(out.writeupDiagnostics.drop_count, 1);
  assert.strictEqual(out.writeupDiagnostics.final_selected_count, 5);
}

async function testTrustedFloorBackfillPrefersTrustedReserveFirst() {
  const initialRaw = [
    makeSelectedCandidate("https://example.com/21", "One"),
    makeSelectedCandidate("https://example.com/22", "Two"),
    makeSelectedCandidate("https://example.com/23", "Three"),
    makeSelectedCandidate("https://example.com/24", "Four"),
    makeSelectedCandidate("https://example.com/25", "Five"),
  ];
  const initialEnriched = [
    withPassingWriteup(initialRaw[0]),
    withPassingWriteup(initialRaw[1]),
    withPassingWriteup(initialRaw[2]),
    withPassingWriteup(initialRaw[3], {
      writeup_status: "failed_dropped",
      signal_shift: null,
      wim_brief: null,
      wim: null,
      writeup_rejection_reasons: ["provider_parse_failure"],
    }),
    withPassingWriteup(initialRaw[4], {
      writeup_status: "failed_dropped",
      signal_shift: null,
      wim_brief: null,
      wim: null,
      writeup_rejection_reasons: ["provider_parse_failure"],
    }),
  ];
  const standardReserve = {
    ...makeSelectedCandidate("https://example.com/26", "Standard reserve"),
    source_tier: "standard",
    source_authority: 0.95,
  };
  const trustedReserve = {
    ...makeSelectedCandidate("https://example.com/27", "Trusted reserve"),
    source_tier: "strong",
    source_authority: 0.62,
  };
  const calls = [];
  const enrichmentRuntime = createDigestOrchestratorEnrichmentRuntime({
    enrichItems: async (items) => {
      calls.push(items.map((item) => item.url));
      if (calls.length === 1) {
        return {
          items: initialEnriched,
          usage: { input_tokens: 10, output_tokens: 5 },
          degraded: false,
          degradation: null,
        };
      }
      return {
        items: items.map((item) => withPassingWriteup(item)),
        usage: { input_tokens: 3, output_tokens: 2 },
        degraded: false,
        degradation: null,
      };
    },
    emitDigestIncident: async () => false,
    getBackfillRejectionReason: () => null,
  });

  const out = await enrichmentRuntime.enrichSelectedItems({
    selected: initialRaw.map((item) => ({ ...item })),
    selectedByTopic: { TECHNOLOGY: initialRaw.map((item) => ({ ...item })) },
    reserveByTopic: { TECHNOLOGY: makeReserveState([trustedReserve], [standardReserve]) },
    selectionDiagnostics: {
      topic_selection_audit: [{
        tag: "TECHNOLOGY",
        total_candidates: 7,
        selected_count: 5,
        rejected_count: 2,
        rejection_reason_counts: { selection_pool_full: 2 },
        candidates: [
          ...initialRaw.map((item) => ({ url: item.url, headline: item.headline, selected: true, selection_reason: null })),
          { url: standardReserve.url, headline: standardReserve.headline, selected: false, selection_reason: "selection_pool_full" },
          { url: trustedReserve.url, headline: trustedReserve.headline, selected: false, selection_reason: "selection_pool_full" },
        ],
      }],
    },
    writeupBackfillPolicy: {
      itemsPerTopic: 5,
      maxItemsPerSourceDomain: 5,
      maxDiscoveryPerTopic: 1,
      commentaryCapPerTopic: 1,
      trustedFloor: {
        byTopic: {
          TECHNOLOGY: {
            active: true,
            minTrustedItemsPerTopic: 4,
          },
        },
      },
    },
    runMode: "scheduled",
    dueUsersCount: 1,
  });

  assert.deepStrictEqual(calls[1], [trustedReserve.url], "trusted floor should try the trusted reserve before a standard reserve");
  assert.deepStrictEqual(calls[2], [standardReserve.url], "standard reserve should remain available once the trusted floor is satisfied");
  assert.ok(out.enriched.some((item) => item.url === trustedReserve.url));
  assert.ok(out.enriched.some((item) => item.url === standardReserve.url));
  assert.strictEqual(out.enrichmentDiagnostics.item_outcomes.filter((item) => item.failure_reason === "parse_failure").length, 2);
  assert.strictEqual(
    out.selectionDiagnostics.topic_selection_audit[0].standard_tier_blocked_while_strong_available,
    true,
    "topic audit should preserve the standard-tier block invariant after writeup backfill"
  );
}

async function testProviderFailureDetailsArePreserved() {
  const initialRaw = [
    makeSelectedCandidate("https://example.com/31", "Parse failure item"),
  ];
  const enrichmentRuntime = createDigestOrchestratorEnrichmentRuntime({
    enrichItems: async () => ({
      items: [{
        ...initialRaw[0],
        writeup_status: "failed_dropped",
        writeup_attempt_count: 1,
        writeup_rejection_reasons: ["provider_parse_failure"],
      }],
      usage: { input_tokens: 10, output_tokens: 5 },
      degraded: true,
      degradation: { provider: "anthropic", reason: "parse_failure" },
      writeupDiagnostics: {
        provider_failure_details: [{
          batch_index: 0,
          provider: "anthropic",
          reason: "provider_parse_failure",
          raw_preview: "{bad-json",
          raw_length: 9,
          url: initialRaw[0].url,
        }],
      },
    }),
    emitDigestIncident: async () => false,
    getBackfillRejectionReason: () => null,
  });

  const out = await enrichmentRuntime.enrichSelectedItems({
    selected: initialRaw.map((item) => ({ ...item })),
    selectedByTopic: { TECHNOLOGY: initialRaw.map((item) => ({ ...item })) },
    reserveByTopic: { TECHNOLOGY: makeReserveState([], []) },
    selectionDiagnostics: {
      topic_selection_audit: [{
        tag: "TECHNOLOGY",
        total_candidates: 1,
        selected_count: 1,
        rejected_count: 0,
        rejection_reason_counts: {},
        candidates: [{ url: initialRaw[0].url, headline: initialRaw[0].headline, selected: true, selection_reason: null }],
      }],
    },
    writeupBackfillPolicy: {
      itemsPerTopic: 1,
      maxItemsPerSourceDomain: 5,
      maxDiscoveryPerTopic: 1,
      commentaryCapPerTopic: 1,
    },
    runMode: "scheduled",
    dueUsersCount: 1,
  });

  assert.strictEqual(out.enrichmentDiagnostics.writeup_failure_details.length, 1);
  assert.strictEqual(out.enrichmentDiagnostics.writeup_failure_details[0].topic_tag, "TECHNOLOGY");
  assert.strictEqual(out.enrichmentDiagnostics.writeup_failure_details[0].raw_preview, "{bad-json");
}

async function testStrictQualityBackfillsWeakWriteupAndSwapsMajorStory() {
  const initialSelected = [
    withPassingWriteup(makeSelectedCandidate("https://example.com/11", "One"), { _score: 0.84 }),
    withPassingWriteup(makeSelectedCandidate("https://example.com/12", "Two"), {
      writeup_status: "failed_dropped",
      signal_shift: null,
      wim_brief: null,
      wim: null,
      writeup_rejection_reasons: ["generic_language"],
      _score: 0.76,
    }),
    withPassingWriteup(makeSelectedCandidate("https://example.com/13", "Three"), { _score: 0.83 }),
    withPassingWriteup(makeSelectedCandidate("https://example.com/14", "Four"), { _score: 0.78 }),
    withPassingWriteup(makeSelectedCandidate("https://example.com/15", "Weakest"), { _score: 0.51, baseScore: 6.1, strategic_value: 0.48 }),
  ];
  const reserveRaw = [
    makeSelectedCandidate("https://example.com/16", "Backfill reserve"),
    {
      ...makeSelectedCandidate("https://example.com/17", "Official major story"),
      source_type: "primary_official",
      source_policy: "allowed",
      source_authority: 0.97,
      cross_source_count: 4,
      _score: 0.62,
      baseScore: 7.8,
      strategic_value: 0.77,
    },
  ];
  const enrichedByUrl = new Map([
    ...initialSelected.map((item) => [item.url, item]),
    ["https://example.com/16", withPassingWriteup(makeSelectedCandidate("https://example.com/16", "Backfill reserve"), { _score: 0.79 })],
    ["https://example.com/17", withPassingWriteup({
      ...reserveRaw[1],
      summary: "The agency issued a new nationwide AI procurement rule.",
    }, {
      signal_shift: "The SEC reset AI vendor disclosures",
      implication_type: "regulation",
      wim_brief: "The SEC's regulation reset tightens AI vendor compliance costs immediately.",
      wim: "The SEC reset AI vendor disclosures, which raises regulatory compliance costs and forces enterprise software sellers to slow deal cycles this quarter.",
      _score: 0.91,
    })],
  ]);

  const enrichmentRuntime = createDigestOrchestratorEnrichmentRuntime({
    CONFIG: {
      digest: {
        strict_quality: {
          enabled: true,
          max_backfills_per_slot: 2,
          max_exceptions_per_digest: 1,
        },
      },
    },
    enrichItems: async (items) => ({
      items: items.map((item) => enrichedByUrl.get(item.url) || item),
      usage: { input_tokens: 10, output_tokens: 5 },
      degraded: false,
      degradation: null,
    }),
    emitDigestIncident: async () => false,
    getBackfillRejectionReason: () => null,
  });

  const out = await enrichmentRuntime.enrichSelectedItems({
    selected: initialSelected.map((item) => ({ ...item })),
    selectedByTopic: {
      TECHNOLOGY: initialSelected.map((item) => makeSelectedCandidate(item.url, item.headline)),
    },
    reserveByTopic: {
      TECHNOLOGY: makeReserveState(reserveRaw.map((item) => ({ ...item })), []),
    },
    selectionDiagnostics: {
      topic_selection_audit: [{
        tag: "TECHNOLOGY",
        total_candidates: 7,
        selected_count: 5,
        rejected_count: 2,
        rejection_reason_counts: { selection_pool_full: 2 },
        candidates: [
          ...initialSelected.map((item) => ({ url: item.url, headline: item.headline, selected: true, selection_reason: null })),
          { url: "https://example.com/16", headline: "Backfill reserve", selected: false, selection_reason: "selection_pool_full" },
          { url: "https://example.com/17", headline: "Official major story", selected: false, selection_reason: "selection_pool_full" },
        ],
      }],
    },
    writeupBackfillPolicy: {
      itemsPerTopic: 5,
      maxItemsPerSourceDomain: 5,
      maxDiscoveryPerTopic: 1,
      commentaryCapPerTopic: 1,
    },
    runMode: "scheduled",
    dueUsersCount: 1,
    nowMs: Date.parse("2026-03-27T12:00:00.000Z"),
  });

  assert.strictEqual(out.finalSelectedByTopic.TECHNOLOGY.length, 5);
  assert.ok(out.finalSelectedByTopic.TECHNOLOGY.some((item) => item.url === "https://example.com/16"), "strict gate should backfill the weak writeup slot");
  assert.ok(out.finalSelectedByTopic.TECHNOLOGY.some((item) => item.url === "https://example.com/17"), "major story candidate should swap into the topic bucket");
  assert.ok(!out.finalSelectedByTopic.TECHNOLOGY.some((item) => item.url === "https://example.com/15"), "weakest item should be swapped out by the major story");
  assert.ok(out.failedByTopic.TECHNOLOGY.some((item) => item.url === "https://example.com/12"), "weak writeup item should remain inspectable");
  assert.ok(out.failedByTopic.TECHNOLOGY.some((item) => item.selection_reason === "major_story_swapped_out"), "swapped-out item should be logged");
  assert.strictEqual(out.selectionDiagnostics.strict_quality.major_story.swap_count, 1);
  assert.strictEqual(out.selectionDiagnostics.strict_quality.topic_buckets.TECHNOLOGY.pass, true);
  assert.strictEqual(
    out.selectionDiagnostics.topic_selection_audit[0].trusted_floor?.relaxed_reason || null,
    null,
    "trusted floor should not relax when strong-tier replacements are available"
  );
}

(async () => {
  await testBackfillsDroppedWriteupWithSameTopicReserve();
  await testTrustedFloorBackfillPrefersTrustedReserveFirst();
  await testProviderFailureDetailsArePreserved();
  await testStrictQualityBackfillsWeakWriteupAndSwapsMajorStory();
})().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
