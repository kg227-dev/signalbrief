"use strict";

const {
  evaluateFinalDigestAssembly,
  evaluateTopicBucketShipReady,
  evaluateTopicItem,
  isMajorStoryCandidate,
  resolveStrictQualityConfig,
} = require("../digest/domain/strict-quality-domain-runtime");

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

const SOURCE_TIER_ALIASES = Object.freeze({
  1: 1,
  2: 2,
  3: 3,
  premium: 1,
  strong: 2,
  standard: 3,
});

function normalizeSourceTier(itemOrTier) {
  const rawTier = itemOrTier && typeof itemOrTier === "object" ? itemOrTier.source_tier : itemOrTier;
  const numeric = Number(rawTier);
  if (numeric === 1 || numeric === 2 || numeric === 3) return numeric;
  const alias = SOURCE_TIER_ALIASES[String(rawTier || "").trim().toLowerCase()];
  return alias || null;
}

function isTrustedSourceTier(item) {
  const tier = normalizeSourceTier(item);
  return tier != null && tier <= 2;
}

function countTrustedSourceTier(items = []) {
  return (Array.isArray(items) ? items : []).filter((item) => isTrustedSourceTier(item)).length;
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
      first_pass_success_count: 0,
      first_pass_failure_count: 0,
      repair_attempted_count: 0,
      repair_success_count: 0,
      drop_count: 0,
      repeated_phrase_rejection_count: 0,
      model_generated_count: 0,
      final_selected_count: 0,
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
    const attemptCount = Math.max(1, Number(item?.writeup_attempt_count || 1));
    const reasons = Array.isArray(item?.writeup_rejection_reasons) ? item.writeup_rejection_reasons : [];
    const topicStats = ensureTopicWriteupStats(tag, target.topicWriteupStats || (target.topicWriteupStats = Object.create(null)));

    target.attempted_count += 1;
    topicStats.attempted_count += 1;

    if (attemptCount <= 1) {
      if (status === "model_pass") {
        target.first_pass_success_count += 1;
        topicStats.first_pass_success_count += 1;
      } else {
        target.first_pass_failure_count += 1;
        topicStats.first_pass_failure_count += 1;
      }
    } else {
      target.first_pass_failure_count += 1;
      topicStats.first_pass_failure_count += 1;
      target.repair_attempted_count += 1;
      topicStats.repair_attempted_count += 1;
      if (status === "repair_pass") {
        target.repair_success_count += 1;
        topicStats.repair_success_count += 1;
      }
    }

    if (status === "failed_dropped") {
      target.drop_count += 1;
      topicStats.drop_count += 1;
    }
    if (status === "model_pass" || status === "repair_pass") {
      target.model_generated_count += 1;
      topicStats.model_generated_count += 1;
    }
    if (reasons.includes("repeated_lead_phrase")) {
      target.repeated_phrase_rejection_count += 1;
      topicStats.repeated_phrase_rejection_count += 1;
    }
  }
}

function normalizeAggregateWriteupStats(stats = {}, itemsPerTopic = 5) {
  const attemptedCount = Math.max(0, Number(stats.attempted_count || 0));
  const repairAttemptedCount = Math.max(0, Number(stats.repair_attempted_count || 0));
  const dropCount = Math.max(0, Number(stats.drop_count || 0));
  const modelGeneratedCount = Math.max(0, Number(stats.model_generated_count || 0));
  const finalSelectedCount = Math.max(0, Number(stats.final_selected_count || 0));
  const underfillDueWriteupCount = Math.max(0, Number(stats.underfill_due_writeup_count || 0));
  return {
    attempted_count: attemptedCount,
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
    underfill_due_writeup_count: underfillDueWriteupCount,
    repeated_phrase_rejection_count: Math.max(0, Number(stats.repeated_phrase_rejection_count || 0)),
    model_generated_count: modelGeneratedCount,
    model_generated_share_pct: attemptedCount > 0
      ? Number(((modelGeneratedCount / attemptedCount) * 100).toFixed(2))
      : 0,
    dropped_share_pct: attemptedCount > 0
      ? Number(((dropCount / attemptedCount) * 100).toFixed(2))
      : 0,
    final_selected_count: finalSelectedCount,
    items_per_topic_target: Math.max(1, Number(itemsPerTopic || 5)),
  };
}

