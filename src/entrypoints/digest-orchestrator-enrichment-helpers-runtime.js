"use strict";

const {
  countTrustedSourceTier,
} = require("../domains/digest/candidate-quality-runtime");

function cloneCountMap(rawValue) {
  const out = Object.create(null);
  const entries = rawValue && typeof rawValue === "object" ? Object.entries(rawValue) : [];
  for (const [key, value] of entries) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) continue;
    out[String(key || "").trim()] = numeric;
  }
  return out;
}

function addCount(target, key, increment = 1) {
  const normalizedKey = String(key || "").trim() || "unknown";
  target[normalizedKey] = (target[normalizedKey] || 0) + Number(increment || 0);
}

function flattenTopicBuckets(topicBuckets = {}) {
  const flat = [];
  for (const [tag, items] of Object.entries(topicBuckets || {})) {
    for (const item of (Array.isArray(items) ? items : [])) {
      flat.push({ tag, item });
    }
  }
  return flat;
}

function cloneReserveState(rawState) {
  const state = rawState && typeof rawState === "object" ? rawState : {};
  return {
    strongReserve: Array.isArray(state.strongReserve) ? state.strongReserve.slice() : [],
    standardReserve: Array.isArray(state.standardReserve) ? state.standardReserve.slice() : [],
    allReserve: Array.isArray(state.allReserve) ? state.allReserve.slice() : [],
  };
}

function mapEnrichedTopicBuckets(flattened = [], enrichedItems = []) {
  const out = Object.create(null);
  for (let index = 0; index < flattened.length; index += 1) {
    const tag = String(flattened[index]?.tag || "").trim().toUpperCase();
    if (!tag) continue;
    if (!out[tag]) out[tag] = [];
    out[tag].push(enrichedItems[index] || flattened[index].item);
  }
  return out;
}

function ensureTopicWriteupStats(tag, topicWriteupStats = {}) {
  const normalizedTag = String(tag || "").trim().toUpperCase() || "__UNTAGGED__";
  if (!topicWriteupStats[normalizedTag]) {
    topicWriteupStats[normalizedTag] = {
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
      strong_tier_hard_fail_count: 0,
      strong_tier_final_selected_count: 0,
      hard_fail_count: 0,
      soft_fail_count: 0,
      soft_fail_recovery_count: 0,
      minimum_viable_accept_count: 0,
      parse_failure_counts: Object.create(null),
      underfill_due_writeup_count: 0,
    };
  }
  return topicWriteupStats[normalizedTag];
}

