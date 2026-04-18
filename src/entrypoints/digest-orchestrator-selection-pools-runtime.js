"use strict";

const {
  countTrustedSourceTier,
  isTrustedSourceTier,
  normalizeSourceTier,
  splitByFreshnessTiers,
} = require("../domains/digest/candidate-quality-runtime");
const {
  compareByFinalRank,
} = require("../domains/scoring/score-candidate");
const {
  isLowSignalProceduralItem,
} = require("./digest-orchestrator-selection-candidates-runtime");

function isDiscoveryLaneItem(item) {
  const origin = String(item?.retrieval_origin || item?.retrieval_lane || "").trim().toLowerCase();
  return origin.includes("discovery") || origin.includes("perplexity");
}

function isAnalysisOrCommentaryItem(item) {
  const sourceType = String(item?.source_type || "").trim().toLowerCase();
  const originalityProfile = String(item?.originality_profile || "").trim().toLowerCase();
  const contentFlags = Array.isArray(item?.content_flags) ? item.content_flags.map((flag) => String(flag || "").trim().toLowerCase()) : [];
  const url = String(item?.url || "").trim().toLowerCase();
  return sourceType === "analysis_blog"
    || originalityProfile === "derived_synthesis"
    || contentFlags.includes("generic_commentary")
    || /\/opinions?\//.test(url)
    || /\/analysis\//.test(url);
}

function isStandardSourceTier(item) {
  return normalizeSourceTier(item) === 3;
}

function annotateSelectorPenalties(item) {
  if (!item || typeof item !== "object") return item;
  const penalties = Object.create(null);
  const sourceDomain = String(item?.source_domain || item?.source || "").trim().toLowerCase();
  const sourceType = String(item?.source_type || "").trim().toLowerCase();
  const lowSignalProcedural = isLowSignalProceduralItem(item);
  if (lowSignalProcedural) penalties.low_signal_procedural = 0.24;
  if (item?.procedural_notice === true && sourceType === "primary_official") penalties.procedural_official = 0.1;
  if (sourceType === "aggregator_republisher") penalties.aggregator = 0.08;
  if (sourceDomain === "marketwatch.com") penalties.weak_domain_marketwatch = 0.06;
  if (sourceDomain === "federalregister.gov") penalties.procedural_gov = 0.05;
  const totalPenalty = Object.values(penalties).reduce((sum, value) => sum + Number(value || 0), 0);
  return {
    ...item,
    _low_signal_procedural: lowSignalProcedural,
    _selector_penalties: penalties,
    _selection_score: Number((Number(item?._score || 0) - totalPenalty).toFixed(4)),
  };
}

function getSelectionScore(item) {
  if (!item) return 0;
  if (Number.isFinite(Number(item?._selection_score))) return Number(item._selection_score);
  return Number(item?._score || 0);
}

function sortByScoreDesc(items) {
  return (Array.isArray(items) ? items : []).slice().sort((left, right) => {
    const scoreDelta = getSelectionScore(right) - getSelectionScore(left);
    if (scoreDelta !== 0) return scoreDelta;
    return String(left?.headline || "").localeCompare(String(right?.headline || ""));
  });
}

const SOURCE_TYPE_PREFERENCE = Object.freeze({
  reported_media: 0,
  trade_specialist: 0,
  analysis_blog: 2,
  unclassified: 2,
  primary_official: 3,
  corporate_pr: 4,
  aggregator_republisher: 4,
  platform_user_generated: 4,
});

function sortWithSourceTypePreference(items) {
  return (Array.isArray(items) ? items : []).slice().sort((a, b) => {
    const rankA = SOURCE_TYPE_PREFERENCE[String(a?.source_type || "").trim().toLowerCase()] ?? 2;
    const rankB = SOURCE_TYPE_PREFERENCE[String(b?.source_type || "").trim().toLowerCase()] ?? 2;
    if (rankA !== rankB) return rankA - rankB;
    return (b._score || 0) - (a._score || 0);
  });
}

function getSourceTypePreferenceRank(item) {
  return SOURCE_TYPE_PREFERENCE[String(item?.source_type || "").trim().toLowerCase()] ?? 2;
}

function compareCandidatePreference(left, right) {
  const scoreDelta = getSelectionScore(right) - getSelectionScore(left);
  if (scoreDelta !== 0) return scoreDelta;
  const sourceTypeDelta = getSourceTypePreferenceRank(left) - getSourceTypePreferenceRank(right);
  if (sourceTypeDelta !== 0) return sourceTypeDelta;
  return String(left?.headline || "").localeCompare(String(right?.headline || ""));
}

function sortBySelectionPreference(items) {
  return (Array.isArray(items) ? items : []).slice().sort(compareCandidatePreference);
}

