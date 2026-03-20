"use strict";

const {
  buildSemanticRepeatIndex,
  isSemanticRepeatItem,
} = require("../digest/runtime/repeat-freshness-runtime");

function isStrictFreshnessMode(mode) {
  const normalized = String(mode || "").trim().toLowerCase();
  return normalized === "scheduled";
}

function isTopFitItem(item) {
  const topicMatch = Number(item?.topicMatch || 0);
  return topicMatch >= 7 || (Array.isArray(item?.why_shown) && item.why_shown.includes("custom_keyword"));
}

function applyTopFitCoverageFloor(items, requestedCount, minimumTopFit = 3) {
  const arr = Array.isArray(items) ? items : [];
  const count = Math.max(1, Number(requestedCount || 5));
  const floor = Math.min(count, Math.max(0, Number(minimumTopFit || 0)));
  if (!arr.length || floor <= 0) return arr.slice();

  const topFit = [];
  const other = [];
  for (const item of arr) {
    if (isTopFitItem(item)) topFit.push(item);
    else other.push(item);
  }
  if (topFit.length >= floor) {
    const head = topFit.slice(0, floor);
    const used = new Set(head.map((item) => `${item?.url || ""}::${item?.headline || ""}`));
    const tail = [...topFit.slice(floor), ...other].filter((item) => {
      const key = `${item?.url || ""}::${item?.headline || ""}`;
      if (used.has(key)) return false;
      used.add(key);
      return true;
    });
    return [...head, ...tail];
  }
  return arr.slice();
}

function countWeakSourceItems(items = []) {
  return (Array.isArray(items) ? items : []).filter((item) => {
    const sourceAuthority = Number(item?.source_authority || 0);
    const sourceTier = String(item?.source_tier || "").trim().toLowerCase();
    const routineScore = Number(item?.routine_item_score || 0);
    return sourceAuthority < 0.55
      || sourceTier === "corporate"
      || sourceTier === "weak"
      || sourceTier === "suspect"
      || routineScore >= 0.6;
  }).length;
}