function accumulateWriteupStatsFromTaggedItems(target, taggedItems = []) {
  const rows = Array.isArray(taggedItems) ? taggedItems : [];
  for (const entry of rows) {
    const tag = String(entry?.tag || "").trim().toUpperCase() || "__UNTAGGED__";
    const item = entry?.item || {};
    const status = String(item?.writeup_status || "").trim().toLowerCase();
    const reasons = Array.isArray(item?.writeup_rejection_reasons) ? item.writeup_rejection_reasons : [];
    const stageDiagnostics = item?.writeup_stage_diagnostics && typeof item.writeup_stage_diagnostics === "object"
      ? item.writeup_stage_diagnostics
      : {};
    const extractionStatus = String(stageDiagnostics?.extraction?.status || "").trim().toLowerCase();
    const generationStatus = String(stageDiagnostics?.generation?.status || "").trim().toLowerCase();
    const repairAttempted = stageDiagnostics?.repair?.attempted === true;
    const repairStatus = String(stageDiagnostics?.repair?.status || "").trim().toLowerCase();
    const firstPassSucceeded = item?.first_pass_succeeded === true;
    const candidateTier = String(stageDiagnostics?.candidate_tier || "").trim().toLowerCase();
    const parseFailureType = String(item?.parse_failure_type || "").trim();
    const validationTier = String(item?.validation_tier || "").trim().toLowerCase();
    const topicStats = ensureTopicWriteupStats(tag, target.topicWriteupStats || (target.topicWriteupStats = Object.create(null)));

    target.attempted_count += 1;
    topicStats.attempted_count += 1;
    target.extraction_attempted_count += 1;
    topicStats.extraction_attempted_count += 1;
    if (extractionStatus && extractionStatus !== "failed") {
      target.extraction_success_count += 1;
      topicStats.extraction_success_count += 1;
    } else {
      target.extraction_failure_count += 1;
      topicStats.extraction_failure_count += 1;
    }
    if (generationStatus) {
      target.generation_attempted_count += 1;
      topicStats.generation_attempted_count += 1;
      if (
        generationStatus === "model_pass"
        || generationStatus === "retry_pass"
        || (generationStatus === "soft_fail" && status !== "failed_dropped")
      ) {
        target.generation_success_count += 1;
        topicStats.generation_success_count += 1;
      } else {
        target.generation_failure_count += 1;
        topicStats.generation_failure_count += 1;
      }
    }
    if (candidateTier === "strong") {
      target.strong_tier_attempted_count += 1;
      topicStats.strong_tier_attempted_count += 1;
    }
    if (validationTier === "hard_fail") {
      target.hard_fail_count += 1;
      topicStats.hard_fail_count += 1;
      if (candidateTier === "strong") {
        target.strong_tier_hard_fail_count += 1;
        topicStats.strong_tier_hard_fail_count += 1;
      }
    }
    if (validationTier === "soft_fail") {
      target.soft_fail_count += 1;
      topicStats.soft_fail_count += 1;
      if (status !== "failed_dropped") {
        target.soft_fail_recovery_count += 1;
        topicStats.soft_fail_recovery_count += 1;
      }
    }
    if (item?.minimum_viable_accept === true) {
      target.minimum_viable_accept_count += 1;
      topicStats.minimum_viable_accept_count += 1;
    }

    if (firstPassSucceeded) {
      target.first_pass_success_count += 1;
      topicStats.first_pass_success_count += 1;
    } else {
      target.first_pass_failure_count += 1;
      topicStats.first_pass_failure_count += 1;
    }
    if (repairAttempted) {
      target.repair_attempted_count += 1;
      topicStats.repair_attempted_count += 1;
      if (repairStatus === "model_pass" || repairStatus === "retry_pass" || status === "repair_pass") {
        target.repair_success_count += 1;
        topicStats.repair_success_count += 1;
      }
    }

    if (status === "failed_dropped") {
      target.drop_count += 1;
      topicStats.drop_count += 1;
      if (candidateTier === "strong") {
        target.strong_tier_drop_count += 1;
        topicStats.strong_tier_drop_count += 1;
      }
    }
    if (status === "model_pass" || status === "retry_pass" || status === "repair_pass") {
      target.model_generated_count += 1;
      topicStats.model_generated_count += 1;
    }
    if (reasons.includes("repeated_lead_phrase")) {
      target.repeated_phrase_rejection_count += 1;
      topicStats.repeated_phrase_rejection_count += 1;
    }
    if (parseFailureType) {
      addCount(target.parse_failure_counts || (target.parse_failure_counts = Object.create(null)), parseFailureType);
      addCount(topicStats.parse_failure_counts, parseFailureType);
    }
  }
}

