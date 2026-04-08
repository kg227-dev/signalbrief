"use strict";

const { scoreCandidate } = require("../domains/scoring/score-candidate");
const {
  createConversionFunnel,
  mergeConversionFunnel,
} = require("../digest/runtime/digest-data-fetch-items-runtime");
const {
  annotateItemsForFetch,
  buildStateCandidateInventory,
  isDiscoverySupplementItem,
  matchesDomain,
} = require("./digest-orchestrator-fetch-state-runtime");

function mergeStatusCounts(target, source) {
  const out = target && typeof target === "object" ? target : {};
  if (!source || typeof source !== "object") return out;
  for (const [code, count] of Object.entries(source)) {
    const normalizedCount = Number(count);
    if (!Number.isFinite(normalizedCount) || normalizedCount <= 0) continue;
    out[code] = (out[code] || 0) + normalizedCount;
  }
  return out;
}

function countUsableItems(items, isFetchedItemEligible) {
  const eligibilityFn = typeof isFetchedItemEligible === "function"
    ? isFetchedItemEligible
    : () => true;
  return (Array.isArray(items) ? items : []).reduce((sum, item) => {
    return sum + (eligibilityFn(item) !== false ? 1 : 0);
  }, 0);
}

function resolveMaxDiscoveryCandidateShare(digestConfig) {
  const configured = Number(digestConfig?.maxDiscoveryCandidateShare ?? 0.2);
  if (!Number.isFinite(configured)) return 0.2;
  return Math.max(0, Math.min(1, configured));
}

function resolveDiscoveryCandidateCapCount(backboneCount, maxShare) {
  const normalizedBackboneCount = Math.max(0, Number(backboneCount || 0));
  const normalizedMaxShare = Math.max(0, Math.min(1, Number(maxShare || 0)));
  if (normalizedMaxShare >= 1) return Number.MAX_SAFE_INTEGER;
  if (normalizedBackboneCount <= 0 || normalizedMaxShare <= 0) return 0;
  return Math.max(0, Math.floor((normalizedBackboneCount * normalizedMaxShare) / (1 - normalizedMaxShare)));
}

function parsePublishedDateForSort(item) {
  const value = Date.parse(String(item?.published_date || item?.publishedDate || item?.date || item?.timestamp || ""));
  return Number.isFinite(value) ? value : 0;
}