function getTrustedOverrideMargin(config = {}) {
  const configured = Number(config.standardOverrideMargin);
  if (!Number.isFinite(configured)) return 0.08;
  return Math.max(0, configured);
}

function getTopicAwareTrustedOverrideMargin(config = {}, topicTag = "") {
  const normalizedTag = String(topicTag || "").trim().toUpperCase();
  const topicMargins = config?.topicOverrideMargins && typeof config.topicOverrideMargins === "object"
    ? config.topicOverrideMargins
    : {};
  const configuredTopicMargin = Number(topicMargins[normalizedTag]);
  if (Number.isFinite(configuredTopicMargin)) return Math.max(0, configuredTopicMargin);
  if (normalizedTag === "INDUSTRIALS") return Math.max(0.12, getTrustedOverrideMargin(config));
  return getTrustedOverrideMargin(config);
}

function suppressOfficialsByCluster(topicItems) {
  const items = Array.isArray(topicItems) ? topicItems : [];
  const clusters = new Map();
  for (const item of items) {
    const key = String(item?.storyline_key || "").trim();
    if (!key) continue;
    if (!clusters.has(key)) clusters.set(key, []);
    clusters.get(key).push(item);
  }
  const suppressed = new Set();
  for (const [, cluster] of clusters) {
    const hasReported = cluster.some((item) => {
      const sourceType = String(item?.source_type || "").trim().toLowerCase();
      return sourceType === "reported_media" || sourceType === "trade_specialist";
    });
    if (!hasReported) continue;
    for (const item of cluster) {
      if (String(item?.source_type || "").trim().toLowerCase() === "primary_official") {
        suppressed.add(item);
      }
    }
  }
  return items.map((item) => suppressed.has(item)
    ? { ...item, _official_suppressed_by_cluster: true, _suppression_reason: "selection_official_suppressed_by_reported" }
    : item
  );
}

function buildTopicFallbackPools(topicItems, nowMs, opts = {}) {
  const items = opts.clusterOfficialSuppression
    ? suppressOfficialsByCluster(Array.isArray(topicItems) ? topicItems : [])
    : (Array.isArray(topicItems) ? topicItems : []);
  const scoredItems = items.map(annotateSelectorPenalties);
  const { tier1, tier2, tier3 } = splitByFreshnessTiers(scoredItems, nowMs);
  const eventTier1 = sortWithSourceTypePreference(
    tier1.filter((item) => !isAnalysisOrCommentaryItem(item) && !item._official_suppressed_by_cluster)
  );
  const eventTier2 = sortWithSourceTypePreference(
    tier2.filter((item) => !isAnalysisOrCommentaryItem(item) && !item._official_suppressed_by_cluster)
  );
  const commentaryPool = [...tier1, ...tier2].filter((item) => isAnalysisOrCommentaryItem(item));
  const suppressedOfficials = [...tier1, ...tier2].filter((item) => item._official_suppressed_by_cluster);
  return {
    tier1,
    tier2,
    tier3,
    eventTier1,
    eventTier2,
    commentaryPool,
    suppressedOfficials,
  };
}

