"use strict";

const {
  computeItemAgeHours,
  countTrustedSourceTier,
  isTrustedSourceTier,
  normalizeSourceTier,
  splitByFreshnessTiers,
} = require("../domains/digest/candidate-quality-runtime");
const {
  buildTopicSelectionState,
  buildTopicReserveQueue,
  buildTopicReserveQueueV2,
  getBackfillRejectionReason,
  getSelectionScore,
  isStandardSourceTier,
  resolveBackfillUnlockPolicy,
  resolveTrustGuardrailPolicy,
  resolveTrustedSelectionFloor,
  selectTopicItemsWithFallback,
  selectTopicItemsV2,
  sortWithSourceTypePreference,
  suppressOfficialsByCluster,
} = require("./digest-orchestrator-selection-pools-runtime");
const {
  canonicalizeCandidateTopicTags,
  filterPreSelectionSignalQuality,
  prepareSelectionCandidates,
  toSelectionAuditCandidate,
} = require("./digest-orchestrator-selection-candidates-runtime");
const { scoreCandidates } = require("../domains/scoring/score-candidate");
const { classifyCandidates } = require("../domains/classification/strategic-relevance-classifier");
const { filterLowRelevance, boostHighRelevance } = require("../domains/classification/strategic-relevance-scoring");
const { loadCache } = require("../domains/classification/strategic-relevance-cache");
const {
  resolveStrictQualityConfig,
  runPreRankingFilter,
} = require("../digest/domain/strict-quality-domain-runtime");
const { normalizeTopicToken } = require("../runtime/topic-normalization-runtime");
const path = require("path");

function incrementCount(target, key) {
  const normalizedKey = String(key || "").trim() || "unknown";
  target[normalizedKey] = (target[normalizedKey] || 0) + 1;
}

function resolveEffectiveSourceCap(paramScoringConfig, configDigest) {
  const configured = Number(
    (paramScoringConfig && paramScoringConfig.maxItemsPerSourceDomain != null)
      ? paramScoringConfig.maxItemsPerSourceDomain
      : (configDigest && configDigest.maxItemsPerSourceDomain != null)
        ? configDigest.maxItemsPerSourceDomain
        : 2
  );
  if (!Number.isFinite(configured)) return 2;
  return Math.max(1, Math.trunc(configured));
}

const SOURCE_CAP_OVERFLOW_TOPICS = new Set([
  "TECHNOLOGY",
  "CONSUMER & RETAIL",
  "ENERGY",
]);

const TRADE_FIRST_TOPICS = new Set([
  "INDUSTRIALS",
  "LIFE SCIENCES",
  "ENERGY",
]);

function getTopicAwareSourceCapOverflowMargin(topicTag = "") {
  const normalizedTag = String(topicTag || "").trim().toUpperCase();
  if (normalizedTag === "TECHNOLOGY" || normalizedTag === "CONSUMER & RETAIL") return 0.04;
  if (normalizedTag === "ENERGY") return 0.06;
  return 0.08;
}

function getUpgradePriorityForTopic(item, topicTag = "") {
  const normalizedTag = String(topicTag || "").trim().toUpperCase();
  const sourceType = String(item?.source_type || "").trim().toLowerCase();
  const tier = normalizeSourceTier(item);
  if (item?._low_signal_procedural === true
      || (sourceType === "primary_official" && item?.procedural_notice === true)) {
    return 0;
  }
  if (TRADE_FIRST_TOPICS.has(normalizedTag) && sourceType === "primary_official") return 1;
  if (tier != null && tier >= 3) return 2;
  if (normalizedTag === "TECHNOLOGY" || normalizedTag === "CONSUMER & RETAIL") {
    if (sourceType === "analysis_blog" || sourceType === "aggregator_republisher" || sourceType === "corporate_pr") return 2;
  }
  return 3;
}

function candidateOutranksSelectedForTopic(candidate, selectedItem, topicTag = "") {
  const normalizedTag = String(topicTag || "").trim().toUpperCase();
  const candidateScore = getSelectionScore(candidate);
  const selectedScore = getSelectionScore(selectedItem);
  const scoreMargin = candidateScore - selectedScore;
  const candidateType = String(candidate?.source_type || "").trim().toLowerCase();
  const selectedType = String(selectedItem?.source_type || "").trim().toLowerCase();
  const candidateTier = normalizeSourceTier(candidate);
  const selectedTier = normalizeSourceTier(selectedItem);

  if (getUpgradePriorityForTopic(selectedItem, normalizedTag) <= 1) {
    return scoreMargin >= -0.02;
  }
  if (selectedTier != null && candidateTier != null && candidateTier < selectedTier) {
    return scoreMargin >= -0.03;
  }
  if (TRADE_FIRST_TOPICS.has(normalizedTag)
      && (candidateType === "trade_specialist" || candidateType === "reported_media")
      && selectedType === "primary_official") {
    return scoreMargin >= -0.02;
  }
  return scoreMargin >= getTopicAwareSourceCapOverflowMargin(normalizedTag);
}

function normalizeRankingTopicTag(value) {
  return normalizeTopicToken(String(value || "").trim());
}

function resolveRankingConfig(configDigest = {}) {
  const raw = configDigest?.ranking && typeof configDigest.ranking === "object"
    ? configDigest.ranking
    : {};
  const liveTopicTags = Array.isArray(raw.live_topic_tags) ? raw.live_topic_tags : [];
  return {
    primaryVersion: raw.primary_version === "v2" ? "v2" : "v1",
    shadowVersion: raw.shadow_version === "v1" || raw.shadow_version === "v2"
      ? raw.shadow_version
      : null,
    liveTopicTags,
    liveTopicTagSet: new Set(liveTopicTags.map(normalizeRankingTopicTag).filter(Boolean)),
    sameDomainPenalty: raw.same_domain_penalty && typeof raw.same_domain_penalty === "object"
      ? raw.same_domain_penalty
      : {
          enabled: true,
          min_competitive_gap_for_bypass: 0.10,
          penalties: { second: 0.03, third: 0.08, fourth_or_more: 0.15 },
        },
    sameDomainGuardrail: raw.same_domain_guardrail && typeof raw.same_domain_guardrail === "object"
      ? raw.same_domain_guardrail
      : { enabled: false, max_per_topic: 3 },
    killSwitch: raw.kill_switch && typeof raw.kill_switch === "object"
      ? raw.kill_switch
      : {
          enabled: true,
          action: "fallback_to_v1",
          thresholds: {
            min_selection_overlap_pct: 0.40,
            max_trusted_share_drop_pct: 20,
            max_avg_final_rank_drop: 0.15,
          },
        },
  };
}

function isTopicV2Pilot(topicTag, rankingConfig) {
  if (!rankingConfig || rankingConfig.primaryVersion !== "v2") return false;
  return rankingConfig.liveTopicTagSet.has(normalizeRankingTopicTag(topicTag));
}

function cloneScoredItems(items = [], rankingVersion = "v1") {
  return (Array.isArray(items) ? items : []).map((item) => ({
    ...item,
    ranking_version: rankingVersion,
  }));
}

function pctShare(numerator, denominator) {
  const denom = Number(denominator || 0);
  if (!Number.isFinite(denom) || denom <= 0) return 0;
  return Number((((Number(numerator || 0) / denom) * 100)).toFixed(2));
}

function average(values = []) {
  const nums = (Array.isArray(values) ? values : []).map((value) => Number(value)).filter((value) => Number.isFinite(value));
  if (!nums.length) return 0;
  return Number((nums.reduce((sum, value) => sum + value, 0) / nums.length).toFixed(4));
}

function getSelectedUrls(items = []) {
  return new Set((Array.isArray(items) ? items : []).map((item) => String(item?.url || "").trim()).filter(Boolean));
}

function calculateOverlapPct(leftItems = [], rightItems = []) {
  const leftUrls = getSelectedUrls(leftItems);
  const rightUrls = getSelectedUrls(rightItems);
  const union = new Set([...leftUrls, ...rightUrls]);
  if (!union.size) return 100;
  let overlap = 0;
  for (const url of leftUrls) {
    if (rightUrls.has(url)) overlap += 1;
  }
  return Number(((overlap / union.size) * 100).toFixed(2));
}

function calculateTrustedSharePct(items = []) {
  const selectedItems = Array.isArray(items) ? items : [];
  return pctShare(countTrustedSourceTier(selectedItems), selectedItems.length);
}

