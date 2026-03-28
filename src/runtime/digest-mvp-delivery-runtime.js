"use strict";

const DELIVERY_POLICY = Object.freeze({
  target_item_count: 5,
  candidate_pool_target_count: 7,
});

const TRANSIENT_FAILURE_CLASSES = Object.freeze(new Set(["transient"]));

function isRetryEligibleFailureClass(failureClass) {
  return TRANSIENT_FAILURE_CLASSES.has(String(failureClass || "").trim());
}

function computeRetryDelayMinutes(failureClass, latestSafeDelayMinutes) {
  const safeDelay = Math.max(0, Number(latestSafeDelayMinutes || 0));
  if (safeDelay < 5) return null;
  if (failureClass === "transient") return Math.min(10, safeDelay);
  if (failureClass === "ranking_policy_limited") return Math.min(15, safeDelay);
  return Math.min(25, safeDelay);
}

function classifyRetryFailureClass(params = {}) {
  const diagnostics = params.diagnostics && typeof params.diagnostics === "object" ? params.diagnostics : {};
  if (Number(diagnostics.provider_429_count || 0) > 0 || Number(diagnostics.transport_errors || 0) > 0 || diagnostics.provider_degraded === true) {
    return "transient";
  }
  if (Number(params.availableCandidateCount || 0) <= 0 || diagnostics.thin_pool === true) {
    return "retrieval_thin";
  }
  return "ranking_policy_limited";
}

function deriveInternalThinnessLabel(params = {}) {
  const availableCount = Math.max(0, Number(params.availableCandidateCount || 0));
  const strongCount = Math.max(0, Number(params.highConfidenceAvailableCount || 0));
  if (availableCount > 0 && availableCount < DELIVERY_POLICY.target_item_count && strongCount === availableCount) {
    return "healthy_thin_internal";
  }
  if (availableCount > 0 && strongCount >= Math.min(3, availableCount)) {
    return "healthy_thin_internal";
  }
  return "product_underdelivery";
}

function selectTopicBuckets(items, subscribedTopics, itemsPerTopic = 5) {
  const topicSet = new Set(Array.isArray(subscribedTopics) ? subscribedTopics : []);
  const buckets = {};
  for (const topic of topicSet) buckets[topic] = [];
  for (const item of (Array.isArray(items) ? items : [])) {
    const tag = String(item?.tag || "").trim();
    if (!topicSet.has(tag)) continue;
    buckets[tag].push(item);
  }
  for (const topic of Object.keys(buckets)) {
    buckets[topic] = buckets[topic]
      .sort((a, b) => {
        const aScore = Number(a?.relevanceScore ?? a?._score ?? a?.baseScore ?? 0);
        const bScore = Number(b?.relevanceScore ?? b?._score ?? b?.baseScore ?? 0);
        return bScore - aScore;
      })
      .slice(0, itemsPerTopic);
  }
  return buckets;
}

module.exports = {
  DELIVERY_POLICY,
  TRANSIENT_FAILURE_CLASSES,
  classifyRetryFailureClass,
  computeRetryDelayMinutes,
  deriveInternalThinnessLabel,
  isRetryEligibleFailureClass,
  selectTopicBuckets,
};
