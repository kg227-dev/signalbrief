"use strict";

const assert = require("assert");

const {
  attachDiagnosisToAuditDocument,
  buildRunEvidence,
  deriveTopicDiagnosis,
} = require("./root-cause-diagnosis-runtime");

function buildTopic({
  totalCandidates = 18,
  selectedCount = 5,
  trustedSelectedCount = 4,
  trustedUnselectedCount = 0,
  missedStoryFlagCount = 0,
  writeup = {},
  strictQuality = {},
} = {}) {
  const candidates = [];
  for (let index = 0; index < trustedSelectedCount; index += 1) {
    candidates.push({ selected: true, source_tier: 1, url: `https://example.com/selected-trusted-${index}` });
  }
  for (let index = trustedSelectedCount; index < selectedCount; index += 1) {
    candidates.push({ selected: true, source_tier: 3, url: `https://example.com/selected-low-${index}` });
  }
  for (let index = 0; index < trustedUnselectedCount; index += 1) {
    candidates.push({ selected: false, source_tier: 1, url: `https://example.com/unselected-trusted-${index}`, selection_reason: "selection_not_selected" });
  }
  return {
    total_candidates: totalCandidates,
    selected_count: selectedCount,
    missed_story_flags: Array.from({ length: missedStoryFlagCount }, (_, index) => ({
      headline: `Missed ${index}`,
      selection_reason: "selection_not_selected",
    })),
    rejection_reason_counts: {
      selection_not_selected: trustedUnselectedCount,
    },
    candidates,
    writeup: {
      attempted_count: selectedCount + trustedUnselectedCount,
      drop_count: 0,
      dropped_share_pct: 0,
      strong_tier_attempted_count: trustedSelectedCount + trustedUnselectedCount,
      strong_tier_drop_count: 0,
      strong_tier_final_selected_count: trustedSelectedCount,
      soft_fail_count: 0,
      soft_fail_recovery_count: 0,
      minimum_viable_accept_count: 0,
      underfill_due_writeup_count: 0,
      parse_failure_counts: {},
      ...writeup,
    },
    strict_quality: {
      pass: true,
      strong_pool_exhausted: false,
      standard_tier_blocked_while_strong_available: true,
      ...strictQuality,
    },
  };
}

function buildAuditDoc({
  writeup = {},
  topics = {},
  writeupFailureDetails = [],
  selectionRejectionCounts = {},
  missedStoryFlagCount = 0,
} = {}) {
  return {
    date_et: "2026-04-09",
    summary: {
      total_candidates: 60,
      total_selected: 15,
      missed_story_flag_count: missedStoryFlagCount,
      selection_rejection_counts: selectionRejectionCounts,
      writeup: {
        attempted_count: 15,
        drop_count: 0,
        dropped_share_pct: 0,
        strong_tier_attempted_count: 8,
        strong_tier_drop_count: 0,
        strong_tier_final_selected_count: 6,
        generation_failure_count: 0,
        hard_fail_count: 0,
        soft_fail_count: 0,
        soft_fail_recovery_count: 0,
        minimum_viable_accept_count: 0,
        parse_failure_counts: {},
        ...writeup,
      },
    },
    topics,
    fetch: {
      topic_diagnostics: Object.keys(topics).map((tag) => ({
        tag,
        coverage_status: "covered",
        broker_item_count: 12,
        discovery_item_count: 3,
      })),
    },
    enrichmentDiagnostics: {
      item_outcomes: [],
      writeup_failure_details: writeupFailureDetails,
    },
  };
}

{
  const doc = attachDiagnosisToAuditDocument(buildAuditDoc({
    writeup: {
      drop_count: 13,
      dropped_share_pct: 27.08,
      strong_tier_attempted_count: 39,
      strong_tier_drop_count: 13,
      strong_tier_final_selected_count: 26,
      repair_pass_success_rate_pct: 100,
      parse_failure_counts: { validator_mismatch: 13 },
    },
    topics: {
      TECHNOLOGY: buildTopic({
        writeup: {
          drop_count: 3,
          dropped_share_pct: 37.5,
          strong_tier_attempted_count: 7,
          strong_tier_drop_count: 3,
          strong_tier_final_selected_count: 4,
        },
      }),
      INDUSTRIALS: buildTopic({
        trustedSelectedCount: 2,
        writeup: {
          drop_count: 2,
          dropped_share_pct: 28.5,
          strong_tier_attempted_count: 4,
          strong_tier_drop_count: 2,
          strong_tier_final_selected_count: 2,
        },
      }),
    },
  }));

  assert.strictEqual(doc.runDiagnosis.primaryRootCause, "validator_over_reject");
}

{
  const doc = attachDiagnosisToAuditDocument(buildAuditDoc({
    writeup: {
      drop_count: 9,
      dropped_share_pct: 60,
      strong_tier_attempted_count: 9,
      strong_tier_drop_count: 5,
      strong_tier_final_selected_count: 2,
      soft_fail_count: 8,
      soft_fail_recovery_count: 1,
      minimum_viable_accept_count: 1,
    },
    topics: {
      INDUSTRIALS: buildTopic({
        selectedCount: 4,
        trustedSelectedCount: 1,
        writeup: {
          drop_count: 3,
          dropped_share_pct: 60,
          strong_tier_attempted_count: 4,
          strong_tier_drop_count: 3,
          strong_tier_final_selected_count: 1,
          soft_fail_count: 3,
          soft_fail_recovery_count: 0,
        },
      }),
      TECHNOLOGY: buildTopic(),
    },
  }));

  assert.strictEqual(doc.runDiagnosis.primaryRootCause, "validator_over_reject");
  assert.strictEqual(doc.topics.INDUSTRIALS.topicDiagnosis.primaryRootCause, "writeup_failure_causing_strong_tier_loss");
}

