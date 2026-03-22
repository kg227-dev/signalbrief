"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");

const {
  createDigestArchiveRuntime,
  createDigestDataRuntime,
  createDigestDeliveryRecordRuntime,
  createDigestFormattingRuntime,
  createDigestPolicies,
  buildRecentEntityHistory,
  buildStorylineCandidates,
  clusterStorylines,
  annotateEditorialSignals,
  applyEntityCoverageCap,
  applyDigestDepth,
  applyStrategicQualityGate,
  applyTopicRelevanceScores,
  buildCustomTopicQueries,
  computeDigestQualityScore,
  customKeywordMatches,
  filterItemsByTopics,
  headlineFingerprint,
  isRepeatedItem,
  normalizeMatchText,
  normalizeTopicToken,
  normalizeUrlForDedup,
  reserveCustomKeywordSlot,
  selectDigestItemsDetailed,
  setAdminSourceRegistry,
  setLearnedDomainAdjustments,
  setPreferredSourceRegistry,
  splitUserTopics,
} = require("../../domains/digest");
const { createDigestOrchestratorDeliveryRankingRuntime } = require("../../entrypoints/digest-orchestrator-delivery-ranking-runtime");
const { createDigestOrchestratorEnrichmentRuntime } = require("../../entrypoints/digest-orchestrator-enrichment-runtime");
const { createDigestOrchestratorFetchRuntime } = require("../../entrypoints/digest-orchestrator-fetch-runtime");
const { createDigestOrchestratorTransportRuntime } = require("../../entrypoints/digest-orchestrator-transport-runtime");
const { computeMaxCustomItems } = require("../../entrypoints/digest-orchestrator-selection-runtime");
const { articleAgeTooOld } = require("../../digest/runtime/digest-data-fetch-items-runtime");
const {
  computeLearnedAuthorityAdjustments,
  loadDomainStats,
} = require("../../digest/domain/domain-learning-runtime");
const { loadConfig } = require("../../runtime/config-provider");
const {
  createPreferredSourceRegistryRuntime,
  buildPreferredDomainShortlist,
} = require("../../runtime/preferred-source-registry-runtime");
const { createSourceRegistryRuntime } = require("../../runtime/source-policy-registry-runtime");
const { resolveSignalBriefRuntimePaths } = require("../../runtime/runtime-state-paths-runtime");
const {
  DELIVERY_POLICY,
  classifyDeliveryConfidence,
  deriveInternalThinnessLabel,
  listTrustedOnlyCustomKeywords,
  selectDeliveryItems,
} = require("../../runtime/digest-delivery-policy-runtime");
const { buildHistoricalComparison } = require("./historical-runtime");
const {
  CURRENT_DQS_FORMULA,
  DEFAULT_BUDGET_CAP_USD,
  DEFAULT_SCENARIOS,
  DEFAULT_MANUAL_REVIEW_SAMPLE_COUNT,
  EVAL_VERSION,
} = require("./constants-runtime");
const { buildScenarioMatrix } = require("./personas-runtime");
const {
  ageHoursForItem,
  buildManualReviewQueue,
  buildSourceLevelSummary,
  computeSetQuality,
  describeScarcity,
  itemSourceScore,
  rankItemsBySourceScore,
} = require("./scoring-runtime");
const {
  createRetrievalEvalStorageRuntime,
  normalizeBudget,
} = require("./storage-runtime");

