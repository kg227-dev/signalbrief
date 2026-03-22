"use strict";

const {
  customKeywordMatches,
  getCustomTopicMetadata: getTopicMetadata,
  normalizeTopicToken,
} = require("../digest/domain/topic-domain-runtime");
const {
  isWeakSourceItem,
} = require("../digest/domain/storyline-domain-runtime");

const DELIVERY_POLICY = Object.freeze({
  target_item_count: 5,
  candidate_pool_target_count: 7,
  first_attempt: Object.freeze({
    min_high_confidence: 4,
    max_lower_confidence: 1,
  }),
  retry_attempt: Object.freeze({
    min_high_confidence: 3,
    max_lower_confidence: 2,
  }),
  lower_confidence_cap: Object.freeze({
    rolling_days: 7,
    max_assisted_digests: 2,
  }),
  thresholds: Object.freeze({
    max_age_hours: 48,
    min_topic_match: 7,
    min_relevance_score: 5.0,
    min_strategic_value: 0.34,
    max_routine_item_score: 0.65,
    min_high_confidence_source_authority: 0.58,
    min_lower_confidence_source_authority: 0.42,
  }),
  allowed_high_confidence_policies: Object.freeze(["preferred", "allowed"]),
  allowed_lower_confidence_policies: Object.freeze(["preferred", "allowed", "limited", "review"]),
  disallowed_source_types: Object.freeze([
    "platform_user_generated",
    "aggregator_republisher",
    "corporate_pr",
  ]),
  topic_classes: Object.freeze({
    macro_policy_noise_sensitive: Object.freeze({
      lower_confidence_backfill_allowed: false,
      trusted_only: true,
    }),
  }),
});

function clamp(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.max(min, Math.min(max, numeric));
}

function normalizeCustomTopicKey(value) {
  return normalizeTopicToken(String(value || "").replace(/^custom_/i, "").replace(/_/g, " "));
}

function getCustomTopicMetadata(keyword) {
  return getTopicMetadata(keyword);
}

function listTrustedOnlyCustomKeywords(customKeywords = []) {
  return (Array.isArray(customKeywords) ? customKeywords : []).filter((keyword) => {
    const metadata = getCustomTopicMetadata(keyword);
    return metadata.topic_classes.some((topicClass) => {
      return DELIVERY_POLICY.topic_classes[topicClass]?.trusted_only === true;
    });
  });
}

function ageHoursForItem(item, nowIso = new Date().toISOString()) {
  const publishedTs = Date.parse(String(item?.published_date || ""));
  if (!Number.isFinite(publishedTs)) return null;
  const nowTs = Date.parse(String(nowIso || ""));
  if (!Number.isFinite(nowTs)) return null;
  return Math.max(0, (nowTs - publishedTs) / (60 * 60 * 1000));
}

function hasCustomKeywordSignal(item) {
  return Array.isArray(item?.why_shown) && item.why_shown.includes("custom_keyword");
}

function isDisallowedSourceType(item) {
  const sourceType = String(item?.source_type || "").trim().toLowerCase();
  return DELIVERY_POLICY.disallowed_source_types.includes(sourceType);
}

function matchesCustomKeyword(item, keyword) {
  const normalizedKeyword = normalizeCustomTopicKey(keyword);
  if (!normalizedKeyword) return false;
  const tagNormalized = normalizeTopicToken(item?.tag || "");
  const bodyText = `${String(item?.headline || "")} ${String(item?.summary || "")}`;
  return customKeywordMatches(normalizedKeyword, bodyText, tagNormalized);
}

function matchedCustomKeywordsForItem(item, customKeywords = []) {
  const keywords = Array.isArray(customKeywords) ? customKeywords : [];
  const explicitMatches = Array.isArray(item?.delivery_custom_keywords)
    ? item.delivery_custom_keywords
    : Array.isArray(item?.custom_keywords)
      ? item.custom_keywords
      : [];
  const normalizedExplicitMatches = explicitMatches
    .map((keyword) => normalizeCustomTopicKey(keyword))
    .filter(Boolean);
  if (normalizedExplicitMatches.length > 0) {
    return keywords.filter((keyword) => normalizedExplicitMatches.includes(normalizeCustomTopicKey(keyword)));
  }
  const inferredMatches = keywords.filter((keyword) => matchesCustomKeyword(item, keyword));
  if (inferredMatches.length > 0) return inferredMatches;
  if (hasCustomKeywordSignal(item) && keywords.length === 1) return keywords.slice(0, 1);
  return [];
}