function averageMetric(items = [], field) {
  const values = (Array.isArray(items) ? items : [])
    .map((item) => Number(item?.[field]))
    .filter((value) => Number.isFinite(value));
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function deriveDominantFailureMode({
  finalItems,
  requestedCount,
  freshnessBlockCount,
  thinPool,
}) {
  const items = Array.isArray(finalItems) ? finalItems : [];
  if (thinPool || items.length < Math.max(1, Number(requestedCount || 0))) return "thin_pool";
  if (freshnessBlockCount > 0) return "repeat";

  const weakSourceCount = countWeakSourceItems(items);
  if (items.length > 0 && weakSourceCount >= Math.ceil(items.length / 2)) return "weak_source";

  const avgTopicMatch = averageMetric(items, "topicMatch");
  const topFitCount = items.filter(isTopFitItem).length;
  const requiredTopFit = Math.min(3, Math.max(1, Number(requestedCount || 0)), items.length);
  if ((requiredTopFit > 0 && topFitCount < requiredTopFit) || avgTopicMatch < 4.5) return "topic_fit";

  return "unknown";
}

function createDigestOrchestratorDeliveryRankingRuntime(deps) {
  const {
    CONFIG,
    log,
    filterItemsByTopics,
    applyTopicRelevanceScores,
    buildRecentEntityHistory,
    suppressRecentlySentForUser,
    isRecentRepeatItem,
    parseSourceDomain,
    applyEntityCoverageCap,
    reserveCustomKeywordSlot,
  } = deps;

  function filterFreshCandidates(items, opts = {}) {
    const arr = Array.isArray(items) ? items : [];
    const currentUrls = opts.currentUrls instanceof Set
      ? opts.currentUrls
      : new Set(Array.isArray(opts.currentUrls) ? opts.currentUrls : []);
    const globalRepeatIndex = opts.globalRepeatIndex || null;
    const userRepeatIndex = opts.userRepeatIndex || null;
    const kept = [];
    let removedGlobal = 0;
    let removedUser = 0;
    let removedCurrent = 0;

    for (const item of arr) {
      const url = String(item?.url || "").trim();
      if (url && currentUrls.has(url)) {
        removedCurrent += 1;
        continue;
      }
      if (globalRepeatIndex && isSemanticRepeatItem(item, globalRepeatIndex)) {
        removedGlobal += 1;
        continue;
      }
      if (userRepeatIndex && isSemanticRepeatItem(item, userRepeatIndex)) {
        removedUser += 1;
        continue;
      }
      kept.push(item);
    }

    return {
      items: kept,
      removedGlobal,
      removedUser,
      removedCurrent,
    };
  }

  function rankAndSuppressUserItems(params) {
    const {
      user,
      enriched,
      repeatIndex,
      repeatPenalty,
      depthPolicy,
      rankingPolicy,
      recentDigestRecords,
      nowIso,
      deliveryMode,
      runDiagnostics,
    } = params;

    const prefs = user.preferences || {};
    const sourcePrefs = user.source_preferences || {};
    const blockedSources = new Set(Array.isArray(sourcePrefs.blocked_sources) ? sourcePrefs.blocked_sources : []);
    const trustedSources = new Set(Array.isArray(sourcePrefs.trusted_sources) ? sourcePrefs.trusted_sources : []);
    let wasFiltered = false;
    let userItems = enriched;
    const filteredResult = filterItemsByTopics(enriched, user.topics || [], {
      minItems: depthPolicy.minFilteredItems,
      strictZeroFallback: "specialist",
    });
    const customKeywords = filteredResult.customKeywords || [];
    const specialistMode = Boolean(filteredResult.specialistMode);
    userItems = filteredResult.items;
    wasFiltered = filteredResult.wasFiltered;
    const recentHistory = typeof buildRecentEntityHistory === "function"
      ? buildRecentEntityHistory(
        recentDigestRecords,
        Math.max(1, Number(CONFIG.digest.perUserEntityHistoryDigests || 3))
      )
      : { entityCounts: {}, storylineKeys: new Set() };
    const recentUserRepeatIndex = buildSemanticRepeatIndex(
      (Array.isArray(recentDigestRecords) ? recentDigestRecords : []).flatMap((record) => (
        Array.isArray(record?.items) ? record.items : []
      ))
    );

    const weights = user.topic_weights || {};
    const hasWeights = Object.values(weights).some((value) => value !== 0);
    if (hasWeights) {
      log(`  [weights] ${user.email || user.chatId}: ${JSON.stringify(weights)}`);
      log(`  [pre-sort] ${userItems.map((item) => `${item.tag}(${item.baseScore})`).join(", ")}`);
    }

    userItems = applyTopicRelevanceScores(userItems, user.topics || [], weights, {
      specialistMode,
      repeatPenalty,
      isRecentRepeat: (item) => isRecentRepeatItem(item, repeatIndex),
      sourceDomainForItem: parseSourceDomain,
      recentEntityCounts: recentHistory.entityCounts,
      recentStorylineKeys: recentHistory.storylineKeys,
      blockedSources,
      trustedSources,
      nowIso,
    });
    userItems.sort((a, b) => b.relevanceScore - a.relevanceScore);
    userItems = typeof applyEntityCoverageCap === "function"
      ? applyEntityCoverageCap(userItems, Math.max(1, Number(CONFIG.digest.maxSignalsPerEntity || 1)))
      : userItems;

    const requestedCount = Number(prefs.items_per_digest || depthPolicy.defaultItemCount || 5);
    const strictFreshness = isStrictFreshnessMode(deliveryMode);
    const freshnessLookbackDigests = strictFreshness
      ? Math.max(1, Number(CONFIG.digest.scheduledFreshnessWindowDays || 5))
      : Math.max(1, Number(CONFIG.digest.perUserFreshnessDigests || 3));
    const perUserFreshnessMin = Math.max(1, Math.min(requestedCount, Number(CONFIG.digest.perUserFreshnessMinItems || 3)));
    const suppression = suppressRecentlySentForUser(userItems, user, {
      maxDigests: freshnessLookbackDigests,
      minItems: perUserFreshnessMin,
    });
    if (strictFreshness && suppression.removed > 0) {
      userItems = suppression.items;
      log(`  [freshness-user] ${user.email || user.chatId}: removed ${suppression.removed} recent repeat(s)`);
    } else if (!strictFreshness && suppression.removed > 0) {
      log(`  [freshness-soft] ${user.email || user.chatId}: would remove ${suppression.removed} recent repeat(s) in scheduled mode`);
    }

    const semanticPreviewBase = strictFreshness ? userItems : suppression.items;
    const semanticFreshness = filterFreshCandidates(semanticPreviewBase, {
      globalRepeatIndex: strictFreshness ? repeatIndex : null,
      userRepeatIndex: strictFreshness ? recentUserRepeatIndex : null,
    });
    if (strictFreshness && (semanticFreshness.removedGlobal > 0 || semanticFreshness.removedUser > 0)) {
      userItems = semanticFreshness.items;
      log(
        `  [freshness-semantic] ${user.email || user.chatId}: removed ${semanticFreshness.removedGlobal} global and ${semanticFreshness.removedUser} per-user storyline repeat(s)`
      );
    } else if (!strictFreshness && (semanticFreshness.removedGlobal > 0 || semanticFreshness.removedUser > 0)) {
      log(
        `  [freshness-soft] ${user.email || user.chatId}: would remove ${semanticFreshness.removedGlobal} global and ${semanticFreshness.removedUser} per-user storyline repeat(s) in scheduled mode`
      );
    }

    const minStrategicValue = Math.max(0, Math.min(1, Number(CONFIG.digest.minStrategicValue ?? rankingPolicy.minStrategicValue ?? 0.34)));
    const maxRoutineScore = Math.max(0, Math.min(1, Number(CONFIG.digest.maxRoutineScore ?? rankingPolicy.maxRoutineScore ?? 0.65)));
    const minSignalScoreForFinal = Number(CONFIG.digest.minSignalScoreForFinal ?? rankingPolicy.minSignalScoreForFinal ?? 5.0);
    let qualityBackfillCount = 0;
    let minCountBackfillCount = 0;
    let emergencyFallbackCount = 0;
    const qualityEligible = userItems.filter((item) => (
      !item?.hard_exclude
      && Number(item?.strategic_value || 0) >= minStrategicValue
      && Number(item?.routine_item_score || 0) <= maxRoutineScore
      && Number(item?.relevanceScore || 0) >= minSignalScoreForFinal
    ));
    if (qualityEligible.length > 0) {
      if (qualityEligible.length < requestedCount) {
        const qualityUrls = new Set(qualityEligible.map((i) => i.url));
        const backfill = filterFreshCandidates(
          userItems
          .filter((item) => !item?.hard_exclude && !qualityUrls.has(item.url))
          , {
            currentUrls: qualityUrls,
            globalRepeatIndex: strictFreshness ? repeatIndex : null,
            userRepeatIndex: strictFreshness ? recentUserRepeatIndex : null,
          }
        ).items.slice(0, requestedCount - qualityEligible.length);
        userItems = [...qualityEligible, ...backfill];
        if (backfill.length > 0) {
          qualityBackfillCount = backfill.length;
          log(`  [quality-backfill] added ${backfill.length} item(s) to reach ${requestedCount}`);
        }
      } else {
        userItems = qualityEligible;
      }
    } else {
      userItems = userItems.filter((item) => !item?.hard_exclude);
    }

    if (hasWeights) {
      log(`  [post-sort] ${userItems.map((item) => `${item.tag}(${item.relevanceScore})`).join(", ")}`);
    }

    userItems = applyTopFitCoverageFloor(userItems, requestedCount, Number(CONFIG.digest.minTopFitItems || 3));
    userItems = reserveCustomKeywordSlot(userItems, requestedCount, customKeywords);

    // Minimum-count backfill: if we have fewer than requestedCount items,
    // pull additional items from the full enriched pool (re-scored) to reach the minimum.
    if (userItems.length > 0 && userItems.length < requestedCount) {
      const currentUrls = new Set(userItems.map((i) => i.url));
      const poolCandidates = filterFreshCandidates(
        applyTopicRelevanceScores(enriched, user.topics || [], weights, {
          specialistMode: false,
          repeatPenalty,
          isRecentRepeat: (item) => isRecentRepeatItem(item, repeatIndex),
          sourceDomainForItem: parseSourceDomain,
          recentEntityCounts: recentHistory.entityCounts,
          recentStorylineKeys: recentHistory.storylineKeys,
          blockedSources,
          trustedSources,
          nowIso,
        })
          .filter((item) => !item?.hard_exclude && !currentUrls.has(item.url))
          .sort((a, b) => b.relevanceScore - a.relevanceScore),
        {
          currentUrls,
          globalRepeatIndex: strictFreshness ? repeatIndex : null,
          userRepeatIndex: strictFreshness ? recentUserRepeatIndex : null,
        }
      ).items.slice(0, requestedCount - userItems.length);
      if (poolCandidates.length > 0) {
        userItems = [...userItems, ...poolCandidates];
        minCountBackfillCount = poolCandidates.length;
        log(`  [min-count-backfill] added ${poolCandidates.length} item(s) from enriched pool to reach ${userItems.length}/${requestedCount}`);
      }
    }

    if (userItems.length === 0) {
      const emergencyCount = Math.max(1, Math.min(3, requestedCount));
      const emergency = filterFreshCandidates(
        applyTopicRelevanceScores(enriched, user.topics || [], weights, {
          specialistMode: false,
          repeatPenalty,
          isRecentRepeat: (item) => isRecentRepeatItem(item, repeatIndex),
          sourceDomainForItem: parseSourceDomain,
          recentEntityCounts: recentHistory.entityCounts,
          recentStorylineKeys: recentHistory.storylineKeys,
          blockedSources,
          trustedSources,
          nowIso,
        })
          .sort((a, b) => b.relevanceScore - a.relevanceScore)
          .filter((item) => !item?.hard_exclude)
          .filter((item) => Number(item?.routine_item_score || 0) <= maxRoutineScore)
          .filter((item) => Number(item?.strategic_value || 0) >= (minStrategicValue * 0.9)),
        {
          globalRepeatIndex: strictFreshness ? repeatIndex : null,
          userRepeatIndex: strictFreshness ? recentUserRepeatIndex : null,
        }
      ).items.slice(0, emergencyCount);
      const emergencyCapped = typeof applyEntityCoverageCap === "function"
        ? applyEntityCoverageCap(emergency, Math.max(1, Number(CONFIG.digest.maxSignalsPerEntity || 1)))
        : emergency;
      const emergencyDeliverable = emergencyCapped
        .slice(0, emergencyCount);
      if (emergencyDeliverable.length > 0) {
        userItems = emergencyDeliverable;
        wasFiltered = false;
        emergencyFallbackCount = emergencyDeliverable.length;
        log(`⚠️ Emergency fallback items used for ${user.email || user.chatId} (count=${emergencyDeliverable.length})`);
      }
    }

    if (userItems.length === 0) {
      throw new Error("No deliverable items after emergency fallback");
    }

    userItems = applyTopFitCoverageFloor(userItems, requestedCount, Number(CONFIG.digest.minTopFitItems || 3));

    const freshnessBlockCount = Math.max(0, Number(suppression.removed || 0))
      + Math.max(0, Number(semanticFreshness.removedGlobal || 0))
      + Math.max(0, Number(semanticFreshness.removedUser || 0));
    const semanticRepeatBlockCount = Math.max(0, Number(suppression.storyline_suppressed || 0))
      + Math.max(0, Number(suppression.freshness_suppressed || 0))
      + Math.max(0, Number(suppression.semantic_suppressed || 0))
      + Math.max(0, Number(semanticFreshness.removedGlobal || 0))
      + Math.max(0, Number(semanticFreshness.removedUser || 0));
    const thinPool = userItems.length < requestedCount;
    let fallbackReason = null;
    if (qualityBackfillCount > 0) fallbackReason = "quality_backfill";
    if (minCountBackfillCount > 0) fallbackReason = "min_count_backfill";
    if (emergencyFallbackCount > 0) fallbackReason = "emergency_fallback";
    if (!fallbackReason && thinPool) fallbackReason = "thin_pool";

    return {
      userItems,
      wasFiltered,
      diagnostics: {
        requested_count: requestedCount,
        strict_freshness_applied: strictFreshness,
        freshness_block_count: freshnessBlockCount,
        semantic_repeat_block_count: semanticRepeatBlockCount,
        alternate_queries_used: Math.max(0, Number(runDiagnostics?.alternate_queries_used || 0)),
        candidate_pool_before_dedup: Number.isFinite(Number(runDiagnostics?.candidate_pool_before_dedup))
          ? Number(runDiagnostics.candidate_pool_before_dedup)
          : null,
        candidate_pool_after_dedup: Number.isFinite(Number(runDiagnostics?.candidate_pool_after_dedup))
          ? Number(runDiagnostics.candidate_pool_after_dedup)
          : null,
        fallback_reason: fallbackReason,
        refill_count: qualityBackfillCount + minCountBackfillCount + emergencyFallbackCount,
        thin_pool: thinPool,
        dominant_failure_mode: deriveDominantFailureMode({
          finalItems: userItems,
          requestedCount,
          freshnessBlockCount,
          thinPool,
        }),
      },
    };
  }

  return {
    rankAndSuppressUserItems,
  };
}

module.exports = {
  createDigestOrchestratorDeliveryRankingRuntime,
};
