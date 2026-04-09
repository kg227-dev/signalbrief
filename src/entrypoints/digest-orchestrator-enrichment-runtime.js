"use strict";

const {
  countTrustedSourceTier,
} = require("../domains/digest/candidate-quality-runtime");
const {
  evaluateFinalDigestAssembly,
  evaluateTopicBucketShipReady,
  evaluateTopicItem,
  isMajorStoryCandidate,
  resolveStrictQualityConfig,
} = require("../digest/domain/strict-quality-domain-runtime");

const {
  accumulateWriteupStatsFromTaggedItems,
  appendRejectedItems,
  attachStrictQuality,
  cloneReserveState,
  ensureTopicWriteupStats,
  flattenTopicBuckets,
  mapEnrichedTopicBuckets,
  normalizeAggregateWriteupStats,
  pickNextReserveCandidate,
  summarizeRejectedReason,
  updateSelectionDiagnosticsForWriteups,
} = require("./digest-orchestrator-enrichment-helpers-runtime");

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
      ? Object.fromEntries(Object.entries(reserveByTopic).map(([tag, reserveState]) => [String(tag || "").trim().toUpperCase(), cloneReserveState(reserveState)]))
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
        + Number(reserves[normalizedTag]?.allReserve?.length || 0);
    }

    const writeupStats = {
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
    };
    const usedUrls = new Set(flattenTopicBuckets(topicBuckets).map(({ item }) => String(item?.url || "").trim()).filter(Boolean));
    const reserveCursors = Object.fromEntries(
      [...new Set([...Object.keys(topicBuckets), ...Object.keys(reserves)])].map((tag) => [tag, { strong: 0, standard: 0 }])
    );
    const failedItemsByTopic = Object.create(null);
    const finalTopicBuckets = Object.create(null);
    const topicReserveDiagnostics = Object.create(null);
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
        || !(item?.wim_extraction && typeof item.wim_extraction === "object");
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
      let standardTierBlockedWhileStrongAvailable = true;
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
            reserveState: reserves[topicTag],
            reserveCursor: reserveCursors[topicTag] || { strong: 0, standard: 0 },
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
        const remainingReserve = [
          ...(Array.isArray(reserves[topicTag]?.strongReserve)
            ? reserves[topicTag].strongReserve.slice(reserveCursors[topicTag]?.strong || 0)
            : []),
          ...(Array.isArray(reserves[topicTag]?.standardReserve)
            ? reserves[topicTag].standardReserve.slice(reserveCursors[topicTag]?.standard || 0)
            : []),
        ];
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
            ...(Array.isArray(reserves[topicTag]?.allReserve) ? reserves[topicTag].allReserve : []),
          ],
        });
      }

      const topicStats = ensureTopicWriteupStats(topicTag, writeupStats.topicWriteupStats);
      topicStats.underfill_due_writeup_count = Math.max(0, backfillPolicy.itemsPerTopic - acceptedItems.length);
      const remainingStrongReserveCount = Math.max(
        0,
        Number(reserves[topicTag]?.strongReserve?.length || 0) - Number(reserveCursors[topicTag]?.strong || 0)
      );
      const remainingStandardReserveCount = Math.max(
        0,
        Number(reserves[topicTag]?.standardReserve?.length || 0) - Number(reserveCursors[topicTag]?.standard || 0)
      );
      const trustedFloorState = backfillPolicy.trustedFloor?.byTopic?.[topicTag] || {};
      const currentStrongSelectedCount = countTrustedSourceTier(acceptedItems);
      const strongPoolExhausted = trustedFloorState.active === true
        && currentStrongSelectedCount < Math.max(0, Number(trustedFloorState.minTrustedItemsPerTopic || 0))
        && remainingStrongReserveCount <= 0;
      topicReserveDiagnostics[topicTag] = {
        remaining_reserve_count: remainingStrongReserveCount + remainingStandardReserveCount,
        remaining_strong_reserve_count: remainingStrongReserveCount,
        remaining_standard_reserve_count: remainingStandardReserveCount,
        strong_pool_exhausted: strongPoolExhausted,
        standard_tier_blocked_while_strong_available: standardTierBlockedWhileStrongAvailable,
      };

      if (!strictQualityEnabled || shipReady.pass === true) {
        finalTopicBuckets[topicTag] = acceptedItems.slice();
        topicStats.final_selected_count = acceptedItems.length;
        topicStats.strong_tier_final_selected_count = countTrustedSourceTier(acceptedItems);
        writeupStats.final_selected_count += acceptedItems.length;
        writeupStats.strong_tier_final_selected_count += topicStats.strong_tier_final_selected_count;
      } else {
        topicStats.final_selected_count = 0;
        topicStats.strong_tier_final_selected_count = 0;
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
        strong_pool_exhausted: strongPoolExhausted,
        standard_tier_blocked_while_strong_available: standardTierBlockedWhileStrongAvailable,
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
      topicReserveDiagnostics,
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
        candidate_tier: String(item?.writeup_stage_diagnostics?.candidate_tier || "").trim() || null,
        enrichment_status: isFailed ? "failed" : isRepaired ? "repaired" : "success",
        repair_applied: isRepaired,
        failure_reason: failureReason,
        extraction_output: item?.extraction_output || item?.wim_extraction || null,
        wim_output: item?.wim_output || item?.wim || null,
        repair_type: item?.repair_type || null,
        parse_failure_type: item?.parse_failure_type || null,
        final_status: item?.final_status || null,
        first_pass_succeeded: item?.first_pass_succeeded === true,
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