function enforceDiscoveryCandidateShare(states, digestConfig, logger = () => {}) {
  const topicStates = Array.isArray(states) ? states : [];
  const maxDiscoveryShare = resolveMaxDiscoveryCandidateShare(digestConfig);
  let brokerCandidateCount = 0;
  const discoveryEntries = [];
  for (const state of topicStates) {
    state.discoveryCappedItemCount = 0;
    for (const item of (Array.isArray(state?.items) ? state.items : [])) {
      if (isDiscoverySupplementItem(item)) {
        discoveryEntries.push({ state, item });
      } else {
        brokerCandidateCount += 1;
      }
    }
  }

  const discoveryCandidateCountBefore = discoveryEntries.length;
  const allowedDiscoveryCandidateCount = resolveDiscoveryCandidateCapCount(brokerCandidateCount, maxDiscoveryShare);
  if (discoveryCandidateCountBefore <= allowedDiscoveryCandidateCount) {
    const totalCandidateCount = brokerCandidateCount + discoveryCandidateCountBefore;
    return {
      broker_candidate_count: brokerCandidateCount,
      discovery_candidate_count_before: discoveryCandidateCountBefore,
      discovery_candidate_count_after: discoveryCandidateCountBefore,
      discovery_candidate_cap_count: allowedDiscoveryCandidateCount,
      discovery_candidate_capped_count: 0,
      discovery_candidate_share_pct: totalCandidateCount > 0
        ? Number(((discoveryCandidateCountBefore / totalCandidateCount) * 100).toFixed(2))
        : 0,
      max_discovery_candidate_share_pct: Number((maxDiscoveryShare * 100).toFixed(2)),
    };
  }

  const nowMs = Date.now();
  const scoredEntries = discoveryEntries.map((entry, index) => {
    const scored = scoreCandidate(entry.item, {
      scoringConfig: digestConfig?.scoring || {},
      nowMs,
    });
    return {
      ...entry,
      index,
      score: Number(scored?._score || 0),
      publishedMs: parsePublishedDateForSort(entry.item),
      sourceAuthority: Number(entry.item?.source_authority || 0),
    };
  });
  scoredEntries.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    if (right.sourceAuthority !== left.sourceAuthority) return right.sourceAuthority - left.sourceAuthority;
    if (right.publishedMs !== left.publishedMs) return right.publishedMs - left.publishedMs;
    return left.index - right.index;
  });

  const retainedDiscoveryItems = new Set(
    scoredEntries.slice(0, allowedDiscoveryCandidateCount).map((entry) => entry.item)
  );

  for (const state of topicStates) {
    const keptItems = [];
    let removedForState = 0;
    for (const item of (Array.isArray(state?.items) ? state.items : [])) {
      if (!isDiscoverySupplementItem(item) || retainedDiscoveryItems.has(item)) {
        keptItems.push(item);
      } else {
        removedForState += 1;
      }
    }
    state.items = keptItems;
    state.discoveryCappedItemCount = removedForState;
  }

  const discoveryCandidateCountAfter = allowedDiscoveryCandidateCount;
  const totalCandidateCount = brokerCandidateCount + discoveryCandidateCountAfter;
  const discoveryCandidateSharePct = totalCandidateCount > 0
    ? Number(((discoveryCandidateCountAfter / totalCandidateCount) * 100).toFixed(2))
    : 0;
  const discoveryCandidateCappedCount = Math.max(0, discoveryCandidateCountBefore - discoveryCandidateCountAfter);
  logger(
    `Discovery supplement cap retained ${discoveryCandidateCountAfter}/${discoveryCandidateCountBefore} discovery candidate(s) `
    + `(${discoveryCandidateSharePct}% of ${totalCandidateCount} total; target <= ${(maxDiscoveryShare * 100).toFixed(0)}%)`
  );

  return {
    broker_candidate_count: brokerCandidateCount,
    discovery_candidate_count_before: discoveryCandidateCountBefore,
    discovery_candidate_count_after: discoveryCandidateCountAfter,
    discovery_candidate_cap_count: allowedDiscoveryCandidateCount,
    discovery_candidate_capped_count: discoveryCandidateCappedCount,
    discovery_candidate_share_pct: discoveryCandidateSharePct,
    max_discovery_candidate_share_pct: Number((maxDiscoveryShare * 100).toFixed(2)),
  };
}

function normalizeSourceTierForFetch(value) {
  const tier = String(value || "").trim().toLowerCase();
  return tier.startsWith("learned-") ? tier.slice("learned-".length) : tier;
}

function isHighTrustAnnotatedItem(item) {
  const sourcePolicy = String(item?.source_policy || "").trim().toLowerCase();
  const sourceTier = normalizeSourceTierForFetch(item?.source_tier);
  return (sourcePolicy === "preferred" || sourcePolicy === "allowed")
    && (sourceTier === "premium" || sourceTier === "strong" || sourceTier === "standard");
}

function isReviewTierAnnotatedItem(item) {
  const sourcePolicy = String(item?.source_policy || "").trim().toLowerCase();
  const sourceTier = normalizeSourceTierForFetch(item?.source_tier);
  return sourcePolicy === "review"
    || sourceTier === "blog"
    || sourceTier === "weak"
    || sourceTier === "suspect"
    || sourceTier === "unknown"
    || sourceTier === "corporate";
}

function summarizeAnnotatedTrustMix(items, annotateFetchedItems, isFetchedItemEligible) {
  const annotated = annotateItemsForFetch(items, annotateFetchedItems);
  const eligibilityFn = typeof isFetchedItemEligible === "function"
    ? isFetchedItemEligible
    : () => true;
  const eligible = annotated.filter((item) => eligibilityFn(item) !== false);
  const highTrustCount = eligible.reduce((sum, item) => sum + (isHighTrustAnnotatedItem(item) ? 1 : 0), 0);
  const reviewTierCount = eligible.reduce((sum, item) => sum + (isReviewTierAnnotatedItem(item) ? 1 : 0), 0);
  return {
    eligible_count: eligible.length,
    high_trust_count: highTrustCount,
    review_tier_count: reviewTierCount,
    review_heavy: eligible.length > 0
      && highTrustCount <= 0
      && reviewTierCount >= Math.max(1, Math.ceil(eligible.length / 2)),
  };
}