function selectTopicItemsWithFallback(params = {}) {
  const {
    topicItems,
    itemsPerTopic,
    maxItemsPerSourceDomain,
    maxDiscoveryPerTopic,
    nowMs,
    clusterOfficialSuppression,
    trustedSelectionFloor,
  } = params;

  const targetCount = Math.max(1, Number(itemsPerTopic || 5));
  const perSourceCap = Math.max(1, Number(maxItemsPerSourceDomain || 2));
  const discoveryCap = Math.max(0, Number(maxDiscoveryPerTopic ?? 1));
  const topicTag = String(Array.isArray(topicItems) && topicItems[0]?.tag ? topicItems[0].tag : "").trim().toUpperCase();
  const pools = buildTopicFallbackPools(topicItems, nowMs, {
    clusterOfficialSuppression: clusterOfficialSuppression === true,
  });
  const freshSelectablePool = [
    ...pools.eventTier1,
    ...pools.eventTier2,
    ...pools.commentaryPool,
  ];
  const trustedFloorConfig = trustedSelectionFloor && typeof trustedSelectionFloor === "object"
    ? trustedSelectionFloor
    : {};
  const configuredMinTrustedItems = Number(trustedFloorConfig.minTrustedItemsPerTopic);
  const configuredActivationStrongCount = Number(trustedFloorConfig.activationStrongCandidateCount);
  const minTrustedItems = Number.isFinite(configuredMinTrustedItems)
    ? Math.min(targetCount, Math.max(0, Math.trunc(configuredMinTrustedItems)))
    : Math.min(4, targetCount);
  const activationStrongCandidateCount = Number.isFinite(configuredActivationStrongCount)
    ? Math.max(1, Math.trunc(configuredActivationStrongCount))
    : 5;
  const trustedCandidateCount = countTrustedSourceTier(freshSelectablePool);
  const trustedFloor = {
    enabled: trustedFloorConfig.enabled === true,
    active: trustedFloorConfig.enabled === true
      && trustedCandidateCount >= activationStrongCandidateCount
      && minTrustedItems > 0,
    minTrustedItemsPerTopic: minTrustedItems,
    activationStrongCandidateCount,
    standardOverrideMargin: getTopicAwareTrustedOverrideMargin(trustedFloorConfig, topicTag),
    candidate_count: freshSelectablePool.length,
    trusted_candidate_count: trustedCandidateCount,
  };
  const selected = [];
  const selectedSet = new Set();
  const rejectionReasonByItem = new Map();
  const domainCounts = Object.create(null);
  let discoveryCount = 0;
  let commentarySelectedCount = 0;
  let standardTierBlockedWhileStrongAvailable = false;
  let strongPoolExhausted = false;
  let standardCandidatesBlockedByTrustedFirstCount = 0;
  const trustedOverrideDetails = [];

  function recordRejection(item, reason) {
    if (!item || selectedSet.has(item) || rejectionReasonByItem.has(item)) return;
    rejectionReasonByItem.set(item, String(reason || "selection_not_selected"));
  }

  function isCandidateEligible(item, commentaryCap = 0) {
    const isCommentary = isAnalysisOrCommentaryItem(item);
    if (commentaryCap > 0 && isCommentary && commentarySelectedCount >= commentaryCap) return false;
    const domain = String(item?.source_domain || item?.source || "unknown").trim().toLowerCase();
    const domainCount = domainCounts[domain] || 0;
    if (domainCount >= perSourceCap) return false;
    if (isDiscoveryLaneItem(item) && discoveryCount >= discoveryCap) return false;
    return true;
  }

  function markIneligibleRejection(item, commentaryCap = 0) {
    const isCommentary = isAnalysisOrCommentaryItem(item);
    if (commentaryCap > 0 && isCommentary && commentarySelectedCount >= commentaryCap) {
      recordRejection(item, "selection_commentary_cap");
      return;
    }
    const domain = String(item?.source_domain || item?.source || "unknown").trim().toLowerCase();
    const domainCount = domainCounts[domain] || 0;
    if (domainCount >= perSourceCap) {
      recordRejection(item, `selection_source_cap (${domain}: ${domainCount}/${perSourceCap})`);
      return;
    }
    if (isDiscoveryLaneItem(item) && discoveryCount >= discoveryCap) {
      recordRejection(item, "selection_discovery_cap");
    }
  }

  function attemptStage(items, stageName, { commentaryCap = 0, maxAccepted = Number.MAX_SAFE_INTEGER } = {}) {
    let acceptedThisStage = 0;
    const stageItems = sortBySelectionPreference(items);
    while (acceptedThisStage < maxAccepted && selected.length < targetCount) {
      const remaining = stageItems.filter((item) => item && !selectedSet.has(item));
      if (!remaining.length) break;
      const eligibleTrusted = remaining.filter((item) => isTrustedSourceTier(item) && isCandidateEligible(item, commentaryCap));
      const eligibleStandard = remaining.filter((item) => !isTrustedSourceTier(item) && isCandidateEligible(item, commentaryCap));

      for (const item of remaining) {
        if (selectedSet.has(item) || isCandidateEligible(item, commentaryCap)) continue;
        markIneligibleRejection(item, commentaryCap);
      }

      const bestTrusted = eligibleTrusted.length > 0 ? sortBySelectionPreference(eligibleTrusted)[0] : null;
      const bestStandard = eligibleStandard.length > 0 ? sortBySelectionPreference(eligibleStandard)[0] : null;
      const trustedStillAvailable = Boolean(bestTrusted);

      if (trustedStillAvailable) standardTierBlockedWhileStrongAvailable = true;
      if (!bestTrusted && !bestStandard) break;

      let nextItem = bestTrusted || bestStandard;
      let selectionStage = stageName;
      if (bestStandard && bestTrusted) {
        const scoreMargin = getSelectionScore(bestStandard) - getSelectionScore(bestTrusted);
        if (scoreMargin >= trustedFloor.standardOverrideMargin) {
          nextItem = bestStandard;
          selectionStage = `${stageName}_trusted_override`;
          trustedOverrideDetails.push({
            selected_url: String(bestStandard?.url || "").trim() || null,
            selected_headline: String(bestStandard?.headline || "").slice(0, 160) || null,
            selected_score: getSelectionScore(bestStandard),
            trusted_url: String(bestTrusted?.url || "").trim() || null,
            trusted_headline: String(bestTrusted?.headline || "").slice(0, 160) || null,
            trusted_score: getSelectionScore(bestTrusted),
            score_margin: Number(scoreMargin.toFixed(4)),
            stage: stageName,
            override_reason: "standard_won_over_trusted_with_gap",
          });
          bestStandard._trusted_override = {
            margin: Number(scoreMargin.toFixed(4)),
            trusted_candidate_url: String(bestTrusted?.url || "").trim() || null,
            trusted_candidate_score: getSelectionScore(bestTrusted),
            override_reason: "standard_won_over_trusted_with_gap",
          };
        } else {
          standardCandidatesBlockedByTrustedFirstCount += 1;
          if (!rejectionReasonByItem.has(bestStandard)) {
            recordRejection(bestStandard, "selection_trusted_first_blocked");
          }
        }
      }

      const item = nextItem;
      if (selected.length >= targetCount) {
        if (selected.length >= targetCount) recordRejection(item, "selection_pool_full");
        break;
      }
      const isCommentary = isAnalysisOrCommentaryItem(item);
      const domain = String(item?.source_domain || item?.source || "unknown").trim().toLowerCase();
      const domainCount = domainCounts[domain] || 0;
      selected.push(item);
      selectedSet.add(item);
      item._selection_stage = `stage_${selectionStage}`;
      domainCounts[domain] = domainCount + 1;
      if (isDiscoveryLaneItem(item)) discoveryCount += 1;
      if (isCommentary) commentarySelectedCount += 1;
      acceptedThisStage += 1;
    }
  }

  attemptStage(pools.eventTier1, "event_tier1");
  if (selected.length < targetCount) attemptStage(pools.eventTier2, "event_tier2");
  if (selected.length < targetCount) attemptStage(pools.commentaryPool, "commentary", { commentaryCap: 1 });

  if (trustedFloor.active) {
    strongPoolExhausted = countTrustedSourceTier(selected) < trustedFloor.minTrustedItemsPerTopic
      && !freshSelectablePool.some((item) => !selectedSet.has(item) && isTrustedSourceTier(item));
  }

  trustedFloor.selected_trusted_count = countTrustedSourceTier(selected);
  trustedFloor.standard_tier_blocked_while_strong_available = standardTierBlockedWhileStrongAvailable;
  trustedFloor.relaxed_reason = trustedFloor.active && strongPoolExhausted ? "strong_pool_exhausted" : null;
  trustedFloor.strong_pool_exhausted = trustedFloor.active && strongPoolExhausted;
  trustedFloor.standard_candidates_blocked_by_trusted_first_count = standardCandidatesBlockedByTrustedFirstCount;
  trustedFloor.trusted_override_count = trustedOverrideDetails.length;
  trustedFloor.trusted_override_details = trustedOverrideDetails.slice();

  for (const item of (Array.isArray(topicItems) ? topicItems : [])) {
    if (selectedSet.has(item)) continue;
    recordRejection(item, "selection_not_selected");
  }

  return {
    selected,
    rejectionReasonByItem,
    pools,
    commentarySelectedCount,
    trustedFloor,
  };
}

