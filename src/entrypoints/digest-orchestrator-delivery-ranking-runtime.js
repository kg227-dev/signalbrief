"use strict";

const {
  buildSemanticRepeatIndex,
  isSemanticRepeatItem,
} = require("../digest/runtime/repeat-freshness-runtime");
const {
  isWeakSourceItem,
} = require("../digest/domain/storyline-domain-runtime");

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
  return (Array.isArray(items) ? items : []).filter((item) => isWeakSourceItem(item)).length;
}

function itemNeedsCorroboration(item) {
  return item?.source_policy_effects?.requires_corroboration === true;
}

function itemIsCorroborated(item) {
  return Number(item?.cross_source_count || 0) >= 2
    || Number(item?.supporting_sources_avg_authority || 0) >= 0.7;
}

function hasCustomKeywordSignal(item) {
  return Array.isArray(item?.why_shown) && item.why_shown.includes("custom_keyword");
}

function isCustomPrecisionMode(customKeywords = [], standardTopicsLower = []) {
  const customCount = Array.isArray(customKeywords) ? customKeywords.length : 0;
  const standardCount = Array.isArray(standardTopicsLower) ? standardTopicsLower.length : 0;
  return customCount > 0 && customCount >= Math.max(1, standardCount) && standardCount <= 1;
}

function applyCustomPrecisionGate(items = [], enabled = false) {
  const ranked = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!enabled || ranked.length === 0) {
    return {
      items: ranked,
      removed: 0,
      matched: 0,
      applied: false,
    };
  }
  const customMatched = ranked.filter((item) => hasCustomKeywordSignal(item));
  if (customMatched.length === 0) {
    return {
      items: [],
      removed: ranked.length,
      matched: 0,
      applied: true,
    };
  }
  return {
    items: customMatched,
    removed: Math.max(0, ranked.length - customMatched.length),
    matched: customMatched.length,
    applied: true,
  };
}

function applySourcePolicyCaps(items = [], requestedCount = 5) {
  const ranked = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!ranked.length) return [];
  const unrestricted = [];
  const limited = [];
  const review = [];
  const deferred = [];

  for (const item of ranked) {
    const policy = String(item?.source_policy || "").trim().toLowerCase();
    if (policy === "blocked" || item?.source_hard_block === true) continue;
    if ((policy === "limited" || policy === "review") && itemNeedsCorroboration(item) && !itemIsCorroborated(item)) {
      deferred.push(item);
      continue;
    }
    if (policy === "review") review.push(item);
    else if (policy === "limited") limited.push(item);
    else unrestricted.push(item);
  }

  const limitedCap = Math.min(Math.max(1, Math.floor(Number(requestedCount || 5) / 2)), 2);
  const reviewCap = 1;
  const chosen = [
    ...unrestricted,
    ...limited.slice(0, limitedCap),
    ...review.slice(0, reviewCap),
  ];
  const fill = [...limited.slice(limitedCap), ...review.slice(reviewCap), ...deferred];
  for (const item of fill) {
    if (chosen.length >= Math.max(1, Number(requestedCount || 5))) break;
    chosen.push(item);
  }

  const leadIndex = chosen.findIndex((item) => item?.source_policy_effects?.lead_eligible !== false);
  if (leadIndex > 0) {
    const [lead] = chosen.splice(leadIndex, 1);
    chosen.unshift(lead);
  }
  return chosen;
}

