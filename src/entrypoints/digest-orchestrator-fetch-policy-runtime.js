"use strict";

const { getPerplexityMaxConcurrentFetchesOverride } = require("../runtime/config-provider");
const { PERPLEXITY_PROVIDER_DEFAULTS } = require("../platform/config/provider-defaults");
const {
  summarizeAnnotatedTrustMix,
} = require("./digest-orchestrator-fetch-diagnostics-runtime");

function uniqueValues(values = []) {
  return Array.from(new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  ));
}

function toBoundedInt(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.trunc(parsed);
  if (normalized < min) return min;
  if (normalized > max) return max;
  return normalized;
}

function resolveFetchConcurrency(digestConfig) {
  const configured = digestConfig?.providerResilience?.perplexity?.maxConcurrentFetches;
  return toBoundedInt(
    getPerplexityMaxConcurrentFetchesOverride() || configured,
    PERPLEXITY_PROVIDER_DEFAULTS.maxConcurrentFetches,
    { min: 1, max: 24 }
  );
}

function markBudgetStop(budgetTracker, reason) {
  if (!budgetTracker || !reason) return;
  if (!budgetTracker.stop_reason) budgetTracker.stop_reason = reason;
  budgetTracker.exhausted = true;
}

function canReceiveAdditionalRetry(state, isFetchedItemEligible) {
  if (!state || state.retryBlockReason === "repeat") return false;
  if (Number(state.zeroYieldRetryStreak || 0) >= 2) return false;
  if (state.retryBlockReason === "topic_fit" && !hasWeakPreferredConversion(state, isFetchedItemEligible)) return false;
  return countUsableItems(state.items, isFetchedItemEligible) < 2;
}

function hasWeakPreferredConversion(state, isFetchedItemEligible) {
  if (!state) return false;
  if (Number(state?.preferredCallsMade || 0) <= 0) return false;
  if (Number(state?.nextBroadQueryIndex || 0) >= Number(state?.topic?.queries?.length || 0)) return false;
  const usableCount = countUsableItems(state?.items, isFetchedItemEligible);
  const providerArticleCount = Number(state?.conversionFunnel?.provider_url_shape_counts?.article_url || 0);
  const providerListingCount = Number(state?.conversionFunnel?.provider_url_shape_counts?.listing_page || 0)
    + Number(state?.conversionFunnel?.provider_url_shape_counts?.tag_page || 0)
    + Number(state?.conversionFunnel?.provider_url_shape_counts?.search_page || 0)
    + Number(state?.conversionFunnel?.provider_url_shape_counts?.homepage || 0);
  const staleCount = Number(state?.conversionFunnel?.stale_item_count || 0);
  const evidenceRetainedCount = Number(state?.conversionFunnel?.search_evidence_retained_count || 0);
  return usableCount < 2
    || (providerArticleCount <= 0 && evidenceRetainedCount <= 0)
    || providerListingCount > providerArticleCount
    || staleCount > 0;
}

function countUsableItems(items, isFetchedItemEligible) {
  return (Array.isArray(items) ? items : []).filter((item) => isFetchedItemEligible(item)).length;
}

function hasBlockingProviderFailure(state) {
  const failedCalls = Math.max(0, Number(state?.provider?.failed_calls || 0));
  const rateLimitedCalls = Math.max(0, countStatusCode(state, 429));
  return Number(state?.provider?.transport_errors || 0) > 0
    || Math.max(0, failedCalls - rateLimitedCalls) > 0;
}

function countStatusCode(state, statusCode) {
  return Math.max(0, Number(state?.provider?.status_counts?.[statusCode] || 0));
}

function shouldPreferBroadFallbackRetry(state, isFetchedItemEligible) {
  if (Number(state?.nextBroadQueryIndex || 0) >= Number(state?.topic?.queries?.length || 0)) return false;
  return countUsableItems(state?.items, isFetchedItemEligible) <= 0
    || hasWeakPreferredConversion(state, isFetchedItemEligible);
}

function needsStandardTrustedSourcePass(state, annotateFetchedItems, isFetchedItemEligible) {
  if (!state) return false;
  if (!Array.isArray(state?.trustedFamilyQueue) || Number(state?.nextTrustedFamilyIndex || 0) >= state.trustedFamilyQueue.length) {
    return false;
  }
  if (hasBlockingProviderFailure(state)) return false;
  const usableCount = countUsableItems(state?.items, isFetchedItemEligible);
  if (usableCount < 2) return true;
  return summarizeAnnotatedTrustMix(state?.items, annotateFetchedItems, isFetchedItemEligible).review_heavy === true;
}