function calculateAverageFinalRank(items = []) {
  return average((Array.isArray(items) ? items : []).map((item) => Number(item?.final_rank_score || 0)));
}

function jaccardSimilarity(left = [], right = []) {
  const leftSet = new Set((Array.isArray(left) ? left : []).map((value) => String(value || "").trim()).filter(Boolean));
  const rightSet = new Set((Array.isArray(right) ? right : []).map((value) => String(value || "").trim()).filter(Boolean));
  const union = new Set([...leftSet, ...rightSet]);
  if (!union.size) return 0;
  let intersection = 0;
  for (const value of leftSet) {
    if (rightSet.has(value)) intersection += 1;
  }
  return intersection / union.size;
}

function findWeakestNonTrustedIndex(items = []) {
  let weakestIndex = -1;
  let weakestPriority = Infinity;
  let weakestScore = Infinity;
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (isTrustedSourceTier(item)) continue;
    const replacementPriority = item?._low_signal_procedural === true
      ? 0
      : String(item?.source_tier || "").trim().toLowerCase() === "unknown"
        ? 1
        : 2;
    const normalizedScore = getSelectionScore(item);
    if (replacementPriority < weakestPriority || (replacementPriority === weakestPriority && normalizedScore < weakestScore)) {
      weakestPriority = replacementPriority;
      weakestScore = normalizedScore;
      weakestIndex = index;
    }
  }
  return weakestIndex;
}

function classifyTopicHealth({ totalCandidates = 0, selectedCount = 0, trustedCount = 0, trustedFloor = 3 }) {
  if (Number(totalCandidates || 0) < 10 || Number(selectedCount || 0) < 5) return "THIN";
  if (Number(trustedCount || 0) < Number(trustedFloor || 3)) return "LOW_TRUST";
  return "HEALTHY";
}

function capThinExpansionCandidates(items = [], maxShare = 0.4, scoreResolver = getSelectionScore) {
  const grouped = new Map();
  for (const item of (Array.isArray(items) ? items : [])) {
    const tag = String(item?.tag || "").trim().toUpperCase() || "__untagged__";
    if (!grouped.has(tag)) grouped.set(tag, []);
    grouped.get(tag).push(item);
  }
  const kept = [];
  const diagnostics = Object.create(null);
  for (const [tag, topicItems] of grouped.entries()) {
    const expanded = topicItems.filter((item) => item?._thin_topic_expansion === true);
    const baseline = topicItems.filter((item) => item?._thin_topic_expansion !== true);
    const allowedExpanded = Math.max(0, Math.floor(topicItems.length * maxShare));
    const retainedExpanded = expanded
      .slice()
      .sort((left, right) => Number(scoreResolver(right) || 0) - Number(scoreResolver(left) || 0))
      .slice(0, Math.max(allowedExpanded, baseline.length > 0 ? 1 : 0));
    const retainedUrls = new Set(retainedExpanded.map((item) => String(item?.url || "").trim()).filter(Boolean));
    diagnostics[tag] = {
      expanded_candidate_count: expanded.length,
      expanded_candidate_cap: Math.max(allowedExpanded, baseline.length > 0 ? 1 : 0),
      expanded_candidate_capped_count: Math.max(0, expanded.length - retainedExpanded.length),
    };
    kept.push(
      ...baseline,
      ...expanded.filter((item) => retainedUrls.has(String(item?.url || "").trim()))
    );
  }
  return {
    items: kept,
    diagnostics,
  };
}

function canSwapCandidateIntoTopic(candidate, selectedItems = [], replaceIndex, policy = {}, topicTag = "") {
  const remaining = (Array.isArray(selectedItems) ? selectedItems : []).filter((_, index) => index !== replaceIndex);
  const rejectionReason = getBackfillRejectionReason(candidate, remaining, policy);
  if (!rejectionReason) return true;
  if (!String(rejectionReason).startsWith("selection_source_cap")) return false;
  if (!isTrustedSourceTier(candidate)) return false;
  if (policy.allowTrustedSourceCapOverflow !== true) return false;

  const state = buildTopicSelectionState(remaining);
  const perSourceCap = Math.max(1, Number(policy.maxItemsPerSourceDomain || 2));
  const sourceDomain = String(candidate?.source_domain || candidate?.source || "unknown").trim().toLowerCase();
  const sourceDomainCount = Number(state.domainCounts[sourceDomain] || 0);
  if (sourceDomainCount !== perSourceCap) return false;

  const replaced = Array.isArray(selectedItems) ? selectedItems[replaceIndex] : null;
  if (!replaced) return false;
  const normalizedTag = String(topicTag || replaced?.tag || candidate?.tag || "").trim().toUpperCase();
  const replacedTrusted = isTrustedSourceTier(replaced);
  const replacedSourceType = String(replaced?.source_type || "").trim().toLowerCase();
  const replacedLowSignalOfficial = replaced?._low_signal_procedural === true
    || (replacedSourceType === "primary_official" && replaced?.procedural_notice === true);
  if (!replacedLowSignalOfficial && replacedTrusted && !SOURCE_CAP_OVERFLOW_TOPICS.has(normalizedTag)) return false;

  const scoreTolerance = Number(policy.trustedSourceCapOverflowScoreTolerance);
  const allowedTolerance = Number.isFinite(scoreTolerance) ? Math.max(0, scoreTolerance) : 0.1;
  if (!candidateOutranksSelectedForTopic(candidate, replaced, normalizedTag)) return false;
  return getSelectionScore(candidate) >= (getSelectionScore(replaced) - allowedTolerance);
}

function findWeakestTrustedUpgradeIndex(items = [], topicTag = "") {
  let weakestIndex = -1;
  let weakestPriority = Infinity;
  let weakestScore = Infinity;
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const upgradePriority = getUpgradePriorityForTopic(item, topicTag);
    if (upgradePriority >= 3) continue;
    const normalizedScore = getSelectionScore(item);
    if (upgradePriority < weakestPriority || (upgradePriority === weakestPriority && normalizedScore < weakestScore)) {
      weakestPriority = upgradePriority;
      weakestScore = normalizedScore;
      weakestIndex = index;
    }
  }
  return weakestIndex;
}

function evaluateKillSwitchForTopic(v2SelectedItems = [], v1ShadowSelectedItems = [], rankingConfig = {}) {
  const overlapPct = calculateOverlapPct(v2SelectedItems, v1ShadowSelectedItems);
  const trustedSharePctV1 = calculateTrustedSharePct(v1ShadowSelectedItems);
  const trustedSharePctV2 = calculateTrustedSharePct(v2SelectedItems);
  const trustedShareDropPct = Number((trustedSharePctV1 - trustedSharePctV2).toFixed(2));
  const avgFinalRankV1 = calculateAverageFinalRank(v1ShadowSelectedItems);
  const avgFinalRankV2 = calculateAverageFinalRank(v2SelectedItems);
  const avgFinalRankDrop = Number((avgFinalRankV1 - avgFinalRankV2).toFixed(4));
  const top1Changed = String(v2SelectedItems[0]?.url || "").trim() !== String(v1ShadowSelectedItems[0]?.url || "").trim();
  const thresholds = rankingConfig?.killSwitch?.thresholds && typeof rankingConfig.killSwitch.thresholds === "object"
    ? rankingConfig.killSwitch.thresholds
    : {};
  const reasons = [];
  if (overlapPct < Number((thresholds.min_selection_overlap_pct ?? 0.40) * 100)) {
    reasons.push("selection_overlap_breach");
  }
  if (trustedShareDropPct > Number(thresholds.max_trusted_share_drop_pct ?? 20)) {
    reasons.push("trusted_share_drop_breach");
  }
  if (avgFinalRankDrop > Number(thresholds.max_avg_final_rank_drop ?? 0.15)) {
    reasons.push("avg_final_rank_drop_breach");
  }
  return {
    selection_overlap_pct: overlapPct,
    trusted_share_pct_v1: trustedSharePctV1,
    trusted_share_pct_v2: trustedSharePctV2,
    trusted_share_drop_pct: trustedShareDropPct,
    avg_final_rank_v1_selected: avgFinalRankV1,
    avg_final_rank_v2_selected: avgFinalRankV2,
    avg_final_rank_drop: avgFinalRankDrop,
    top1_changed: top1Changed,
    kill_switch_triggered: rankingConfig?.killSwitch?.enabled === true && reasons.length > 0,
    kill_switch_reasons: reasons,
  };
}