function sortTopicStates(states) {
  return (Array.isArray(states) ? states.slice() : []).sort((left, right) => {
    if (right.priority !== left.priority) return right.priority - left.priority;
    return left.originalIndex - right.originalIndex;
  });
}

function sortRetryStates(states, isFetchedItemEligible) {
  return sortTopicStates(states).sort((left, right) => {
    if (right.priority !== left.priority) return right.priority - left.priority;
    const leftUsable = countUsableItems(left?.items, isFetchedItemEligible);
    const rightUsable = countUsableItems(right?.items, isFetchedItemEligible);
    if (leftUsable !== rightUsable) return leftUsable - rightUsable;
    return left.originalIndex - right.originalIndex;
  });
}

function sortDeepCoverageRetryStates(states, isFetchedItemEligible) {
  return sortTopicStates(states).sort((left, right) => {
    const leftUsable = countUsableItems(left?.items, isFetchedItemEligible);
    const rightUsable = countUsableItems(right?.items, isFetchedItemEligible);
    if (leftUsable !== rightUsable) return leftUsable - rightUsable;
    const leftPreferredHits = Number(left?.preferredSearchResultHitCount || 0);
    const rightPreferredHits = Number(right?.preferredSearchResultHitCount || 0);
    if (rightPreferredHits !== leftPreferredHits) return rightPreferredHits - leftPreferredHits;
    const leftSearchDomainCount = Array.isArray(left?.searchResultDomains) ? left.searchResultDomains.length : 0;
    const rightSearchDomainCount = Array.isArray(right?.searchResultDomains) ? right.searchResultDomains.length : 0;
    if (rightSearchDomainCount !== leftSearchDomainCount) return rightSearchDomainCount - leftSearchDomainCount;
    if (right.priority !== left.priority) return right.priority - left.priority;
    return left.originalIndex - right.originalIndex;
  });
}

function sortTrustedSourceRetryStates(states, annotateFetchedItems, isFetchedItemEligible) {
  return sortTopicStates(states).sort((left, right) => {
    const leftUsable = countUsableItems(left?.items, isFetchedItemEligible);
    const rightUsable = countUsableItems(right?.items, isFetchedItemEligible);
    if (leftUsable !== rightUsable) return leftUsable - rightUsable;
    const leftTrustMix = summarizeAnnotatedTrustMix(left?.items, annotateFetchedItems, isFetchedItemEligible);
    const rightTrustMix = summarizeAnnotatedTrustMix(right?.items, annotateFetchedItems, isFetchedItemEligible);
    if (leftTrustMix.high_trust_count !== rightTrustMix.high_trust_count) {
      return leftTrustMix.high_trust_count - rightTrustMix.high_trust_count;
    }
    if (rightTrustMix.review_tier_count !== leftTrustMix.review_tier_count) {
      return rightTrustMix.review_tier_count - leftTrustMix.review_tier_count;
    }
    if (right.priority !== left.priority) return right.priority - left.priority;
    return left.originalIndex - right.originalIndex;
  });
}

function countScheduledCalls(states) {
  return (Array.isArray(states) ? states : []).reduce((sum, state) => {
    return sum + Number(state?.totalCallsScheduled || 0);
  }, 0);
}

function summarizeProviderDiagnostics(states) {
  const summary = {
    topics: 0,
    degraded_topics: 0,
    failed_calls: 0,
    transport_errors: 0,
    successful_calls: 0,
    status_counts: {},
  };
  for (const state of (Array.isArray(states) ? states : [])) {
    if (Number(state?.totalCallsScheduled || 0) <= 0) continue;
    summary.topics += 1;
    if (state?.provider?.degraded) summary.degraded_topics += 1;
    summary.failed_calls += Number(state?.provider?.failed_calls || 0);
    summary.transport_errors += Number(state?.provider?.transport_errors || 0);
    summary.successful_calls += Number(state?.provider?.successful_calls || 0);
    mergeStatusCounts(summary.status_counts, state?.provider?.status_counts);
  }
  return summary;
}

