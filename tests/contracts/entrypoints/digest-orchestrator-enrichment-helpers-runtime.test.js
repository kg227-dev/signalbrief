"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/entrypoints/digest-orchestrator-enrichment-helpers-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);

assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const {
  accumulateWriteupStatsFromTaggedItems,
  appendRejectedItems,
  cloneReserveState,
  groupFailedItemsByTopic,
  normalizeAggregateWriteupStats,
  pickNextReserveCandidate,
  updateSelectionDiagnosticsForWriteups,
} = runtime;

{
  const original = {
    strongReserve: [{ url: "https://example.com/1" }],
    standardReserve: [{ url: "https://example.com/2" }],
    allReserve: [{ url: "https://example.com/1" }, { url: "https://example.com/2" }],
  };
  const cloned = cloneReserveState(original);
  original.strongReserve.push({ url: "https://example.com/3" });
  assert.deepStrictEqual(cloned.strongReserve, [{ url: "https://example.com/1" }]);
  assert.deepStrictEqual(cloned.standardReserve, [{ url: "https://example.com/2" }]);
  assert.deepStrictEqual(cloned.allReserve, [{ url: "https://example.com/1" }, { url: "https://example.com/2" }]);
}

{
  const stats = {
    attempted_count: 0,
    extraction_attempted_count: 0,
    extraction_success_count: 0,
    extraction_failure_count: 0,
    generation_attempted_count: 0,
    generation_success_count: 0,
    generation_failure_count: 0,
    first_pass_success_count: 0,
    first_pass_failure_count: 0,
    repair_attempted_count: 0,
    repair_success_count: 0,
    drop_count: 0,
    repeated_phrase_rejection_count: 0,
    model_generated_count: 0,
    final_selected_count: 0,
    strong_tier_attempted_count: 0,
    strong_tier_drop_count: 0,
    strong_tier_final_selected_count: 0,
    parse_failure_counts: Object.create(null),
    underfill_due_writeup_count: 0,
    topicWriteupStats: Object.create(null),
    hard_fail_count: 0,
    soft_fail_count: 0,
    soft_fail_recovery_count: 0,
    minimum_viable_accept_count: 0,
    strong_tier_hard_fail_count: 0,
  };

  accumulateWriteupStatsFromTaggedItems(stats, [
    {
      tag: "technology",
      item: {
        writeup_status: "model_pass",
        writeup_rejection_reasons: ["repeated_lead_phrase"],
        first_pass_succeeded: true,
        parse_failure_type: "timeout",
        validation_tier: "soft_fail",
        minimum_viable_accept: true,
        writeup_stage_diagnostics: {
          extraction: { status: "model_pass" },
          generation: { status: "soft_fail" },
          repair: { attempted: true, status: "model_pass" },
          candidate_tier: "strong",
        },
      },
    },
    {
      tag: "technology",
      item: {
        writeup_status: "failed_dropped",
        first_pass_succeeded: false,
        validation_tier: "hard_fail",
        writeup_stage_diagnostics: {
          extraction: { status: "failed" },
          generation: { status: "failed" },
          repair: { attempted: false, status: "failed" },
          candidate_tier: "strong",
        },
      },
    },
  ]);

  assert.strictEqual(stats.attempted_count, 2);
  assert.strictEqual(stats.extraction_success_count, 1);
  assert.strictEqual(stats.generation_attempted_count, 2);
  assert.strictEqual(stats.generation_success_count, 1);
  assert.strictEqual(stats.repair_attempted_count, 1);
  assert.strictEqual(stats.repair_success_count, 1);
  assert.strictEqual(stats.drop_count, 1);
  assert.strictEqual(stats.repeated_phrase_rejection_count, 1);
  assert.strictEqual(stats.strong_tier_attempted_count, 2);
  assert.strictEqual(stats.strong_tier_drop_count, 1);
  assert.strictEqual(stats.strong_tier_hard_fail_count, 1);
  assert.strictEqual(stats.soft_fail_count, 1);
  assert.strictEqual(stats.soft_fail_recovery_count, 1);
  assert.strictEqual(stats.minimum_viable_accept_count, 1);
  assert.strictEqual(stats.parse_failure_counts.timeout, 1);
  assert.strictEqual(stats.topicWriteupStats.TECHNOLOGY.attempted_count, 2);

  const normalized = normalizeAggregateWriteupStats(stats, 5);
  assert.strictEqual(normalized.attempted_count, 2);
  assert.strictEqual(normalized.model_generated_share_pct, 50);
  assert.strictEqual(normalized.strong_tier_drop_rate_pct, 50);
  assert.strictEqual(normalized.soft_fail_recovery_rate_pct, 100);
  assert.strictEqual(normalized.items_per_topic_target, 5);
}

{
  const reservePick = pickNextReserveCandidate({
    reserveState: {
      strongReserve: [{ url: "https://example.com/skip" }],
      standardReserve: [{ url: "https://example.com/fill" }],
    },
    reserveCursor: { strong: 0, standard: 0 },
    selectedItems: [],
    usedUrls: new Set(),
    getBackfillRejectionReason: (candidate) => (candidate.url.endsWith("/skip") ? "duplicate_source" : null),
    policy: {},
  });
  assert.strictEqual(reservePick.candidate.url, "https://example.com/fill");
  assert.strictEqual(reservePick.reserve_bucket, "standard");
}

{
  const grouped = appendRejectedItems({}, "technology", [{ url: "https://example.com/a" }, null]);
  assert.strictEqual(grouped.TECHNOLOGY.length, 1);

  const failedByTopic = groupFailedItemsByTopic({
    technology: [
      { url: "https://example.com/a", writeup_status: "failed_dropped" },
      { url: "https://example.com/b", writeup_status: "model_pass" },
    ],
  });
  assert.strictEqual(failedByTopic.technology.length, 1);
}