function buildTopicSelectionState(selectedItems = []) {
  const domainCounts = Object.create(null);
  let discoveryCount = 0;
  let commentaryCount = 0;
  for (const item of (Array.isArray(selectedItems) ? selectedItems : [])) {
    const domain = String(item?.source_domain || item?.source || "unknown").trim().toLowerCase();
    domainCounts[domain] = (domainCounts[domain] || 0) + 1;
    if (isDiscoveryLaneItem(item)) discoveryCount += 1;
    if (isAnalysisOrCommentaryItem(item)) commentaryCount += 1;
  }
  return {
    domainCounts,
    discoveryCount,
    commentaryCount,
  };
}

function getFinalRankScore(item) {
  return Number.isFinite(Number(item?.final_rank_score)) ? Number(item.final_rank_score) : 0;
}

function resolveV2SameDomainPenaltyConfig(config = {}) {
  const raw = config && typeof config === "object" ? config : {};
  return {
    enabled: raw.enabled !== false,
    minCompetitiveGapForBypass: Number.isFinite(Number(raw.min_competitive_gap_for_bypass))
      ? Math.max(0, Number(raw.min_competitive_gap_for_bypass))
      : 0.10,
    penalties: {
      second: Number.isFinite(Number(raw?.penalties?.second)) ? Math.max(0, Number(raw.penalties.second)) : 0.03,
      third: Number.isFinite(Number(raw?.penalties?.third)) ? Math.max(0, Number(raw.penalties.third)) : 0.08,
      fourth_or_more: Number.isFinite(Number(raw?.penalties?.fourth_or_more)) ? Math.max(0, Number(raw.penalties.fourth_or_more)) : 0.15,
    },
  };
}