function averageMetric(items = [], field) {
  const values = (Array.isArray(items) ? items : [])
    .map((item) => Number(item?.[field]))
    .filter((value) => Number.isFinite(value));
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function buildItemTraceKey(item = {}) {
  const url = String(item?.url || "").trim();
  const headline = String(item?.headline || "").trim();
  if (url) return `url:${url}`;
  if (headline) return `headline:${headline.toLowerCase()}`;
  return `tag:${String(item?.tag || "").trim().toLowerCase()}`;
}

function snapshotStage(items = [], stage, reason) {
  return {
    stage,
    reason,
    items: (Array.isArray(items) ? items : []).map((item) => ({
      key: buildItemTraceKey(item),
      url: String(item?.url || "").trim() || null,
      headline: String(item?.headline || "").trim() || null,
      tag: String(item?.tag || "").trim() || null,
      source_domain: String(item?.source_domain || "").trim() || null,
    })),
  };
}

function appendStageTrace(trace, beforeItems, afterItems, stage, reason) {
  if (!trace || !Array.isArray(trace.transitions)) return;
  const kept = new Set((Array.isArray(afterItems) ? afterItems : []).map((item) => buildItemTraceKey(item)));
  for (const item of (Array.isArray(beforeItems) ? beforeItems : [])) {
    const key = buildItemTraceKey(item);
    if (kept.has(key)) continue;
    trace.transitions.push({
      key,
      reason,
      stage,
      url: String(item?.url || "").trim() || null,
      headline: String(item?.headline || "").trim() || null,
      tag: String(item?.tag || "").trim() || null,
      source_domain: String(item?.source_domain || "").trim() || null,
    });
  }
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
      captureDiagnostics,
    } = params;

    const prefs = user.preferences || {};
    const sourcePrefs = user.source_preferences || {};
    const blockedSources = new Set(Array.isArray(sourcePrefs.blocked_sources) ? sourcePrefs.blocked_sources : []);
    const trustedSources = new Set(Array.isArray(sourcePrefs.trusted_sources) ? sourcePrefs.trusted_sources : []);
    const trace = captureDiagnostics === true
      ? {
        snapshots: [],
        transitions: [],
      }
      : null;
    let wasFiltered = false;
    let userItems = enriched;
    if (trace) trace.snapshots.push(snapshotStage(userItems, "initial", "initial"));
    const filteredResult = filterItemsByTopics(enriched, user.topics || [], {
      minItems: depthPolicy.minFilteredItems,
      strictZeroFallback: "specialist",
    });
    const customKeywords = filteredResult.customKeywords || [];
    const specialistMode = Boolean(filteredResult.specialistMode);
    if (trace) appendStageTrace(trace, userItems, filteredResult.items, "topic_filter", "filtered_by_topic");
    userItems = filteredResult.items;
    wasFiltered = filteredResult.wasFiltered;
    const standardTopicsLower = Array.isArray(filteredResult.standardTopicsLower)
      ? filteredResult.standardTopicsLower
      : [];
    if (trace) trace.snapshots.push(snapshotStage(userItems, "topic_filter", "filtered_by_topic"));
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
    if (trace) trace.snapshots.push(snapshotStage(userItems, "relevance_ranked", "ranked"));
    userItems = typeof applyEntityCoverageCap === "function"
      ? applyEntityCoverageCap(userItems, Math.max(1, Number(CONFIG.digest.maxSignalsPerEntity || 1)))
      : userItems;
    if (trace) trace.snapshots.push(snapshotStage(userItems, "entity_cap", "entity_cap_applied"));

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
      if (trace) appendStageTrace(trace, userItems, suppression.items, "freshness_repeat", "removed_by_recent_repeat");
      userItems = suppression.items;
      log(`  [freshness-user] ${user.email || user.chatId}: removed ${suppression.removed} recent repeat(s)`);
    } else if (!strictFreshness && suppression.removed > 0) {
      log(`  [freshness-soft] ${user.email || user.chatId}: would remove ${suppression.removed} recent repeat(s) in scheduled mode`);
    }
    if (trace) trace.snapshots.push(snapshotStage(userItems, "freshness_repeat", strictFreshness ? "removed_by_recent_repeat" : "freshness_soft_preview"));

    const semanticPreviewBase = strictFreshness ? userItems : suppression.items;
    const semanticFreshness = filterFreshCandidates(semanticPreviewBase, {
      globalRepeatIndex: strictFreshness ? repeatIndex : null,
      userRepeatIndex: strictFreshness ? recentUserRepeatIndex : null,
    });
    if (strictFreshness && (semanticFreshness.removedGlobal > 0 || semanticFreshness.removedUser > 0)) {
      if (trace) appendStageTrace(trace, userItems, semanticFreshness.items, "semantic_repeat", "removed_by_semantic_repeat");
      userItems = semanticFreshness.items;
      log(
        `  [freshness-semantic] ${user.email || user.chatId}: removed ${semanticFreshness.removedGlobal} global and ${semanticFreshness.removedUser} per-user storyline repeat(s)`
      );
    } else if (!strictFreshness && (semanticFreshness.removedGlobal > 0 || semanticFreshness.removedUser > 0)) {
      log(
        `  [freshness-soft] ${user.email || user.chatId}: would remove ${semanticFreshness.removedGlobal} global and ${semanticFreshness.removedUser} per-user storyline repeat(s) in scheduled mode`
      );
    }
    if (trace) trace.snapshots.push(snapshotStage(userItems, "semantic_repeat", strictFreshness ? "removed_by_semantic_repeat" : "semantic_soft_preview"));

    const customPrecisionMode = isCustomPrecisionMode(customKeywords, standardTopicsLower);
    const precisionGate = applyCustomPrecisionGate(userItems, customPrecisionMode);
    if (precisionGate.applied) {
      if (trace) appendStageTrace(trace, userItems, precisionGate.items, "custom_precision_gate", "removed_by_custom_precision");
      userItems = precisionGate.items;
      log(`  [custom-precision] ${user.email || user.chatId}: kept ${precisionGate.matched} custom-matched item(s), removed ${precisionGate.removed} broad fallback candidate(s)`);
    }
    if (trace) trace.snapshots.push(snapshotStage(userItems, "custom_precision_gate", precisionGate.applied ? "removed_by_custom_precision" : "custom_precision_skipped"));

    const rankedFilteredPool = userItems.slice();

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
      if (trace) appendStageTrace(trace, userItems, qualityEligible, "final_quality_gate", "excluded_by_final_quality_threshold");
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
    if (trace) trace.snapshots.push(snapshotStage(userItems, "final_quality_gate", "excluded_by_final_quality_threshold"));

    if (hasWeights) {
      log(`  [post-sort] ${userItems.map((item) => `${item.tag}(${item.relevanceScore})`).join(", ")}`);
    }

    userItems = applyTopFitCoverageFloor(userItems, requestedCount, Number(CONFIG.digest.minTopFitItems || 3));
    userItems = reserveCustomKeywordSlot(userItems, requestedCount, customKeywords);
    const beforeSourcePolicyCaps = userItems.slice();
    userItems = applySourcePolicyCaps(userItems, requestedCount);
    if (trace) appendStageTrace(trace, beforeSourcePolicyCaps, userItems, "source_policy_caps", "removed_by_source_policy_cap");
    if (trace) trace.snapshots.push(snapshotStage(userItems, "source_policy_caps", "removed_by_source_policy_cap"));

    // Minimum-count backfill: stay inside the ranked filtered pool so we do not
    // dilute thin digests with unrelated stories from the broader enriched set.
    if (userItems.length > 0 && userItems.length < requestedCount) {
      const currentUrls = new Set(userItems.map((i) => i.url));
      const poolCandidates = filterFreshCandidates(
        rankedFilteredPool
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
        log(`  [min-count-backfill] added ${poolCandidates.length} item(s) from ranked filtered pool to reach ${userItems.length}/${requestedCount}`);
      }
    }

    if (userItems.length === 0) {
      const emergencyCount = Math.max(1, Math.min(3, requestedCount));
      let emergencyPool = rankedFilteredPool
        .filter((item) => !item?.hard_exclude)
        .filter((item) => Number(item?.routine_item_score || 0) <= maxRoutineScore)
        .filter((item) => Number(item?.strategic_value || 0) >= (minStrategicValue * 0.9))
        .sort((a, b) => b.relevanceScore - a.relevanceScore);
      if (emergencyPool.length === 0 && !wasFiltered && !customPrecisionMode) {
        emergencyPool = applyTopicRelevanceScores(enriched, user.topics || [], weights, {
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
          .filter((item) => Number(item?.strategic_value || 0) >= (minStrategicValue * 0.9));
      }
      const emergency = filterFreshCandidates(emergencyPool, {
        globalRepeatIndex: strictFreshness ? repeatIndex : null,
        userRepeatIndex: strictFreshness ? recentUserRepeatIndex : null,
      }).items.slice(0, emergencyCount);
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
    const beforeFinalPolicyCaps = userItems.slice();
    userItems = applySourcePolicyCaps(userItems, requestedCount);
    if (trace) appendStageTrace(trace, beforeFinalPolicyCaps, userItems, "final_source_policy_caps", "removed_by_source_policy_cap");
    if (trace) trace.snapshots.push(snapshotStage(userItems, "final_source_policy_caps", "removed_by_source_policy_cap"));

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
        preferred_domains_used: Array.isArray(runDiagnostics?.preferred_domains_used) ? runDiagnostics.preferred_domains_used.slice(0, 20) : [],
        preferred_search_result_domains: Array.isArray(runDiagnostics?.preferred_search_result_domains) ? runDiagnostics.preferred_search_result_domains.slice(0, 20) : [],
        preferred_search_result_hit_count: Math.max(0, Number(runDiagnostics?.preferred_search_result_hit_count || 0)),
        preferred_search_results_without_preferred_item_count: Math.max(0, Number(runDiagnostics?.preferred_search_results_without_preferred_item_count || 0)),
        preferred_fallback_triggered: runDiagnostics?.preferred_fallback_triggered === true,
        preferred_pass_item_count: Math.max(0, Number(runDiagnostics?.preferred_pass_item_count || 0)),
        broad_pass_item_count: Math.max(0, Number(runDiagnostics?.broad_pass_item_count || 0)),
        preferred_domains_count: Math.max(0, Number(runDiagnostics?.preferred_domains_count || 0)),
        preferred_candidate_count: Math.max(0, Number(runDiagnostics?.preferred_candidate_count || 0)),
        non_preferred_candidate_count: Math.max(0, Number(runDiagnostics?.non_preferred_candidate_count || 0)),
        final_selected_preferred_count: Math.max(0, Number(runDiagnostics?.final_selected_preferred_count || 0)),
        preferred_displaced_weak_count: Math.max(0, Number(runDiagnostics?.preferred_displaced_weak_count || 0)),
        derivative_suppressed_count: Math.max(0, Number(runDiagnostics?.derivative_suppressed_count || 0)),
        specialist_trade_beat_preferred_count: Math.max(0, Number(runDiagnostics?.specialist_trade_beat_preferred_count || 0)),
        platform_identity_ambiguity_count: Math.max(0, Number(runDiagnostics?.platform_identity_ambiguity_count || 0)),
        broader_retrieval_found_better_count: Math.max(0, Number(runDiagnostics?.broader_retrieval_found_better_count || 0)),
        coverage_gap_preferred_missing_count: Math.max(0, Number(runDiagnostics?.coverage_gap_preferred_missing_count || 0)),
        coverage_gap_preferred_weaker_count: Math.max(0, Number(runDiagnostics?.coverage_gap_preferred_weaker_count || 0)),
        candidate_pool_before_dedup: Number.isFinite(Number(runDiagnostics?.candidate_pool_before_dedup))
          ? Number(runDiagnostics.candidate_pool_before_dedup)
          : null,
        candidate_pool_after_dedup: Number.isFinite(Number(runDiagnostics?.candidate_pool_after_dedup))
          ? Number(runDiagnostics.candidate_pool_after_dedup)
          : null,
        fallback_reason: fallbackReason,
        refill_count: qualityBackfillCount + minCountBackfillCount + emergencyFallbackCount,
        thin_pool: thinPool,
        custom_precision_mode: customPrecisionMode,
        custom_precision_applied: precisionGate.applied,
        custom_precision_removed_count: Math.max(0, Number(precisionGate.removed || 0)),
        short_digest_accepted: thinPool && userItems.length > 0,
        item_trace: trace,
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