function resolveBatchConcurrency(batchName, jobCount, budgetTracker, maxFetchConcurrency) {
  const batch = String(batchName || "").trim().toLowerCase();
  let limit = Math.max(1, Number(maxFetchConcurrency || 1));
  if (batch.startsWith("custom:")) limit = Math.min(limit, 2);
  if (batch === "standard:phase1" && Number(jobCount || 0) >= 10) limit = Math.min(limit, 3);
  const backoffLevel = Math.max(0, Number(budgetTracker?.rate_limit_backoff_level || 0));
  if (backoffLevel > 0) {
    limit = Math.max(1, limit - backoffLevel);
    if (batch.startsWith("custom:")) limit = 1;
  }
  return Math.max(1, Math.min(limit, Number(jobCount || 0) || 1));
}

function buildPreferredInvocation(state, queryIndex, { countsAsRetry = false, maxAgeHours = 48 } = {}) {
  const query = Array.isArray(state?.topic?.queries) ? state.topic.queries[queryIndex] : "";
  if (!query) return null;
  return {
    phase: "preferred",
    queryIndex,
    countsAsRetry,
    broadFallback: false,
    topic: {
      ...state.topic,
      queries: [query],
    },
    opts: {
      maxAgeHours,
      retrievalPlan: {
        preferred_domains: Array.isArray(state.preferredDomains) ? state.preferredDomains.slice() : [],
        reported_domains: Array.isArray(state.reportedDomains) ? state.reportedDomains.slice() : [],
        official_domains: Array.isArray(state.officialDomains) ? state.officialDomains.slice() : [],
        thin_item_threshold: 2,
        official_friendly: state.officialFriendly === true,
        topic_keys: Array.isArray(state.topicKeys) ? state.topicKeys.slice() : [],
        allow_broad_fallback: false,
      },
    },
  };
}

function buildBroadInvocation(state, queryIndex, { countsAsRetry = false, broadFallback = false, maxAgeHours = 48 } = {}) {
  const query = Array.isArray(state?.topic?.queries) ? state.topic.queries[queryIndex] : "";
  if (!query) return null;
  return {
    phase: "broad",
    queryIndex,
    countsAsRetry,
    broadFallback,
    topic: {
      ...state.topic,
      queries: [query],
    },
    opts: {
      maxAgeHours,
      retrievalPlan: {
        preferred_domains: Array.isArray(state.preferredDomains) ? state.preferredDomains.slice() : [],
        reported_domains: Array.isArray(state.reportedDomains) ? state.reportedDomains.slice() : [],
        official_domains: Array.isArray(state.officialDomains) ? state.officialDomains.slice() : [],
        thin_item_threshold: 2,
        official_friendly: state.officialFriendly === true,
        topic_keys: Array.isArray(state.topicKeys) ? state.topicKeys.slice() : [],
        broad_only: true,
      },
    },
  };
}

function buildTrustedFamilyInvocation(state, { countsAsRetry = true, maxAgeHours = 48 } = {}) {
  const family = Array.isArray(state?.trustedFamilyQueue)
    ? state.trustedFamilyQueue[Number(state?.nextTrustedFamilyIndex || 0)]
    : null;
  const query = Array.isArray(state?.topic?.queries) ? state.topic.queries[0] : "";
  if (!family || !query) return null;
  return {
    phase: "trusted",
    queryIndex: 0,
    countsAsRetry,
    broadFallback: false,
    trustedFamilyName: family.name,
    topic: {
      ...state.topic,
      queries: [query],
    },
    opts: {
      maxAgeHours,
      retrievalPlan: {
        preferred_domains: Array.isArray(family.domains) ? family.domains.slice() : [],
        reported_domains: Array.isArray(state.reportedDomains) ? state.reportedDomains.slice() : [],
        official_domains: Array.isArray(state.officialDomains) ? state.officialDomains.slice() : [],
        thin_item_threshold: 1,
        official_friendly: family.official_friendly === true,
        topic_keys: Array.isArray(state.topicKeys) ? state.topicKeys.slice() : [],
        allow_broad_fallback: false,
        trusted_source_second_pass: true,
        trusted_source_family: String(family.name || "").trim() || "reported",
      },
    },
  };
}

module.exports = {
  buildBroadInvocation,
  buildPreferredInvocation,
  buildTrustedFamilyInvocation,
  canReceiveAdditionalRetry,
  hasBlockingProviderFailure,
  hasWeakPreferredConversion,
  markBudgetStop,
  needsStandardTrustedSourcePass,
  resolveBatchConcurrency,
  resolveFetchConcurrency,
  shouldPreferBroadFallbackRetry,
  toBoundedInt,
  uniqueValues,
};