function pickNextReserveCandidate(params = {}) {
  const reserveQueue = Array.isArray(params.reserveQueue) ? params.reserveQueue : [];
  const reserveCursor = Math.max(0, Number(params.reserveCursor || 0));
  const selectedItems = Array.isArray(params.selectedItems) ? params.selectedItems : [];
  const usedUrls = params.usedUrls instanceof Set ? params.usedUrls : new Set();
  const getBackfillRejectionReason = typeof params.getBackfillRejectionReason === "function"
    ? params.getBackfillRejectionReason
    : () => null;
  const policy = params.policy && typeof params.policy === "object" ? params.policy : {};
  const trustedFloor = policy.trustedFloor && typeof policy.trustedFloor === "object" ? policy.trustedFloor : {};
  const minTrustedItems = Math.max(0, Number(trustedFloor.minTrustedItemsPerTopic || 0));
  const needsTrustedBackfill = trustedFloor.active === true
    && minTrustedItems > 0
    && countTrustedSourceTier(selectedItems) < minTrustedItems;
  if (needsTrustedBackfill) {
    for (let index = reserveCursor; index < reserveQueue.length; index += 1) {
      const candidate = reserveQueue[index];
      const url = String(candidate?.url || "").trim();
      if (url && usedUrls.has(url)) continue;
      if (!isTrustedSourceTier(candidate)) continue;
      const rejectionReason = getBackfillRejectionReason(candidate, selectedItems, {
        maxItemsPerSourceDomain: policy.maxItemsPerSourceDomain,
        maxDiscoveryPerTopic: policy.maxDiscoveryPerTopic,
        commentaryCap: policy.commentaryCapPerTopic,
        backfillTrustFloor: policy.backfillTrustFloor === true,
      });
      if (rejectionReason) continue;
      return {
        candidate,
        nextCursor: reserveCursor,
      };
    }
  }
  for (let index = reserveCursor; index < reserveQueue.length; index += 1) {
    const candidate = reserveQueue[index];
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
      nextCursor: index + 1,
    };
  }
  return {
    candidate: null,
    nextCursor: reserveQueue.length,
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

function createDigestOrchestratorEnrichmentRuntime(deps) {
  const {
    CONFIG,
    enrichItems,
    emitDigestIncident,
    getBackfillRejectionReason,
  } = deps;
  const emitIncident = typeof emitDigestIncident === "function"
    ? emitDigestIncident
    : async () => false;
  const resolveBackfillRejection = typeof getBackfillRejectionReason === "function"
    ? getBackfillRejectionReason
    : () => null;

  async function enrichSelectedItems(params) {
    const {
      selected,
      selectedByTopic,
      reserveByTopic,
      selectionDiagnostics,
      writeupBackfillPolicy,
      enrichOpts,
      runMode,
      dueUsersCount,
      nowMs: paramNowMs,
    } = params;
    const configDigest = CONFIG?.digest && typeof CONFIG.digest === "object"
      ? CONFIG.digest
      : {};
    const strictQualityConfig = resolveStrictQualityConfig(configDigest);
    const strictQualityEnabled = strictQualityConfig.enabled === true;
    const nowMs = Number.isFinite(paramNowMs) ? paramNowMs : Date.now();

    const topicBuckets = selectedByTopic && typeof selectedByTopic === "object"
      ? Object.fromEntries(Object.entries(selectedByTopic).map(([tag, items]) => [String(tag || "").trim().toUpperCase(), Array.isArray(items) ? items.slice() : []]))
      : (() => {
          const grouped = Object.create(null);
          for (const item of (Array.isArray(selected) ? selected : [])) {
            const tag = String(item?.tag || "").trim().toUpperCase();
            if (!tag) continue;
            if (!grouped[tag]) grouped[tag] = [];
            grouped[tag].push(item);
          }
          return grouped;
        })();
    const reserves = reserveByTopic && typeof reserveByTopic === "object"
      ? Object.fromEntries(Object.entries(reserveByTopic).map(([tag, items]) => [String(tag || "").trim().toUpperCase(), Array.isArray(items) ? items.slice() : []]))
      : {};
    const backfillPolicy = {
      itemsPerTopic: Math.max(1, Number(writeupBackfillPolicy?.itemsPerTopic || 5)),
      maxItemsPerSourceDomain: Math.max(1, Number(writeupBackfillPolicy?.maxItemsPerSourceDomain || 2)),
      maxDiscoveryPerTopic: Math.max(0, Number(writeupBackfillPolicy?.maxDiscoveryPerTopic ?? 1)),
      commentaryCapPerTopic: Math.max(0, Number(writeupBackfillPolicy?.commentaryCapPerTopic ?? 1)),
      backfillTrustFloor: writeupBackfillPolicy?.backfillTrustFloor === true,
      trustedFloor: writeupBackfillPolicy?.trustedFloor && typeof writeupBackfillPolicy.trustedFloor === "object"
        ? writeupBackfillPolicy.trustedFloor
        : { enabled: false, byTopic: {} },
    };
    const maxBackfillsPerSlot = strictQualityEnabled
      ? Math.max(1, Number(strictQualityConfig.max_backfills_per_slot || 2))
      : 99;
    const topicPoolCounts = Object.create(null);
    for (const tag of new Set([...Object.keys(topicBuckets), ...Object.keys(reserves)])) {
      const normalizedTag = String(tag || "").trim().toUpperCase();
      if (!normalizedTag) continue;
      topicPoolCounts[normalizedTag] = (Array.isArray(topicBuckets[normalizedTag]) ? topicBuckets[normalizedTag].length : 0)
        + (Array.isArray(reserves[normalizedTag]) ? reserves[normalizedTag].length : 0);
    }

    const writeupStats = {
      attempted_count: 0,
      first_pass_success_count: 0,
      first_pass_failure_count: 0,
      repair_attempted_count: 0,
      repair_success_count: 0,
      drop_count: 0,
      repeated_phrase_rejection_count: 0,
      model_generated_count: 0,
      final_selected_count: 0,
      underfill_due_writeup_count: 0,
      topicWriteupStats: Object.create(null),
    };
    const usedUrls = new Set(flattenTopicBuckets(topicBuckets).map(({ item }) => String(item?.url || "").trim()).filter(Boolean));
    const reserveCursors = Object.fromEntries([...new Set([...Object.keys(topicBuckets), ...Object.keys(reserves)])].map((tag) => [tag, 0]));
    const failedItemsByTopic = Object.create(null);
    const finalTopicBuckets = Object.create(null);
    let aggregateUsage = { input_tokens: 0, output_tokens: 0 };
    let degraded = false;
    let degradation = null;
    const degradationIncidentKeys = new Set();
    const writeupFailureDetails = [];
    const strictTopicDiagnostics = Object.create(null);
    const strictMajorStorySummary = {
      detected_count: 0,
      swap_count: 0,
      blocked_count: 0,
    };

    async function maybeEmitDegradationIncident(enrichment, meta = {}) {
      if (enrichment?.degraded !== true) return;
      degraded = true;
      degradation = enrichment?.degradation || degradation;
      const provider = String(enrichment?.degradation?.provider || "").trim();
      if (!provider) return;
      const reason = String(enrichment?.degradation?.reason || "unknown").trim() || "unknown";
      const incidentKey = `${provider}:${reason}`;
      if (degradationIncidentKeys.has(incidentKey)) return;
      degradationIncidentKeys.add(incidentKey);
      await emitIncident(
        `${provider}-partial-degradation`,
        `${provider} degradation during enrichment (${reason})`,
        {
          mode: runMode,
          due_users: Number(dueUsersCount || 0),
          selected_items: Math.max(0, Number(meta.selected_items || 0)),
          provider,
          reason,
          status_code: enrichment?.degradation?.status_code != null ? Number(enrichment.degradation.status_code) : null,
          timeout_ms: enrichment?.degradation?.timeout_ms != null ? Number(enrichment.degradation.timeout_ms) : null,
          phase: meta.phase || null,
          topic_tag: meta.topic_tag || null,
        }
      );
    }

    async function enrichTaggedEntries(taggedEntries = [], meta = {}) {
      const rows = Array.isArray(taggedEntries) ? taggedEntries.filter((entry) => entry?.item) : [];
      if (!rows.length) return [];
      const MAX_BATCH = 10;
      const allTaggedOut = [];
      for (let i = 0; i < rows.length; i += MAX_BATCH) {
        const chunk = rows.slice(i, i + MAX_BATCH);
        const enrichment = await enrichItems(chunk.map((entry) => entry.item), enrichOpts);
        aggregateUsage.input_tokens += Number(enrichment?.usage?.input_tokens || 0);
        aggregateUsage.output_tokens += Number(enrichment?.usage?.output_tokens || 0);
        await maybeEmitDegradationIncident(enrichment, {
          ...meta,
          selected_items: chunk.length,
        });
        const providerFailureDetails = Array.isArray(enrichment?.writeupDiagnostics?.provider_failure_details)
          ? enrichment.writeupDiagnostics.provider_failure_details
          : [];
        for (const detail of providerFailureDetails) {
          const batchIndex = Number(detail?.batch_index);
          const row = Number.isInteger(batchIndex) ? chunk[batchIndex] : null;
          writeupFailureDetails.push({
            ...detail,
            phase: meta.phase || null,
            topic_tag: String(meta.topic_tag || row?.tag || detail?.topic || "").trim().toUpperCase() || null,
          });
        }
        const enrichedItems = Array.isArray(enrichment?.items) ? enrichment.items : [];
        const taggedChunk = chunk.map((entry, index) => ({
          tag: String(entry?.tag || "").trim().toUpperCase(),
          item: enrichedItems[index] || entry.item,
        }));
        accumulateWriteupStatsFromTaggedItems(writeupStats, taggedChunk);
        allTaggedOut.push(...taggedChunk);
      }
      return allTaggedOut;
    }

    function evaluateCandidateForTopic(topicTag, item, acceptedItems, remainingExceptions) {
      if (!strictQualityEnabled) {
        const dropped = String(item?.writeup_status || "").trim().toLowerCase() === "failed_dropped";
        return dropped
          ? {
              pass: false,
              rejected_rule: "wim_strength",
              rejected_reason: "writeup_failed",
              quality_rule_results: [],
              exception_used: false,
              exception_reason: null,
              follow_up_allowed: false,
              inclusion_reason: null,
            }
          : {
              pass: true,
              rejected_rule: null,
              rejected_reason: null,
              quality_rule_results: [],
              exception_used: false,
              exception_reason: null,
              follow_up_allowed: false,
              inclusion_reason: "writeup_pass",
            };
      }
      return evaluateTopicItem(item, {
        strictQualityConfig,
        configDigest,
        nowMs,
        acceptedItems,
        remainingExceptions,
        topicCandidateCount: Math.max(0, Number(topicPoolCounts[topicTag] || 0)),
        thinPool: Number(topicPoolCounts[topicTag] || 0) < Math.max(15, backfillPolicy.itemsPerTopic * 3),
      });
    }

    function weakestAcceptedIndex(items = []) {
      let weakestIndex = -1;
      let weakestScore = Infinity;
      for (let index = 0; index < items.length; index += 1) {
        const score = Number(items[index]?._score);
        const normalizedScore = Number.isFinite(score) ? score : -Infinity;
        if (normalizedScore < weakestScore) {
          weakestScore = normalizedScore;
          weakestIndex = index;
        }
      }
      return weakestIndex;
    }

    function needsEnrichment(item = {}) {
      const status = String(item?.writeup_status || "").trim();
      if (status) return false;
      return !String(item?.wim || "").trim()
        || !String(item?.wim_brief || "").trim()
        || !String(item?.signal_shift || "").trim()
        || !String(item?.implication_type || "").trim();
    }

    const flattenedInitial = flattenTopicBuckets(topicBuckets);
    if (flattenedInitial.length > 0) {
      const enrichedTagged = await enrichTaggedEntries(flattenedInitial, { phase: "initial" });
      const enrichedTopicBuckets = mapEnrichedTopicBuckets(flattenedInitial, enrichedTagged.map((entry) => entry.item));
      for (const [tag, itemsForTopic] of Object.entries(enrichedTopicBuckets)) {
        topicBuckets[tag] = itemsForTopic;
      }
    }

    for (const tag of [...new Set([...Object.keys(topicBuckets), ...Object.keys(reserves)])]) {
      const topicTag = String(tag || "").trim().toUpperCase();
      if (!topicTag) continue;
      const initialItems = Array.isArray(topicBuckets[topicTag]) ? topicBuckets[topicTag].slice() : [];
      const acceptedItems = [];
      const rejectedItems = [];
      let remainingExceptions = Math.max(0, Number(strictQualityConfig.max_exceptions_per_digest || 0));
      let backfillAttemptCount = 0;
      let underfillCount = 0;
      const majorStoryDiagnostics = {
        detected_count: 0,
        swap_count: 0,
        blocked_count: 0,
        detected_candidates: [],
        blocked_candidates: [],
      };

      for (const item of initialItems) {
        const evaluation = evaluateCandidateForTopic(topicTag, item, acceptedItems, remainingExceptions);
        if (evaluation.pass) {
          const accepted = attachStrictQuality(item, evaluation);
          acceptedItems.push(accepted);
          if (evaluation.exception_used === true) remainingExceptions = Math.max(0, remainingExceptions - 1);
          continue;
        }
        const rejected = attachStrictQuality(item, evaluation);
        rejectedItems.push(rejected);
        appendRejectedItems(failedItemsByTopic, topicTag, [rejected]);
      }

      let reserveDepleted = false;
      while (acceptedItems.length < backfillPolicy.itemsPerTopic && !reserveDepleted) {
        let slotFilled = false;
        for (let attempt = 0; attempt < maxBackfillsPerSlot; attempt += 1) {
          const nextCandidate = pickNextReserveCandidate({
            reserveQueue: reserves[topicTag],
            reserveCursor: reserveCursors[topicTag] || 0,
            selectedItems: acceptedItems,
            usedUrls,
            getBackfillRejectionReason: resolveBackfillRejection,
            policy: {
              ...backfillPolicy,
              trustedFloor: backfillPolicy.trustedFloor?.byTopic?.[topicTag] || { active: false },
            },
          });
          reserveCursors[topicTag] = nextCandidate.nextCursor;
          if (!nextCandidate.candidate) {
            reserveDepleted = true;
            break;
          }
          const candidateUrl = String(nextCandidate.candidate?.url || "").trim();
          if (candidateUrl) usedUrls.add(candidateUrl);
          backfillAttemptCount += 1;
          const enrichedReplacement = await enrichTaggedEntries([{ tag: topicTag, item: nextCandidate.candidate }], {
            phase: "backfill",
            topic_tag: topicTag,
          });
          const enrichedCandidate = enrichedReplacement[0]?.item || nextCandidate.candidate;
          const evaluation = evaluateCandidateForTopic(topicTag, enrichedCandidate, acceptedItems, remainingExceptions);
          if (evaluation.pass) {
            const accepted = attachStrictQuality(enrichedCandidate, evaluation);
            acceptedItems.push(accepted);
            if (evaluation.exception_used === true) remainingExceptions = Math.max(0, remainingExceptions - 1);
            slotFilled = true;
            break;
          }
          const rejected = attachStrictQuality(enrichedCandidate, evaluation);
          rejectedItems.push(rejected);
          appendRejectedItems(failedItemsByTopic, topicTag, [rejected]);
        }
        if (!slotFilled) underfillCount += 1;
      }

      if (strictQualityEnabled && strictQualityConfig.major_story.enabled === true) {
        const majorStoryPool = [];
        const seenMajorStoryUrls = new Set();
        const remainingReserve = Array.isArray(reserves[topicTag]) ? reserves[topicTag].slice(reserveCursors[topicTag] || 0) : [];
        for (const candidate of [...rejectedItems, ...remainingReserve]) {
          const url = String(candidate?.url || "").trim() || `${topicTag}:${majorStoryPool.length}`;
          if (seenMajorStoryUrls.has(url)) continue;
          seenMajorStoryUrls.add(url);
          if (acceptedItems.some((item) => String(item?.url || "").trim() === String(candidate?.url || "").trim())) continue;
          if (!isMajorStoryCandidate(candidate, {
            strictQualityConfig,
            configDigest,
            nowMs,
            selectedItems: acceptedItems,
          })) continue;
          majorStoryPool.push(candidate);
        }
        majorStoryPool.sort((left, right) => Number(right?._score || 0) - Number(left?._score || 0));

        for (const candidate of majorStoryPool.slice(0, 5)) {
          const url = String(candidate?.url || "").trim();
          majorStoryDiagnostics.detected_count += 1;
          strictMajorStorySummary.detected_count += 1;
          majorStoryDiagnostics.detected_candidates.push({
            url: url || null,
            headline: String(candidate?.headline || "").slice(0, 160) || null,
            score: Number.isFinite(Number(candidate?._score)) ? Number(candidate._score) : null,
          });
          const preparedCandidate = needsEnrichment(candidate)
            ? ((await enrichTaggedEntries([{ tag: topicTag, item: candidate }], {
                phase: "major_story",
                topic_tag: topicTag,
              }))[0]?.item || candidate)
            : candidate;

          if (acceptedItems.length < backfillPolicy.itemsPerTopic) {
            const evaluation = evaluateCandidateForTopic(topicTag, preparedCandidate, acceptedItems, remainingExceptions);
            if (evaluation.pass) {
              const accepted = attachStrictQuality(preparedCandidate, evaluation, {
                major_story_candidate: true,
                inclusion_reason: "major_story_underfill_fill",
              });
              acceptedItems.push(accepted);
              if (evaluation.exception_used === true) remainingExceptions = Math.max(0, remainingExceptions - 1);
              majorStoryDiagnostics.swap_count += 1;
              strictMajorStorySummary.swap_count += 1;
              continue;
            }
            const blocked = attachStrictQuality(preparedCandidate, evaluation, {
              major_story_candidate: true,
              major_story_block_reason: evaluation.rejected_reason || "major_story_rejected",
            });
            rejectedItems.push(blocked);
            appendRejectedItems(failedItemsByTopic, topicTag, [blocked]);
            majorStoryDiagnostics.blocked_count += 1;
            strictMajorStorySummary.blocked_count += 1;
            majorStoryDiagnostics.blocked_candidates.push({
              url: url || null,
              headline: String(preparedCandidate?.headline || "").slice(0, 160) || null,
              reason: evaluation.rejected_reason || "major_story_rejected",
            });
            continue;
          }

          const weakestIndex = weakestAcceptedIndex(acceptedItems);
          if (weakestIndex === -1) break;
          const swapOut = acceptedItems[weakestIndex];
          const acceptedWithoutWeakest = acceptedItems.filter((_item, index) => index !== weakestIndex);
          const swapBudget = Math.max(
            0,
            remainingExceptions + (swapOut?.exception_used === true ? 1 : 0)
          );
          const evaluation = evaluateCandidateForTopic(topicTag, preparedCandidate, acceptedWithoutWeakest, swapBudget);
          if (evaluation.pass) {
            const accepted = attachStrictQuality(preparedCandidate, evaluation, {
              major_story_candidate: true,
              inclusion_reason: "major_story_swap",
            });
            acceptedItems.splice(weakestIndex, 1, accepted);
            if (swapOut?.exception_used === true) remainingExceptions += 1;
            if (evaluation.exception_used === true) remainingExceptions = Math.max(0, remainingExceptions - 1);
            const swappedOut = {
              ...swapOut,
              selection_reason: "major_story_swapped_out",
            };
            rejectedItems.push(swappedOut);
            appendRejectedItems(failedItemsByTopic, topicTag, [swappedOut]);
            majorStoryDiagnostics.swap_count += 1;
            strictMajorStorySummary.swap_count += 1;
            continue;
          }
          const blocked = attachStrictQuality(preparedCandidate, evaluation, {
            major_story_candidate: true,
            major_story_block_reason: evaluation.rejected_reason || "major_story_rejected",
          });
          rejectedItems.push(blocked);
          appendRejectedItems(failedItemsByTopic, topicTag, [blocked]);
          majorStoryDiagnostics.blocked_count += 1;
          strictMajorStorySummary.blocked_count += 1;
          majorStoryDiagnostics.blocked_candidates.push({
            url: url || null,
            headline: String(preparedCandidate?.headline || "").slice(0, 160) || null,
            reason: evaluation.rejected_reason || "major_story_rejected",
          });
        }
      }

      let shipReady = {
        pass: true,
        reason: strictQualityEnabled ? "bucket_not_evaluated" : "strict_quality_disabled",
        lead_item_reason: null,
        signal_density: 0,
      };
      if (strictQualityEnabled) {
        shipReady = evaluateTopicBucketShipReady(acceptedItems, {
          strictQualityConfig,
          configDigest,
          maxItemsPerSourceDomain: backfillPolicy.maxItemsPerSourceDomain,
          nowMs,
          topicCandidates: [
            ...initialItems,
            ...(Array.isArray(reserves[topicTag]) ? reserves[topicTag] : []),
          ],
        });
      }

      const topicStats = ensureTopicWriteupStats(topicTag, writeupStats.topicWriteupStats);
      topicStats.underfill_due_writeup_count = Math.max(0, backfillPolicy.itemsPerTopic - acceptedItems.length);

      if (!strictQualityEnabled || shipReady.pass === true) {
        finalTopicBuckets[topicTag] = acceptedItems.slice();
        topicStats.final_selected_count = acceptedItems.length;
        writeupStats.final_selected_count += acceptedItems.length;
      } else {
        topicStats.final_selected_count = 0;
        const blockedItems = acceptedItems.map((item) => ({
          ...item,
          selection_reason: `bucket_${shipReady.reason}`,
          strict_quality: {
            ...(item?.strict_quality && typeof item.strict_quality === "object" ? item.strict_quality : {}),
            bucket_block_reason: shipReady.reason,
          },
        }));
        appendRejectedItems(failedItemsByTopic, topicTag, blockedItems);
      }
      writeupStats.underfill_due_writeup_count += topicStats.underfill_due_writeup_count;

      strictTopicDiagnostics[topicTag] = {
        initial_selected_count: initialItems.length,
        final_count: Array.isArray(finalTopicBuckets[topicTag]) ? finalTopicBuckets[topicTag].length : 0,
        underfill_count: Math.max(0, backfillPolicy.itemsPerTopic - acceptedItems.length),
        backfill_attempt_count: backfillAttemptCount,
        exception_count: acceptedItems.filter((item) => item?.exception_used === true).length,
        pass: strictQualityEnabled ? shipReady.pass === true : true,
        block_reason: strictQualityEnabled && shipReady.pass !== true ? shipReady.reason || "bucket_blocked" : null,
        lead_item_reason: shipReady.lead_item_reason || null,
        signal_density: shipReady.signal_density ?? null,
        borderline_item_count: Number(shipReady.borderline_item_count || 0),
        strong_item_count: Number(shipReady.strong_item_count || 0),
        major_story: majorStoryDiagnostics,
      };
    }

    const failedByTopic = Object.fromEntries(
      Object.entries(failedItemsByTopic).map(([tag, items]) => [tag, Array.isArray(items) ? items.slice() : []])
    );
    const finalSelected = flattenTopicBuckets(finalTopicBuckets).map(({ item }) => item);
    const normalizedWriteupSummary = normalizeAggregateWriteupStats(writeupStats, backfillPolicy.itemsPerTopic);
    const normalizedTopicWriteupStats = Object.fromEntries(
      Object.entries(writeupStats.topicWriteupStats).map(([tag, stats]) => [tag, normalizeAggregateWriteupStats(stats, backfillPolicy.itemsPerTopic)])
    );
    const updatedSelectionDiagnostics = updateSelectionDiagnosticsForWriteups(selectionDiagnostics, {
      finalSelectedByTopic: finalTopicBuckets,
      failedByTopic,
      topicWriteupStats: normalizedTopicWriteupStats,
      writeupSummary: normalizedWriteupSummary,
      itemsPerTopic: backfillPolicy.itemsPerTopic,
      strictQualityDiagnostics: {
        ...(selectionDiagnostics?.strict_quality && typeof selectionDiagnostics.strict_quality === "object"
          ? selectionDiagnostics.strict_quality
          : {}),
        topic_buckets: strictTopicDiagnostics,
        major_story: strictMajorStorySummary,
      },
    });

    const allEnrichedItems = [
      ...finalSelected,
      ...Object.values(failedByTopic).flatMap((items) => (Array.isArray(items) ? items : [])),
    ];
    const itemOutcomes = allEnrichedItems.map((item) => {
      const status = String(item?.writeup_status || "").trim().toLowerCase();
      const attemptCount = Number(item?.writeup_attempt_count || 0);
      const reasons = Array.isArray(item?.writeup_rejection_reasons) ? item.writeup_rejection_reasons : [];
      const isFailed = status === "failed_dropped";
      const isRepaired = !isFailed && attemptCount > 1;
      let failureReason = null;
      if (isFailed) {
        if (reasons.includes("timeout")) failureReason = "timeout";
        else if (reasons.includes("parse_failure") || reasons.includes("provider_parse_failure")) failureReason = "parse_failure";
        else failureReason = "model_error";
      }
      return {
        url: String(item?.url || ""),
        enrichment_status: isFailed ? "failed" : isRepaired ? "repaired" : "success",
        repair_applied: isRepaired,
        failure_reason: failureReason,
      };
    });

    return {
      enriched: finalSelected,
      finalSelectedByTopic: finalTopicBuckets,
      failedByTopic,
      claudeUsage: aggregateUsage,
      degraded,
      degradation,
      selectionDiagnostics: updatedSelectionDiagnostics,
      enrichmentDiagnostics: {
        item_outcomes: itemOutcomes,
        writeup_failure_details: writeupFailureDetails,
      },
      writeupDiagnostics: {
        ...normalizedWriteupSummary,
        topic_stats: normalizedTopicWriteupStats,
        allow_underfill_topic_tags: Object.keys(finalTopicBuckets).filter((tag) => {
          const stats = normalizedTopicWriteupStats[tag];
          return Number(stats?.underfill_due_writeup_count || 0) > 0 && Number(stats?.final_selected_count || 0) > 0;
        }),
      },
    };
  }

  return {
    enrichSelectedItems,
  };
}

module.exports = {
  createDigestOrchestratorEnrichmentRuntime,
};