function resolveV2RegretReason(v2Item, displacedV1Item, v2SelectedItems = [], context = {}) {
  if (!v2Item || !displacedV1Item) return null;
  const authorityGap = Number(displacedV1Item?.source_authority_score || displacedV1Item?.source_authority || 0)
    - Number(v2Item?.source_authority_score || v2Item?.source_authority || 0);
  const v2StoryQuality = Number(v2Item?.story_quality_score || 0);
  const v1StoryQuality = Number(displacedV1Item?.story_quality_score || 0);
  const v2Specificity = Number(v2Item?.story_quality_components?.specificity || 0);
  const v1Specificity = Number(displacedV1Item?.story_quality_components?.specificity || 0);
  if (authorityGap >= 0.15 && (v2StoryQuality - v1StoryQuality) < 0.05) {
    return "weaker_source";
  }
  if ((v1Specificity - v2Specificity) >= 0.10 && (v1StoryQuality - v2StoryQuality) >= 0.08) {
    return "lower_specificity";
  }
  const overlapsAnotherV2 = (Array.isArray(v2SelectedItems) ? v2SelectedItems : []).some((candidate) => {
    if (!candidate || candidate === v2Item) return false;
    if (String(candidate?.storyline_key || "").trim() && String(candidate?.storyline_key || "").trim() === String(v2Item?.storyline_key || "").trim()) {
      return true;
    }
    return jaccardSimilarity(candidate?.event_markers || [], v2Item?.event_markers || []) >= 0.5;
  });
  const displacedDiversifies = (Array.isArray(v2SelectedItems) ? v2SelectedItems : []).every((candidate) => {
    if (!candidate || candidate === v2Item) return true;
    const sameDomain = String(candidate?.source_domain || "").trim().toLowerCase() === String(displacedV1Item?.source_domain || "").trim().toLowerCase();
    const sameStory = String(candidate?.storyline_key || "").trim() && String(candidate?.storyline_key || "").trim() === String(displacedV1Item?.storyline_key || "").trim();
    return !sameDomain && !sameStory;
  });
  if (overlapsAnotherV2 && displacedDiversifies) {
    return "duplicate_angle";
  }
  const displacedIsPrimaryType = ["reported_media", "primary_official"].includes(String(displacedV1Item?.source_type || "").trim().toLowerCase());
  const displacedStrategicGap = Number(displacedV1Item?.strategic_value || 0) - Number(v2Item?.strategic_value || 0);
  if (context.displacedWasTop1 === true && displacedIsPrimaryType && displacedStrategicGap >= 0.10) {
    return "missed_primary_story";
  }
  return null;
}

function buildSelectionComparisonMetadata(params = {}) {
  const liveCandidates = Array.isArray(params.liveCandidates) ? params.liveCandidates : [];
  const v1Selected = Array.isArray(params.v1Selected) ? params.v1Selected : [];
  const v2Selected = Array.isArray(params.v2Selected) ? params.v2Selected : [];
  const byUrl = new Map();
  for (const candidate of liveCandidates) {
    byUrl.set(String(candidate?.url || "").trim(), candidate);
  }
  const v1SelectedUrls = getSelectedUrls(v1Selected);
  const v2SelectedUrls = getSelectedUrls(v2Selected);
  const v1Only = v1Selected.filter((candidate) => !v2SelectedUrls.has(String(candidate?.url || "").trim()));
  const v2Only = v2Selected.filter((candidate) => !v1SelectedUrls.has(String(candidate?.url || "").trim()));
  const v1OnlyByRank = v1Only.slice().sort((left, right) => getSelectionScore(right) - getSelectionScore(left));

  for (const candidate of byUrl.values()) {
    const url = String(candidate?.url || "").trim();
    candidate.v1_selected = v1SelectedUrls.has(url);
    candidate.v2_selected = v2SelectedUrls.has(url);
    candidate.selection_disagreement_reason = candidate.v1_selected === candidate.v2_selected
      ? null
      : (candidate.v2_selected ? "v2_only" : "v1_only");
    candidate.v2_regret_flag = false;
    candidate.v2_regret_reason = null;
    candidate.top1_changed = params.top1Changed === true;
    candidate.kill_switch_triggered = params.killSwitchTriggered === true;
    candidate.kill_switch_reasons = Array.isArray(params.killSwitchReasons) ? params.killSwitchReasons.slice() : [];
  }

  v2Only.forEach((candidate, index) => {
    const displaced = v1OnlyByRank[index] || null;
    const regretReason = resolveV2RegretReason(candidate, displaced, v2Selected, {
      displacedWasTop1: displaced && String(displaced?.url || "").trim() === String(v1Selected[0]?.url || "").trim(),
    });
    const liveCandidate = byUrl.get(String(candidate?.url || "").trim());
    if (!liveCandidate) return;
    liveCandidate.v2_regret_flag = Boolean(regretReason);
    liveCandidate.v2_regret_reason = regretReason;
  });

  const regretReasonCounts = Object.create(null);
  for (const candidate of byUrl.values()) {
    if (!candidate?.v2_regret_reason) continue;
    incrementCount(regretReasonCounts, candidate.v2_regret_reason);
  }

  return {
    candidates: Array.from(byUrl.values()),
    regret_flag_count: Array.from(byUrl.values()).filter((candidate) => candidate?.v2_regret_flag === true).length,
    regret_reason_counts: regretReasonCounts,
  };
}

function applyPrimaryTrustGuardrail(params = {}) {
  const topicAcceptedItems = Array.isArray(params.topicAcceptedItems) ? params.topicAcceptedItems.slice() : [];
  const reserveState = params.reserveState && typeof params.reserveState === "object" ? params.reserveState : {};
  const trustGuardrail = params.trustGuardrail && typeof params.trustGuardrail === "object" ? params.trustGuardrail : {};
  const topicItems = Array.isArray(params.topicItems) ? params.topicItems : [];
  const policy = params.policy && typeof params.policy === "object" ? params.policy : {};
  const diagnostics = {
    triggered: false,
    swaps_attempted: 0,
    swaps_completed: 0,
    better_trusted_available_count: 0,
    better_trusted_available_details: [],
  };
  const strongReserve = Array.isArray(reserveState.strongReserve) ? reserveState.strongReserve.slice() : [];
  const topicTag = String(
    params.topicTag
      || topicAcceptedItems[0]?.tag
      || params.topicItems?.[0]?.tag
      || ""
  ).trim().toUpperCase();

  const desiredTrusted = Math.min(
    topicAcceptedItems.length,
    Math.max(
      Number(trustGuardrail.minTrustedItemsPerTopic || 0),
      Number(trustGuardrail.aspirationalTrustedItemsPerTopic || 0)
    )
  );
  while (countTrustedSourceTier(topicAcceptedItems) < desiredTrusted && strongReserve.length > 0) {
    const weakestIndex = findWeakestNonTrustedIndex(topicAcceptedItems);
    if (weakestIndex === -1) break;
    const replacementIndex = strongReserve.findIndex((candidate) => canSwapCandidateIntoTopic(candidate, topicAcceptedItems, weakestIndex, {
      ...policy,
      allowTrustedSourceCapOverflow: true,
    }, topicTag));
    if (replacementIndex === -1) break;
    diagnostics.triggered = true;
    diagnostics.swaps_attempted += 1;
    const replacement = strongReserve.splice(replacementIndex, 1)[0];
    const replaced = topicAcceptedItems[weakestIndex];
    replacement._selection_stage = `${replacement._selection_stage || "reserve"}_guardrail_swap`;
    replacement._guardrail_swap = {
      replaced_url: String(replaced?.url || "").trim() || null,
      replaced_score: Number(replaced?._score || 0),
    };
    topicAcceptedItems.splice(weakestIndex, 1, replacement);
    diagnostics.swaps_completed += 1;
  }

  while (strongReserve.length > 0) {
    let weakestIndex = findWeakestNonTrustedIndex(topicAcceptedItems);
    if (weakestIndex === -1) weakestIndex = findWeakestTrustedUpgradeIndex(topicAcceptedItems, topicTag);
    if (weakestIndex === -1) break;
    const weakestSelected = topicAcceptedItems[weakestIndex];
    const replacementIndex = strongReserve.findIndex((candidate) =>
      canSwapCandidateIntoTopic(candidate, topicAcceptedItems, weakestIndex, {
        ...policy,
        allowTrustedSourceCapOverflow: true,
      }, topicTag)
      && candidateOutranksSelectedForTopic(candidate, weakestSelected, topicTag)
    );
    if (replacementIndex === -1) break;
    diagnostics.triggered = true;
    diagnostics.swaps_attempted += 1;
    const replacement = strongReserve.splice(replacementIndex, 1)[0];
    const replaced = topicAcceptedItems[weakestIndex];
    replacement._selection_stage = `${replacement._selection_stage || "reserve"}_guardrail_swap`;
    replacement._guardrail_swap = {
      replaced_url: String(replaced?.url || "").trim() || null,
      replaced_score: Number(getSelectionScore(replaced) || 0),
      source_cap_overflow_allowed: true,
    };
    topicAcceptedItems.splice(weakestIndex, 1, replacement);
    diagnostics.swaps_completed += 1;
  }

  const selectedUrls = new Set(topicAcceptedItems.map((item) => String(item?.url || "").trim()).filter(Boolean));
  const remainingStrongReserve = strongReserve.filter((candidate) => !selectedUrls.has(String(candidate?.url || "").trim()));
  for (let index = 0; index < topicAcceptedItems.length; index += 1) {
    const selectedItem = topicAcceptedItems[index];
    if (isTrustedSourceTier(selectedItem)) continue;
    const betterTrusted = remainingStrongReserve.find((candidate) =>
      getSelectionScore(candidate) > getSelectionScore(selectedItem)
      && canSwapCandidateIntoTopic(candidate, topicAcceptedItems, index, {
        ...policy,
        allowTrustedSourceCapOverflow: true,
      })
    );
    if (!betterTrusted) continue;
      selectedItem._better_trusted_available = {
        trusted_url: String(betterTrusted?.url || "").trim() || null,
        trusted_score: getSelectionScore(betterTrusted),
      };
    diagnostics.better_trusted_available_count += 1;
    diagnostics.better_trusted_available_details.push({
        selected_url: String(selectedItem?.url || "").trim() || null,
        selected_score: getSelectionScore(selectedItem),
        trusted_url: String(betterTrusted?.url || "").trim() || null,
        trusted_score: getSelectionScore(betterTrusted),
      });
  }

  return {
    selectedItems: topicAcceptedItems,
    reserveState: {
      ...reserveState,
      strongReserve: remainingStrongReserve,
      allReserve: [...remainingStrongReserve, ...(Array.isArray(reserveState.standardReserve) ? reserveState.standardReserve : [])],
    },
    diagnostics,
  };
}

