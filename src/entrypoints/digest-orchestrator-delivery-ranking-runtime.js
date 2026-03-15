"use strict";

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
      nowIso,
    });
    userItems.sort((a, b) => b.relevanceScore - a.relevanceScore);

    const requestedCount = Number(prefs.items_per_digest || depthPolicy.defaultItemCount || 5);
    const perUserFreshnessMin = Math.max(1, Math.min(requestedCount, Number(CONFIG.digest.perUserFreshnessMinItems || 3)));
    const suppression = suppressRecentlySentForUser(userItems, user, {
      maxDigests: Math.max(1, Number(CONFIG.digest.perUserFreshnessDigests || 3)),
      minItems: perUserFreshnessMin,
    });
    if (suppression.removed > 0) {
      userItems = suppression.items;
      log(`  [freshness-user] ${user.email || user.chatId}: removed ${suppression.removed} recent URL repeat(s)${suppression.backfilled > 0 ? `, backfilled ${suppression.backfilled}` : ""}`);
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
      userItems = qualityEligible;
    } else {
      userItems = userItems.filter((item) => !item?.hard_exclude);
    }

    if (hasWeights) {
      log(`  [post-sort] ${userItems.map((item) => `${item.tag}(${item.relevanceScore})`).join(", ")}`);
    }

    userItems = reserveCustomKeywordSlot(userItems, requestedCount, customKeywords);
    userItems = typeof applyEntityCoverageCap === "function"
      ? applyEntityCoverageCap(userItems, Math.max(1, Number(CONFIG.digest.maxSignalsPerEntity || 1)))
      : userItems;

    if (userItems.length === 0) {
      const emergencyCount = Math.max(1, Math.min(3, requestedCount));
      const emergency = applyTopicRelevanceScores(enriched, user.topics || [], weights, {
        specialistMode: false,
        repeatPenalty,
        isRecentRepeat: (item) => isRecentRepeatItem(item, repeatIndex),
        sourceDomainForItem: parseSourceDomain,
        recentEntityCounts: recentHistory.entityCounts,
        recentStorylineKeys: recentHistory.storylineKeys,
        nowIso,
      })
        .sort((a, b) => b.relevanceScore - a.relevanceScore)
        .filter((item) => !item?.hard_exclude)
        .filter((item) => Number(item?.routine_item_score || 0) <= maxRoutineScore)
        .filter((item) => Number(item?.strategic_value || 0) >= (minStrategicValue * 0.9))
        .slice(0, emergencyCount);
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