function classifyBroadDepthStopReason(state, budgetTracker) {
  const remainingBroadQueries = Math.max(0, Number((state?.topic?.queries || []).length || 0) - Number(state?.nextBroadQueryIndex || 0));
  if (remainingBroadQueries <= 0) return null;
  if (state?.broadFallbackUsed !== true) return "broad_fallback_not_started";
  if (Number(state?.provider?.transport_errors || 0) > 0 || Math.max(0, Number(state?.provider?.failed_calls || 0) - Number(state?.provider?.status_counts?.[429] || 0)) > 0) {
    return "provider_failure_blocked";
  }
  if (state?.retryBlockReason === "repeat") return "retry_guard_repeat";
  if (state?.retryBlockReason === "topic_fit") return "retry_guard_zero_yield";
  if (budgetTracker?.stop_reason === "hard_cap_reached") return "global_search_budget_hard_cap";
  if (budgetTracker?.stop_reason === "soft_cap_reached") return "global_search_budget_soft_cap";
  return "unscheduled_remaining_queries";
}

function countPreferredItems(state) {
  const preferredDomains = Array.isArray(state?.preferredDomains) ? state.preferredDomains : [];
  if (preferredDomains.length === 0) return 0;
  return (Array.isArray(state?.items) ? state.items : []).reduce((sum, item) => {
    const matches = preferredDomains.some((candidate) => matchesDomain(
      item?.source_domain || item?.source || item?.url,
      candidate
    ));
    return sum + (matches ? 1 : 0);
  }, 0);
}

function countStatusCode(state, statusCode) {
  return Number(state?.provider?.status_counts?.[statusCode] || 0);
}

function classifyTopicCoverage(state) {
  const usableCount = countUsableItems(state?.items, () => true);
  const hasProviderFailure = Number(state?.provider?.failed_calls || 0) > 0
    || Number(state?.provider?.transport_errors || 0) > 0
    || countStatusCode(state, 429) > 0;
  if (usableCount >= 2) return "covered";
  if (usableCount === 1) return hasProviderFailure ? "provider_limited_thin" : "thin";
  if (hasProviderFailure) return "provider_limited_zero";
  return "zero_yield";
}

