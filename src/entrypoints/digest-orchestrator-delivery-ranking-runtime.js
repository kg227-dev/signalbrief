"use strict";

function createDigestOrchestratorDeliveryRankingRuntime(deps) {
  const {
    CONFIG,
    log,
    filterItemsByTopics,
    applyTopicRelevanceScores,
    suppressRecentlySentForUser,
    isRecentRepeatItem,
    parseSourceDomain,
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
    });
    userItems.sort((a, b) => b.relevanceScore - a.relevanceScore);

    const minBaseScoreForFinal = Number(rankingPolicy.minBaseScoreForFinal || 6.5);
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

    const minStrongItems = Math.max(2, Math.min(requestedCount, 4));
    const stronger = userItems.filter((item) =>
      Number(item?.baseScore || 0) >= minBaseScoreForFinal
      || (Array.isArray(item?.why_shown) && item.why_shown.includes("custom_keyword"))
    );
    if (stronger.length >= minStrongItems) {
      userItems = stronger;
    }

    if (hasWeights) {
      log(`  [post-sort] ${userItems.map((item) => `${item.tag}(${item.relevanceScore})`).join(", ")}`);
    }

    userItems = reserveCustomKeywordSlot(userItems, requestedCount, customKeywords);

    if (userItems.length === 0) {
      const emergencyCount = Math.max(1, Math.min(3, requestedCount));
      const emergency = applyTopicRelevanceScores(enriched, user.topics || [], weights, {
        specialistMode: false,
        repeatPenalty,
        isRecentRepeat: (item) => isRecentRepeatItem(item, repeatIndex),
        sourceDomainForItem: parseSourceDomain,
      })
        .sort((a, b) => b.relevanceScore - a.relevanceScore)
        .slice(0, emergencyCount);
      if (emergency.length > 0) {
        userItems = emergency;
        wasFiltered = false;
        log(`⚠️ Emergency fallback items used for ${user.email || user.chatId} (count=${emergency.length})`);
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