function resolveV2SameDomainGuardrail(config = {}) {
  const raw = config && typeof config === "object" ? config : {};
  return {
    enabled: raw.enabled === true,
    maxPerTopic: Number.isFinite(Number(raw.max_per_topic))
      ? Math.max(1, Math.trunc(Number(raw.max_per_topic)))
      : 3,
  };
}

function getSameDomainPenaltyForCount(nextCount, config) {
  if (nextCount <= 1) return 0;
  if (nextCount === 2) return Number(config?.penalties?.second || 0);
  if (nextCount === 3) return Number(config?.penalties?.third || 0);
  return Number(config?.penalties?.fourth_or_more || 0);
}

function applyDynamicSourcePenalty(candidate, competingItems = [], selectionState = {}, config = {}) {
  const sameDomainPenalty = resolveV2SameDomainPenaltyConfig(config);
  const domain = String(candidate?.source_domain || candidate?.source || "unknown").trim().toLowerCase();
  const currentCount = Number(selectionState?.domainCounts?.[domain] || 0);
  const nextCount = currentCount + 1;
  const penalty = sameDomainPenalty.enabled ? getSameDomainPenaltyForCount(nextCount, sameDomainPenalty) : 0;
  const rawScore = getFinalRankScore(candidate);
  if (penalty <= 0) {
    return {
      penalty: 0,
      effectiveScore: rawScore,
      sameDomainCount: nextCount,
      applied: false,
      bypassed: false,
      competitiveGap: null,
    };
  }
  const bestCrossDomainCompetitor = (Array.isArray(competingItems) ? competingItems : [])
    .filter((item) => item && item !== candidate)
    .filter((item) => String(item?.source_domain || item?.source || "unknown").trim().toLowerCase() !== domain)
    .sort((left, right) => getFinalRankScore(right) - getFinalRankScore(left))[0] || null;
  if (!bestCrossDomainCompetitor) {
    return {
      penalty: 0,
      effectiveScore: rawScore,
      sameDomainCount: nextCount,
      applied: false,
      bypassed: true,
      competitiveGap: null,
    };
  }
  const competitiveGap = Number((rawScore - getFinalRankScore(bestCrossDomainCompetitor)).toFixed(4));
  if (competitiveGap > Number(sameDomainPenalty.minCompetitiveGapForBypass || 0.10)) {
    return {
      penalty: 0,
      effectiveScore: rawScore,
      sameDomainCount: nextCount,
      applied: false,
      bypassed: true,
      competitiveGap,
    };
  }
  return {
    penalty: Number(penalty.toFixed(4)),
    effectiveScore: Number((rawScore - penalty).toFixed(4)),
    sameDomainCount: nextCount,
    applied: true,
    bypassed: false,
    competitiveGap,
  };
}

function resolveTieBreakOutcomeV2(winner, runnerUp) {
  if (!winner || !runnerUp) return null;
  const dimensions = [
    ["final_rank_score", Number(winner?.effective_final_rank_score ?? winner?.final_rank_score ?? 0) - Number(runnerUp?.effective_final_rank_score ?? runnerUp?.final_rank_score ?? 0)],
    ["strategic_value", Number(winner?.strategic_value || 0) - Number(runnerUp?.strategic_value || 0)],
    ["story_quality_score", Number(winner?.story_quality_score || 0) - Number(runnerUp?.story_quality_score || 0)],
    ["source_authority_score", Number(winner?.source_authority_score || 0) - Number(runnerUp?.source_authority_score || 0)],
    ["freshness_score", Number(winner?.freshness_score || 0) - Number(runnerUp?.freshness_score || 0)],
    ["same_domain_concentration", Number(runnerUp?._same_domain_count || 0) - Number(winner?._same_domain_count || 0)],
  ];
  for (const [label, delta] of dimensions) {
    if (delta > 0) return label;
  }
  return "lexical_fallback";
}

function cloneCandidateForV2(candidate) {
  return {
    ...candidate,
    ranking_version: "v2",
  };
}

function rankCandidatesV2(items = [], selectionState = {}, opts = {}) {
  const eligibleItems = Array.isArray(items) ? items : [];
  const ranked = eligibleItems.map((candidate) => {
    const dynamic = applyDynamicSourcePenalty(candidate, eligibleItems, selectionState, opts.sameDomainPenalty);
    return {
      ...candidate,
      _same_domain_count: dynamic.sameDomainCount,
      dynamic_source_penalty: dynamic.penalty,
      effective_final_rank_score: dynamic.effectiveScore,
      same_domain_penalty_applied: dynamic.applied,
      same_domain_penalty_bypassed: dynamic.bypassed,
      same_domain_competitive_gap: dynamic.competitiveGap,
    };
  }).sort((left, right) => compareByFinalRank(left, right));
  const winner = ranked[0] || null;
  const runnerUp = ranked[1] || null;
  if (winner) {
    winner.tie_break_outcome = resolveTieBreakOutcomeV2(winner, runnerUp);
  }
  return ranked;
}