function normalizeAggregateWriteupStats(stats = {}, itemsPerTopic = 5) {
  const attemptedCount = Math.max(0, Number(stats.attempted_count || 0));
  const extractionAttemptedCount = Math.max(0, Number(stats.extraction_attempted_count || attemptedCount));
  const extractionSuccessCount = Math.max(0, Number(stats.extraction_success_count || 0));
  const generationAttemptedCount = Math.max(0, Number(stats.generation_attempted_count || 0));
  const generationSuccessCount = Math.max(0, Number(stats.generation_success_count || 0));
  const repairAttemptedCount = Math.max(0, Number(stats.repair_attempted_count || 0));
  const dropCount = Math.max(0, Number(stats.drop_count || 0));
  const modelGeneratedCount = Math.max(0, Number(stats.model_generated_count || 0));
  const finalSelectedCount = Math.max(0, Number(stats.final_selected_count || 0));
  const strongTierAttemptedCount = Math.max(0, Number(stats.strong_tier_attempted_count || 0));
  const strongTierDropCount = Math.max(0, Number(stats.strong_tier_drop_count || 0));
  const strongTierHardFailCount = Math.max(0, Number(stats.strong_tier_hard_fail_count || 0));
  const strongTierFinalSelectedCount = Math.max(0, Number(stats.strong_tier_final_selected_count || 0));
  const hardFailCount = Math.max(0, Number(stats.hard_fail_count || 0));
  const softFailCount = Math.max(0, Number(stats.soft_fail_count || 0));
  const softFailRecoveryCount = Math.max(0, Number(stats.soft_fail_recovery_count || 0));
  const minimumViableAcceptCount = Math.max(0, Number(stats.minimum_viable_accept_count || 0));
  const underfillDueWriteupCount = Math.max(0, Number(stats.underfill_due_writeup_count || 0));
  return {
    attempted_count: attemptedCount,
    extraction_attempted_count: extractionAttemptedCount,
    extraction_success_count: extractionSuccessCount,
    extraction_failure_count: Math.max(0, Number(stats.extraction_failure_count || (extractionAttemptedCount - extractionSuccessCount))),
    generation_attempted_count: generationAttemptedCount,
    generation_success_count: generationSuccessCount,
    generation_failure_count: Math.max(0, Number(stats.generation_failure_count || (generationAttemptedCount - generationSuccessCount))),
    first_pass_success_count: Math.max(0, Number(stats.first_pass_success_count || 0)),
    first_pass_failure_count: Math.max(0, Number(stats.first_pass_failure_count || 0)),
    first_pass_success_rate_pct: attemptedCount > 0
      ? Number((((Number(stats.first_pass_success_count || 0)) / attemptedCount) * 100).toFixed(2))
      : 0,
    repair_attempted_count: repairAttemptedCount,
    repair_success_count: Math.max(0, Number(stats.repair_success_count || 0)),
    repair_pass_success_rate_pct: repairAttemptedCount > 0
      ? Number((((Number(stats.repair_success_count || 0)) / repairAttemptedCount) * 100).toFixed(2))
      : 0,
    drop_count: dropCount,
    hard_fail_count: hardFailCount,
    soft_fail_count: softFailCount,
    soft_fail_recovery_count: softFailRecoveryCount,
    soft_fail_recovery_rate_pct: softFailCount > 0
      ? Number(((softFailRecoveryCount / softFailCount) * 100).toFixed(2))
      : 0,
    minimum_viable_accept_count: minimumViableAcceptCount,
    underfill_due_writeup_count: underfillDueWriteupCount,
    repeated_phrase_rejection_count: Math.max(0, Number(stats.repeated_phrase_rejection_count || 0)),
    model_generated_count: modelGeneratedCount,
    model_generated_share_pct: attemptedCount > 0
      ? Number(((modelGeneratedCount / attemptedCount) * 100).toFixed(2))
      : 0,
    dropped_share_pct: attemptedCount > 0
      ? Number(((dropCount / attemptedCount) * 100).toFixed(2))
      : 0,
    strong_tier_attempted_count: strongTierAttemptedCount,
    strong_tier_drop_count: strongTierDropCount,
    strong_tier_drop_rate_pct: strongTierAttemptedCount > 0
      ? Number(((strongTierDropCount / strongTierAttemptedCount) * 100).toFixed(2))
      : 0,
    strong_tier_hard_fail_count: strongTierHardFailCount,
    strong_tier_hard_fail_rate_pct: strongTierAttemptedCount > 0
      ? Number(((strongTierHardFailCount / strongTierAttemptedCount) * 100).toFixed(2))
      : 0,
    strong_tier_final_selected_count: strongTierFinalSelectedCount,
    parse_failure_counts: cloneCountMap(stats.parse_failure_counts),
    final_selected_count: finalSelectedCount,
    items_per_topic_target: Math.max(1, Number(itemsPerTopic || 5)),
  };
}