function matchedTopicClassesForItem(item, customKeywords = []) {
  const classes = new Set();
  for (const keyword of matchedCustomKeywordsForItem(item, customKeywords)) {
    const metadata = getCustomTopicMetadata(keyword);
    for (const topicClass of metadata.topic_classes) classes.add(topicClass);
  }
  return Array.from(classes);
}

function passesCommonEligibility(item, nowIso) {
  const ageHours = ageHoursForItem(item, nowIso);
  const thresholds = DELIVERY_POLICY.thresholds;
  const topicMatch = Number(item?.topicMatch || 0);
  const relevanceScore = Number(item?.relevanceScore || 0);
  const strategicValue = Number(item?.strategic_value || 0);
  const routineItemScore = Number(item?.routine_item_score || 0);
  return {
    has_verified_date: Number.isFinite(ageHours),
    age_hours: ageHours,
    fresh_enough: ageHours != null && ageHours <= thresholds.max_age_hours,
    strong_topic_fit: topicMatch >= thresholds.min_topic_match || hasCustomKeywordSignal(item),
    strong_relevance: relevanceScore >= thresholds.min_relevance_score,
    strategic_enough: strategicValue >= thresholds.min_strategic_value,
    not_routine: routineItemScore <= thresholds.max_routine_item_score,
    source_type_allowed: !isDisallowedSourceType(item),
    not_hard_excluded: item?.hard_exclude !== true,
    not_weak_source: !isWeakSourceItem(item),
  };
}

function classifyDeliveryConfidence(item, opts = {}) {
  const nowIso = String(opts.nowIso || new Date().toISOString());
  const customKeywords = Array.isArray(opts.customKeywords) ? opts.customKeywords : [];
  const common = passesCommonEligibility(item, nowIso);
  const sourcePolicy = String(item?.source_policy || "").trim().toLowerCase();
  const sourceAuthority = Number(item?.source_authority || 0);
  const matchedKeywords = matchedCustomKeywordsForItem(item, customKeywords);
  const matchedTopicClasses = matchedTopicClassesForItem(item, customKeywords);
  const trustedOnly = matchedTopicClasses.some((topicClass) => DELIVERY_POLICY.topic_classes[topicClass]?.trusted_only === true);

  const highConfidence = (
    common.has_verified_date
    && common.fresh_enough
    && common.strong_topic_fit
    && common.strong_relevance
    && common.strategic_enough
    && common.not_routine
    && common.source_type_allowed
    && common.not_hard_excluded
    && common.not_weak_source
    && DELIVERY_POLICY.allowed_high_confidence_policies.includes(sourcePolicy)
    && sourceAuthority >= DELIVERY_POLICY.thresholds.min_high_confidence_source_authority
  );

  const lowerConfidenceEligible = (
    !highConfidence
    && common.has_verified_date
    && common.fresh_enough
    && common.strong_topic_fit
    && common.strong_relevance
    && common.strategic_enough
    && common.not_routine
    && common.source_type_allowed
    && common.not_hard_excluded
    && common.not_weak_source
    && !trustedOnly
    && DELIVERY_POLICY.allowed_lower_confidence_policies.includes(sourcePolicy)
    && sourceAuthority >= DELIVERY_POLICY.thresholds.min_lower_confidence_source_authority
  );

  return {
    high_confidence: highConfidence,
    lower_confidence_eligible: lowerConfidenceEligible,
    matched_custom_keywords: matchedKeywords,
    matched_topic_classes: matchedTopicClasses,
    trusted_only_topic_hit: trustedOnly,
    age_hours: common.age_hours,
  };
}

function buildSelectedItems(items, highConfidencePool, lowerConfidencePool, selectedHighCount, selectedLowerCount) {
  const highKeys = new Set(highConfidencePool.slice(0, selectedHighCount).map((item) => item));
  const lowerKeys = new Set(lowerConfidencePool.slice(0, selectedLowerCount).map((item) => item));
  const selected = [];
  for (const item of (Array.isArray(items) ? items : [])) {
    if (highKeys.has(item) || lowerKeys.has(item)) selected.push(item);
    if (selected.length >= DELIVERY_POLICY.target_item_count) break;
  }
  return selected.slice(0, DELIVERY_POLICY.target_item_count);
}

