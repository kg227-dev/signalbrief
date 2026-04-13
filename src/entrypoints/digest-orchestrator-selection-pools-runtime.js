"use strict";

const {
  countTrustedSourceTier,
  isTrustedSourceTier,
  normalizeSourceTier,
  splitByFreshnessTiers,
} = require("../domains/digest/candidate-quality-runtime");
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
    standardOverrideMargin: getTrustedOverrideMargin(trustedFloorConfig),
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

const LOW_TRUST_BACKFILL_SOURCE_TYPES = new Set([
  "corporate_pr",
  "aggregator_republisher",
  "platform_user_generated",
]);

function getBackfillRejectionReason(candidate, currentSelected = [], opts = {}) {
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
  if (domainCount >= perSourceCap && opts.allowSourceCapOverrideWhenExhausted !== true) {
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
  buildTopicSelectionState,
  buildTopicReserveQueue,
  getSelectionScore,
  getBackfillRejectionReason,
  isStandardSourceTier,
  resolveBackfillUnlockPolicy,
  resolveTrustGuardrailPolicy,
  resolveTrustedSelectionFloor,
  selectTopicItemsWithFallback,
  sortWithSourceTypePreference,
  suppressOfficialsByCluster,
};