function pickNextReserveCandidate(params = {}) {
  const reserveState = params.reserveState && typeof params.reserveState === "object" ? params.reserveState : {};
  const reserveCursor = params.reserveCursor && typeof params.reserveCursor === "object"
    ? {
        strong: Math.max(0, Number(params.reserveCursor.strong || 0)),
        standard: Math.max(0, Number(params.reserveCursor.standard || 0)),
      }
    : { strong: 0, standard: 0 };
  const selectedItems = Array.isArray(params.selectedItems) ? params.selectedItems : [];
  const usedUrls = params.usedUrls instanceof Set ? params.usedUrls : new Set();
  const getBackfillRejectionReason = typeof params.getBackfillRejectionReason === "function"
    ? params.getBackfillRejectionReason
    : () => null;
  const policy = params.policy && typeof params.policy === "object" ? params.policy : {};
  const strongReserve = Array.isArray(reserveState.strongReserve) ? reserveState.strongReserve : [];
  const standardReserve = Array.isArray(reserveState.standardReserve) ? reserveState.standardReserve : [];

  function pickFromBucket(bucket, bucketName, cursor) {
    for (let index = cursor; index < bucket.length; index += 1) {
      const candidate = bucket[index];
      const url = String(candidate?.url || "").trim();
      if (url && usedUrls.has(url)) continue;
      const rejectionReason = getBackfillRejectionReason(candidate, selectedItems, {
        maxItemsPerSourceDomain: policy.maxItemsPerSourceDomain,
        maxDiscoveryPerTopic: policy.maxDiscoveryPerTopic,
        commentaryCap: policy.commentaryCapPerTopic,
        backfillTrustFloor: policy.backfillTrustFloor === true,
      });
      if (rejectionReason) continue;
      return {
        candidate,
        nextCursor: {
          ...reserveCursor,
          [bucketName]: index + 1,
        },
        reserve_bucket: bucketName,
      };
    }
    return null;
  }

  const strongPick = pickFromBucket(strongReserve, "strong", reserveCursor.strong);
  if (strongPick) return strongPick;
  const standardPick = pickFromBucket(standardReserve, "standard", reserveCursor.standard);
  if (standardPick) return standardPick;

  return {
    candidate: null,
    nextCursor: {
      strong: strongReserve.length,
      standard: standardReserve.length,
    },
    reserve_bucket: null,
  };
}

function groupFailedItemsByTopic(topicBuckets = {}) {
  const out = Object.create(null);
  for (const [tag, items] of Object.entries(topicBuckets || {})) {
    out[tag] = (Array.isArray(items) ? items : []).filter((item) => String(item?.writeup_status || "").trim().toLowerCase() === "failed_dropped");
  }
  return out;
}

function appendFailedItems(target, topicBuckets = {}) {
  const out = target && typeof target === "object" ? target : Object.create(null);
  for (const [tag, items] of Object.entries(topicBuckets || {})) {
    const normalizedTag = String(tag || "").trim().toUpperCase();
    if (!normalizedTag) continue;
    if (!out[normalizedTag]) out[normalizedTag] = [];
    for (const item of (Array.isArray(items) ? items : [])) {
      if (String(item?.writeup_status || "").trim().toLowerCase() !== "failed_dropped") continue;
      out[normalizedTag].push(item);
    }
  }
  return out;
}

function attachStrictQuality(item, evaluation, extras = {}) {
  const strictQuality = evaluation && typeof evaluation === "object" ? evaluation : {};
  const qualityRuleResults = Array.isArray(strictQuality.quality_rule_results)
    ? strictQuality.quality_rule_results.map((result) => ({ ...result }))
    : [];
  const mergedStrictQuality = {
    pass: strictQuality.pass === true,
    rejected_rule: strictQuality.rejected_rule || null,
    rejected_reason: strictQuality.rejected_reason || null,
    quality_rule_results: qualityRuleResults,
    exception_used: strictQuality.exception_used === true,
    exception_reason: strictQuality.exception_reason || null,
    follow_up_allowed: strictQuality.follow_up_allowed === true,
    inclusion_reason: strictQuality.inclusion_reason || null,
    ...extras,
  };
  return {
    ...item,
    ...extras,
    strict_quality: mergedStrictQuality,
    quality_rule_results: qualityRuleResults,
    rejected_rule: mergedStrictQuality.rejected_rule,
    rejected_reason: mergedStrictQuality.rejected_reason,
    exception_used: mergedStrictQuality.exception_used,
    exception_reason: mergedStrictQuality.exception_reason,
    follow_up_allowed: mergedStrictQuality.follow_up_allowed,
    inclusion_reason: mergedStrictQuality.inclusion_reason,
  };
}