function buildFetchDiagnostics(states, budgetTracker, maxFetchConcurrency, brokerDiagnostics, options = {}) {
  const attemptedStates = (Array.isArray(states) ? states : []).filter((state) => Number(state?.totalCallsScheduled || 0) > 0);
  const preferredDomainsUsed = Array.from(new Set(attemptedStates.flatMap((state) => state.preferredDomains || []).map((value) => String(value || "").trim()).filter(Boolean)));
  const searchResultDomains = Array.from(new Set(attemptedStates.flatMap((state) => state.searchResultDomains || []).map((value) => String(value || "").trim()).filter(Boolean)));
  const preferredSearchResultDomains = Array.from(new Set(attemptedStates.flatMap((state) => state.preferredSearchResultDomains || []).map((value) => String(value || "").trim()).filter(Boolean)));
  const preferredCandidateCount = attemptedStates.reduce((sum, state) => sum + countPreferredItems(state), 0);
  const totalItems = attemptedStates.reduce((sum, state) => sum + (Array.isArray(state?.items) ? state.items.length : 0), 0);
  const totalProviderCalls = attemptedStates.reduce((sum, state) => {
    return sum + Number(state?.provider?.successful_calls || 0) + Number(state?.provider?.failed_calls || 0);
  }, 0);
  const provider429Count = attemptedStates.reduce((sum, state) => sum + countStatusCode(state, 429), 0);
  const retrievalLimitedTopicCount = attemptedStates.filter((state) => {
    return classifyTopicCoverage(state).startsWith("provider_limited");
  }).length;
  const thinTopicCount = attemptedStates.filter((state) => classifyTopicCoverage(state).includes("thin")).length;
  const attemptedInventories = attemptedStates.map((state) => ({
    state,
    inventory: buildStateCandidateInventory(state),
  }));
  const retrievalOriginCounts = attemptedInventories.reduce((combined, { inventory }) => ({
    preferred: Number(combined.preferred || 0) + Number(inventory?.retrievalOriginCounts?.preferred || 0),
    broad: Number(combined.broad || 0) + Number(inventory?.retrievalOriginCounts?.broad || 0),
    trusted_official: Number(combined.trusted_official || 0) + Number(inventory?.retrievalOriginCounts?.trusted_official || 0),
    trusted_reported: Number(combined.trusted_reported || 0) + Number(inventory?.retrievalOriginCounts?.trusted_reported || 0),
    broker_official: Number(combined.broker_official || 0) + Number(inventory?.retrievalOriginCounts?.broker_official || 0),
    broker_publisher_feed: Number(combined.broker_publisher_feed || 0) + Number(inventory?.retrievalOriginCounts?.broker_publisher_feed || 0),
  }), {
    preferred: 0,
    broad: 0,
    trusted_official: 0,
    trusted_reported: 0,
    broker_official: 0,
    broker_publisher_feed: 0,
  });
  const retrievalSourceFamilyCounts = attemptedInventories.reduce((combined, { inventory }) => ({
    official: Number(combined.official || 0) + Number(inventory?.retrievalSourceFamilyCounts?.official || 0),
    reported: Number(combined.reported || 0) + Number(inventory?.retrievalSourceFamilyCounts?.reported || 0),
    specialist: Number(combined.specialist || 0) + Number(inventory?.retrievalSourceFamilyCounts?.specialist || 0),
    corporate: Number(combined.corporate || 0) + Number(inventory?.retrievalSourceFamilyCounts?.corporate || 0),
    other_unknown: Number(combined.other_unknown || 0) + Number(inventory?.retrievalSourceFamilyCounts?.other_unknown || 0),
  }), {
    official: 0,
    reported: 0,
    specialist: 0,
    corporate: 0,
    other_unknown: 0,
  });
  const brokerCandidateCount = attemptedInventories.reduce((sum, { inventory }) => sum + Number(inventory?.brokerItemCount || 0), 0);
  const discoveryCandidateCount = attemptedInventories.reduce((sum, { inventory }) => sum + Number(inventory?.discoveryItemCount || 0), 0);
  const discoveryCandidateCappedCount = attemptedStates.reduce((sum, state) => {
    return sum + Math.max(0, Number(state?.discoveryCappedItemCount || 0));
  }, 0);
  const conversionFunnel = attemptedStates.reduce((combined, state) => {
    return mergeConversionFunnel(combined, state?.conversionFunnel);
  }, createConversionFunnel());
  const topicDiagnostics = attemptedInventories.map(({ state, inventory }) => ({
    tag: state?.topic?.tag || null,
    preferred_topic_hints: Array.isArray(state?.topic?.preferred_topic_hints) ? state.topic.preferred_topic_hints.slice() : [],
    query_count: Array.isArray(state?.topic?.queries) ? state.topic.queries.length : 0,
    unique_item_count: Array.isArray(state?.items) ? state.items.length : 0,
    usable_item_count: countUsableItems(state?.items, () => true),
    preferred_domains: Array.isArray(state?.preferredDomains) ? state.preferredDomains.slice() : [],
    preferred_item_count: countPreferredItems(state),
    preferred_call_count: Number(state?.preferredCallsMade || 0),
    broad_call_count: Number(state?.broadCallsMade || 0),
    trusted_source_call_count: Number(state?.trustedFamilyCallsMade || 0),
    trusted_official_call_count: Number(state?.trustedOfficialCallsMade || 0),
    trusted_reported_call_count: Number(state?.trustedReportedCallsMade || 0),
    broker_item_count: Number(inventory?.brokerItemCount || 0),
    broker_official_item_count: Number(inventory?.brokerOfficialItemCount || 0),
    broker_publisher_feed_item_count: Number(inventory?.brokerPublisherFeedItemCount || 0),
    discovery_item_count: Number(inventory?.discoveryItemCount || 0),
    discovery_capped_count: Math.max(0, Number(state?.discoveryCappedItemCount || 0)),
    discovery_candidate_share_pct: Number(inventory?.discoveryCandidateSharePct || 0),
    broker_candidate_share_pct: Number(inventory?.brokerCandidateSharePct || 0),
    broker_source_ids: Array.isArray(inventory?.brokerSourceIds) ? inventory.brokerSourceIds.slice() : [],
    retrieval_origin_counts: { ...(inventory?.retrievalOriginCounts || {}) },
    retrieval_source_family_counts: { ...(inventory?.retrievalSourceFamilyCounts || {}) },
    next_preferred_query_index: Number(state?.nextPreferredQueryIndex || 0),
    next_broad_query_index: Number(state?.nextBroadQueryIndex || 0),
    next_trusted_family_index: Number(state?.nextTrustedFamilyIndex || 0),
    remaining_preferred_queries: Math.max(0, Number((state?.topic?.queries || []).length || 0) - Number(state?.nextPreferredQueryIndex || 0)),
    remaining_broad_queries: Math.max(0, Number((state?.topic?.queries || []).length || 0) - Number(state?.nextBroadQueryIndex || 0)),
    broad_depth_stop_reason: classifyBroadDepthStopReason(state, budgetTracker),
    remaining_trusted_source_families: Math.max(0, Number((state?.trustedFamilyQueue || []).length || 0) - Number(state?.nextTrustedFamilyIndex || 0)),
    official_domains: Array.isArray(state?.officialDomains) ? state.officialDomains.slice() : [],
    reported_domains: Array.isArray(state?.reportedDomains) ? state.reportedDomains.slice() : [],
    total_calls_scheduled: Number(state?.totalCallsScheduled || 0),
    status_counts: { ...(state?.provider?.status_counts || {}) },
    failed_calls: Number(state?.provider?.failed_calls || 0),
    transport_errors: Number(state?.provider?.transport_errors || 0),
    degraded: state?.provider?.degraded === true,
    last_error: String(state?.provider?.last_error || "").trim() || null,
    coverage_status: classifyTopicCoverage(state),
    search_result_domains: Array.isArray(state?.searchResultDomains) ? state.searchResultDomains.slice() : [],
    preferred_search_result_domains: Array.isArray(state?.preferredSearchResultDomains) ? state.preferredSearchResultDomains.slice() : [],
    preferred_search_result_hit_count: Number(state?.preferredSearchResultHitCount || 0),
    conversion_funnel: mergeConversionFunnel(createConversionFunnel(), state?.conversionFunnel),
  }));
  const resolvedMaxFetchConcurrency = Math.max(
    1,
    Number(maxFetchConcurrency || options.defaultMaxFetchConcurrency || 1)
  );

  return {
    alternate_queries_used: attemptedStates.reduce((sum, state) => sum + Math.max(0, Number(state?.totalCallsScheduled || 0) - 1), 0),
    preferred_domains_used: preferredDomainsUsed,
    preferred_fallback_triggered: attemptedStates.some((state) => state.broadFallbackUsed === true && (state.preferredDomains || []).length > 0),
    preferred_pass_item_count: attemptedStates.reduce((sum, state) => sum + Number(state?.preferredPassItemCount || 0), 0),
    broad_pass_item_count: attemptedStates.reduce((sum, state) => sum + Number(state?.broadPassItemCount || 0), 0),
    preferred_domains_count: attemptedStates.reduce((sum, state) => sum + Number((state?.preferredDomains || []).length), 0),
    preferred_candidate_count: preferredCandidateCount,
    non_preferred_candidate_count: Math.max(0, totalItems - preferredCandidateCount),
    broker_candidate_count: brokerCandidateCount,
    discovery_candidate_count: discoveryCandidateCount,
    discovery_candidate_share_pct: totalItems > 0 ? Number(((discoveryCandidateCount / totalItems) * 100).toFixed(2)) : 0,
    broker_candidate_share_pct: totalItems > 0 ? Number(((brokerCandidateCount / totalItems) * 100).toFixed(2)) : 0,
    discovery_candidate_capped_count: discoveryCandidateCappedCount,
    final_selected_preferred_count: 0,
    preferred_displaced_weak_count: 0,
    search_result_domains: searchResultDomains,
    preferred_search_result_domains: preferredSearchResultDomains,
    preferred_search_result_hit_count: attemptedStates.reduce((sum, state) => sum + Number(state?.preferredSearchResultHitCount || 0), 0),
    preferred_search_results_without_preferred_item_count: attemptedStates.reduce((sum, state) => {
      return sum + ((state?.preferredSearchResultDomains || []).length > 0 && countPreferredItems(state) === 0 ? 1 : 0);
    }, 0),
    search_budget_soft_calls: Number(budgetTracker?.soft_calls || 0),
    search_budget_hard_calls: Number(budgetTracker?.hard_calls || 0),
    search_budget_calls_used: Number(budgetTracker?.calls_used || 0),
    search_budget_exhausted: budgetTracker?.exhausted === true,
    broad_fallback_topics_used: attemptedStates.reduce((sum, state) => sum + (state?.broadFallbackUsed === true ? 1 : 0), 0),
    deep_broad_retry_topics_used: attemptedStates.reduce((sum, state) => sum + (Number(state?.broadCallsMade || 0) > 1 ? 1 : 0), 0),
    trusted_source_second_pass_topics_used: attemptedStates.reduce((sum, state) => sum + (Number(state?.trustedFamilyCallsMade || 0) > 0 ? 1 : 0), 0),
    trusted_source_call_count: attemptedStates.reduce((sum, state) => sum + Number(state?.trustedFamilyCallsMade || 0), 0),
    trusted_official_call_count: attemptedStates.reduce((sum, state) => sum + Number(state?.trustedOfficialCallsMade || 0), 0),
    trusted_reported_call_count: attemptedStates.reduce((sum, state) => sum + Number(state?.trustedReportedCallsMade || 0), 0),
    retrieval_origin_counts: retrievalOriginCounts,
    retrieval_source_family_counts: retrievalSourceFamilyCounts,
    conversion_funnel: conversionFunnel,
    standard_topic_broker: brokerDiagnostics && typeof brokerDiagnostics === "object"
      ? {
        enabled: brokerDiagnostics.enabled === true,
        config_source: brokerDiagnostics.config_source || "none",
        active_path: brokerDiagnostics.active_path || null,
        active_topic_tags: Array.isArray(brokerDiagnostics.active_topic_tags) ? brokerDiagnostics.active_topic_tags.slice() : [],
        lane_counts: { ...(brokerDiagnostics.lane_counts || {}) },
        source_fetch_count: Number(brokerDiagnostics.source_fetch_count || 0),
        source_success_count: Number(brokerDiagnostics.source_success_count || 0),
        source_failure_count: Number(brokerDiagnostics.source_failure_count || 0),
        source_diagnostics: Array.isArray(brokerDiagnostics.source_diagnostics) ? brokerDiagnostics.source_diagnostics.slice() : [],
        topic_diagnostics: Array.isArray(brokerDiagnostics.topic_diagnostics)
          ? brokerDiagnostics.topic_diagnostics.slice()
          : Object.values(brokerDiagnostics.topic_diagnostics || {}),
      }
      : {
        enabled: false,
        config_source: "none",
        active_path: null,
        active_topic_tags: [],
        lane_counts: { publisher_feed: 0, official: 0 },
        source_fetch_count: 0,
        source_success_count: 0,
        source_failure_count: 0,
        source_diagnostics: [],
        topic_diagnostics: [],
      },
    zero_yield_retry_count: attemptedStates.reduce((sum, state) => sum + Number(state?.zeroYieldRetryCount || 0), 0),
    budget_stop_reason: String(budgetTracker?.stop_reason || "").trim() || null,
    max_concurrent_fetches: resolvedMaxFetchConcurrency,
    rate_limit_cooldown_ms: Number(budgetTracker?.rate_limit_cooldown_ms || 0),
    provider_429_count: provider429Count,
    provider_429_rate: totalProviderCalls > 0 ? Number(((provider429Count / totalProviderCalls) * 100).toFixed(2)) : 0,
    degraded_topic_rate: attemptedStates.length > 0
      ? Number(((attemptedStates.filter((state) => state?.provider?.degraded === true).length / attemptedStates.length) * 100).toFixed(2))
      : 0,
    retrieval_limited_topic_count: retrievalLimitedTopicCount,
    thin_topic_count: thinTopicCount,
    topic_diagnostics: topicDiagnostics,
  };
}

module.exports = {
  annotateItemsForFetch,
  mergeStatusCounts,
  countUsableItems,
  resolveMaxDiscoveryCandidateShare,
  resolveDiscoveryCandidateCapCount,
  enforceDiscoveryCandidateShare,
  summarizeAnnotatedTrustMix,
  sortTopicStates,
  sortRetryStates,
  sortDeepCoverageRetryStates,
  sortTrustedSourceRetryStates,
  countScheduledCalls,
  summarizeProviderDiagnostics,
  countStatusCode,
  buildFetchDiagnostics,
};