function isV2CandidateEligible(item, selectionState = {}, opts = {}) {
  const commentaryCap = Math.max(0, Number(opts.commentaryCap ?? 1));
  const discoveryCap = Math.max(0, Number(opts.maxDiscoveryPerTopic ?? 1));
  const isCommentary = isAnalysisOrCommentaryItem(item);
  if (commentaryCap >= 0 && isCommentary && Number(selectionState.commentaryCount || 0) >= commentaryCap) {
    return { eligible: false, reason: "selection_commentary_cap" };
  }
  if (isDiscoveryLaneItem(item) && Number(selectionState.discoveryCount || 0) >= discoveryCap) {
    return { eligible: false, reason: "selection_discovery_cap" };
  }
  return { eligible: true, reason: null };
}

function buildTopicReserveQueueV2(params = {}) {
  const pools = params.pools && typeof params.pools === "object" ? params.pools : {};
  const selectedItems = Array.isArray(params.selectedItems) ? params.selectedItems : [];
  const selectedUrls = new Set(selectedItems.map((item) => String(item?.url || "").trim()).filter(Boolean));
  const reserveItems = [
    ...(Array.isArray(pools.eventTier1) ? pools.eventTier1 : []),
    ...(Array.isArray(pools.eventTier2) ? pools.eventTier2 : []),
    ...(Array.isArray(pools.commentaryPool) ? pools.commentaryPool : []),
    ...(Array.isArray(pools.suppressedOfficials) ? pools.suppressedOfficials : []),
  ]
    .filter((item) => !selectedUrls.has(String(item?.url || "").trim()))
    .map(cloneCandidateForV2);
  const selectionState = buildTopicSelectionState(selectedItems);
  const orderedReserve = [];
  const remaining = reserveItems.slice();
  while (remaining.length > 0) {
    const eligible = remaining.filter((item) => isV2CandidateEligible(item, selectionState, params).eligible);
    const ranked = rankCandidatesV2(eligible.length > 0 ? eligible : remaining, selectionState, params);
    const next = ranked[0];
    if (!next) break;
    const nextUrl = String(next?.url || "").trim();
    const nextIndex = remaining.findIndex((item) => String(item?.url || "").trim() === nextUrl);
    const selectedNext = nextIndex >= 0 ? remaining.splice(nextIndex, 1)[0] : next;
    orderedReserve.push({
      ...selectedNext,
      dynamic_source_penalty: Number(next.dynamic_source_penalty || 0),
      effective_final_rank_score: Number(next.effective_final_rank_score || selectedNext.final_rank_score || 0),
      tie_break_outcome: next.tie_break_outcome || null,
    });
    const domain = String(selectedNext?.source_domain || selectedNext?.source || "unknown").trim().toLowerCase();
    selectionState.domainCounts[domain] = (selectionState.domainCounts[domain] || 0) + 1;
    if (isDiscoveryLaneItem(selectedNext)) selectionState.discoveryCount += 1;
    if (isAnalysisOrCommentaryItem(selectedNext)) selectionState.commentaryCount += 1;
  }
  const strongReserve = orderedReserve.filter((item) => isTrustedSourceTier(item));
  const standardReserve = orderedReserve.filter((item) => !isTrustedSourceTier(item));
  return {
    strongReserve,
    standardReserve,
    allReserve: orderedReserve,
    initialStrongCount: strongReserve.length,
    initialStandardCount: standardReserve.length,
  };
}