function selectDeliveryItems(items, opts = {}) {
  const rows = Array.isArray(items) ? items.filter(Boolean) : [];
  const attemptCount = Math.max(1, Number(opts.attemptCount || 1));
  const lowerConfidenceAssistCount = Math.max(0, Number(opts.lowerConfidenceAssistCount || 0));
  const annotations = rows.map((item) => ({
    item,
    confidence: classifyDeliveryConfidence(item, opts),
  }));
  const highConfidencePool = annotations.filter((row) => row.confidence.high_confidence).map((row) => row.item);
  const lowerConfidencePool = annotations.filter((row) => row.confidence.lower_confidence_eligible).map((row) => row.item);
  const assistCapReached = lowerConfidenceAssistCount >= DELIVERY_POLICY.lower_confidence_cap.max_assisted_digests;
  const policy = attemptCount > 1 ? DELIVERY_POLICY.retry_attempt : DELIVERY_POLICY.first_attempt;
  let selected = [];
  let selectedHigh = 0;
  let selectedLower = 0;

  if (highConfidencePool.length >= DELIVERY_POLICY.target_item_count) {
    selectedHigh = DELIVERY_POLICY.target_item_count;
    selected = buildSelectedItems(rows, highConfidencePool, lowerConfidencePool, selectedHigh, 0);
  } else if (!assistCapReached) {
    const maxLower = Math.min(policy.max_lower_confidence, lowerConfidencePool.length);
    for (let lowerCount = maxLower; lowerCount >= 0; lowerCount -= 1) {
      const requiredHigh = DELIVERY_POLICY.target_item_count - lowerCount;
      if (requiredHigh < policy.min_high_confidence) continue;
      if (highConfidencePool.length < requiredHigh) continue;
      selectedHigh = requiredHigh;
      selectedLower = lowerCount;
      selected = buildSelectedItems(rows, highConfidencePool, lowerConfidencePool, selectedHigh, selectedLower);
      if (selected.length >= DELIVERY_POLICY.target_item_count) break;
    }
  }

  const selectedKeySet = new Set(selected);
  const annotatedSelected = annotations
    .filter((row) => selectedKeySet.has(row.item))
    .map((row) => ({
      ...row.item,
      delivery_confidence: row.confidence.high_confidence ? "high" : "lower",
      delivery_confidence_label: row.confidence.high_confidence ? "High confidence" : "Lower confidence",
      delivery_topic_classes: row.confidence.matched_topic_classes.slice(),
      delivery_custom_keywords: row.confidence.matched_custom_keywords.slice(),
      delivery_trusted_only_topic_hit: row.confidence.trusted_only_topic_hit === true,
    }));

  const deliveryEligible = annotatedSelected.length >= DELIVERY_POLICY.target_item_count
    && annotatedSelected.filter((item) => item.delivery_confidence === "high").length >= policy.min_high_confidence
    && annotatedSelected.filter((item) => item.delivery_confidence === "lower").length <= policy.max_lower_confidence;

  return {
    items: annotatedSelected,
    delivery_eligible: deliveryEligible,
    high_confidence_available_count: highConfidencePool.length,
    lower_confidence_available_count: lowerConfidencePool.length,
    high_confidence_count: annotatedSelected.filter((item) => item.delivery_confidence === "high").length,
    lower_confidence_count: annotatedSelected.filter((item) => item.delivery_confidence === "lower").length,
    lower_confidence_used: annotatedSelected.some((item) => item.delivery_confidence === "lower"),
    lower_confidence_cap_reached: assistCapReached,
    annotations: annotations.map((row) => ({
      key: row.item,
      ...row.confidence,
    })),
  };
}

function countRecentLowerConfidenceAssist(records = [], nowIso = new Date().toISOString()) {
  const lookbackMs = DELIVERY_POLICY.lower_confidence_cap.rolling_days * 24 * 60 * 60 * 1000;
  const nowTs = Date.parse(String(nowIso || ""));
  if (!Number.isFinite(nowTs)) return 0;
  return (Array.isArray(records) ? records : []).filter((record) => {
    const outcome = String(record?.delivery_outcome || "").trim();
    if (outcome !== "delivered_with_lower_confidence") return false;
    const sentTs = Date.parse(String(record?.sent_at || ""));
    if (!Number.isFinite(sentTs)) return false;
    return (nowTs - sentTs) <= lookbackMs;
  }).length;
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

module.exports = {
  DELIVERY_POLICY,
  ageHoursForItem,
  classifyDeliveryConfidence,
  classifyRetryFailureClass,
  computeRetryDelayMinutes,
  countRecentLowerConfidenceAssist,
  deriveInternalThinnessLabel,
  getCustomTopicMetadata,
  hasCustomKeywordSignal,
  listTrustedOnlyCustomKeywords,
  matchedCustomKeywordsForItem,
  matchedTopicClassesForItem,
  normalizeCustomTopicKey,
  selectDeliveryItems,
};