{
  const doc = attachDiagnosisToAuditDocument(buildAuditDoc({
    writeup: {
      drop_count: 7,
      dropped_share_pct: 46.67,
      generation_failure_count: 8,
      strong_tier_attempted_count: 7,
      strong_tier_drop_count: 2,
      strong_tier_final_selected_count: 4,
    },
    topics: {
      TECHNOLOGY: buildTopic(),
    },
    writeupFailureDetails: [
      { reason: "provider_timeout" },
      { reason: "provider_empty_response" },
      { reason: "provider_timeout" },
      { reason: "provider_timeout" },
    ],
  }));

  assert.strictEqual(doc.runDiagnosis.primaryRootCause, "writeup_generation_failure");
}

{
  const doc = attachDiagnosisToAuditDocument(buildAuditDoc({
    topics: {
      TECHNOLOGY: buildTopic({ trustedUnselectedCount: 3, missedStoryFlagCount: 2, trustedSelectedCount: 2 }),
      HEALTHCARE: buildTopic(),
    },
    selectionRejectionCounts: {
      selection_not_selected: 5,
      selection_pool_full: 2,
    },
    missedStoryFlagCount: 2,
  }));

  assert.strictEqual(doc.runDiagnosis.primaryRootCause, "selection_ranking_failure");
}

{
  const doc = attachDiagnosisToAuditDocument(buildAuditDoc({
    topics: {
      INDUSTRIALS: buildTopic({
        trustedSelectedCount: 1,
        writeup: {
          drop_count: 2,
          dropped_share_pct: 40,
          strong_tier_attempted_count: 4,
          strong_tier_drop_count: 2,
          strong_tier_final_selected_count: 1,
        },
      }),
    },
  }));
  doc.topics.INDUSTRIALS.strict_quality.strong_pool_exhausted = false;
  doc.topics.INDUSTRIALS = attachDiagnosisToAuditDocument({
    ...doc,
    topics: {
      INDUSTRIALS: {
        ...doc.topics.INDUSTRIALS,
        candidates: [
          { selected: true, source_tier: 3, url: "https://example.com/low" },
          { selected: false, source_tier: 1, url: "https://example.com/high", writeup_status: "failed_dropped" },
        ],
      },
    },
  }).topics.INDUSTRIALS;
  const rerunDoc = attachDiagnosisToAuditDocument({
    ...doc,
    topics: { INDUSTRIALS: doc.topics.INDUSTRIALS },
  });

  assert.strictEqual(rerunDoc.runDiagnosis.primaryRootCause, "same_topic_backfill_degradation");
}

{
  const doc = attachDiagnosisToAuditDocument(buildAuditDoc({
    topics: {
      ENERGY: buildTopic({ totalCandidates: 8, selectedCount: 3, trustedSelectedCount: 2 }),
      INDUSTRIALS: buildTopic({ totalCandidates: 10, selectedCount: 4, trustedSelectedCount: 3 }),
    },
  }));

  assert.strictEqual(doc.runDiagnosis.primaryRootCause, "retrieval_thinness");
}

{
  const doc = attachDiagnosisToAuditDocument(buildAuditDoc({
    topics: {
      TECHNOLOGY: buildTopic({ trustedSelectedCount: 1 }),
      HEALTHCARE: buildTopic({ trustedSelectedCount: 1 }),
      FINANCE: buildTopic({ trustedSelectedCount: 1 }),
    },
  }));

  assert.strictEqual(doc.runDiagnosis.primaryRootCause, "low_trust_selection_mix");
  assert.strictEqual(doc.topics.TECHNOLOGY.topicDiagnosis.severity, "high");
}

{
  const doc = attachDiagnosisToAuditDocument(buildAuditDoc({
    topics: {
      TECHNOLOGY: buildTopic(),
    },
  }));

  assert.strictEqual(doc.runDiagnosis.primaryRootCause, "unknown");
}

{
  const evidence = buildRunEvidence({
    writeup: {
      attempted_count: 10,
      dropped_share_pct: 40,
      strong_tier_attempted_count: 5,
      strong_tier_final_selected_count: 2,
      minimum_viable_accept_count: 2,
      soft_fail_count: 4,
      soft_fail_recovery_count: 1,
    },
  });
  assert.strictEqual(evidence.minimumViableAcceptRate, 0.2);
  assert.strictEqual(evidence.softFailRate, 0.4);
  assert.strictEqual(evidence.softFailToAcceptRate, 0.25);
}

{
  const topic = deriveTopicDiagnosis("TECHNOLOGY", buildTopic({
    totalCandidates: 8,
    selectedCount: 4,
    trustedSelectedCount: 1,
    trustedUnselectedCount: 3,
    missedStoryFlagCount: 2,
    writeup: {
      drop_count: 1,
      dropped_share_pct: 12.5,
      strong_tier_attempted_count: 4,
      strong_tier_drop_count: 0,
      strong_tier_final_selected_count: 1,
    },
  }), { coverage_status: "thin_pool" });

  assert.strictEqual(topic.primaryRootCause, "retrieval_supply_thin");
}

{
  const topic = deriveTopicDiagnosis("INDUSTRIALS", buildTopic({
    trustedSelectedCount: 1,
    trustedUnselectedCount: 2,
    missedStoryFlagCount: 2,
    writeup: {
      drop_count: 3,
      dropped_share_pct: 50,
      strong_tier_attempted_count: 4,
      strong_tier_drop_count: 2,
      strong_tier_final_selected_count: 1,
      underfill_due_writeup_count: 2,
    },
  }), { coverage_status: "covered" });

  assert.strictEqual(topic.primaryRootCause, "writeup_failure_causing_strong_tier_loss");
}

console.log("root cause diagnosis runtime ✓");