function selectTopicItemsV2(params = {}) {
  const {
    topicItems,
    itemsPerTopic,
    maxDiscoveryPerTopic,
  } = params;
  const targetCount = Math.max(1, Number(itemsPerTopic || 5));
  const pools = buildTopicFallbackPools(topicItems, params.nowMs, {
    clusterOfficialSuppression: params.clusterOfficialSuppression === true,
  });
  const candidatePool = [
    ...(Array.isArray(pools.eventTier1) ? pools.eventTier1 : []),
    ...(Array.isArray(pools.eventTier2) ? pools.eventTier2 : []),
    ...(Array.isArray(pools.commentaryPool) ? pools.commentaryPool : []),
  ].map(cloneCandidateForV2);
  const selected = [];
  const selectedSet = new Set();
  const rejectionReasonByItem = new Map();
  const selectionState = buildTopicSelectionState([]);
  const guardrail = resolveV2SameDomainGuardrail(params.sameDomainGuardrail);
  const diagnostics = {
    same_domain_guardrail_hits: 0,
    same_domain_guardrail_details: [],
  };

  function recordRejection(item, reason) {
    if (!item || selectedSet.has(item) || rejectionReasonByItem.has(item)) return;
    rejectionReasonByItem.set(item, String(reason || "selection_not_selected"));
  }

  while (selected.length < targetCount) {
    const remaining = candidatePool.filter((item) => item && !selectedSet.has(item));
    if (!remaining.length) break;
    const eligible = [];
    for (const item of remaining) {
      const eligibility = isV2CandidateEligible(item, selectionState, {
        commentaryCap: 1,
        maxDiscoveryPerTopic,
      });
      if (!eligibility.eligible) {
        recordRejection(item, eligibility.reason);
        continue;
      }
      eligible.push(item);
    }
    if (!eligible.length) break;
    const ranked = rankCandidatesV2(eligible, selectionState, {
      sameDomainPenalty: params.sameDomainPenalty,
    });
    const next = ranked[0];
    if (!next) break;
    const nextUrl = String(next?.url || "").trim();
    const selectedItem = remaining.find((item) => String(item?.url || "").trim() === nextUrl) || next;
    const domain = String(selectedItem?.source_domain || selectedItem?.source || "unknown").trim().toLowerCase();
    const nextDomainCount = Number(selectionState.domainCounts[domain] || 0) + 1;
    if (nextDomainCount > Number(guardrail.maxPerTopic || 3)) {
      diagnostics.same_domain_guardrail_hits += 1;
      diagnostics.same_domain_guardrail_details.push({
        url: selectedItem?.url || null,
        source_domain: domain,
        attempted_count: nextDomainCount,
        max_per_topic: guardrail.maxPerTopic,
      });
    }
    selected.push({
      ...selectedItem,
      dynamic_source_penalty: Number(next.dynamic_source_penalty || 0),
      effective_final_rank_score: Number(next.effective_final_rank_score || selectedItem.final_rank_score || 0),
      tie_break_outcome: next.tie_break_outcome || null,
      would_block_same_domain_guardrail: nextDomainCount > Number(guardrail.maxPerTopic || 3),
      ranking_version: "v2",
    });
    selectedSet.add(selectedItem);
    selectionState.domainCounts[domain] = nextDomainCount;
    if (isDiscoveryLaneItem(selectedItem)) selectionState.discoveryCount += 1;
    if (isAnalysisOrCommentaryItem(selectedItem)) selectionState.commentaryCount += 1;
  }

  for (const item of candidatePool) {
    if (selectedSet.has(item)) continue;
    if (!rejectionReasonByItem.has(item)) recordRejection(item, "selection_not_selected");
  }

  return {
    selected,
    rejectionReasonByItem,
    pools,
    commentarySelectedCount: selectionState.commentaryCount,
    trustedFloor: null,
    diagnostics,
  };
}

const LOW_TRUST_BACKFILL_SOURCE_TYPES = new Set([
  "corporate_pr",
  "aggregator_republisher",
  "platform_user_generated",
]);

function getBackfillRejectionReason(candidate, currentSelected = [], opts = {}) {
  const rankingVersion = String(opts?.rankingVersion || "").trim().toLowerCase();
  if (opts.backfillTrustFloor === true) {
    const sourceTier = String(candidate?.source_tier || "").trim().toLowerCase();
    if (sourceTier === "unknown") return "selection_low_trust_backfill";
    const sourceType = String(candidate?.source_type || "").trim().toLowerCase();
    if (LOW_TRUST_BACKFILL_SOURCE_TYPES.has(sourceType)) return "selection_low_trust_backfill";
  }

  const perSourceCap = Math.max(1, Number(opts.maxItemsPerSourceDomain || 2));
  const discoveryCap = Math.max(0, Number(opts.maxDiscoveryPerTopic ?? 1));
  const commentaryCap = Math.max(0, Number(opts.commentaryCap ?? 1));
  const state = buildTopicSelectionState(currentSelected);
  const isCommentary = isAnalysisOrCommentaryItem(candidate);
  if (commentaryCap >= 0 && isCommentary && state.commentaryCount >= commentaryCap) {
    return "selection_commentary_cap";
  }

  const domain = String(candidate?.source_domain || candidate?.source || "unknown").trim().toLowerCase();
  const domainCount = state.domainCounts[domain] || 0;
  if (rankingVersion !== "v2" && domainCount >= perSourceCap && opts.allowSourceCapOverrideWhenExhausted !== true) {
    return `selection_source_cap (${domain}: ${domainCount}/${perSourceCap})`;
  }

  if (isDiscoveryLaneItem(candidate) && state.discoveryCount >= discoveryCap) {
    return "selection_discovery_cap";
  }

  return null;
}

