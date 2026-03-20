"use strict";

const {
  buildSemanticRepeatIndex,
  isSemanticRepeatItem,
} = require("../digest/runtime/repeat-freshness-runtime");

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
    const perUserFreshnessMin = Math.max(1, Math.min(requestedCount, Number(CONFIG.digest.perUserFreshnessMinItems || 3)));
    const suppression = suppressRecentlySentForUser(userItems, user, {
      maxDigests: Math.max(1, Number(CONFIG.digest.perUserFreshnessDigests || 3)),
      minItems: perUserFreshnessMin,
    });
    if (suppression.removed > 0) {
      userItems = suppression.items;
      log(`  [freshness-user] ${user.email || user.chatId}: removed ${suppression.removed} recent repeat(s)`);
    }

    const semanticFreshness = filterFreshCandidates(userItems, {
      globalRepeatIndex: repeatIndex,
      userRepeatIndex: recentUserRepeatIndex,
    });
    if (semanticFreshness.removedGlobal > 0 || semanticFreshness.removedUser > 0) {
      userItems = semanticFreshness.items;
      log(
        `  [freshness-semantic] ${user.email || user.chatId}: removed ${semanticFreshness.removedGlobal} global and ${semanticFreshness.removedUser} per-user storyline repeat(s)`
      );
    }

    const minStrategicValue = Math.max(0, Math.min(1, Number(CONFIG.digest.minStrategicValue ?? rankingPolicy.minStrategicValue ?? 0.34)));
    const maxRoutineScore = Math.max(0, Math.min(1, Number(CONFIG.digest.maxRoutineScore ?? rankingPolicy.maxRoutineScore ?? 0.74)));
    const minSignalScoreForFinal = Number(CONFIG.digest.minSignalScoreForFinal ?? rankingPolicy.minSignalScoreForFinal ?? 5.0);
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
            globalRepeatIndex: repeatIndex,
            userRepeatIndex: recentUserRepeatIndex,
          }
        ).items.slice(0, requestedCount - qualityEligible.length);
        userItems = [...qualityEligible, ...backfill];
        if (backfill.length > 0) {
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
          globalRepeatIndex: repeatIndex,
          userRepeatIndex: recentUserRepeatIndex,
        }
      ).items.slice(0, requestedCount - userItems.length);
      if (poolCandidates.length > 0) {
        userItems = [...userItems, ...poolCandidates];
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
          globalRepeatIndex: repeatIndex,
          userRepeatIndex: recentUserRepeatIndex,
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
        log(`⚠️ Emergency fallback items used for ${user.email || user.chatId} (count=${emergencyDeliverable.length})`);
      }
    }

    if (userItems.length === 0) {
      throw new Error("No deliverable items after emergency fallback");
    }

    return {
      userItems,
      wasFiltered,
    };
  }

  return {
    rankAndSuppressUserItems,
  };
}

module.exports = {
  createDigestOrchestratorDeliveryRankingRuntime,
};