{
  const updated = updateSelectionDiagnosticsForWriteups({
    topic_selection_audit: [{
      tag: "technology",
      total_candidates: 2,
      rejection_reason_counts: { selection_pool_full: 1 },
      trusted_floor: { active: true, minTrustedItemsPerTopic: 1 },
      candidates: [
        { url: "https://example.com/a", headline: "A", selection_reason: "selection_not_selected" },
        { url: "https://example.com/b", headline: "B", selection_reason: "selection_not_selected" },
      ],
    }],
    strict_quality: { existing: true },
  }, {
    finalSelectedByTopic: {
      TECHNOLOGY: [{
        url: "https://example.com/a",
        source_tier: "strong",
        signal_shift: "shift",
        implication_type: "cost",
        writeup_status: "model_pass",
        writeup_attempt_count: 1,
        writeup_rejection_reasons: [],
        writeup_version: "v2",
        validation_tier: "soft_fail",
        minimum_viable_accept: true,
        hard_failure_reasons: [],
        soft_failure_reasons: ["sentence_clause_overload"],
        failure_reason: null,
        final_status: "model_pass",
        strict_quality: { pass: true },
        quality_rule_results: [{ rule: "wim_strength" }],
        rejected_rule: null,
        rejected_reason: null,
        exception_used: false,
        exception_reason: null,
        follow_up_allowed: false,
        inclusion_reason: "writeup_pass",
      }],
    },
    failedByTopic: {
      TECHNOLOGY: [{
        url: "https://example.com/b",
        writeup_status: "failed_dropped",
        writeup_attempt_count: 1,
        writeup_rejection_reasons: ["generic_language"],
        validation_tier: "hard_fail",
        hard_failure_reasons: ["generic_language"],
        soft_failure_reasons: [],
        failure_reason: "generic_language",
        final_status: "failed_dropped",
        strict_quality: { rejected_reason: "generic_language" },
        quality_rule_results: [],
        rejected_rule: "wim_strength",
        rejected_reason: "generic_language",
        exception_used: false,
        exception_reason: null,
        follow_up_allowed: false,
        inclusion_reason: null,
      }],
    },
    topicWriteupStats: {
      TECHNOLOGY: {
        attempted_count: 2,
        extraction_attempted_count: 2,
        extraction_success_count: 1,
        extraction_failure_count: 1,
        generation_attempted_count: 2,
        generation_success_count: 1,
        generation_failure_count: 1,
        first_pass_success_count: 1,
        first_pass_failure_count: 1,
        repair_attempted_count: 0,
        repair_success_count: 0,
        drop_count: 1,
        repeated_phrase_rejection_count: 0,
        model_generated_count: 1,
        final_selected_count: 1,
        hard_fail_count: 1,
        soft_fail_count: 1,
        soft_fail_recovery_count: 1,
        minimum_viable_accept_count: 1,
        strong_tier_attempted_count: 0,
        strong_tier_drop_count: 0,
        strong_tier_hard_fail_count: 0,
        strong_tier_final_selected_count: 1,
        parse_failure_counts: Object.create(null),
        underfill_due_writeup_count: 0,
      },
    },
    writeupSummary: {
      attempted_count: 2,
      extraction_attempted_count: 2,
      extraction_success_count: 1,
      extraction_failure_count: 1,
      generation_attempted_count: 2,
      generation_success_count: 1,
      generation_failure_count: 1,
      first_pass_success_count: 1,
      first_pass_failure_count: 1,
      repair_attempted_count: 0,
      repair_success_count: 0,
      drop_count: 1,
      repeated_phrase_rejection_count: 0,
      model_generated_count: 1,
      final_selected_count: 1,
      hard_fail_count: 1,
      soft_fail_count: 1,
      soft_fail_recovery_count: 1,
      minimum_viable_accept_count: 1,
      strong_tier_attempted_count: 0,
      strong_tier_drop_count: 0,
      strong_tier_hard_fail_count: 0,
      strong_tier_final_selected_count: 1,
      parse_failure_counts: Object.create(null),
      underfill_due_writeup_count: 0,
    },
    itemsPerTopic: 5,
    topicReserveDiagnostics: {
      TECHNOLOGY: {
        remaining_reserve_count: 1,
        remaining_strong_reserve_count: 0,
        remaining_standard_reserve_count: 1,
        strong_pool_exhausted: false,
        standard_tier_blocked_while_strong_available: true,
      },
    },
    strictQualityDiagnostics: {
      topic_buckets: {
        TECHNOLOGY: { pass: true },
      },
      major_story: { detected_count: 0, swap_count: 0, blocked_count: 0 },
    },
  });

  assert.strictEqual(updated.topic_selection_audit[0].selected_count, 1);
  assert.strictEqual(updated.topic_selection_audit[0].candidates[1].selection_reason, "generic_language");
  assert.strictEqual(updated.topic_selection_audit[0].candidates[0].validation_tier, "soft_fail");
  assert.strictEqual(updated.topic_selection_audit[0].candidates[1].validation_tier, "hard_fail");
  assert.strictEqual(updated.topic_selection_audit[0].trusted_floor.selected_trusted_count, 1);
  assert.strictEqual(updated.writeup.soft_fail_count, 1);
  assert.strictEqual(updated.writeup.attempted_count, 2);
}

process.stdout.write("[digest-orchestrator-enrichment-helpers-runtime] all assertions passed\n");