function createDigestOrchestratorSelectionRuntime(deps) {
  const {
    CONFIG,
    log,
    createDigestPolicies,
    dedupAgainstRecentArchives,
    buildRecentRepeatIndex,
    selectItems,
    selectItemsDetailed,
    loadRecentArchiveByDate,
    buildRepeatHistory,
    filterItemsAgainstHistory,
    buildRepetitionNote,
    emitDigestIncident,
    articleAgeTooOld,
    classifyStoryRelationship,
    loadEditorialOverrides,
    editorialOverridesPath,
    isUrlExcluded,
    isDomainSuppressed,
    getPinsForDate,
    annotateEditorialSignals,
    buildStorylineCandidates,
    assignCanonicalTopic,
    scoreBestFitTopicTag,
    httpsPostWithRetry,
  } = deps;

  async function selectForEnrichment(params) {
    const {
      selectionTarget,
      tagPriority,
      runMode,
      digestDateKey,
      dueUsersCount,
      standardFetchCallsPlanned,
      scoringConfig: paramScoringConfig,
      nowMs: paramNowMs,
    } = params;
    let allItems = params.allItems; // must be let — editorial override block reassigns it below
    const rawCandidateCount = Array.isArray(allItems) ? allItems.length : 0;

    const todayStr = String(digestDateKey || "").slice(0, 10);

    // Apply editorial overrides: excludes, domain suppressions, and pins.
    let editorialOverrides = { pins: [], excludes: [], source_suppressions: [] };
    if (typeof loadEditorialOverrides === "function" && editorialOverridesPath) {
      editorialOverrides = loadEditorialOverrides(editorialOverridesPath);
    }

    // Remove excluded URLs
    const urlExcludedItems = allItems.filter((item) =>
      isUrlExcluded(String(item?.url || ""), editorialOverrides.excludes, todayStr)
    );
    const excludedCount = urlExcludedItems.length;
    if (excludedCount > 0) {
      log(`Editorial overrides: excluded ${excludedCount} item(s) by URL`);
    }
    allItems = allItems.filter((item) =>
      !isUrlExcluded(String(item?.url || ""), editorialOverrides.excludes, todayStr)
    );

    // Remove domain-suppressed items
    const domainSuppressedItems = allItems.filter((item) => {
      const domain = String(item?.source_domain || item?.source || "").toLowerCase();
      return isDomainSuppressed(domain, editorialOverrides.source_suppressions, todayStr);
    });
    const suppressedCount = domainSuppressedItems.length;
    if (suppressedCount > 0) {
      log(`Editorial overrides: suppressed ${suppressedCount} item(s) by source domain`);
    }
    allItems = allItems.filter((item) => {
      const domain = String(item?.source_domain || item?.source || "").toLowerCase();
      return !isDomainSuppressed(domain, editorialOverrides.source_suppressions, todayStr);
    });

    const editorialDroppedItems = [
      ...urlExcludedItems.map((item) => ({
        stage: "editorial_filter",
        status: "dropped",
        reason: "url_excluded",
        url: String(item?.url || ""),
        title: String(item?.headline || item?.title || "").slice(0, 160),
        domain: String(item?.source_domain || item?.source || "").toLowerCase().replace(/^www\./, ""),
        topic: String(item?.topic_tag || item?.tag || ""),
        published_at: item?.published_at || null,
      })),
      ...domainSuppressedItems.map((item) => ({
        stage: "editorial_filter",
        status: "dropped",
        reason: "domain_suppressed",
        url: String(item?.url || ""),
        title: String(item?.headline || item?.title || "").slice(0, 160),
        domain: String(item?.source_domain || item?.source || "").toLowerCase().replace(/^www\./, ""),
        topic: String(item?.topic_tag || item?.tag || ""),
        published_at: item?.published_at || null,
      })),
    ];

    // Inject pinned items (mark them so selection policy keeps them)
    const activePins = typeof getPinsForDate === "function"
      ? getPinsForDate(editorialOverrides.pins, todayStr)
      : [];
    let injectedPinCount = 0;
    if (activePins.length > 0) {
      const existingUrls = new Set(allItems.map((item) => String(item?.url || "").trim()));
      for (const pin of activePins) {
        const pinUrl = String(pin?.url || "").trim();
        if (!pinUrl || existingUrls.has(pinUrl)) continue;
        // Inject as a high-priority synthetic item so it survives scoring
        allItems.push({
          url: pinUrl,
          headline: pin.note || `Pinned: ${pinUrl}`,
          tag: String(pin.topic || "").trim().toUpperCase() || "__pinned__",
          _editorial_pin: true,
          _score: 1.0, // ensures it is not filtered by score
          source: "editorial-pin",
          source_domain: "editorial-pin",
          source_tier: 1,
        });
        existingUrls.add(pinUrl);
        injectedPinCount += 1;
      }
      if (injectedPinCount > 0) {
        log(`Editorial overrides: injected ${injectedPinCount} pinned item(s)`);
      }
    }
    const candidatePoolAfterEditorial = Array.isArray(allItems) ? allItems.length : 0;
    const preparedCandidates = prepareSelectionCandidates(allItems, {
      configTopics: CONFIG.topics,
      annotateEditorialSignals,
      buildStorylineCandidates,
      assignCanonicalTopic,
      scoreBestFitTopicTag,
    });
    allItems = preparedCandidates.items;
    const candidatePoolAfterPreparation = Array.isArray(allItems) ? allItems.length : 0;
    const storylineClusterRemovedCount = Math.max(0, Number(preparedCandidates.storylineClusterRemovedCount || 0));
    const bestFitTopicReassignedCount = Math.max(0, Number(preparedCandidates.bestFitTopicReassignedCount || 0));
    if (storylineClusterRemovedCount > 0) {
      log(`Storyline clustering collapsed ${storylineClusterRemovedCount} same-story candidate(s) before selection`);
    }
    if (bestFitTopicReassignedCount > 0) {
      log(`Best-fit topic arbitration reassigned ${bestFitTopicReassignedCount} candidate(s) to a stronger topic`);
    }

    const crossDayDedupDays = Math.max(1, Number(
      (paramScoringConfig && paramScoringConfig.crossDayDedupDays != null)
        ? paramScoringConfig.crossDayDedupDays
        : (CONFIG.digest.crossDayDedupDays || 3)
    ));
    const digestPolicies = createDigestPolicies(CONFIG.digest || {});
    const rankingPolicy = digestPolicies.rankingPolicy;
    const depthPolicy = digestPolicies.depthPolicy;
    const dedupRes = dedupAgainstRecentArchives(allItems, {
      days: crossDayDedupDays,
      targetCount: selectionTarget,
      minBackfillItems: Math.max(1, Number(CONFIG.digest.minBackfillItemsAfterDedup || depthPolicy.defaultItemCount || 5)),
    });
    const configuredMaxAgeHours = Number(
      (paramScoringConfig && paramScoringConfig.maxAgeHours != null)
        ? paramScoringConfig.maxAgeHours
        : (CONFIG.digest.maxArticleAgeHours || 48)
    );
    const maxArticleAgeHours = Number.isFinite(configuredMaxAgeHours)
      ? Math.min(48, Math.max(1, configuredMaxAgeHours))
      : 48;
    const ageFilter = typeof articleAgeTooOld === "function" ? articleAgeTooOld : () => false;
    const freshItems = dedupRes.items.filter((item) => !ageFilter(item, maxArticleAgeHours));
    const staleItems = dedupRes.items.filter((item) => ageFilter(item, maxArticleAgeHours));
    const staleRemoved = staleItems.length;
    if (staleRemoved > 0) {
      log(`Freshness gate removed ${staleRemoved} stale item(s) older than ${maxArticleAgeHours}h`);
    }

    const archiveDedupDroppedItems = (dedupRes.removed_items || []).map((item) => ({
      stage: "archive_dedup",
      status: "dropped",
      reason: "already_seen",
      url: String(item?.url || ""),
      title: String(item?.headline || item?.title || "").slice(0, 160),
      domain: String(item?.source_domain || item?.source || "").toLowerCase().replace(/^www\./, ""),
      topic: String(item?.topic_tag || item?.tag || ""),
      matched_reference: item?._archive_match || null,
    }));

    const _nowMsForFreshness = Number.isFinite(paramNowMs) ? paramNowMs : Date.now();
    const freshnessDroppedItems = staleItems.map((item) => {
      const h = computeItemAgeHours(item, _nowMsForFreshness);
      let freshness_bucket = "unknown";
      if (Number.isFinite(h)) {
        if (h <= 24) freshness_bucket = "0_24h";
        else if (h <= 48) freshness_bucket = "24_48h";
        else freshness_bucket = "over_48h";
      }
      return {
        stage: "freshness_filter",
        status: "dropped",
        reason: "too_old",
        freshness_bucket,
        url: String(item?.url || ""),
        title: String(item?.headline || item?.title || "").slice(0, 160),
        domain: String(item?.source_domain || item?.source || "").toLowerCase().replace(/^www\./, ""),
        topic: String(item?.topic_tag || item?.tag || ""),
        published_at: item?.published_at || null,
      };
    });
    const repeatIndex = buildRecentRepeatIndex(crossDayDedupDays);
    const repeatPenalty = Number(rankingPolicy.repeatPenalty || 0);

    if (dedupRes.removed > 0) {
      log(`Cross-day dedup removed ${dedupRes.removed} repeat item(s) using last ${dedupRes.archive_days_used} day(s) of archive history${dedupRes.backfilled > 0 ? ` (backfilled ${dedupRes.backfilled} to minimum)` : ""}`);
    }
    if ((repeatIndex.urlKeys.size > 0 || repeatIndex.headlineKeys.size > 0) && repeatPenalty > 0) {
      log(`Freshness penalty active (days=${repeatIndex.days}, penalty=${repeatPenalty.toFixed(2)})`);
    }

    // Longitudinal history filter: suppress same storylines seen in past 7 days
    // unless the item introduces new entities or content flags (materially new).
    const historyLookbackDays = Math.max(4, Number(
      (paramScoringConfig && paramScoringConfig.historyLookbackDays != null)
        ? paramScoringConfig.historyLookbackDays
        : (CONFIG.digest?.historyLookbackDays || 7)
    ));
    const archiveByDate = typeof loadRecentArchiveByDate === "function"
      ? loadRecentArchiveByDate(historyLookbackDays)
      : [];
    const repeatHistoryMap = typeof buildRepeatHistory === "function"
      ? buildRepeatHistory(archiveByDate)
      : new Map();
    const historyResult = typeof filterItemsAgainstHistory === "function"
      ? filterItemsAgainstHistory(freshItems, repeatHistoryMap, String(digestDateKey || ""), {
        suppressWithinDays: 3,
        frequentThreshold: 3,
      })
      : { items: freshItems, suppressedCount: 0, suppressedFrequentCount: 0, streaks: [] };

    if (historyResult.suppressedCount > 0) {
      log(`Longitudinal history filter suppressed ${historyResult.suppressedCount} repeat item(s) from last ${historyLookbackDays} days (streaks: ${historyResult.streaks.length})`);
    }
    const dedupedItems = historyResult.items;
    const repetitionNote = typeof buildRepetitionNote === "function"
      ? buildRepetitionNote(historyResult.streaks, historyResult.suppressedCount)
      : "";

    // Cross-day story relationship annotation (§2.3)
    // Uses the same archive window as history suppression.
    // Continuation items are removed; follow_up items are annotated and kept.
    let annotatedItems = dedupedItems;
    let continuationRemovedCount = 0;
    let followUpCount = 0;
    const storyDedupDroppedItems = [];

    if (typeof classifyStoryRelationship === "function") {
      // Build a flat list of past headlines from the archive-by-date result.
      const pastItems = [];
      for (const dateEntry of (Array.isArray(archiveByDate) ? archiveByDate : [])) {
        if (Array.isArray(dateEntry?.items)) {
          for (const archiveItem of dateEntry.items) {
            if (archiveItem?.headline) pastItems.push(archiveItem);
          }
        }
      }

      const classified = [];
      for (const item of dedupedItems) {
        const relationship = classifyStoryRelationship(item, pastItems);
        if (relationship === "continuation") {
          continuationRemovedCount += 1;
          storyDedupDroppedItems.push({
            url: String(item?.url || ""),
            title: String(item?.headline || item?.title || ""),
            domain: String(item?.source_domain || item?.source || ""),
            lane: String(item?.lane || ""),
            published_at: item?.published_at || null,
            reason: "story_continuation",
          });
          continue;
        }
        classified.push({ ...item, _story_relationship: relationship });
        if (relationship === "follow_up") followUpCount += 1;
      }
      annotatedItems = classified;

      if (continuationRemovedCount > 0) {
        log(`Story classification: removed ${continuationRemovedCount} continuation item(s), ${followUpCount} follow_up item(s) passed through`);
      }
    }

    // --- Strategic relevance classification (feature-gated) ---
    let classificationDiagnostics = null;
    let filterDiagnostics = null;
    let boostDiagnostics = null;
    let strictQualityPrefilterDiagnostics = null;
    let signalQualityPrefilterDiagnostics = null;
    const strictQualityConfig = resolveStrictQualityConfig(CONFIG.digest || {});
    const nowMs = Number.isFinite(paramNowMs) ? paramNowMs : Date.now();
    let preRankingItems = annotatedItems;
    if (strictQualityConfig.enabled) {
      const preRankingResult = runPreRankingFilter(annotatedItems, {
        strictQualityConfig,
        configDigest: CONFIG.digest || {},
        nowMs,
      });
      strictQualityPrefilterDiagnostics = preRankingResult.diagnostics;
      preRankingItems = preRankingResult.kept;
      if (Number(strictQualityPrefilterDiagnostics?.removed_count || 0) > 0) {
        log(`Strict quality prefilter removed ${strictQualityPrefilterDiagnostics.removed_count} candidate(s) before scoring`);
      }
    }
    const signalQualityPrefilter = filterPreSelectionSignalQuality(preRankingItems);
    signalQualityPrefilterDiagnostics = signalQualityPrefilter.diagnostics;
    preRankingItems = signalQualityPrefilter.kept;
    if (Number(signalQualityPrefilterDiagnostics?.removed_count || 0) > 0) {
      log(`Signal-quality prefilter removed ${signalQualityPrefilterDiagnostics.removed_count} low-signal procedural candidate(s) before scoring`);
    }
    const classificationEnabled = CONFIG.digest?.classification?.enabled === true;
    let scoringInput = preRankingItems;
    let classifierDroppedItems = null;

    if (classificationEnabled) {
      const cachePath = path.resolve(process.cwd(), "data", "strategic-classification-cache.json");
      const cache = loadCache(cachePath);
      const { candidates: classified, diagnostics: classRunDiag } = await classifyCandidates(
        preRankingItems,
        {
          cache,
          config: CONFIG,
          log,
          httpsPost: httpsPostWithRetry,
          cachePath,
        }
      );
      classificationDiagnostics = classRunDiag;

      const { filtered, dropped, diagnostics: filterDiag } = filterLowRelevance(classified, { log });
      filterDiagnostics = filterDiag;
      scoringInput = filtered;
      classifierDroppedItems = dropped.map((item) => ({
        url: String(item?.url || ""),
        title: String(item?.headline || item?.title || ""),
        domain: String(item?.source_domain || item?.source || ""),
        lane: String(item?.lane || ""),
        published_at: item?.published_at || null,
        topic: String(item?.tag || ""),
        reason: "low_relevance",
        strategic_relevance: "LOW",
        strategic_relevance_reason: item?.strategic_relevance_reason
          ? String(item.strategic_relevance_reason).slice(0, 120)
          : null,
      }));

      log(`Strategic classifier: ${classRunDiag.total_classified} classified (${classRunDiag.cache_hits} cached, ${classRunDiag.model_calls} model), ${dropped.length} LOW dropped, ${filtered.length} remain`);
    }

    const scoringConfig = paramScoringConfig && typeof paramScoringConfig === "object"
      ? paramScoringConfig
      : (CONFIG.digest?.scoring || {});
    const rankingConfig = resolveRankingConfig(CONFIG.digest || {});
    const baseScoredItems = scoreCandidates(scoringInput, { scoringConfig, nowMs });
    const v1ScoredItems = cloneScoredItems(baseScoredItems, "v1");
    const v2ScoredItems = cloneScoredItems(baseScoredItems, "v2");

    let v1PostScoreItems = v1ScoredItems;
    if (classificationEnabled) {
      const boostAmount = CONFIG.digest?.classification?.boost_amount ?? 0.12;
      const boostInThinPool = CONFIG.digest?.classification?.boost_in_thin_pool ?? true;
      const { boosted, diagnostics: bDiag } = boostHighRelevance(v1ScoredItems, { boostAmount, boostInThinPool, log });
      boostDiagnostics = bDiag;
      boosted.sort((a, b) => (b._score || 0) - (a._score || 0));
      v1PostScoreItems = boosted;
    }
    const v1ThinExpansionCapResult = capThinExpansionCandidates(v1PostScoreItems, 0.4, getSelectionScore);
    v1PostScoreItems = v1ThinExpansionCapResult.items;
    const v2ThinExpansionCapResult = capThinExpansionCandidates(v2ScoredItems, 0.4, (item) => Number(item?.final_rank_score || 0));
    const v2PostScoreItems = v2ThinExpansionCapResult.items;
    const scoreSummaryItems = rankingConfig.primaryVersion === "v2" ? v2PostScoreItems : v1PostScoreItems;

    if (scoreSummaryItems.length > 0) {
      const topScore = rankingConfig.primaryVersion === "v2"
        ? scoreSummaryItems[0]?.final_rank_score?.toFixed(3) ?? "?"
        : scoreSummaryItems[0]?._score?.toFixed(3) ?? "?";
      const bottomScore = rankingConfig.primaryVersion === "v2"
        ? scoreSummaryItems[scoreSummaryItems.length - 1]?.final_rank_score?.toFixed(3) ?? "?"
        : scoreSummaryItems[scoreSummaryItems.length - 1]?._score?.toFixed(3) ?? "?";
      log(`Scored ${scoreSummaryItems.length} candidate(s): top=${topScore}, bottom=${bottomScore}`);
    }

    const itemsPerTopic = 5;
    const maxDiscoveryPerTopic = Math.max(0, Number(CONFIG.digest.maxDiscoveryItemsPerTopic ?? 1));
    const effectiveMaxItemsPerSourceDomain = resolveEffectiveSourceCap(paramScoringConfig, CONFIG.digest);
    const trustedSelectionFloor = resolveTrustedSelectionFloor(CONFIG.digest || {}, itemsPerTopic);
    const trustGuardrailPolicy = resolveTrustGuardrailPolicy(CONFIG.digest || {}, itemsPerTopic);
    const backfillUnlockPolicy = resolveBackfillUnlockPolicy(CONFIG.digest || {});

    function groupByTag(items = []) {
      const byTag = new Map();
      for (const item of (Array.isArray(items) ? items : [])) {
        const topicTag = String(item?.tag || "").trim().toUpperCase() || "__untagged__";
        if (!byTag.has(topicTag)) byTag.set(topicTag, []);
        byTag.get(topicTag).push(item);
      }
      return byTag;
    }

    function executeTopicSelection(version, topicTag, topicItems) {
      if (version === "v2") {
        const topicSelection = selectTopicItemsV2({
          topicItems,
          itemsPerTopic,
          maxDiscoveryPerTopic,
          nowMs,
          clusterOfficialSuppression: CONFIG.digest?.clusterOfficialSuppression === true,
          sameDomainPenalty: rankingConfig.sameDomainPenalty,
          sameDomainGuardrail: rankingConfig.sameDomainGuardrail,
        });
        const reserveState = buildTopicReserveQueueV2({
          pools: topicSelection.pools,
          selectedItems: topicSelection.selected,
          maxDiscoveryPerTopic,
          commentaryCap: 1,
          sameDomainPenalty: rankingConfig.sameDomainPenalty,
        });
        return {
          version,
          topicSelection,
          rawTopicAcceptedItems: topicSelection.selected.slice(),
          selectedItems: topicSelection.selected.slice(),
          reserveState: {
            ...reserveState,
            ranking_version: "v2",
          },
          initialReserveState: reserveState,
          primaryGuardrail: {
            selectedItems: topicSelection.selected.slice(),
            reserveState,
            diagnostics: {
              triggered: false,
              swaps_attempted: 0,
              swaps_completed: 0,
              better_trusted_available_count: 0,
              better_trusted_available_details: [],
            },
          },
          tieredPool: [
            ...(Array.isArray(topicSelection.pools?.tier1) ? topicSelection.pools.tier1 : []),
            ...(Array.isArray(topicSelection.pools?.tier2) ? topicSelection.pools.tier2 : []),
          ],
          trustedFloor: {
            enabled: false,
            active: false,
            minTrustedItemsPerTopic: 0,
            trusted_candidate_count: countTrustedSourceTier(topicItems),
            selected_trusted_count: countTrustedSourceTier(topicSelection.selected),
          },
          commentarySelectedCount: Number(topicSelection.commentarySelectedCount || 0),
          rejectionReasonByItem: topicSelection.rejectionReasonByItem,
          pools: topicSelection.pools,
        };
      }

      const topicSelection = selectTopicItemsWithFallback({
        topicItems,
        itemsPerTopic,
        maxItemsPerSourceDomain: effectiveMaxItemsPerSourceDomain,
        maxDiscoveryPerTopic,
        nowMs,
        trustedSelectionFloor,
      });
      const {
        selected: rawTopicAcceptedItems,
        rejectionReasonByItem,
        pools,
        commentarySelectedCount,
        trustedFloor,
      } = topicSelection;
      const initialReserveState = buildTopicReserveQueue({
        pools,
        selectedItems: rawTopicAcceptedItems,
      });
      const primaryGuardrail = applyPrimaryTrustGuardrail({
        topicAcceptedItems: rawTopicAcceptedItems,
        reserveState: initialReserveState,
        trustGuardrail: trustGuardrailPolicy,
        topicItems,
        policy: {
          maxItemsPerSourceDomain: effectiveMaxItemsPerSourceDomain,
          maxDiscoveryPerTopic,
          commentaryCap: 1,
        },
      });
      return {
        version,
        topicSelection,
        rawTopicAcceptedItems,
        selectedItems: primaryGuardrail.selectedItems,
        reserveState: {
          ...primaryGuardrail.reserveState,
          ranking_version: "v1",
        },
        initialReserveState,
        primaryGuardrail,
        tieredPool: [...pools.tier1, ...pools.tier2],
        trustedFloor,
        commentarySelectedCount,
        rejectionReasonByItem,
        pools,
      };
    }

    const byTagV1 = groupByTag(v1PostScoreItems);
    const byTagV2 = groupByTag(v2PostScoreItems);
    const topicTags = Array.from(new Set([...byTagV1.keys(), ...byTagV2.keys()])).sort((left, right) => left.localeCompare(right));

    const perTopicSelected = [];
    const selectedByTopic = Object.create(null);
    const reserveByTopic = Object.create(null);
    const trustedFloorByTopic = Object.create(null);
    const rankingVersionByTopic = Object.create(null);
    let totalDiscoveryCapped = 0;
    const topicSelectionAudit = [];
    const selectionRejectionCounts = Object.create(null);
    let killSwitchTriggeredTopics = 0;
    for (const topicTag of topicTags) {
      const topicItemsV1 = byTagV1.get(topicTag) || [];
      const topicItemsV2 = byTagV2.get(topicTag) || [];
      const liveVersion = isTopicV2Pilot(topicTag, rankingConfig) ? "v2" : "v1";
      const shadowVersion = rankingConfig.shadowVersion && rankingConfig.shadowVersion !== liveVersion
        ? rankingConfig.shadowVersion
        : null;
      const liveInput = liveVersion === "v2" ? topicItemsV2 : topicItemsV1;
      const liveResult = executeTopicSelection(liveVersion, topicTag, liveInput);
      const v1Result = liveVersion === "v1"
        ? liveResult
        : (shadowVersion === "v1" ? executeTopicSelection("v1", topicTag, topicItemsV1) : null);
      const v2Result = liveVersion === "v2"
        ? liveResult
        : (shadowVersion === "v2" ? executeTopicSelection("v2", topicTag, topicItemsV2) : null);

      const comparisonMetrics = liveVersion === "v2" && shadowVersion === "v1" && v1Result
        ? evaluateKillSwitchForTopic(liveResult.selectedItems, v1Result.selectedItems, rankingConfig)
        : {
            selection_overlap_pct: null,
            trusted_share_pct_v1: null,
            trusted_share_pct_v2: null,
            trusted_share_drop_pct: null,
            avg_final_rank_v1_selected: null,
            avg_final_rank_v2_selected: null,
            avg_final_rank_drop: null,
            top1_changed: false,
            kill_switch_triggered: false,
            kill_switch_reasons: [],
          };

      let finalTopicResult = liveResult;
      if (comparisonMetrics.kill_switch_triggered === true && v1Result) {
        finalTopicResult = {
          ...v1Result,
          killSwitchTriggered: true,
          killSwitchReasons: comparisonMetrics.kill_switch_reasons.slice(),
        };
        killSwitchTriggeredTopics += 1;
      }

      const {
        selectedItems: topicAcceptedItems,
        reserveState,
        pools,
        commentarySelectedCount,
        trustedFloor,
        tieredPool,
        rejectionReasonByItem,
        initialReserveState,
        primaryGuardrail,
      } = finalTopicResult;
      trustedFloorByTopic[topicTag] = { ...(trustedFloor || { enabled: false, active: false }) };
      rankingVersionByTopic[topicTag] = finalTopicResult.version;
      const { tier1 = [], tier2 = [], tier3 = [], commentaryPool = [] } = pools || {};

      if (topicAcceptedItems.length < itemsPerTopic) {
        log(`⚠️ Topic ${topicTag}: only ${topicAcceptedItems.length}/${itemsPerTopic} items selected (event_0_24=${tier1.length}, event_24_48=${tier2.length}, commentary=${commentaryPool.length}, stale=${tier3.length})`);
      }

      totalDiscoveryCapped += Array.from(rejectionReasonByItem.values()).filter((reason) => reason === "selection_discovery_cap").length;
      perTopicSelected.push(...topicAcceptedItems);
      selectedByTopic[topicTag] = topicAcceptedItems.slice();
      reserveByTopic[topicTag] = reserveState;
      const selectedTrustedCount = countTrustedSourceTier(topicAcceptedItems);
      const selectedStandardCount = (Array.isArray(topicAcceptedItems) ? topicAcceptedItems : []).filter((item) => isStandardSourceTier(item)).length;
      const topicHealth = classifyTopicHealth({
        totalCandidates: tieredPool.length,
        selectedCount: topicAcceptedItems.length,
        trustedCount: selectedTrustedCount,
        trustedFloor: trustGuardrailPolicy.minTrustedItemsPerTopic,
      });

      const liveSelectedUrls = getSelectedUrls(topicAcceptedItems);
      const rejectionReasonByUrl = new Map(
        Array.from(rejectionReasonByItem.entries()).map(([candidate, reason]) => [String(candidate?.url || "").trim(), reason])
      );
      const auditUniverse = [];
      const seenUrls = new Set();
      for (const item of [...topicItemsV1, ...topicItemsV2]) {
        const url = String(item?.url || "").trim();
        if (!url || seenUrls.has(url)) continue;
        seenUrls.add(url);
        auditUniverse.push({ ...item });
      }
      const comparisonMetadata = buildSelectionComparisonMetadata({
        liveCandidates: auditUniverse,
        v1Selected: v1Result?.selectedItems || [],
        v2Selected: v2Result?.selectedItems || [],
        top1Changed: comparisonMetrics.top1_changed === true,
        killSwitchTriggered: comparisonMetrics.kill_switch_triggered === true,
        killSwitchReasons: comparisonMetrics.kill_switch_reasons || [],
      });
      const topicReasonCounts = Object.create(null);
      const topicCandidates = comparisonMetadata.candidates.map((item) => {
        const selectedForTopic = liveSelectedUrls.has(String(item?.url || "").trim());
        const selectionReason = selectedForTopic
          ? (item._selection_stage || (finalTopicResult.version === "v2" ? "v2_primary_selection" : "primary_selection"))
          : String(rejectionReasonByUrl.get(String(item?.url || "").trim()) || "selection_not_selected");
        if (!selectedForTopic) incrementCount(topicReasonCounts, selectionReason);
        return toSelectionAuditCandidate(item, {
          freshness_hours: computeItemAgeHours(item, nowMs),
          selected: selectedForTopic,
          selection_reason: selectionReason,
        });
      });
      for (const [reason, count] of Object.entries(topicReasonCounts)) {
        selectionRejectionCounts[reason] = (selectionRejectionCounts[reason] || 0) + count;
      }
      const topicLaneCounts = Object.create(null);
      for (const item of tieredPool) incrementCount(topicLaneCounts, String(item?.retrieval_origin || item?.retrieval_lane || "unknown"));
      topicSelectionAudit.push({
        tag: topicTag,
        total_candidates: tieredPool.length,
        selected_count: topicAcceptedItems.length,
        rejected_count: Math.max(0, auditUniverse.length - topicAcceptedItems.length),
        tier_counts: {
          tier1: tier1.length,
          tier2: tier2.length,
          tier3: tier3.length,
        },
        fallback_stage_counts: {
          event_tier1: tier1.length,
          event_tier2: tier2.length,
          commentary_candidates: commentaryPool.length,
          commentary_selected: commentarySelectedCount,
        },
        trusted_floor: {
          ...(trustedFloor || {}),
        },
        trust_guardrail: {
          min_trusted_items_per_topic: trustGuardrailPolicy.minTrustedItemsPerTopic,
          aspirational_trusted_items_per_topic: trustGuardrailPolicy.aspirationalTrustedItemsPerTopic,
          ...(primaryGuardrail?.diagnostics || {}),
          final_trusted_count: selectedTrustedCount,
        },
        ranking_primary_version: liveVersion,
        ranking_live_version: finalTopicResult.version,
        ranking_shadow_version: shadowVersion,
        selection_overlap_pct: comparisonMetrics.selection_overlap_pct,
        trusted_share_pct_v1: comparisonMetrics.trusted_share_pct_v1,
        trusted_share_pct_v2: comparisonMetrics.trusted_share_pct_v2,
        trusted_share_delta_pct: comparisonMetrics.trusted_share_drop_pct,
        avg_final_rank_v1_selected: comparisonMetrics.avg_final_rank_v1_selected,
        avg_final_rank_v2_selected: comparisonMetrics.avg_final_rank_v2_selected,
        avg_final_rank_delta: comparisonMetrics.avg_final_rank_drop,
        top1_changed: comparisonMetrics.top1_changed === true,
        kill_switch_triggered: comparisonMetrics.kill_switch_triggered === true,
        kill_switch_reasons: Array.isArray(comparisonMetrics.kill_switch_reasons)
          ? comparisonMetrics.kill_switch_reasons.slice()
          : [],
        regret_flag_count: comparisonMetadata.regret_flag_count,
        regret_reason_counts: comparisonMetadata.regret_reason_counts,
        topic_health: topicHealth,
        trusted_first_override_count: Number(trustedFloor?.trusted_override_count || 0),
        trusted_first_override_details: Array.isArray(trustedFloor?.trusted_override_details)
          ? trustedFloor.trusted_override_details.slice()
          : [],
        standard_candidates_blocked_by_trusted_first_count: Number(trustedFloor?.standard_candidates_blocked_by_trusted_first_count || 0),
        strong_tier_candidate_count: Number(trustedFloor?.trusted_candidate_count || countTrustedSourceTier(tieredPool)),
        strong_tier_selected_count: selectedTrustedCount,
        standard_tier_selected_count: selectedStandardCount,
        standard_tier_blocked_while_strong_available: trustedFloor?.standard_tier_blocked_while_strong_available === true,
        reserve_candidate_count: reserveByTopic[topicTag].allReserve.length,
        reserve_strong_count: reserveByTopic[topicTag].strongReserve.length,
        reserve_standard_count: reserveByTopic[topicTag].standardReserve.length,
        backfill_unlock_policy: {
          initial_trusted_reserve_count: Number(initialReserveState.initialStrongCount || 0),
          failure_ratio: backfillUnlockPolicy.failureRatio,
          absolute_floor: backfillUnlockPolicy.absoluteFloor,
          required_trusted_failures: Math.min(
            Number(backfillUnlockPolicy.absoluteFloor || 0),
            Math.ceil(Number(initialReserveState.initialStrongCount || 0) * Number(backfillUnlockPolicy.failureRatio || 0))
          ),
        },
        per_source_cap: effectiveMaxItemsPerSourceDomain,
        lane_breakdown: topicLaneCounts,
        rejection_reason_counts: topicReasonCounts,
        candidates: topicCandidates,
      });
    }
    if (killSwitchTriggeredTopics >= 2) {
      await emitDigestIncident(
        "ranking-v2-kill-switch",
        "Ranking V2 kill switch triggered for multiple pilot topics",
        {
          mode: runMode,
          due_users: dueUsersCount,
          triggered_topics: killSwitchTriggeredTopics,
        }
      );
    }
    let selected = perTopicSelected;
    const proceduralNoticeSelectedCount = selected.filter((item) => item?.procedural_notice === true).length;
    if (totalDiscoveryCapped > 0) {
      log(`Discovery cap removed ${totalDiscoveryCapped} Perplexity item(s) (max ${maxDiscoveryPerTopic} per topic)`);
    }

    if (selected.length === 0) {
      await emitDigestIncident(
        "no-selectable-items",
        "No selectable live items; digest run aborted",
        {
          mode: runMode,
          due_users: dueUsersCount,
          standard_topics: standardFetchCallsPlanned,
          selected_items: 0,
        }
      );
      throw new Error("No live items available after freshness and selection filters; digest aborted");
    }

    log(`Selected ${selected.length} items (${topicTags.length} topic(s), ${itemsPerTopic}/topic, discoveryCapPerTopic=${maxDiscoveryPerTopic}, sourceCap=${effectiveMaxItemsPerSourceDomain})`);

    return {
      selected,
      selectedByTopic,
      reserveByTopic,
      repeatIndex,
      repeatPenalty,
      rankingPolicy,
      depthPolicy,
      repetitionNote,
      writeupBackfillPolicy: {
        itemsPerTopic,
        maxItemsPerSourceDomain: effectiveMaxItemsPerSourceDomain,
        maxDiscoveryPerTopic,
        commentaryCapPerTopic: 1,
        backfillTrustFloor: CONFIG.digest.backfillTrustFloor === true,
        backfillUnlockPolicy,
        trustGuardrailPolicy,
        rankingVersionByTopic,
        trustedFloor: {
          ...trustedSelectionFloor,
          byTopic: trustedFloorByTopic,
        },
      },
      selectionDiagnostics: {
        candidate_pool_before_dedup: rawCandidateCount,
        candidate_pool_after_editorial: candidatePoolAfterEditorial,
        candidate_pool_after_preparation: candidatePoolAfterPreparation,
        candidate_pool_after_archive_dedup: dedupRes.items.length,
        candidate_pool_after_freshness: freshItems.length,
        candidate_pool_after_history: dedupedItems.length,
        candidate_pool_after_story_relationship: annotatedItems.length,
        candidate_pool_after_dedup: dedupedItems.length,
        classification_enabled: classificationEnabled,
        classification_run: classificationDiagnostics,
        classification_summary: filterDiagnostics,
        classification_boost: boostDiagnostics,
        strict_quality: {
          prefilter: strictQualityPrefilterDiagnostics,
          signal_quality_prefilter: signalQualityPrefilterDiagnostics,
          thin_expansion_cap: {
            v1: v1ThinExpansionCapResult.diagnostics,
            v2: v2ThinExpansionCapResult.diagnostics,
          },
        },
        candidate_pool_after_pre_ranking_quality: strictQualityConfig.enabled ? preRankingItems.length : annotatedItems.length,
        candidate_pool_after_classification: classificationEnabled ? scoringInput.length : null,
        effective_max_items_per_source_domain: effectiveMaxItemsPerSourceDomain,
        ranking: {
          primary_version: rankingConfig.primaryVersion,
          shadow_version: rankingConfig.shadowVersion,
          live_topic_tags: rankingConfig.liveTopicTags.slice(),
          kill_switch: {
            enabled: rankingConfig.killSwitch?.enabled === true,
            triggered_topic_count: killSwitchTriggeredTopics,
          },
        },
        storyline_cluster_removed_count: storylineClusterRemovedCount,
        best_fit_topic_reassigned_count: bestFitTopicReassignedCount,
        candidate_pool_scored: scoreSummaryItems.length,
        archive_repeat_block_count: Math.max(0, Number(dedupRes.removed || 0)),
        stale_removed_count: Math.max(0, Number(staleRemoved || 0)),
        history_suppressed_count: Math.max(0, Number(historyResult.suppressedCount || 0)),
        history_lookback_days: historyLookbackDays,
        history_streaks_detected: historyResult.streaks.length,
        story_relationship_continuation_removed: continuationRemovedCount || 0,
        story_relationship_follow_up_count: followUpCount || 0,
        editorial_excluded_count: excludedCount,
        editorial_domain_suppressed_count: suppressedCount,
        editorial_pin_count: injectedPinCount,
        discovery_capped_count: totalDiscoveryCapped,
        procedural_notice_selected_count: proceduralNoticeSelectedCount,
        score_top: rankingConfig.primaryVersion === "v2"
          ? scoreSummaryItems[0]?.final_rank_score ?? null
          : scoreSummaryItems[0]?._score ?? null,
        score_bottom: scoreSummaryItems.length > 0
          ? (rankingConfig.primaryVersion === "v2"
            ? scoreSummaryItems[scoreSummaryItems.length - 1]?.final_rank_score ?? null
            : scoreSummaryItems[scoreSummaryItems.length - 1]?._score ?? null)
          : null,
        selection_rejection_counts: selectionRejectionCounts,
        scored_candidates: scoreSummaryItems.map((item) => toSelectionAuditCandidate(item)),
        topic_selection_audit: topicSelectionAudit,
        editorial_dropped_items: editorialDroppedItems,
        archive_dedup_dropped_items: archiveDedupDroppedItems,
        freshness_dropped_items: freshnessDroppedItems,
        story_dedup_dropped_items: storyDedupDroppedItems,
        classifier_dropped_items: classifierDroppedItems,
      },
    };
  }

  return {
    selectForEnrichment,
  };
}

module.exports = {
  createDigestOrchestratorSelectionRuntime,
  buildTopicReserveQueue,
  buildTopicSelectionState,
  getBackfillRejectionReason,
  canonicalizeCandidateTopicTags,
  computeItemAgeHours,
  prepareSelectionCandidates,
  splitByFreshnessTiers,
  suppressOfficialsByCluster,
  sortWithSourceTypePreference,
  isTrustedSourceTier,
  normalizeSourceTier,
  resolveTrustedSelectionFloor,
};
