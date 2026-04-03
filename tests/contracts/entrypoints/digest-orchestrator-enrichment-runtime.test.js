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
      TECHNOLOGY: [makeSelectedCandidate("https://example.com/6", "Reserve")],
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

testBackfillsDroppedWriteupWithSameTopicReserve().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
