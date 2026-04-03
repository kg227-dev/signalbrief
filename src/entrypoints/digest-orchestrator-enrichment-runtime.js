"use strict";

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
  for (let index = reserveCursor; index < reserveQueue.length; index += 1) {
    const candidate = reserveQueue[index];
    const url = String(candidate?.url || "").trim();
    if (url && usedUrls.has(url)) continue;
    const rejectionReason = getBackfillRejectionReason(candidate, selectedItems, {
      maxItemsPerSourceDomain: policy.maxItemsPerSourceDomain,
      maxDiscoveryPerTopic: policy.maxDiscoveryPerTopic,
      commentaryCap: policy.commentaryCapPerTopic,
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
        };
      }
      const failedReasons = Array.isArray(failed?.writeup_rejection_reasons) ? failed.writeup_rejection_reasons.slice() : [];
      const selectionReason = failed ? "writeup_failed" : String(candidate?.selection_reason || "selection_not_selected").trim() || "selection_not_selected";
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
      };
    });

    topicAudit.selected_count = finalSelectedItems.length;
    topicAudit.rejected_count = Math.max(0, Number(topicAudit.total_candidates || topicAudit.candidates.length) - finalSelectedItems.length);
    topicAudit.rejection_reason_counts = rejectionCounts;
    const topicStats = topicWriteupStats[tag] || {};
    topicAudit.writeup = normalizeAggregateWriteupStats(topicStats, params.itemsPerTopic);
  }

  return {
    ...selectionDiagnostics,
    writeup: normalizeAggregateWriteupStats(writeupSummary, params.itemsPerTopic),
    topic_selection_audit: topicAudits,
  };
}