function appendRejectedItems(target, tag, items = []) {
  const out = target && typeof target === "object" ? target : Object.create(null);
  const normalizedTag = String(tag || "").trim().toUpperCase();
  if (!normalizedTag) return out;
  if (!out[normalizedTag]) out[normalizedTag] = [];
  for (const item of (Array.isArray(items) ? items : [])) {
    if (!item) continue;
    out[normalizedTag].push(item);
  }
  return out;
}

function summarizeRejectedReason(item = {}) {
  if (item?.selection_reason) return String(item.selection_reason);
  const strictQuality = item?.strict_quality && typeof item.strict_quality === "object"
    ? item.strict_quality
    : {};
  if (strictQuality.rejected_reason) return String(strictQuality.rejected_reason);
  if (String(item?.writeup_status || "").trim().toLowerCase() === "failed_dropped") return "writeup_failed";
  return "selection_not_selected";
}

function updateSelectionDiagnosticsForWriteups(selectionDiagnostics = {}, params = {}) {
  const topicAudits = Array.isArray(selectionDiagnostics?.topic_selection_audit)
    ? selectionDiagnostics.topic_selection_audit.map((topic) => ({
        ...topic,
        rejection_reason_counts: cloneCountMap(topic?.rejection_reason_counts),
        candidates: Array.isArray(topic?.candidates)
          ? topic.candidates.map((candidate) => ({
              ...candidate,
              writeup_rejection_reasons: Array.isArray(candidate?.writeup_rejection_reasons) ? candidate.writeup_rejection_reasons.slice() : [],
            }))
          : [],
      }))
    : [];
  const finalSelectedByTopic = params.finalSelectedByTopic && typeof params.finalSelectedByTopic === "object"
    ? params.finalSelectedByTopic
    : {};
  const failedByTopic = params.failedByTopic && typeof params.failedByTopic === "object"
    ? params.failedByTopic
    : {};
  const topicWriteupStats = params.topicWriteupStats && typeof params.topicWriteupStats === "object"
    ? params.topicWriteupStats
    : {};
  const writeupSummary = params.writeupSummary && typeof params.writeupSummary === "object"
    ? params.writeupSummary
    : {};
  const strictQualityDiagnostics = params.strictQualityDiagnostics && typeof params.strictQualityDiagnostics === "object"
    ? params.strictQualityDiagnostics
    : {};
  const topicReserveDiagnostics = params.topicReserveDiagnostics && typeof params.topicReserveDiagnostics === "object"
    ? params.topicReserveDiagnostics
    : {};

  for (const topicAudit of topicAudits) {
    const tag = String(topicAudit?.tag || "").trim().toUpperCase();
    const finalSelectedItems = Array.isArray(finalSelectedByTopic[tag]) ? finalSelectedByTopic[tag] : [];
    const failedItems = Array.isArray(failedByTopic[tag]) ? failedByTopic[tag] : [];
    const finalSelectedByUrl = new Map(finalSelectedItems.map((item) => [String(item?.url || "").trim(), item]));
    const failedByUrl = new Map(failedItems.map((item) => [String(item?.url || "").trim(), item]));
    const rejectionCounts = Object.create(null);

    topicAudit.candidates = (Array.isArray(topicAudit?.candidates) ? topicAudit.candidates : []).map((candidate) => {
      const url = String(candidate?.url || "").trim();
      const finalSelected = finalSelectedByUrl.get(url);
      const failed = failedByUrl.get(url);
      if (finalSelected) {
        return {
          ...candidate,
          selected: true,
          selection_reason: null,
          signal_shift: finalSelected.signal_shift || null,
          implication_type: finalSelected.implication_type || null,
          writeup_status: finalSelected.writeup_status || null,
          writeup_attempt_count: Number(finalSelected.writeup_attempt_count || 0) || null,
          writeup_rejection_reasons: Array.isArray(finalSelected.writeup_rejection_reasons) ? finalSelected.writeup_rejection_reasons.slice() : [],
          writeup_version: finalSelected.writeup_version || null,
          validation_tier: finalSelected.validation_tier || null,
          minimum_viable_accept: finalSelected.minimum_viable_accept === true,
          hard_failure_reasons: Array.isArray(finalSelected.hard_failure_reasons) ? finalSelected.hard_failure_reasons.slice() : [],
          soft_failure_reasons: Array.isArray(finalSelected.soft_failure_reasons) ? finalSelected.soft_failure_reasons.slice() : [],
          failure_reason: finalSelected.failure_reason || null,
          final_status: finalSelected.final_status || null,
          repair_applied: finalSelected?.writeup_stage_diagnostics?.repair?.attempted === true,
          strict_quality: finalSelected.strict_quality ? { ...finalSelected.strict_quality } : null,
          quality_rule_results: Array.isArray(finalSelected.quality_rule_results) ? finalSelected.quality_rule_results.map((result) => ({ ...result })) : [],
          rejected_rule: finalSelected.rejected_rule || null,
          rejected_reason: finalSelected.rejected_reason || null,
          exception_used: finalSelected.exception_used === true,
          exception_reason: finalSelected.exception_reason || null,
          follow_up_allowed: finalSelected.follow_up_allowed === true,
          inclusion_reason: finalSelected.inclusion_reason || null,
          major_story_candidate: finalSelected.major_story_candidate === true,
          major_story_block_reason: finalSelected.major_story_block_reason || null,
        };
      }
      const failedReasons = Array.isArray(failed?.writeup_rejection_reasons) ? failed.writeup_rejection_reasons.slice() : [];
      const selectionReason = failed
        ? summarizeRejectedReason(failed)
        : String(candidate?.selection_reason || "selection_not_selected").trim() || "selection_not_selected";
      addCount(rejectionCounts, selectionReason);
      return {
        ...candidate,
        selected: false,
        selection_reason: selectionReason,
        signal_shift: failed?.signal_shift || null,
        implication_type: failed?.implication_type || null,
        writeup_status: failed?.writeup_status || null,
        writeup_attempt_count: Number(failed?.writeup_attempt_count || 0) || null,
        writeup_rejection_reasons: failedReasons,
        writeup_version: failed?.writeup_version || null,
        validation_tier: failed?.validation_tier || null,
        minimum_viable_accept: failed?.minimum_viable_accept === true,
        hard_failure_reasons: Array.isArray(failed?.hard_failure_reasons) ? failed.hard_failure_reasons.slice() : [],
        soft_failure_reasons: Array.isArray(failed?.soft_failure_reasons) ? failed.soft_failure_reasons.slice() : [],
        failure_reason: failed?.failure_reason || null,
        final_status: failed?.final_status || null,
        repair_applied: failed?.writeup_stage_diagnostics?.repair?.attempted === true,
        strict_quality: failed?.strict_quality ? { ...failed.strict_quality } : null,
        quality_rule_results: Array.isArray(failed?.quality_rule_results) ? failed.quality_rule_results.map((result) => ({ ...result })) : [],
        rejected_rule: failed?.rejected_rule || null,
        rejected_reason: failed?.rejected_reason || null,
        exception_used: failed?.exception_used === true,
        exception_reason: failed?.exception_reason || null,
        follow_up_allowed: failed?.follow_up_allowed === true,
        inclusion_reason: failed?.inclusion_reason || null,
        major_story_candidate: failed?.major_story_candidate === true,
        major_story_block_reason: failed?.major_story_block_reason || null,
      };
    });

    topicAudit.selected_count = finalSelectedItems.length;
    topicAudit.rejected_count = Math.max(0, Number(topicAudit.total_candidates || topicAudit.candidates.length) - finalSelectedItems.length);
    topicAudit.rejection_reason_counts = rejectionCounts;
    const topicStats = topicWriteupStats[tag] || {};
    const reserveDiagnostics = topicReserveDiagnostics[tag] && typeof topicReserveDiagnostics[tag] === "object"
      ? topicReserveDiagnostics[tag]
      : {};
    const strongSelectedCount = countTrustedSourceTier(finalSelectedItems);
    const standardSelectedCount = Math.max(0, finalSelectedItems.length - strongSelectedCount);
    const existingTrustedFloor = topicAudit?.trusted_floor && typeof topicAudit.trusted_floor === "object"
      ? topicAudit.trusted_floor
      : {};
    const floorMinTrusted = Math.max(0, Number(existingTrustedFloor.minTrustedItemsPerTopic || 0));
    const floorActive = existingTrustedFloor.active === true;
    const strongPoolExhausted = reserveDiagnostics.strong_pool_exhausted === true
      || (floorActive && strongSelectedCount < floorMinTrusted && Number(reserveDiagnostics.remaining_strong_reserve_count || 0) <= 0);
    const standardTierBlockedWhileStrongAvailable = reserveDiagnostics.standard_tier_blocked_while_strong_available !== false;
    topicAudit.strong_tier_selected_count = strongSelectedCount;
    topicAudit.standard_tier_selected_count = standardSelectedCount;
    topicAudit.standard_tier_blocked_while_strong_available = standardTierBlockedWhileStrongAvailable;
    topicAudit.reserve_candidate_count = Math.max(0, Number(reserveDiagnostics.remaining_reserve_count ?? topicAudit.reserve_candidate_count ?? 0));
    topicAudit.reserve_strong_count = Math.max(0, Number(reserveDiagnostics.remaining_strong_reserve_count ?? topicAudit.reserve_strong_count ?? 0));
    topicAudit.reserve_standard_count = Math.max(0, Number(reserveDiagnostics.remaining_standard_reserve_count ?? topicAudit.reserve_standard_count ?? 0));
    topicAudit.trusted_floor = {
      ...existingTrustedFloor,
      selected_trusted_count: strongSelectedCount,
      standard_tier_blocked_while_strong_available: standardTierBlockedWhileStrongAvailable,
      strong_pool_exhausted: strongPoolExhausted,
      relaxed_reason: floorActive && strongPoolExhausted ? "strong_pool_exhausted" : (existingTrustedFloor.relaxed_reason || null),
    };
    topicAudit.writeup = normalizeAggregateWriteupStats(topicStats, params.itemsPerTopic);
    topicAudit.strict_quality = strictQualityDiagnostics.topic_buckets?.[tag]
      ? JSON.parse(JSON.stringify(strictQualityDiagnostics.topic_buckets[tag]))
      : null;
  }

  return {
    ...selectionDiagnostics,
    writeup: normalizeAggregateWriteupStats(writeupSummary, params.itemsPerTopic),
    strict_quality: {
      ...(selectionDiagnostics?.strict_quality && typeof selectionDiagnostics.strict_quality === "object"
        ? selectionDiagnostics.strict_quality
        : {}),
      ...JSON.parse(JSON.stringify(strictQualityDiagnostics || {})),
    },
    topic_selection_audit: topicAudits,
  };
}

module.exports = {
  addCount,
  accumulateWriteupStatsFromTaggedItems,
  appendFailedItems,
  appendRejectedItems,
  attachStrictQuality,
  cloneCountMap,
  cloneReserveState,
  ensureTopicWriteupStats,
  flattenTopicBuckets,
  groupFailedItemsByTopic,
  mapEnrichedTopicBuckets,
  normalizeAggregateWriteupStats,
  pickNextReserveCandidate,
  summarizeRejectedReason,
  updateSelectionDiagnosticsForWriteups,
};