function buildTopicReserveQueue(params = {}) {
  const pools = params.pools && typeof params.pools === "object" ? params.pools : {};
  const selectedItems = Array.isArray(params.selectedItems) ? params.selectedItems : [];
  const selectedUrls = new Set(selectedItems.map((item) => String(item?.url || "").trim()).filter(Boolean));
  const reserveItems = [
    ...(Array.isArray(pools.eventTier1) ? pools.eventTier1 : []),
    ...(Array.isArray(pools.eventTier2) ? pools.eventTier2 : []),
    ...(Array.isArray(pools.commentaryPool) ? pools.commentaryPool : []),
    ...(Array.isArray(pools.suppressedOfficials) ? pools.suppressedOfficials : []),
  ].filter((item) => !selectedUrls.has(String(item?.url || "").trim()));
  const strongReserve = sortByScoreDesc(reserveItems.filter((item) => isTrustedSourceTier(item)));
  const standardReserve = sortByScoreDesc(reserveItems.filter((item) => !isTrustedSourceTier(item)));
  return {
    strongReserve,
    standardReserve,
    allReserve: [...strongReserve, ...standardReserve],
    initialStrongCount: strongReserve.length,
    initialStandardCount: standardReserve.length,
  };
}

function resolveTrustedSelectionFloor(configDigest = {}, itemsPerTopic = 5) {
  const raw = configDigest?.trustedSelectionFloor;
  const rawObject = raw && typeof raw === "object" ? raw : {};
  const targetCount = Math.max(1, Number(itemsPerTopic || 5));
  const configuredMin = Number(rawObject.minTrustedItemsPerTopic ?? configDigest?.minTrustedItemsPerTopic);
  const configuredActivationStrongCount = Number(rawObject.activationStrongCandidateCount);
  const configuredOverrideMargin = Number(rawObject.standardOverrideMargin ?? configDigest?.standardOverrideMargin);
  const minTrustedItemsPerTopic = Number.isFinite(configuredMin)
    ? Math.min(targetCount, Math.max(0, Math.trunc(configuredMin)))
    : Math.min(4, targetCount);
  const activationStrongCandidateCount = Number.isFinite(configuredActivationStrongCount)
    ? Math.max(1, Math.trunc(configuredActivationStrongCount))
    : 5;
  return {
    enabled: raw !== false && rawObject.enabled !== false,
    minTrustedItemsPerTopic,
    activationStrongCandidateCount,
    standardOverrideMargin: Number.isFinite(configuredOverrideMargin)
      ? Math.max(0, configuredOverrideMargin)
      : 0.08,
  };
}

function resolveBackfillUnlockPolicy(configDigest = {}) {
  const raw = configDigest?.backfillUnlockPolicy;
  const rawObject = raw && typeof raw === "object" ? raw : {};
  const failureRatio = Number(rawObject.failureRatio ?? configDigest?.backfillUnlockFailureRatio);
  const absoluteFloor = Number(rawObject.absoluteFloor ?? configDigest?.backfillUnlockAbsoluteFloor);
  return {
    failureRatio: Number.isFinite(failureRatio) ? Math.min(1, Math.max(0, failureRatio)) : 0.4,
    absoluteFloor: Number.isFinite(absoluteFloor) ? Math.max(0, Math.trunc(absoluteFloor)) : 2,
  };
}

function resolveTrustGuardrailPolicy(configDigest = {}, itemsPerTopic = 5) {
  const raw = configDigest?.trustGuardrail;
  const rawObject = raw && typeof raw === "object" ? raw : {};
  const targetCount = Math.max(1, Number(itemsPerTopic || 5));
  const minTrusted = Number(rawObject.minTrustedItemsPerTopic ?? configDigest?.minTrustedItemsPerTopicGuardrail);
  const aspirationalTrusted = Number(rawObject.aspirationalTrustedItemsPerTopic ?? configDigest?.aspirationalTrustedItemsPerTopic);
  return {
    minTrustedItemsPerTopic: Number.isFinite(minTrusted)
      ? Math.min(targetCount, Math.max(0, Math.trunc(minTrusted)))
      : Math.min(targetCount, Math.ceil(targetCount * 0.6)),
    aspirationalTrustedItemsPerTopic: Number.isFinite(aspirationalTrusted)
      ? Math.min(targetCount, Math.max(0, Math.trunc(aspirationalTrusted)))
      : Math.min(targetCount, Math.ceil(targetCount * 0.8)),
  };
}

module.exports = {
  applyDynamicSourcePenalty,
  buildTopicSelectionState,
  buildTopicReserveQueue,
  buildTopicReserveQueueV2,
  getSelectionScore,
  getBackfillRejectionReason,
  isStandardSourceTier,
  rankCandidatesV2,
  resolveBackfillUnlockPolicy,
  resolveTrustGuardrailPolicy,
  resolveTrustedSelectionFloor,
  selectTopicItemsWithFallback,
  selectTopicItemsV2,
  sortWithSourceTypePreference,
  suppressOfficialsByCluster,
};