function createDigestOrchestratorEnrichmentRuntime(deps) {
  const {
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
    } = params;

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
      maxItemsPerSourceDomain: Math.max(1, Number(writeupBackfillPolicy?.maxItemsPerSourceDomain || 5)),
      maxDiscoveryPerTopic: Math.max(0, Number(writeupBackfillPolicy?.maxDiscoveryPerTopic ?? 1)),
      commentaryCapPerTopic: Math.max(0, Number(writeupBackfillPolicy?.commentaryCapPerTopic ?? 1)),
    };

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
    const reserveCursors = Object.fromEntries(Object.keys(reserves).map((tag) => [tag, 0]));
    const failedItemsByTopic = Object.create(null);
    let aggregateUsage = { input_tokens: 0, output_tokens: 0 };
    let degraded = false;
    let degradation = null;

    const flattenedInitial = flattenTopicBuckets(topicBuckets);
    if (flattenedInitial.length > 0) {
      const enrichment = await enrichItems(flattenedInitial.map((entry) => entry.item), enrichOpts);
      degraded = enrichment?.degraded === true;
      degradation = enrichment?.degradation || null;
      aggregateUsage.input_tokens += Number(enrichment?.usage?.input_tokens || 0);
      aggregateUsage.output_tokens += Number(enrichment?.usage?.output_tokens || 0);
      const enrichedTopicBuckets = mapEnrichedTopicBuckets(flattenedInitial, Array.isArray(enrichment?.items) ? enrichment.items : []);
      appendFailedItems(failedItemsByTopic, enrichedTopicBuckets);
      accumulateWriteupStatsFromTaggedItems(
        writeupStats,
        flattenTopicBuckets(enrichedTopicBuckets)
      );
      for (const [tag, itemsForTopic] of Object.entries(enrichedTopicBuckets)) {
        topicBuckets[tag] = itemsForTopic;
      }
      if (enrichment?.degraded && degradation?.provider) {
        await emitIncident(
          `${degradation.provider}-partial-degradation`,
          `${degradation.provider} degradation during enrichment (${degradation.reason || "unknown"})`,
          {
            mode: runMode,
            due_users: Number(dueUsersCount || 0),
            selected_items: flattenedInitial.length,
            provider: degradation.provider,
            reason: degradation.reason || "unknown",
            status_code: degradation.status_code != null ? Number(degradation.status_code) : null,
            timeout_ms: degradation.timeout_ms != null ? Number(degradation.timeout_ms) : null,
          }
        );
      }
    }

    let keepBackfilling = true;
    while (keepBackfilling) {
      keepBackfilling = false;
      const replacementTargets = [];
      const replacementCandidates = [];

      for (const tag of Object.keys(topicBuckets)) {
        const topicTag = String(tag || "").trim().toUpperCase();
        const currentItems = Array.isArray(topicBuckets[topicTag]) ? topicBuckets[topicTag] : [];
        const successfulItems = currentItems.filter((item) => String(item?.writeup_status || "").trim().toLowerCase() !== "failed_dropped");
        topicBuckets[topicTag] = successfulItems;

        while (topicBuckets[topicTag].length + replacementTargets.filter((entry) => entry.tag === topicTag).length < backfillPolicy.itemsPerTopic) {
          const nextCandidate = pickNextReserveCandidate({
            reserveQueue: reserves[topicTag],
            reserveCursor: reserveCursors[topicTag] || 0,
            selectedItems: topicBuckets[topicTag].concat(
              replacementTargets
                .filter((entry) => entry.tag === topicTag)
                .map((entry) => entry.item)
            ),
            usedUrls,
            getBackfillRejectionReason: resolveBackfillRejection,
            policy: backfillPolicy,
          });
          reserveCursors[topicTag] = nextCandidate.nextCursor;
          if (!nextCandidate.candidate) break;
          const url = String(nextCandidate.candidate?.url || "").trim();
          if (url) usedUrls.add(url);
          replacementTargets.push({ tag: topicTag, item: nextCandidate.candidate });
          replacementCandidates.push(nextCandidate.candidate);
          keepBackfilling = true;
        }
      }

      if (!replacementCandidates.length) break;

      const replacementEnrichment = await enrichItems(replacementCandidates, enrichOpts);
      aggregateUsage.input_tokens += Number(replacementEnrichment?.usage?.input_tokens || 0);
      aggregateUsage.output_tokens += Number(replacementEnrichment?.usage?.output_tokens || 0);
      if (replacementEnrichment?.degraded === true) {
        degraded = true;
        degradation = replacementEnrichment?.degradation || degradation;
      }
      const enrichedReplacements = Array.isArray(replacementEnrichment?.items) ? replacementEnrichment.items : [];
      const replacementBuckets = Object.create(null);
      for (let index = 0; index < replacementTargets.length; index += 1) {
        const tag = String(replacementTargets[index]?.tag || "").trim().toUpperCase();
        if (!tag) continue;
        if (!replacementBuckets[tag]) replacementBuckets[tag] = [];
        replacementBuckets[tag].push(enrichedReplacements[index] || replacementTargets[index].item);
      }
      appendFailedItems(failedItemsByTopic, replacementBuckets);
      accumulateWriteupStatsFromTaggedItems(
        writeupStats,
        replacementTargets.map((entry, index) => ({
          tag: entry.tag,
          item: enrichedReplacements[index] || entry.item,
        }))
      );
      for (let index = 0; index < replacementTargets.length; index += 1) {
        const tag = replacementTargets[index].tag;
        if (!topicBuckets[tag]) topicBuckets[tag] = [];
        topicBuckets[tag].push(enrichedReplacements[index] || replacementTargets[index].item);
      }
    }

    const failedByTopic = appendFailedItems(Object.create(null), failedItemsByTopic);
    for (const tag of Object.keys(topicBuckets)) {
      topicBuckets[tag] = (Array.isArray(topicBuckets[tag]) ? topicBuckets[tag] : []).filter((item) => String(item?.writeup_status || "").trim().toLowerCase() !== "failed_dropped");
      const topicStats = ensureTopicWriteupStats(tag, writeupStats.topicWriteupStats);
      topicStats.final_selected_count = topicBuckets[tag].length;
      topicStats.underfill_due_writeup_count = Math.max(0, backfillPolicy.itemsPerTopic - topicBuckets[tag].length);
      writeupStats.final_selected_count += topicBuckets[tag].length;
      writeupStats.underfill_due_writeup_count += topicStats.underfill_due_writeup_count;
    }

    const finalSelected = flattenTopicBuckets(topicBuckets).map(({ item }) => item);
    const normalizedWriteupSummary = normalizeAggregateWriteupStats(writeupStats, backfillPolicy.itemsPerTopic);
    const normalizedTopicWriteupStats = Object.fromEntries(
      Object.entries(writeupStats.topicWriteupStats).map(([tag, stats]) => [tag, normalizeAggregateWriteupStats(stats, backfillPolicy.itemsPerTopic)])
    );
    const updatedSelectionDiagnostics = updateSelectionDiagnosticsForWriteups(selectionDiagnostics, {
      finalSelectedByTopic: topicBuckets,
      failedByTopic,
      topicWriteupStats: normalizedTopicWriteupStats,
      writeupSummary: normalizedWriteupSummary,
      itemsPerTopic: backfillPolicy.itemsPerTopic,
    });

    return {
      enriched: finalSelected,
      finalSelectedByTopic: topicBuckets,
      failedByTopic,
      claudeUsage: aggregateUsage,
      degraded,
      degradation,
      selectionDiagnostics: updatedSelectionDiagnostics,
      writeupDiagnostics: {
        ...normalizedWriteupSummary,
        topic_stats: normalizedTopicWriteupStats,
        allow_underfill_topic_tags: Object.keys(topicBuckets).filter((tag) => {
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