function log(message) {
  process.stdout.write(`[retrieval-eval] ${String(message || "")}\n`);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function itemKey(item = {}) {
  const url = String(item?.url || "").trim();
  const headline = String(item?.headline || "").trim().toLowerCase();
  if (url) return `url:${url}`;
  if (headline) return `headline:${headline}`;
  return `${String(item?.tag || "").trim()}:${headline}`;
}

function ensureBudgetCanAfford(budget, estimateUsd, context) {
  const remainingAfterReserve = Number(budget.remaining_usd || 0) - Number(budget.reserve_usd || 0);
  const estimate = Number(estimateUsd || 0);
  if (remainingAfterReserve < estimate) {
    throw new Error(
      `Budget guard triggered before ${context}. Estimated $${estimate.toFixed(4)}, `
      + `remaining after reserve $${Math.max(0, remainingAfterReserve).toFixed(4)}.`
    );
  }
}

function budgetGuardStatus(budget, estimateUsd) {
  const remainingAfterReserve = Number(budget.remaining_usd || 0) - Number(budget.reserve_usd || 0);
  const estimate = Number(estimateUsd || 0);
  return {
    ok: remainingAfterReserve >= estimate,
    estimate_usd: Number(estimate.toFixed(6)),
    remaining_after_reserve_usd: Number(Math.max(0, remainingAfterReserve).toFixed(6)),
  };
}

function summarizeTrace(trace) {
  const reasonCounts = {};
  const transitions = Array.isArray(trace?.transitions) ? trace.transitions : [];
  for (const row of transitions) {
    const reason = String(row?.reason || "").trim() || "unknown";
    reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
  }
  return {
    transitions,
    reason_counts: reasonCounts,
  };
}

function incrementCount(map, key, amount = 1) {
  const safeKey = String(key || "").trim() || "unknown";
  map[safeKey] = (map[safeKey] || 0) + Number(amount || 0);
}

function combineCounts(...maps) {
  const combined = {};
  for (const map of maps) {
    if (!map || typeof map !== "object") continue;
    for (const [key, value] of Object.entries(map)) incrementCount(combined, key, value);
  }
  return combined;
}

function dominantCountKey(counts = {}, fallback = "unknown") {
  let bestKey = fallback;
  let bestValue = -1;
  for (const [key, value] of Object.entries(counts || {})) {
    const numeric = Number(value || 0);
    if (numeric > bestValue) {
      bestKey = key;
      bestValue = numeric;
    }
  }
  return bestKey;
}

function transitionHasCustomKeywordSignal(transition = {}) {
  return Array.isArray(transition?.why_shown) && transition.why_shown.includes("custom_keyword");
}

function classifyTraceTransitionCategory(transition = {}) {
  const reason = String(transition?.reason || "").trim();
  if (
    !reason
    || reason === "filtered_by_topic"
    || reason === "removed_by_recent_repeat"
    || reason === "removed_by_semantic_repeat"
  ) {
    return null;
  }
  if (reason === "removed_by_source_policy_cap") return "source_quality_threshold";
  if (reason === "removed_by_entity_cap" || reason === "selection_custom_cap") return "diversity_or_cap_logic";
  if (reason === "removed_by_custom_precision") return "topic_relevance_threshold";
  if (reason === "no_deliverable_items") return "other_final_selection_rule";
  if (reason === "excluded_by_final_quality_threshold") {
    const topicMatch = Number(transition?.topicMatch || 0);
    const relevanceScore = Number(transition?.relevanceScore || 0);
    const strategicValue = Number(transition?.strategic_value || 0);
    const routineItemScore = Number(transition?.routine_item_score || 0);
    const sourcePolicy = String(transition?.source_policy || "").trim().toLowerCase();
    const sourceAuthority = Number(transition?.source_authority || 0);
    if (topicMatch < DELIVERY_POLICY.thresholds.min_topic_match && !transitionHasCustomKeywordSignal(transition)) {
      return "topic_relevance_threshold";
    }
    if (
      relevanceScore < DELIVERY_POLICY.thresholds.min_relevance_score
      || strategicValue < DELIVERY_POLICY.thresholds.min_strategic_value
      || routineItemScore > DELIVERY_POLICY.thresholds.max_routine_item_score
    ) {
      return "score_threshold";
    }
    if (
      sourcePolicy
      && !DELIVERY_POLICY.allowed_lower_confidence_policies.includes(sourcePolicy)
    ) {
      return "source_quality_threshold";
    }
    if (
      Number.isFinite(sourceAuthority)
      && sourceAuthority > 0
      && sourceAuthority < DELIVERY_POLICY.thresholds.min_lower_confidence_source_authority
    ) {
      return "source_quality_threshold";
    }
    if (transition?.hard_exclude === true) return "other_final_selection_rule";
    return "other_final_selection_rule";
  }
  return null;
}

function buildRankingGateBreakdown(trace) {
  const transitions = Array.isArray(trace?.transitions) ? trace.transitions : [];
  const categoryCounts = {};
  for (const transition of transitions) {
    const category = classifyTraceTransitionCategory(transition);
    if (!category) continue;
    incrementCount(categoryCounts, category);
  }
  return categoryCounts;
}

function buildDeliveryPolicyCandidateReasonCounts(items = [], nowIso, customKeywords = []) {
  const counts = {};
  for (const item of (Array.isArray(items) ? items : [])) {
    const confidence = classifyDeliveryConfidence(item, {
      nowIso,
      customKeywords,
    });
    if (confidence.high_confidence || confidence.lower_confidence_eligible) continue;
    const topicMatch = Number(item?.topicMatch || 0);
    const relevanceScore = Number(item?.relevanceScore || 0);
    const strategicValue = Number(item?.strategic_value || 0);
    const routineItemScore = Number(item?.routine_item_score || 0);
    const sourcePolicy = String(item?.source_policy || "").trim().toLowerCase();
    const sourceAuthority = Number(item?.source_authority || 0);
    if (topicMatch < DELIVERY_POLICY.thresholds.min_topic_match && !transitionHasCustomKeywordSignal(item)) {
      incrementCount(counts, "topic_relevance_threshold");
      continue;
    }
    if (
      relevanceScore < DELIVERY_POLICY.thresholds.min_relevance_score
      || strategicValue < DELIVERY_POLICY.thresholds.min_strategic_value
      || routineItemScore > DELIVERY_POLICY.thresholds.max_routine_item_score
    ) {
      incrementCount(counts, "score_threshold");
      continue;
    }
    if (
      sourcePolicy
      && !DELIVERY_POLICY.allowed_lower_confidence_policies.includes(sourcePolicy)
    ) {
      incrementCount(counts, "source_quality_threshold");
      continue;
    }
    if (
      Number.isFinite(sourceAuthority)
      && sourceAuthority > 0
      && sourceAuthority < DELIVERY_POLICY.thresholds.min_lower_confidence_source_authority
    ) {
      incrementCount(counts, "source_quality_threshold");
      continue;
    }
    incrementCount(counts, "other_final_selection_rule");
  }
  return counts;
}

function buildDeliveryPolicyGateBreakdown({
  deliveryPolicy = {},
  requestedCount = DELIVERY_POLICY.target_item_count,
  rankedItems = [],
  customKeywords = [],
  nowIso = new Date().toISOString(),
} = {}) {
  const outcome = String(deliveryPolicy?.delivery_outcome || "").trim();
  if (outcome.startsWith("delivered")) return {};
  const retry = deliveryPolicy?.retry && typeof deliveryPolicy.retry === "object" ? deliveryPolicy.retry : {};
  const trustedOnlyKeywords = Array.isArray(deliveryPolicy?.trusted_only_custom_keywords)
    ? deliveryPolicy.trusted_only_custom_keywords
    : [];
  const availableHigh = Math.max(0, Number(retry.high_confidence_available_count || 0));
  const availableLower = Math.max(0, Number(retry.lower_confidence_available_count || 0));
  const availableTotal = availableHigh + availableLower;
  const counts = {};
  if (trustedOnlyKeywords.length > 0 && availableHigh < Math.max(1, Number(requestedCount || 0))) {
    incrementCount(counts, "delivery_policy_trusted_only_source_bar");
    return counts;
  }
  if (availableTotal <= 0 && (Array.isArray(rankedItems) ? rankedItems.length : 0) > 0) {
    const candidateReasonCounts = buildDeliveryPolicyCandidateReasonCounts(rankedItems, nowIso, customKeywords);
    const dominantReason = dominantCountKey(candidateReasonCounts, "other_final_selection_rule");
    if (dominantReason === "score_threshold") incrementCount(counts, "delivery_policy_score_threshold");
    else if (dominantReason === "topic_relevance_threshold") incrementCount(counts, "delivery_policy_topic_relevance_threshold");
    else if (dominantReason === "source_quality_threshold") incrementCount(counts, "delivery_policy_source_quality_threshold");
    else incrementCount(counts, "delivery_policy_no_eligible_items");
    return counts;
  }
  if (availableTotal < Math.max(1, Number(requestedCount || 0))) {
    incrementCount(counts, "delivery_policy_total_item_shortfall");
    return counts;
  }
  if (availableHigh < DELIVERY_POLICY.retry_attempt.min_high_confidence) {
    incrementCount(counts, "delivery_policy_high_confidence_shortfall");
    return counts;
  }
  if (retry.lower_confidence_cap_reached === true) {
    incrementCount(counts, "delivery_policy_lower_confidence_cap");
    return counts;
  }
  incrementCount(counts, "delivery_policy_gate");
  return counts;
}

function buildPersonaGateBreakdown({ trace, deliveryPolicy, requestedCount, rankedItems, customKeywords, nowIso }) {
  const rankingGateBreakdown = buildRankingGateBreakdown(trace);
  const deliveryPolicyBreakdown = buildDeliveryPolicyGateBreakdown({
    deliveryPolicy,
    requestedCount,
    rankedItems,
    customKeywords,
    nowIso,
  });
  const finalGateBreakdown = combineCounts(rankingGateBreakdown, deliveryPolicyBreakdown);
  return {
    ranking_gate_breakdown: rankingGateBreakdown,
    delivery_policy_breakdown: deliveryPolicyBreakdown,
    final_gate_breakdown: finalGateBreakdown,
    primary_final_gate_reason: Object.keys(deliveryPolicyBreakdown).length > 0
      ? dominantCountKey(deliveryPolicyBreakdown, "unknown")
      : dominantCountKey(finalGateBreakdown, "unknown"),
  };
}

function buildFailedPersonaQuality() {
  return {
    score: 0,
    band: "weak",
    avg_item_score: 0,
    avg_relevance: 0,
    avg_freshness: 0,
    preferred_hit_rate: 0,
    weak_source_rate: 0,
    unique_domain_count: 0,
    top_domain_share: 0,
    stale_item_share: 0,
    item_count: 0,
    requested_count: 0,
    fill_rate: 0,
  };
}

function serializeItem(item, extra = {}) {
  return {
    key: itemKey(item),
    headline: String(item?.headline || "").trim() || null,
    url: String(item?.url || "").trim() || null,
    tag: String(item?.tag || "").trim() || null,
    source: String(item?.source || "").trim() || null,
    source_domain: String(item?.source_domain || "").trim() || null,
    source_tier: String(item?.source_tier || "").trim() || null,
    source_policy: String(item?.source_policy || "").trim() || null,
    source_authority: Number.isFinite(Number(item?.source_authority)) ? Number(item.source_authority) : null,
    published_date: String(item?.published_date || "").trim() || null,
    retrieved_at: String(item?.retrieved_at || "").trim() || null,
    topicMatch: Number.isFinite(Number(item?.topicMatch)) ? Number(item.topicMatch) : null,
    relevanceScore: Number.isFinite(Number(item?.relevanceScore)) ? Number(item.relevanceScore) : null,
    preferred_source_match: String(item?.preferred_source_match || "none").trim(),
    preferred_source_strength: Number.isFinite(Number(item?.preferred_source_strength)) ? Number(item.preferred_source_strength) : null,
    weak_source: extra.weak_source === true,
    age_hours: ageHoursForItem(item) == null ? null : Number(ageHoursForItem(item).toFixed(2)),
    source_eval_item_score: Number(itemSourceScore(item).toFixed(2)),
    why_shown: Array.isArray(item?.why_shown) ? item.why_shown.slice() : [],
    delivery_confidence: String(item?.delivery_confidence || "").trim() || null,
    delivery_topic_classes: Array.isArray(item?.delivery_topic_classes) ? item.delivery_topic_classes.slice() : [],
    stage_reason: extra.stage_reason || null,
  };
}

function diffItems(before = [], after = []) {
  const kept = new Set((Array.isArray(after) ? after : []).map((item) => itemKey(item)));
  return (Array.isArray(before) ? before : []).filter((item) => !kept.has(itemKey(item)));
}

function normalizeEvalTopicKey(value) {
  return normalizeTopicToken(String(value || "").replace(/^custom_/, "").replace(/_/g, " "));
}

function findMatchingPersonaResults(topicDiagnostic, personaResults = []) {
  const key = normalizeEvalTopicKey(topicDiagnostic?.custom_slug || topicDiagnostic?.tag);
  if (!key) return [];
  return (Array.isArray(personaResults) ? personaResults : []).filter((row) => {
    const personaKey = normalizeEvalTopicKey(row?.persona_label || row?.persona_id);
    return personaKey === key;
  });
}

function groupRejectedReasonsByTopic(rejected = []) {
  const grouped = {};
  for (const row of (Array.isArray(rejected) ? rejected : [])) {
    const key = normalizeEvalTopicKey(row?.item?.custom_slug || row?.item?.tag);
    if (!key) continue;
    if (!grouped[key]) grouped[key] = {};
    const reason = String(row?.reason || "").trim() || "unknown";
    grouped[key][reason] = (grouped[key][reason] || 0) + 1;
  }
  return grouped;
}

function aggregatePersonaGateBreakdown(personas = []) {
  const rankingGateBreakdown = {};
  const deliveryPolicyBreakdown = {};
  const finalGateBreakdown = {};
  for (const row of (Array.isArray(personas) ? personas : [])) {
    for (const [key, value] of Object.entries(row?.ranking_gate_breakdown || {})) {
      incrementCount(rankingGateBreakdown, key, value);
    }
    for (const [key, value] of Object.entries(row?.delivery_policy_breakdown || {})) {
      incrementCount(deliveryPolicyBreakdown, key, value);
    }
    for (const [key, value] of Object.entries(row?.final_gate_breakdown || {})) {
      incrementCount(finalGateBreakdown, key, value);
    }
  }
  return {
    ranking_gate_breakdown: rankingGateBreakdown,
    delivery_policy_breakdown: deliveryPolicyBreakdown,
    final_gate_breakdown: finalGateBreakdown,
    primary_final_gate_reason: Object.keys(deliveryPolicyBreakdown).length > 0
      ? dominantCountKey(deliveryPolicyBreakdown, "unknown")
      : dominantCountKey(finalGateBreakdown, "unknown"),
  };
}

function classifyTopicGapAudit({
  topicDiagnostic,
  matchingPersonaResults,
  rejectionCounts,
}) {
  const topic = topicDiagnostic && typeof topicDiagnostic === "object" ? topicDiagnostic : {};
  const personas = Array.isArray(matchingPersonaResults) ? matchingPersonaResults : [];
  const rejections = rejectionCounts && typeof rejectionCounts === "object" ? rejectionCounts : {};
  const candidatePoolCount = personas.reduce((sum, row) => sum + Number(row?.candidate_pool_count || 0), 0);
  const internalFinalCount = personas.reduce((sum, row) => sum + Number(row?.internal_final_quality?.item_count || 0), 0);
  const finalCount = personas.reduce((sum, row) => sum + Number(row?.final_selected_quality?.item_count || 0), 0);
  const gateBreakdown = aggregatePersonaGateBreakdown(personas);
  const status429 = Number(topic?.status_counts?.[429] || 0);
  const staleRejected = Number(rejections.stale_age_filter || 0);
  const hasProviderFailure = status429 > 0
    || Number(topic?.failed_calls || 0) > 0
    || Number(topic?.transport_errors || 0) > 0
    || topic?.degraded === true;
  const hasRemainingBroadQueries = Number(topic?.remaining_broad_queries || 0) > 0;
  const preferredOnlyZeroYield = Number(topic?.unique_item_count || 0) <= 0
    && Number(topic?.preferred_call_count || 0) > 0
    && Number(topic?.broad_call_count || 0) <= 0
    && Array.isArray(topic?.preferred_domains)
    && topic.preferred_domains.length > 0;
  const offTopicQueryMiss = topic?.is_custom === true
    && Number(topic?.unique_item_count || 0) > 0
    && candidatePoolCount <= 0;
  let rootCause = "covered";
  let failureReason = null;
  if (hasProviderFailure) {
    rootCause = "provider_429_or_transport";
    failureReason = status429 > 0 ? "provider_429" : "provider_transport";
  } else if (staleRejected > 0 && candidatePoolCount <= 0) {
    rootCause = "freshness_filter_collapse";
    failureReason = "stale_age_filter";
  } else if (preferredOnlyZeroYield) {
    rootCause = "preferred_only_query_design";
    failureReason = "preferred_only_zero_yield";
  } else if (Number(topic?.unique_item_count || 0) <= 0 && Number(topic?.broad_call_count || 0) > 0 && hasRemainingBroadQueries) {
    rootCause = "query_plan_not_exhausted";
    failureReason = "unused_broad_queries";
  } else if (offTopicQueryMiss) {
    rootCause = "keyword_ambiguity_or_off_topic_query";
    failureReason = "topic_filter_miss";
  } else if (Number(topic?.unique_item_count || 0) <= 0 && Number(topic?.broad_call_count || 0) > 0) {
    rootCause = "provider_no_recent_coverage";
    failureReason = "zero_yield_broad";
  } else if (candidatePoolCount > 0 && finalCount <= 0) {
    if (internalFinalCount > 0 || Object.keys(gateBreakdown.delivery_policy_breakdown).length > 0) {
      rootCause = "delivery_policy_gate";
      failureReason = dominantCountKey(gateBreakdown.delivery_policy_breakdown, "delivery_policy_gate");
    } else if (Number(rejections.selection_custom_cap || 0) > 0) {
      rootCause = "selection_custom_cap";
      failureReason = "selection_custom_cap";
    } else if (Number(rejections.storyline_quality_gate || 0) > 0) {
      rootCause = "storyline_quality_gate";
      failureReason = "storyline_quality_gate";
    } else if (Number(rejections.removed_by_source_policy_cap || 0) > 0) {
      rootCause = "source_policy_gate";
      failureReason = "source_policy_cap";
    } else if (gateBreakdown.primary_final_gate_reason === "diversity_or_cap_logic") {
      rootCause = "diversity_cap_gate";
      failureReason = "diversity_or_cap_logic";
    } else if (gateBreakdown.primary_final_gate_reason === "source_quality_threshold") {
      rootCause = "source_quality_gate";
      failureReason = "source_quality_threshold";
    } else if (gateBreakdown.primary_final_gate_reason === "topic_relevance_threshold") {
      rootCause = "topic_relevance_gate";
      failureReason = "topic_relevance_threshold";
    } else if (gateBreakdown.primary_final_gate_reason === "score_threshold") {
      rootCause = "score_threshold_gate";
      failureReason = "score_threshold";
    } else {
      rootCause = "ranking_or_quality_gate";
      failureReason = dominantCountKey(gateBreakdown.ranking_gate_breakdown, "other_final_selection_rule");
    }
  } else if (Number(topic?.unique_item_count || 0) > 0 && finalCount > 0 && finalCount < Math.max(1, personas[0]?.requested_count || 1)) {
    rootCause = "thin_but_precise";
    failureReason = "thin_pool";
  }

  let betterSourceOpportunity = "unlikely";
  let betterSourceNote = null;
  if (rootCause === "preferred_only_query_design") {
    betterSourceOpportunity = "likely";
    betterSourceNote = "Preferred-only retries exhausted before a real broad fallback ran.";
  } else if (rootCause === "query_plan_not_exhausted") {
    betterSourceOpportunity = "likely";
    betterSourceNote = "A broad fallback ran, but alternate broad queries were left unused.";
  } else if (rootCause === "keyword_ambiguity_or_off_topic_query") {
    betterSourceOpportunity = "likely";
    betterSourceNote = "Items were retrieved, but none survived keyword/topic matching.";
  } else if (Number(topic?.preferred_search_result_hit_count || 0) > 0 && Number(topic?.preferred_item_count || 0) <= 0) {
    betterSourceOpportunity = "possible";
    betterSourceNote = "Preferred/trusted domains appeared in search results but did not convert into retained items.";
  } else if (rootCause === "freshness_filter_collapse") {
    betterSourceOpportunity = "possible";
    betterSourceNote = "Retrieved coverage existed, but it missed the freshness policy.";
  } else if (rootCause === "provider_429_or_transport") {
    betterSourceOpportunity = "unknown";
    betterSourceNote = "Provider failures limited the evidence available for this topic.";
  } else if (rootCause === "provider_no_recent_coverage") {
    betterSourceOpportunity = "unclear";
    betterSourceNote = "Broad retrieval ran but still found no usable recent items.";
  } else if (rootCause === "selection_custom_cap") {
    betterSourceOpportunity = "possible";
    betterSourceNote = "A candidate survived retrieval but lost to the scenario-level custom selection cap.";
  } else if (rootCause === "delivery_policy_gate") {
    betterSourceOpportunity = "possible";
    if (failureReason === "delivery_policy_score_threshold") {
      betterSourceNote = "Items survived retrieval, but the remaining candidates missed the delivery confidence floor on relevance, strategic value, or source quality.";
    } else if (failureReason === "delivery_policy_total_item_shortfall") {
      betterSourceNote = "Some acceptable items survived ranking, but there were not enough to satisfy the 5-item shipping contract.";
    } else if (failureReason === "delivery_policy_trusted_only_source_bar") {
      betterSourceNote = "Coverage existed, but the trusted-only topic policy rejected lower-trust candidates.";
    } else {
      betterSourceNote = "Reasonably good items survived ranking, but the 5-item shipping contract or confidence mix blocked delivery.";
    }
  }

  const sourceScore = personas.length > 0
    ? Number((personas.reduce((sum, row) => sum + Number(row?.final_selected_quality?.score || 0), 0) / personas.length).toFixed(2))
    : 0;
  const selectionLift = personas.length > 0
    ? Number((personas.reduce((sum, row) => sum + Number(row?.selection_lift || 0), 0) / personas.length).toFixed(2))
    : 0;

  return {
    tag: topic?.tag || null,
    custom_slug: topic?.custom_slug || null,
    is_custom: topic?.is_custom === true,
    raw_count: Number(topic?.unique_item_count || 0),
    cleaned_count: candidatePoolCount,
    final_count: finalCount,
    internal_final_count: internalFinalCount,
    source_score: sourceScore,
    selection_lift: selectionLift,
    stale_rate: Number(topic?.unique_item_count || 0) > 0
      ? Number(((staleRejected / Math.max(1, Number(topic?.unique_item_count || 0))) * 100).toFixed(2))
      : 0,
    provider_429_count: status429,
    preferred_call_count: Number(topic?.preferred_call_count || 0),
    broad_call_count: Number(topic?.broad_call_count || 0),
    query_count: Number(topic?.query_count || 0),
    remaining_broad_queries: Number(topic?.remaining_broad_queries || 0),
    coverage_status: String(topic?.coverage_status || "").trim() || null,
    root_cause: rootCause,
    failure_reason: failureReason,
    primary_final_gate_reason: gateBreakdown.primary_final_gate_reason,
    final_gate_breakdown: gateBreakdown.final_gate_breakdown,
    ranking_gate_breakdown: gateBreakdown.ranking_gate_breakdown,
    delivery_policy_breakdown: gateBreakdown.delivery_policy_breakdown,
    better_source_opportunity: betterSourceOpportunity,
    better_source_note: betterSourceNote,
    preferred_domains: Array.isArray(topic?.preferred_domains) ? topic.preferred_domains.slice() : [],
    preferred_topic_hints: Array.isArray(topic?.preferred_topic_hints) ? topic.preferred_topic_hints.slice() : [],
    search_result_domains: Array.isArray(topic?.search_result_domains) ? topic.search_result_domains.slice() : [],
    preferred_search_result_domains: Array.isArray(topic?.preferred_search_result_domains) ? topic.preferred_search_result_domains.slice() : [],
  };
}

function buildTopicGapAudit(globalResult, personaResults) {
  const topicDiagnostics = Array.isArray(globalResult?.fetchResult?.fetchDiagnostics?.topic_diagnostics)
    ? globalResult.fetchResult.fetchDiagnostics.topic_diagnostics
    : [];
  const rejectedByTopic = groupRejectedReasonsByTopic(globalResult?.rejected);
  return topicDiagnostics.map((topicDiagnostic) => classifyTopicGapAudit({
    topicDiagnostic,
    matchingPersonaResults: findMatchingPersonaResults(topicDiagnostic, personaResults),
    rejectionCounts: rejectedByTopic[normalizeEvalTopicKey(topicDiagnostic?.custom_slug || topicDiagnostic?.tag)] || {},
  }));
}

function createEvalServices() {
  const CONFIG = loadConfig();
  const runtimePaths = resolveSignalBriefRuntimePaths({
    appRoot: path.resolve(__dirname, "..", "..", ".."),
    env: process.env,
    nodeEnv: process.env.NODE_ENV,
  });
  const transportRuntime = createDigestOrchestratorTransportRuntime({
    https,
    defaultTimeoutMs: 30_000,
  });
  const httpsPostWithRetry = (...args) => transportRuntime.httpsPostWithRetry(...args);
  const sourceRegistryRuntime = createSourceRegistryRuntime({
    fs,
    path,
    sourceRegistryPath: runtimePaths.sourceRegistryPath,
  });
  const preferredSourceRegistryRuntime = createPreferredSourceRegistryRuntime({
    fs,
    preferredSourcesPath: runtimePaths.preferredSourcesPath,
  });
  const archiveRuntime = createDigestArchiveRuntime({
    APP_ROOT: runtimePaths.appRoot,
    archiveDir: runtimePaths.archiveDir,
    fs,
    path,
    log,
    formatEtDateKey: (value = new Date()) => new Date(value).toLocaleDateString("en-CA", { timeZone: "America/New_York" }),
    isRepeatedItem,
    normalizeUrlForDedup,
    parseSourceDomainShared: (item, opts = {}) => {
      try {
        const parsed = new URL(String(item?.url || ""));
        return String(parsed.hostname || "").replace(/^www\./, "").toLowerCase();
      } catch (error) {
        if (typeof opts.onUrlParseError === "function") opts.onUrlParseError(error);
        return String(item?.source_domain || item?.source || "").trim().toLowerCase();
      }
    },
  });
  const dataRuntime = createDigestDataRuntime({
    CONFIG,
    log,
    httpsPostWithRetry,
    normalizeUrlForDedup,
    isFetchedItemEligible: (item) => {
      const annotated = annotateEditorialSignals([item]);
      return annotated.length > 0 && annotated[0].hard_exclude !== true;
    },
  });
  const formattingRuntime = createDigestFormattingRuntime({
    CONFIG,
    EMAIL_TEMPLATE: "",
    BASE_URL: process.env.BASE_URL || "https://getsignalbrief.com",
    httpsPostWithRetry,
    buildPublicDigestUrl: () => "",
    normalizeTopicToken,
    customKeywordMatches,
    normalizeMatchText,
    headlineFingerprint,
    normalizeUrlForDedup,
  });
  const deliveryRecordRuntime = createDigestDeliveryRecordRuntime({
    APP_ROOT: runtimePaths.appRoot,
    digestRecordsDir: runtimePaths.digestRecordsDir,
    fs,
    path,
    log,
  });
  const rankingRuntime = createDigestOrchestratorDeliveryRankingRuntime({
    CONFIG,
    log,
    filterItemsByTopics,
    applyTopicRelevanceScores,
    buildRecentEntityHistory,
    suppressRecentlySentForUser: archiveRuntime.suppressRecentlySentForUser,
    isRecentRepeatItem: archiveRuntime.isRecentRepeatItem,
    parseSourceDomain: archiveRuntime.parseSourceDomain,
    applyEntityCoverageCap,
    reserveCustomKeywordSlot,
  });
  const enrichmentRuntime = createDigestOrchestratorEnrichmentRuntime({
    enrichItems: dataRuntime.enrichItems,
  });
  return {
    CONFIG,
    archiveRuntime,
    dataRuntime,
    deliveryRecordRuntime,
    enrichmentRuntime,
    formattingRuntime,
    preferredSourceRegistryRuntime,
    rankingRuntime,
    runtimePaths,
    sourceRegistryRuntime,
  };
}

function buildScenarioEstimate(services, scenario) {
  const digestConfig = services.CONFIG?.digest || {};
  const hardCalls = Number(digestConfig?.search_budget?.scheduled?.hard_calls || 36);
  const perplexityEstimate = Math.max(1, hardCalls) * 0.005;
  const claudeEstimate = 0.08;
  const personaCount = Array.isArray(scenario?.dueUsers) ? scenario.dueUsers.length : 0;
  return Number((perplexityEstimate + claudeEstimate + (personaCount * 0.0005)).toFixed(4));
}

function recordBudgetEvent(storage, budget, entry) {
  const next = normalizeBudget({
    ...budget,
    spent_usd: Number((Number(budget.spent_usd || 0) + Number(entry.cost_usd || 0)).toFixed(6)),
    calls: [...(Array.isArray(budget.calls) ? budget.calls : []), entry],
  });
  return storage.saveBudget(next);
}

function computeScenarioCost(result = {}) {
  const fetchResult = result?.fetchResult || {};
  const enrichResult = result?.enrichResult || {};
  const perplexityCost = (
    Number(fetchResult.standardFetchCalls || 0)
    + Number(fetchResult.customFetchCalls || 0)
  ) * 0.005;
  const claudeCost = (
    (Number(enrichResult.claudeUsage?.input_tokens || 0) / 1_000_000) * 0.8
    + (Number(enrichResult.claudeUsage?.output_tokens || 0) / 1_000_000) * 4.0
  );
  return {
    perplexityCost: Number(perplexityCost.toFixed(6)),
    claudeCost: Number(claudeCost.toFixed(6)),
    totalCost: Number((perplexityCost + claudeCost).toFixed(6)),
  };
}

function resolveEvalSelectionTarget({ scenarioId, dueUsers, baseSelectionTarget }) {
  const base = Math.max(1, Number(baseSelectionTarget || 0));
  const users = Array.isArray(dueUsers) ? dueUsers : [];
  const uniqueCustomTopics = new Set();
  for (const user of users) {
    for (const topic of (Array.isArray(user?.topics) ? user.topics : [])) {
      const topicText = String(topic || "").trim().toLowerCase();
      if (topicText.startsWith("custom_")) uniqueCustomTopics.add(topicText);
    }
  }
  const customOnlyScenario = String(scenarioId || "").startsWith("custom_")
    && users.length > 0
    && users.every((user) => (Array.isArray(user?.topics) ? user.topics : []).some((topic) => String(topic || "").toLowerCase().startsWith("custom_")));
  if (!customOnlyScenario) return base;
  return Math.max(base, Math.min(14, uniqueCustomTopics.size));
}

function buildGlobalSelection({
  services,
  scenarioId,
  dueUsers,
}) {
  const {
    CONFIG,
    archiveRuntime,
    dataRuntime,
    enrichmentRuntime,
    formattingRuntime,
    preferredSourceRegistryRuntime,
  } = services;
  const preferredSourceRegistry = preferredSourceRegistryRuntime.loadPreferredSourceRegistry();
  const fetchRuntime = createDigestOrchestratorFetchRuntime({
    CONFIG,
    log,
    normalizeTopicToken,
    fetchTopicNews: dataRuntime.fetchTopicNews,
    buildPreferredDomainShortlist: (options) => buildPreferredDomainShortlist(preferredSourceRegistry, options),
    buildCustomTopicQueries,
    buildCustomRescueItemsFromStandard: formattingRuntime.buildCustomRescueItemsFromStandard,
    emitDigestIncident: async () => false,
    normalizeUrlForDedup,
    isFetchedItemEligible: (item) => {
      const annotated = annotateEditorialSignals([item]);
      return annotated.length > 0 && annotated[0].hard_exclude !== true;
    },
  });

  return fetchRuntime.orchestrateFetch({
    dueUsers,
    targetChatId: null,
    runMode: scenarioId,
  }).then(async (fetchResult) => {
    let dedupRes = { items: [], removed: 0 };
    let freshItems = [];
    let cleanedAnnotated = [];
    let globalSelection = { selected: [], rejected: [] };
    let enrichResult = { enriched: [], claudeUsage: { input_tokens: 0, output_tokens: 0 } };
    let clusters = [];
    let storylineCandidates = [];
    let storylinePool = [];
    let rejected = [];

    try {
      const digestPolicies = createDigestPolicies(CONFIG.digest || {});
      const selectionTarget = resolveEvalSelectionTarget({
        scenarioId,
        dueUsers,
        baseSelectionTarget: fetchResult.selectionTarget,
      });
      const crossDayDedupDays = Math.max(1, Number(CONFIG.digest.crossDayDedupDays || 3));
      dedupRes = archiveRuntime.dedupAgainstRecentArchives(fetchResult.allItems, {
        days: crossDayDedupDays,
        targetCount: selectionTarget,
        minBackfillItems: Math.max(1, Number(CONFIG.digest.minBackfillItemsAfterDedup || digestPolicies.depthPolicy.defaultItemCount || 5)),
      });
      const maxArticleAgeHours = Number(CONFIG.digest.maxArticleAgeHours || 48);
      freshItems = dedupRes.items.filter((item) => !articleAgeTooOld(item, maxArticleAgeHours));
      const staleRejected = diffItems(dedupRes.items, freshItems).map((item) => ({
        item,
        reason: "stale_age_filter",
      }));
      const dedupRejected = diffItems(fetchResult.allItems, dedupRes.items).map((item) => ({
        item,
        reason: "archive_dedup",
      }));
      const maxCustomItems = computeMaxCustomItems({
        configuredMaxCustom: Number(CONFIG.digest.maxCustomItemsPerRun),
        selectionTarget,
        customTags: fetchResult.customTags,
      });
      globalSelection = selectDigestItemsDetailed(freshItems, {
        maxItems: selectionTarget,
        maxItemsPerTag: CONFIG.digest.maxItemsPerTag,
        customTags: fetchResult.customTags,
        maxCustomItems,
        tagPriority: fetchResult.tagPriority,
        maxItemsPerSourceDomain: CONFIG.digest.maxItemsPerSourceDomain,
        normalizeUrl: normalizeUrlForDedup,
        parseDomain: archiveRuntime.parseSourceDomain,
        normalizeTopicToken,
        isCandidate: (_item, ctx) => Boolean(ctx.headlineKey),
      });
      enrichResult = await enrichmentRuntime.enrichSelectedItems({
        selected: globalSelection.selected,
        runMode: "scheduled",
        dueUsersCount: dueUsers.length,
      });
      clusters = clusterStorylines(enrichResult.enriched);
      storylineCandidates = buildStorylineCandidates(enrichResult.enriched);
      storylinePool = applyStrategicQualityGate(storylineCandidates, {
        minStrategicValue: 0.34,
        maxRoutineScore: 0.65,
        minKeep: Math.min(Math.max(2, Number(selectionTarget || 3)), Math.max(3, storylineCandidates.length)),
      });
      const clusterRejected = clusters.flatMap((cluster) => {
        const representativeKey = itemKey(cluster?.representative || {});
        return (Array.isArray(cluster?.items) ? cluster.items : [])
          .filter((item) => itemKey(item) !== representativeKey)
          .map((item) => ({
            item,
            reason: item?.suppressed_by_preferred_source
              ? "storyline_preferred_substitute"
              : item?.suppressed_by_derivative_source
                ? "storyline_derivative_suppressed"
                : "storyline_displaced",
          }));
      });
      const strategicRejected = diffItems(storylineCandidates, storylinePool).map((item) => ({
        item,
        reason: "storyline_quality_gate",
      }));
      cleanedAnnotated = annotateEditorialSignals(freshItems);
      rejected = [
        ...dedupRejected,
        ...staleRejected,
        ...globalSelection.rejected,
        ...clusterRejected,
        ...strategicRejected,
      ];
    } catch (error) {
      error.partialEvalResult = {
        fetchResult,
        dedupRes,
        freshItems,
        cleanedAnnotated: cleanedAnnotated.length > 0 ? cleanedAnnotated : annotateEditorialSignals(freshItems),
        globalSelection,
        enrichResult,
        clusters,
        storylineCandidates,
        storylinePool,
        rejected,
      };
      throw error;
    }

    return {
      fetchResult,
      dedupRes,
      freshItems,
      cleanedAnnotated,
      globalSelection,
      enrichResult,
      clusters,
      storylineCandidates,
      storylinePool,
      rejected,
    };
  });
}

const SOURCE_FAMILY_AUDIT_TOPICS = Object.freeze([
  Object.freeze({
    key: "grid infrastructure",
    label: "grid infrastructure",
    tag: "GRID INFRASTRUCTURE",
    hints: ["ENERGY", "SUSTAINABILITY", "POLICY×REGULATORY", "PUBLIC SECTOR"],
    query_override: [
      "grid infrastructure transmission permitting interconnection regulator utility last 48 hours",
      "transmission line permitting interconnection queue FERC utility buildout last 48 hours",
      "power transformer utility equipment grid capex data center load last 48 hours",
      "grid modernization transformer utility equipment transmission capex last 48 hours",
    ],
  }),
  Object.freeze({
    key: "energy",
    label: "ENERGY",
    tag: "ENERGY",
    hints: ["ENERGY", "SUSTAINABILITY"],
  }),
  Object.freeze({
    key: "policy regulatory",
    label: "POLICY×REGULATORY",
    tag: "POLICY×REGULATORY",
    hints: ["POLICY×REGULATORY", "PUBLIC SECTOR"],
  }),
  Object.freeze({
    key: "cbam",
    label: "CBAM",
    tag: "CBAM",
    hints: ["SUSTAINABILITY", "POLICY×REGULATORY", "ENERGY"],
  }),
  Object.freeze({
    key: "rate cuts",
    label: "rate cuts",
    tag: "RATE CUTS",
    hints: ["FINANCIAL SERVICES", "STRATEGY"],
  }),
]);

function findTopicGapEntry(scenarios = [], topicKey = "") {
  const normalizedKey = normalizeEvalTopicKey(topicKey);
  for (const scenario of (Array.isArray(scenarios) ? scenarios : [])) {
    const gap = (Array.isArray(scenario?.summary?.topic_gap_audit) ? scenario.summary.topic_gap_audit : []).find((entry) => {
      return normalizeEvalTopicKey(entry?.custom_slug || entry?.tag) === normalizedKey;
    });
    if (gap) return gap;
  }
  return null;
}

async function runFocusedStrictProbe(services, topicConfig) {
  const preferredRegistry = services.preferredSourceRegistryRuntime.loadPreferredSourceRegistry();
  const shortlist = buildPreferredDomainShortlist(preferredRegistry, {
    topicTag: topicConfig.tag,
    dueUserTopics: topicConfig.hints,
    official_friendly: true,
  });
  const topic = {
    tag: topicConfig.tag,
    queries: Array.isArray(topicConfig.query_override) && topicConfig.query_override.length > 0
      ? topicConfig.query_override.slice()
      : buildCustomTopicQueries(topicConfig.label),
  };
  const result = await services.dataRuntime.fetchTopicNews(topic, {
    retrievalPlan: {
      preferred_domains: Array.isArray(shortlist?.domains) ? shortlist.domains.slice() : [],
      allow_broad_fallback: false,
      official_friendly: shortlist?.official_friendly === true,
      thin_item_threshold: 1,
    },
  });
  return {
    topic: topicConfig.label,
    queries_used: topic.queries.slice(),
    preferred_shortlist: Array.isArray(shortlist?.domains) ? shortlist.domains.slice() : [],
    search_result_domains: Array.isArray(result?.diagnostics?.search_result_domains) ? result.diagnostics.search_result_domains.slice() : [],
    preferred_search_result_domains: Array.isArray(result?.diagnostics?.preferred_search_result_domains) ? result.diagnostics.preferred_search_result_domains.slice() : [],
    returned_items: (Array.isArray(result?.items) ? result.items : []).map((item) => serializeItem(item)),
    diagnostics: result?.diagnostics || {},
  };
}

async function buildWeakTopicArtifacts(services, scenarios = []) {
  const sourceFamilyAudit = [];
  let gridComparison = null;
  for (const topicConfig of SOURCE_FAMILY_AUDIT_TOPICS) {
    const normalGap = findTopicGapEntry(scenarios, topicConfig.key) || {};
    const strictProbe = await runFocusedStrictProbe(services, topicConfig);
    const strictDomains = Array.isArray(strictProbe.search_result_domains) ? strictProbe.search_result_domains : [];
    const repeatedCandidateDomainsSeen = Array.isArray(normalGap?.search_result_domains)
      ? Array.from(new Set([
        ...(normalGap.search_result_domains || []),
      ]))
      : [];
    let recommendation = "keep";
    let confidence = "medium";
    if (strictProbe.returned_items.length > 0 && Number(normalGap.final_count || 0) <= 0 && Number(normalGap.raw_count || 0) <= 0) {
      recommendation = "add";
      confidence = "high";
    } else if (strictProbe.returned_items.length === 0 && Number(normalGap.raw_count || 0) <= 0) {
      recommendation = "no_action";
      confidence = "high";
    } else if (strictDomains.length > 0 && repeatedCandidateDomainsSeen.length === 0) {
      recommendation = "add";
    }
    sourceFamilyAudit.push({
      topic: topicConfig.label,
      current_preferred_family: topicConfig.hints.slice(),
      repeated_candidate_domains_seen: repeatedCandidateDomainsSeen,
      strict_probe_domains_seen: strictDomains,
      recommendation,
      confidence,
    });
    if (topicConfig.key === "grid infrastructure") {
      const likelyRootCause = strictProbe.returned_items.length > 0 && Number(normalGap.final_count || 0) <= 0
        ? "normal_path_missed_strict_probe_hit"
        : strictProbe.returned_items.length <= 0
          ? "strict_probe_also_thin"
          : "normal_path_recovered";
      gridComparison = {
        topic: topicConfig.label,
        normal_pipeline: {
          raw_count: Number(normalGap.raw_count || 0),
          cleaned_count: Number(normalGap.cleaned_count || 0),
          final_count: Number(normalGap.final_count || 0),
          source_score: Number(normalGap.source_score || 0),
          selection_lift: Number(normalGap.selection_lift || 0),
          root_cause: normalGap.root_cause || null,
          preferred_family: topicConfig.hints.slice(),
        },
        strict_probe: strictProbe,
        miss_stage: Number(normalGap.final_count || 0) <= 0 ? (normalGap.failure_reason || "unknown") : null,
        likely_root_cause: likelyRootCause,
      };
    }
  }
  return {
    grid_infrastructure_comparison: gridComparison,
    source_family_audit: sourceFamilyAudit,
  };
}

function computePersonaRawBaseline(items, user, parseSourceDomain) {
  const topics = Array.isArray(user?.topics) ? user.topics : [];
  const { customKeywords } = splitUserTopics(topics);
  const filteredResult = filterItemsByTopics(items, topics, {
    minItems: 1,
    strictZeroFallback: customKeywords.length > 0 ? true : "specialist",
  });
  let filtered = filteredResult.items;
  if (customKeywords.length > 0) {
    filtered = filtered.filter((item) => {
      const tagNormalized = normalizeTopicToken(item?.tag || "");
      const bodyText = normalizeMatchText(`${String(item?.headline || "")} ${String(item?.summary || "")}`);
      return customKeywords.some((keyword) => customKeywordMatches(keyword, bodyText, tagNormalized));
    });
  }
  const scored = applyTopicRelevanceScores(filtered, topics, user.topic_weights || {}, {
    specialistMode: false,
    repeatPenalty: 0,
    isRecentRepeat: () => false,
    sourceDomainForItem: parseSourceDomain,
    recentEntityCounts: {},
    recentStorylineKeys: new Set(),
    blockedSources: new Set(),
    trustedSources: new Set(),
  });
  const requestedCount = Math.max(1, Number(user?.preferences?.items_per_digest || 5));
  const rawBaselineItems = rankItemsBySourceScore(scored).slice(0, requestedCount);
  return {
    filtered,
    scored,
    requestedCount,
    custom_keyword_count: customKeywords.length,
    filter_mode: filteredResult.mode,
    rawBaselineItems,
    candidatePoolQuality: computeSetQuality(scored, { requestedCount }),
    rawBaselineQuality: computeSetQuality(rawBaselineItems, { requestedCount }),
  };
}

function buildDeliveryPolicyResult(user, rankedItems, nowIso) {
  const customKeywords = (Array.isArray(user?.topics) ? user.topics : [])
    .filter((topic) => String(topic || "").startsWith("custom_"))
    .map((topic) => String(topic || "").replace(/^custom_/, "").replace(/_/g, " ").trim())
    .filter(Boolean);
  const trustedOnlyKeywords = listTrustedOnlyCustomKeywords(customKeywords);
  const attempt1 = selectDeliveryItems(rankedItems, {
    attemptCount: 1,
    nowIso,
    customKeywords,
    lowerConfidenceAssistCount: 0,
  });
  const retry = selectDeliveryItems(rankedItems, {
    attemptCount: 2,
    nowIso,
    customKeywords,
    lowerConfidenceAssistCount: attempt1.lower_confidence_used ? 1 : 0,
  });
  let deliveryOutcome = "withheld_after_retry";
  let deliveredItems = [];
  if (attempt1.delivery_eligible) {
    deliveryOutcome = attempt1.lower_confidence_used ? "delivered_with_lower_confidence" : "delivered_full_confidence";
    deliveredItems = attempt1.items;
  } else if (retry.delivery_eligible) {
    deliveryOutcome = retry.lower_confidence_used ? "delivered_with_lower_confidence" : "delivered_full_confidence";
    deliveredItems = retry.items;
  }
  return {
    attempt_1: attempt1,
    retry,
    delivered_items: deliveredItems,
    delivery_outcome: deliveryOutcome,
    internal_thinness_label: deriveInternalThinnessLabel({
      availableCandidateCount: rankedItems.length,
      highConfidenceAvailableCount: attempt1.high_confidence_available_count,
    }),
    trusted_only_custom_keywords: trustedOnlyKeywords,
    lower_confidence_used: deliveredItems.some((item) => item?.delivery_confidence === "lower"),
    product_underdelivery: !deliveryOutcome.startsWith("delivered"),
  };
}

function classifyPersonaCoverage(rawBaseline, finalItems, errorMessage, internalFinalCount = 0) {
  const candidateCount = Math.max(0, Number(rawBaseline?.scored?.length || 0));
  const rawBaselineCount = Math.max(0, Number(rawBaseline?.rawBaselineItems?.length || 0));
  const finalCount = Math.max(0, Number(finalItems?.length || 0));
  if (finalCount > 0) return candidateCount < Math.max(1, Number(rawBaseline?.requestedCount || 0)) ? "retrieval_limited" : "covered";
  if (internalFinalCount > 0) return "product_underdelivery";
  if (candidateCount <= 0 || rawBaselineCount <= 0) return "retrieval_limited";
  if (errorMessage) return "ranking_limited";
  return "noisy_baseline_blocked";
}

function evaluatePersona({
  services,
  scenarioId,
  user,
  storylinePool,
  repeatIndex,
  repeatPenalty,
  rankingPolicy,
  depthPolicy,
  cleanedAnnotated,
  fetchDiagnostics,
  selectionDiagnostics,
}) {
  const { archiveRuntime, rankingRuntime } = services;
  const rawBaseline = computePersonaRawBaseline(cleanedAnnotated, user, archiveRuntime.parseSourceDomain);
  const requestedCount = rawBaseline.requestedCount;
  try {
    const ranking = rankingRuntime.rankAndSuppressUserItems({
      user,
      enriched: storylinePool,
      repeatIndex,
      repeatPenalty,
      depthPolicy,
      rankingPolicy,
      recentDigestRecords: [],
      nowIso: new Date().toISOString(),
      deliveryMode: "scheduled",
      runDiagnostics: {
        ...(fetchDiagnostics || {}),
        candidate_pool_before_dedup: selectionDiagnostics?.candidate_pool_before_dedup,
        candidate_pool_after_dedup: selectionDiagnostics?.candidate_pool_after_dedup,
      },
      captureDiagnostics: true,
    });
    const nowIso = new Date().toISOString();
    const internalFinalItems = applyDigestDepth(ranking.userItems, user?.preferences?.depth || "headline_plus_why");
    const deliveryPolicy = buildDeliveryPolicyResult(user, ranking.userItems, nowIso);
    const finalItems = applyDigestDepth(deliveryPolicy.delivered_items, user?.preferences?.depth || "headline_plus_why");
    const finalQuality = computeSetQuality(finalItems, { requestedCount });
    const internalFinalQuality = computeSetQuality(internalFinalItems, { requestedCount });
    const digestQuality = computeDigestQualityScore({
      items: finalItems.length > 0 ? finalItems : internalFinalItems,
      user,
      previous_items: [],
    });
    const gateBreakdown = buildPersonaGateBreakdown({
      trace: ranking?.diagnostics?.item_trace,
      deliveryPolicy,
      requestedCount,
      rankedItems: ranking.userItems,
      customKeywords: (Array.isArray(user?.topics) ? user.topics : [])
        .filter((topic) => String(topic || "").startsWith("custom_"))
        .map((topic) => String(topic || "").replace(/^custom_/, "").replace(/_/g, " ").trim())
        .filter(Boolean),
      nowIso,
    });
    const selectionLift = Number((finalQuality.score - rawBaseline.rawBaselineQuality.score).toFixed(2));
    return {
      status: "completed",
      scenario_id: scenarioId,
      persona_id: user.chatId,
      persona_label: user.eval_label || user.email || user.chatId,
      group: user.eval_group || "unknown",
      requested_count: requestedCount,
      candidate_pool_count: rawBaseline.scored.length,
      candidate_pool_quality: rawBaseline.candidatePoolQuality,
      raw_baseline_quality: rawBaseline.rawBaselineQuality,
      final_selected_quality: finalQuality,
      internal_final_quality: internalFinalQuality,
      selection_lift: selectionLift,
      coverage_limiter: classifyPersonaCoverage(rawBaseline, finalItems, null, internalFinalItems.length),
      scarcity_profile: describeScarcity({
        itemCount: finalItems.length,
        requestedCount,
        score: finalQuality.score,
        selectionLift,
      }),
      current_digest_quality: digestQuality,
      delivery_policy: {
        delivery_outcome: deliveryPolicy.delivery_outcome,
        internal_thinness_label: deliveryPolicy.internal_thinness_label,
        lower_confidence_used: deliveryPolicy.lower_confidence_used,
        product_underdelivery: deliveryPolicy.product_underdelivery,
        trusted_only_custom_keywords: deliveryPolicy.trusted_only_custom_keywords,
        attempt_1: {
          high_confidence_count: deliveryPolicy.attempt_1.high_confidence_count,
          lower_confidence_count: deliveryPolicy.attempt_1.lower_confidence_count,
          high_confidence_available_count: deliveryPolicy.attempt_1.high_confidence_available_count,
          lower_confidence_available_count: deliveryPolicy.attempt_1.lower_confidence_available_count,
          delivery_eligible: deliveryPolicy.attempt_1.delivery_eligible,
          lower_confidence_cap_reached: deliveryPolicy.attempt_1.lower_confidence_cap_reached === true,
        },
        retry: {
          high_confidence_count: deliveryPolicy.retry.high_confidence_count,
          lower_confidence_count: deliveryPolicy.retry.lower_confidence_count,
          high_confidence_available_count: deliveryPolicy.retry.high_confidence_available_count,
          lower_confidence_available_count: deliveryPolicy.retry.lower_confidence_available_count,
          delivery_eligible: deliveryPolicy.retry.delivery_eligible,
          lower_confidence_cap_reached: deliveryPolicy.retry.lower_confidence_cap_reached === true,
        },
      },
      final_gate_breakdown: gateBreakdown.final_gate_breakdown,
      ranking_gate_breakdown: gateBreakdown.ranking_gate_breakdown,
      delivery_policy_breakdown: gateBreakdown.delivery_policy_breakdown,
      primary_final_gate_reason: gateBreakdown.primary_final_gate_reason,
      candidate_pool_items: rawBaseline.scored.map((item) => serializeItem(item)),
      raw_baseline_items: rawBaseline.rawBaselineItems.map((item) => serializeItem(item)),
      final_items: finalItems.map((item) => serializeItem(item)),
      internal_final_items: internalFinalItems.map((item) => serializeItem(item)),
      failure_reasons: summarizeTrace(ranking?.diagnostics?.item_trace),
      final_trace: ranking?.diagnostics?.item_trace || null,
      error: null,
    };
  } catch (error) {
    const message = String(error?.message || error || "unknown persona failure");
    const failedDeliveryPolicy = {
      delivery_outcome: "withheld_after_retry",
      internal_thinness_label: "product_underdelivery",
      lower_confidence_used: false,
      product_underdelivery: true,
      trusted_only_custom_keywords: [],
      attempt_1: {
        high_confidence_count: 0,
        lower_confidence_count: 0,
        high_confidence_available_count: 0,
        lower_confidence_available_count: 0,
        delivery_eligible: false,
        lower_confidence_cap_reached: false,
      },
      retry: {
        high_confidence_count: 0,
        lower_confidence_count: 0,
        high_confidence_available_count: 0,
        lower_confidence_available_count: 0,
        delivery_eligible: false,
        lower_confidence_cap_reached: false,
      },
    };
    const failedGateBreakdown = buildPersonaGateBreakdown({
      trace: {
        transitions: [
          {
            stage: "ranking",
            reason: "no_deliverable_items",
            message,
          },
        ],
      },
      deliveryPolicy: failedDeliveryPolicy,
      requestedCount,
      rankedItems: [],
      customKeywords: [],
      nowIso: new Date().toISOString(),
    });
    return {
      status: "failed",
      scenario_id: scenarioId,
      persona_id: user.chatId,
      persona_label: user.eval_label || user.email || user.chatId,
      group: user.eval_group || "unknown",
      requested_count: requestedCount,
      candidate_pool_count: rawBaseline.scored.length,
      candidate_pool_quality: rawBaseline.candidatePoolQuality,
      raw_baseline_quality: rawBaseline.rawBaselineQuality,
      final_selected_quality: {
        ...buildFailedPersonaQuality(),
        requested_count: requestedCount,
      },
      internal_final_quality: {
        ...buildFailedPersonaQuality(),
        requested_count: requestedCount,
      },
      selection_lift: Number((0 - rawBaseline.rawBaselineQuality.score).toFixed(2)),
      coverage_limiter: classifyPersonaCoverage(rawBaseline, [], message, 0),
      scarcity_profile: describeScarcity({
        itemCount: 0,
        requestedCount,
        score: 0,
      }),
      current_digest_quality: {
        score: 0,
        band: "poor",
        quality_label: "poor",
      },
      delivery_policy: failedDeliveryPolicy,
      final_gate_breakdown: failedGateBreakdown.final_gate_breakdown,
      ranking_gate_breakdown: failedGateBreakdown.ranking_gate_breakdown,
      delivery_policy_breakdown: failedGateBreakdown.delivery_policy_breakdown,
      primary_final_gate_reason: failedGateBreakdown.primary_final_gate_reason,
      candidate_pool_items: rawBaseline.scored.map((item) => serializeItem(item)),
      raw_baseline_items: rawBaseline.rawBaselineItems.map((item) => serializeItem(item)),
      final_items: [],
      internal_final_items: [],
      failure_reasons: {
        transitions: [
          {
            stage: "ranking",
            reason: "no_deliverable_items",
            message,
          },
        ],
        reason_counts: {
          no_deliverable_items: 1,
        },
      },
      final_trace: null,
      error: message,
    };
  }
}

function buildScenarioSummary(scenario, globalResult, personaResults) {
  const deliveryOutcomeCounts = {};
  for (const row of personaResults) {
    const key = String(row?.delivery_policy?.delivery_outcome || "withheld_after_retry").trim();
    deliveryOutcomeCounts[key] = (deliveryOutcomeCounts[key] || 0) + 1;
  }
  const deliveredCount = personaResults.filter((row) => String(row?.delivery_policy?.delivery_outcome || "").startsWith("delivered")).length;
  const lowerConfidenceUsedCount = personaResults.filter((row) => row?.delivery_policy?.lower_confidence_used === true).length;
  const withheldAfterRetryCount = personaResults.filter((row) => {
    const outcome = String(row?.delivery_policy?.delivery_outcome || "");
    return outcome === "withheld_after_retry" || outcome === "withheld_after_retry_window";
  }).length;
  const rawSourceSummary = buildSourceLevelSummary(globalResult.cleanedAnnotated);
  const finalItems = personaResults.flatMap((row) => row.final_items || []);
  const finalSourceSummary = buildSourceLevelSummary(finalItems);
  const topicGapAudit = buildTopicGapAudit(globalResult, personaResults);
  const strongest = personaResults.slice().sort((left, right) => Number(right.final_selected_quality?.score || 0) - Number(left.final_selected_quality?.score || 0))[0] || null;
  const weakest = personaResults.slice().sort((left, right) => Number(left.final_selected_quality?.score || 0) - Number(right.final_selected_quality?.score || 0))[0] || null;
  const negativeLiftCount = personaResults.filter((row) => Number(row.selection_lift || 0) < 0).length;
  const failedPersonaCount = personaResults.filter((row) => row?.status === "failed").length;
  const scarcityCounts = {};
  const reasonCounts = {};
  const coverageLimiterCounts = {};
  const topicRootCauseCounts = {};
  const finalGateBreakdownCounts = {};
  for (const row of personaResults) {
    const scarcityKey = String(row?.scarcity_profile || "").trim() || "unknown";
    scarcityCounts[scarcityKey] = (scarcityCounts[scarcityKey] || 0) + 1;
    const limiterKey = String(row?.coverage_limiter || "").trim() || "unknown";
    coverageLimiterCounts[limiterKey] = (coverageLimiterCounts[limiterKey] || 0) + 1;
    for (const [reason, count] of Object.entries(row?.failure_reasons?.reason_counts || {})) {
      reasonCounts[reason] = (reasonCounts[reason] || 0) + Number(count || 0);
    }
    if (Number(row?.candidate_pool_count || 0) > 0 && Number(row?.final_selected_quality?.item_count || 0) <= 0) {
      incrementCount(finalGateBreakdownCounts, row?.primary_final_gate_reason || "unknown");
    }
  }
  for (const row of topicGapAudit) {
    const rootCause = String(row?.root_cause || "").trim() || "unknown";
    topicRootCauseCounts[rootCause] = (topicRootCauseCounts[rootCause] || 0) + 1;
  }
  const recommendations = [];
  const avgFinalScore = personaResults.length
    ? personaResults.reduce((sum, row) => sum + Number(row?.final_selected_quality?.score || 0), 0) / personaResults.length
    : 0;
  const avgFreshness = personaResults.length
    ? personaResults.reduce((sum, row) => sum + Number(row?.final_selected_quality?.avg_freshness || 0), 0) / personaResults.length
    : 0;
  const avgFillRate = personaResults.length
    ? personaResults.reduce((sum, row) => sum + Number(row?.final_selected_quality?.fill_rate || 0), 0) / personaResults.length
    : 0;
  const topDomainShare = finalSourceSummary[0]?.top_domain_share || 0;
  const provider429Rate = Number(globalResult?.fetchResult?.fetchDiagnostics?.provider_429_rate || 0);
  const provider429Count = Number(globalResult?.fetchResult?.fetchDiagnostics?.provider_429_count || 0);
  const retrievalLimitedCount = Number(coverageLimiterCounts.retrieval_limited || 0);
  const rankingLimitedCount = Number(coverageLimiterCounts.ranking_limited || 0);
  const staleRejectedCount = globalResult.rejected.filter((row) => row?.reason === "stale_age_filter").length;
  const rawCandidateCount = Math.max(0, Number(globalResult?.fetchResult?.allItems?.length || 0));
  const cleanedCandidateCount = Math.max(0, Number(globalResult?.cleanedAnnotated?.length || 0));
  if (avgFreshness < 75) recommendations.push("Freshness is slipping below the 24-48h target in final selections.");
  if (negativeLiftCount > 0) recommendations.push("Selection is reducing quality for some personas; inspect negative-lift cases.");
  if (topDomainShare > 50) recommendations.push("Source concentration is high in final selections; review source-cap behavior.");
  if (failedPersonaCount > 0) recommendations.push("Some personas failed to produce deliverable items after fallback; inspect thin-pool and retrieval coverage.");
  if ((scarcityCounts.short_but_precise || 0) > 0) recommendations.push("Some digests are intentionally short but precise; treat fill-rate separately from quality.");
  if (provider429Count > 0) recommendations.push("Provider rate limits are collapsing coverage for part of this scenario; inspect batching and query sequencing.");
  if (retrievalLimitedCount > rankingLimitedCount && retrievalLimitedCount > 0) recommendations.push("Most failures are retrieval-limited rather than ranking-limited; prioritize candidate yield.");
  if (deliveredCount < personaResults.length) recommendations.push("The 5-item shipping contract is under-fulfilled for part of this scenario; separate healthy thinness from product underdelivery.");
  if ((finalGateBreakdownCounts.delivery_policy_total_item_shortfall || 0) > 0) recommendations.push("Some topics are good enough to rank but still die at shipping because they cannot assemble 5 eligible items.");
  if ((finalGateBreakdownCounts.score_threshold || 0) > 0) recommendations.push("Some topics are finding candidates that die on the final score/strategic thresholds; inspect whether those bars are now too tight for the 5-item promise.");
  if ((topicRootCauseCounts.preferred_only_query_design || 0) > 0) recommendations.push("Zero-yield preferred-domain topics are still missing broad fallback coverage; fix retry sequencing before adding more fallback.");
  if ((topicRootCauseCounts.query_plan_not_exhausted || 0) > 0) recommendations.push("Zero-yield topics still have unused alternate broad queries; one more broad pass is likely higher-leverage than looser fallback.");
  if ((topicRootCauseCounts.keyword_ambiguity_or_off_topic_query || 0) > 0) recommendations.push("Broad custom keywords are retrieving off-topic items; tighten keyword/source hints rather than padding.");
  return {
    scenario_id: scenario.id,
    label: scenario.label,
    status: failedPersonaCount > 0 ? "completed_with_errors" : "completed",
    persona_count: scenario.personaCount,
    failed_persona_count: failedPersonaCount,
    raw_candidate_count: globalResult.fetchResult.allItems ? globalResult.fetchResult.allItems.length : globalResult.fetchResult?.allItems,
    cleaned_candidate_count: globalResult.cleanedAnnotated.length,
    global_selected_count: globalResult.globalSelection.selected.length,
    storyline_pool_count: globalResult.storylinePool.length,
    fetch_calls: {
      standard: Number(globalResult.fetchResult.standardFetchCalls || 0),
      custom: Number(globalResult.fetchResult.customFetchCalls || 0),
    },
    strongest_persona: strongest ? {
      id: strongest.persona_id,
      label: strongest.persona_label,
      score: strongest.final_selected_quality.score,
    } : null,
    weakest_persona: weakest ? {
      id: weakest.persona_id,
      label: weakest.persona_label,
      score: weakest.final_selected_quality.score,
    } : null,
    negative_lift_count: negativeLiftCount,
    scarcity_counts: scarcityCounts,
    coverage_limiter_counts: coverageLimiterCounts,
    final_gate_breakdown_counts: finalGateBreakdownCounts,
    reason_counts: reasonCounts,
    topic_root_cause_counts: topicRootCauseCounts,
    topic_gap_audit: topicGapAudit,
    raw_source_summary: rawSourceSummary,
    final_source_summary: finalSourceSummary,
    five_item_fulfillment_rate: personaResults.length > 0 ? Number(((deliveredCount / personaResults.length) * 100).toFixed(2)) : 0,
    withheld_after_retry_rate: personaResults.length > 0 ? Number(((withheldAfterRetryCount / personaResults.length) * 100).toFixed(2)) : 0,
    lower_confidence_usage_rate: personaResults.length > 0 ? Number(((lowerConfidenceUsedCount / personaResults.length) * 100).toFixed(2)) : 0,
    delivery_outcome_counts: deliveryOutcomeCounts,
    provider_429_count: provider429Count,
    provider_429_rate: provider429Rate,
    degraded_topic_rate: Number(globalResult?.fetchResult?.fetchDiagnostics?.degraded_topic_rate || 0),
    retrieval_limited_topic_count: Number(globalResult?.fetchResult?.fetchDiagnostics?.retrieval_limited_topic_count || 0),
    thin_topic_count: Number(globalResult?.fetchResult?.fetchDiagnostics?.thin_topic_count || 0),
    stale_rejection_rate: rawCandidateCount > 0 ? Number(((staleRejectedCount / rawCandidateCount) * 100).toFixed(2)) : 0,
    candidate_collapse_rate: rawCandidateCount > 0 ? Number((((rawCandidateCount - cleanedCandidateCount) / rawCandidateCount) * 100).toFixed(2)) : 0,
    recommendations,
    average_final_score: Number(avgFinalScore.toFixed(2)),
    average_final_freshness: Number(avgFreshness.toFixed(2)),
    average_fill_rate: Number(avgFillRate.toFixed(2)),
  };
}

function buildOverallSummary(scenarios, personaResults) {
  const strongest = personaResults.slice().sort((left, right) => Number(right.final_selected_quality?.score || 0) - Number(left.final_selected_quality?.score || 0))[0] || null;
  const weakest = personaResults.slice().sort((left, right) => Number(left.final_selected_quality?.score || 0) - Number(right.final_selected_quality?.score || 0))[0] || null;
  const overallScore = personaResults.length
    ? personaResults.reduce((sum, row) => sum + Number(row?.final_selected_quality?.score || 0), 0) / personaResults.length
    : 0;
  const deliveryOutcomeCounts = {};
  const bucketKpis = {};
  const lowerConfidenceExposure = {};
  const finalGateBreakdownCounts = {};
  for (const row of personaResults) {
    const outcome = String(row?.delivery_policy?.delivery_outcome || "withheld_after_retry").trim();
    deliveryOutcomeCounts[outcome] = (deliveryOutcomeCounts[outcome] || 0) + 1;
    const bucket = String(row?.group || "unknown");
    if (!bucketKpis[bucket]) {
      bucketKpis[bucket] = {
        persona_count: 0,
        delivered_count: 0,
        lower_confidence_count: 0,
        withheld_after_retry_count: 0,
      };
    }
    bucketKpis[bucket].persona_count += 1;
    if (outcome.startsWith("delivered")) bucketKpis[bucket].delivered_count += 1;
    if (row?.delivery_policy?.lower_confidence_used === true) bucketKpis[bucket].lower_confidence_count += 1;
    if (outcome === "withheld_after_retry" || outcome === "withheld_after_retry_window") bucketKpis[bucket].withheld_after_retry_count += 1;
    if (row?.delivery_policy?.lower_confidence_used === true) {
      const exposureKey = String(row?.persona_id || "");
      lowerConfidenceExposure[exposureKey] = (lowerConfidenceExposure[exposureKey] || 0) + 1;
    }
    if (Number(row?.candidate_pool_count || 0) > 0 && Number(row?.final_selected_quality?.item_count || 0) <= 0) {
      incrementCount(finalGateBreakdownCounts, row?.primary_final_gate_reason || "unknown");
    }
  }
  const deliveredCount = Object.entries(deliveryOutcomeCounts)
    .filter(([key]) => key.startsWith("delivered"))
    .reduce((sum, [, count]) => sum + Number(count || 0), 0);
  const lowerConfidenceCount = personaResults.filter((row) => row?.delivery_policy?.lower_confidence_used === true).length;
  const withheldAfterRetryCount = personaResults.filter((row) => {
    const outcome = String(row?.delivery_policy?.delivery_outcome || "");
    return outcome === "withheld_after_retry" || outcome === "withheld_after_retry_window";
  }).length;
  return {
    scenario_count: scenarios.length,
    persona_count: personaResults.length,
    overall_score: Number(overallScore.toFixed(2)),
    five_item_fulfillment_rate: personaResults.length > 0 ? Number(((deliveredCount / personaResults.length) * 100).toFixed(2)) : 0,
    withheld_after_retry_rate: personaResults.length > 0 ? Number(((withheldAfterRetryCount / personaResults.length) * 100).toFixed(2)) : 0,
    lower_confidence_usage_rate: personaResults.length > 0 ? Number(((lowerConfidenceCount / personaResults.length) * 100).toFixed(2)) : 0,
    repeated_lower_confidence_exposure_rate: personaResults.length > 0
      ? Number(((Object.values(lowerConfidenceExposure).filter((count) => count > 1).length / personaResults.length) * 100).toFixed(2))
      : 0,
    delivery_outcome_counts: deliveryOutcomeCounts,
    final_gate_breakdown_counts: finalGateBreakdownCounts,
    bucket_kpis: Object.fromEntries(Object.entries(bucketKpis).map(([bucket, stats]) => ([
      bucket,
      {
        ...stats,
        five_item_fulfillment_rate: stats.persona_count > 0 ? Number(((stats.delivered_count / stats.persona_count) * 100).toFixed(2)) : 0,
        withheld_after_retry_rate: stats.persona_count > 0 ? Number(((stats.withheld_after_retry_count / stats.persona_count) * 100).toFixed(2)) : 0,
        lower_confidence_usage_rate: stats.persona_count > 0 ? Number(((stats.lower_confidence_count / stats.persona_count) * 100).toFixed(2)) : 0,
      },
    ]))),
    strongest_band: strongest?.final_selected_quality?.band || null,
    weakest_band: weakest?.final_selected_quality?.band || null,
    strongest_persona: strongest ? {
      scenario_id: strongest.scenario_id,
      persona_id: strongest.persona_id,
      persona_label: strongest.persona_label,
      score: strongest.final_selected_quality.score,
    } : null,
    weakest_persona: weakest ? {
      scenario_id: weakest.scenario_id,
      persona_id: weakest.persona_id,
      persona_label: weakest.persona_label,
      score: weakest.final_selected_quality.score,
    } : null,
  };
}

async function runRetrievalEval(options = {}) {
  const scenarios = Array.isArray(options.scenarios) && options.scenarios.length > 0
    ? options.scenarios
    : DEFAULT_SCENARIOS.slice();
  const services = options.services || createEvalServices();
  const storage = options.storage || createRetrievalEvalStorageRuntime({
    appRoot: services.runtimePaths.appRoot,
    env: process.env,
    nodeEnv: process.env.NODE_ENV,
  });
  storage.ensureRoot();
  let budget = storage.loadBudget();
  if (options.resetBudget === true) {
    budget = storage.saveBudget({
      cap_usd: Number(options.budgetCapUsd || DEFAULT_BUDGET_CAP_USD),
      reserve_usd: Number(options.budgetReserveUsd || budget.reserve_usd),
      spent_usd: 0,
      calls: [],
      stop_reason: null,
    });
  }
  const runId = String(options.runId || `retrieval-eval:${new Date().toISOString().replace(/[:.]/g, "-")}`);
  const scenarioDefs = Array.isArray(options.scenarioDefs) && options.scenarioDefs.length > 0
    ? options.scenarioDefs
    : buildScenarioMatrix(scenarios);
  const runRecord = {
    version: EVAL_VERSION,
    run_id: runId,
    status: "running",
    started_at: new Date().toISOString(),
    completed_at: null,
    delivery_disabled: true,
    transport_channels_disabled: ["email", "telegram"],
    budget: cloneJson(budget),
    historical: null,
    dqs_formula: CURRENT_DQS_FORMULA,
    scenarios: [],
    manual_review_queue: [],
    overall_summary: null,
    recommendations: [],
  };
  storage.saveActiveRun({
    run_id: runId,
    status: "running",
    started_at: runRecord.started_at,
    scenarios: scenarioDefs.map((row) => row.id),
  });
  storage.saveRun(runRecord);

  const sourceRegistry = services.sourceRegistryRuntime.loadSourceRegistry();
  const preferredRegistry = services.preferredSourceRegistryRuntime.loadPreferredSourceRegistry();
  setAdminSourceRegistry(services.sourceRegistryRuntime.buildRegistryMap(sourceRegistry));
  setPreferredSourceRegistry(preferredRegistry);
  const learnedAdjustments = computeLearnedAuthorityAdjustments(loadDomainStats());
  if (learnedAdjustments.size > 0) setLearnedDomainAdjustments(learnedAdjustments);

  try {
    runRecord.historical = buildHistoricalComparison({
      digestDeliveryRecordRuntime: services.deliveryRecordRuntime,
      days: Number(options.historicalDays || 14),
    });
    storage.saveRun(runRecord);

    const allPersonaResults = [];
    for (const scenario of scenarioDefs) {
      const estimatedScenarioCost = buildScenarioEstimate(services, scenario);
      const budgetGuard = budgetGuardStatus(budget, estimatedScenarioCost);
      if (!budgetGuard.ok) {
        budget = storage.saveBudget({
          ...budget,
          stop_reason: `budget_cap_before:${scenario.id}`,
        });
        runRecord.budget = cloneJson(budget);
        runRecord.recommendations.push(
          `Stopped before ${scenario.id} because the remaining budget after reserve `
          + `($${budgetGuard.remaining_after_reserve_usd.toFixed(2)}) was below the `
          + `estimated scenario cost ($${budgetGuard.estimate_usd.toFixed(2)}).`
        );
        break;
      }
      log(`Running scenario ${scenario.id} (${scenario.personaCount} personas)`);
      try {
        const globalResult = await buildGlobalSelection({
          services,
          scenarioId: scenario.id,
          dueUsers: scenario.dueUsers,
        });
        const digestPolicies = createDigestPolicies(services.CONFIG.digest || {});
        const repeatIndex = services.archiveRuntime.buildRecentRepeatIndex(Math.max(1, Number(services.CONFIG.digest.crossDayDedupDays || 3)));
        const repeatPenalty = Number(digestPolicies.rankingPolicy.repeatPenalty || 0);
        const selectionDiagnostics = {
          candidate_pool_before_dedup: Array.isArray(globalResult.fetchResult.allItems) ? globalResult.fetchResult.allItems.length : globalResult.fetchResult?.allItems?.length || globalResult.fetchResult?.allItems || globalResult.fetchResult.allItems,
          candidate_pool_after_dedup: globalResult.freshItems.length,
        };
        const personaResults = scenario.dueUsers.map((user) => evaluatePersona({
          services,
          scenarioId: scenario.id,
          user,
          storylinePool: globalResult.storylinePool,
          repeatIndex,
          repeatPenalty,
          rankingPolicy: digestPolicies.rankingPolicy,
          depthPolicy: digestPolicies.depthPolicy,
          cleanedAnnotated: globalResult.cleanedAnnotated,
          fetchDiagnostics: globalResult.fetchResult.fetchDiagnostics,
          selectionDiagnostics,
        }));
        allPersonaResults.push(...personaResults);

        const scenarioCost = computeScenarioCost(globalResult);
        budget = recordBudgetEvent(storage, budget, {
          ts: new Date().toISOString(),
          provider: "eval_scenario",
          purpose: scenario.id,
          cost_usd: scenarioCost.totalCost,
          standard_fetch_calls: Number(globalResult.fetchResult.standardFetchCalls || 0),
          custom_fetch_calls: Number(globalResult.fetchResult.customFetchCalls || 0),
          claude_usage: globalResult.enrichResult.claudeUsage,
        });

        const summary = buildScenarioSummary(scenario, globalResult, personaResults);
        const scenarioRecord = {
          id: scenario.id,
          label: scenario.label,
          status: summary.status,
          error: null,
          due_users_count: scenario.dueUsers.length,
          budget_cost_usd: scenarioCost.totalCost,
          fetch_diagnostics: globalResult.fetchResult.fetchDiagnostics,
          raw_candidates: globalResult.fetchResult.allItems.map((item) => serializeItem(item)),
          cleaned_candidates: globalResult.cleanedAnnotated.map((item) => serializeItem(item)),
          global_selected_items: globalResult.enrichResult.enriched.map((item) => serializeItem(item)),
          storyline_pool_items: globalResult.storylinePool.map((item) => serializeItem(item)),
          global_rejections: globalResult.rejected.map((row) => serializeItem(row.item, { stage_reason: row.reason })),
          clusters: globalResult.clusters.map((cluster) => ({
            storyline_id: cluster.storyline_id,
            canonical_headline: cluster.canonical_headline,
            representative: serializeItem(cluster.representative || {}),
            items: (Array.isArray(cluster.items) ? cluster.items : []).map((item) => serializeItem(item, {
              stage_reason: item?.suppressed_by_preferred_source
                ? "storyline_preferred_substitute"
                : item?.suppressed_by_derivative_source
                  ? "storyline_derivative_suppressed"
                  : null,
              weak_source: false,
            })),
          })),
          summary,
          persona_results: personaResults,
        };
        runRecord.scenarios.push(scenarioRecord);
      } catch (error) {
        const message = String(error?.message || error || "scenario failed");
        const partialResult = error?.partialEvalResult && typeof error.partialEvalResult === "object"
          ? error.partialEvalResult
          : null;
        const partialCost = computeScenarioCost(partialResult || {});
        if (partialCost.totalCost > 0) {
          budget = recordBudgetEvent(storage, budget, {
            ts: new Date().toISOString(),
            provider: "eval_scenario_partial_failure",
            purpose: scenario.id,
            cost_usd: partialCost.totalCost,
            standard_fetch_calls: Number(partialResult?.fetchResult?.standardFetchCalls || 0),
            custom_fetch_calls: Number(partialResult?.fetchResult?.customFetchCalls || 0),
            claude_usage: partialResult?.enrichResult?.claudeUsage || null,
            failed: true,
          });
        }
        runRecord.scenarios.push({
          id: scenario.id,
          label: scenario.label,
          status: "failed",
          error: message,
          due_users_count: scenario.dueUsers.length,
          budget_cost_usd: partialCost.totalCost,
          fetch_diagnostics: partialResult?.fetchResult?.fetchDiagnostics || null,
          raw_candidates: (Array.isArray(partialResult?.fetchResult?.allItems) ? partialResult.fetchResult.allItems : []).map((item) => serializeItem(item)),
          cleaned_candidates: (Array.isArray(partialResult?.cleanedAnnotated) ? partialResult.cleanedAnnotated : []).map((item) => serializeItem(item)),
          global_selected_items: (Array.isArray(partialResult?.enrichResult?.enriched) ? partialResult.enrichResult.enriched : []).map((item) => serializeItem(item)),
          storyline_pool_items: (Array.isArray(partialResult?.storylinePool) ? partialResult.storylinePool : []).map((item) => serializeItem(item)),
          global_rejections: (Array.isArray(partialResult?.rejected) ? partialResult.rejected : []).map((row) => serializeItem(row.item, { stage_reason: row.reason })),
          clusters: (Array.isArray(partialResult?.clusters) ? partialResult.clusters : []).map((cluster) => ({
            storyline_id: cluster.storyline_id,
            canonical_headline: cluster.canonical_headline,
            representative: serializeItem(cluster.representative || {}),
            items: (Array.isArray(cluster.items) ? cluster.items : []).map((item) => serializeItem(item)),
          })),
          summary: {
            scenario_id: scenario.id,
            label: scenario.label,
            status: "failed",
            persona_count: scenario.personaCount,
            failed_persona_count: scenario.personaCount,
            reason_counts: {
              scenario_failed: 1,
            },
            raw_candidate_count: Math.max(0, Number(partialResult?.fetchResult?.allItems?.length || 0)),
            cleaned_candidate_count: Math.max(0, Number(partialResult?.cleanedAnnotated?.length || 0)),
            average_fill_rate: 0,
            recommendations: [
              `Scenario failed before final selection: ${message}`,
            ],
            average_final_score: 0,
            average_final_freshness: 0,
          },
          persona_results: [],
        });
        runRecord.recommendations.push(`Scenario ${scenario.id} failed: ${message}`);
      }
      runRecord.budget = cloneJson(budget);
      storage.saveRun(runRecord);
    }

    runRecord.manual_review_queue = buildManualReviewQueue(allPersonaResults, Number(options.manualReviewSampleCount || DEFAULT_MANUAL_REVIEW_SAMPLE_COUNT));
    runRecord.weak_topic_artifacts = services?.dataRuntime && services?.preferredSourceRegistryRuntime
      ? await buildWeakTopicArtifacts(services, runRecord.scenarios)
      : {
        grid_infrastructure_comparison: null,
        source_family_audit: [],
      };
    runRecord.overall_summary = buildOverallSummary(runRecord.scenarios, allPersonaResults);
    runRecord.recommendations = Array.from(new Set([
      ...(Array.isArray(runRecord.recommendations) ? runRecord.recommendations : []),
      ...runRecord.scenarios.flatMap((scenario) => scenario.summary?.recommendations || []),
    ]));
    runRecord.completed_at = new Date().toISOString();
    runRecord.status = runRecord.scenarios.some((scenario) => scenario?.status === "failed")
      || runRecord.scenarios.some((scenario) => scenario?.status === "completed_with_errors")
      ? "completed_with_errors"
      : "completed";
    runRecord.budget = cloneJson(budget);
    storage.saveRun(runRecord);
    storage.clearActiveRun();
    return runRecord;
  } catch (error) {
    runRecord.completed_at = new Date().toISOString();
    runRecord.status = "failed";
    runRecord.error = String(error?.message || error);
    runRecord.budget = cloneJson(storage.loadBudget());
    storage.saveRun(runRecord);
    storage.saveActiveRun({
      run_id: runId,
      status: "failed",
      started_at: runRecord.started_at,
      completed_at: runRecord.completed_at,
      error: runRecord.error,
    });
    throw error;
  } finally {
    setLearnedDomainAdjustments(null);
    setPreferredSourceRegistry(null);
    setAdminSourceRegistry(null);
  }
}

module.exports = {
  budgetGuardStatus,
  buildGlobalSelection,
  buildScenarioEstimate,
  buildTopicGapAudit,
  classifyTopicGapAudit,
  computeScenarioCost,
  computePersonaRawBaseline,
  createEvalServices,
  ensureBudgetCanAfford,
  resolveEvalSelectionTarget,
  runRetrievalEval,
  serializeItem,
};
