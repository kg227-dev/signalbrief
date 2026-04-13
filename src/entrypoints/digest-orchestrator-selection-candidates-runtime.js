"use strict";

const {
  annotateEditorialSignals: annotateEditorialSignalsDefault,
  buildStorylineCandidates: buildStorylineCandidatesDefault,
} = require("../domains/digest");
const {
  assignCanonicalTopic: assignCanonicalTopicDefault,
  scoreBestFitTopicTag: scoreBestFitTopicTagDefault,
} = require("../runtime/standard-topic-broker-topic-fit-runtime");

// Domain-to-topic scope constraints for best-fit reassignment.
// Items from these source domains are locked to the listed topic tags and will not
// be reassigned to any topic outside this set, regardless of keyword scoring.
// Prevents specialist-source items from bleeding into unrelated topic pools
// (e.g. STAT health/pharma items scoring into TECHNOLOGY via "ai" keywords,
//  or The Register tech items scoring into FINANCIAL SERVICES via "payments" keywords).
const DOMAIN_TOPIC_SCOPE = new Map([
  ["statnews.com", new Set(["HEALTHCARE", "LIFE SCIENCES"])],
  ["fiercehealthcare.com", new Set(["HEALTHCARE"])],
  ["modernhealthcare.com", new Set(["HEALTHCARE"])],
  ["beckershospitalreview.com", new Set(["HEALTHCARE"])],
  ["fiercebiotech.com", new Set(["LIFE SCIENCES", "HEALTHCARE"])],
  ["biopharmadive.com", new Set(["LIFE SCIENCES", "HEALTHCARE"])],
  ["fiercepharma.com", new Set(["LIFE SCIENCES", "HEALTHCARE"])],
  ["theregister.com", new Set(["TECHNOLOGY"])],
  ["go.theregister.com", new Set(["TECHNOLOGY"])],
  ["freightwaves.com", new Set(["INDUSTRIALS"])],
  ["supplychaindive.com", new Set(["INDUSTRIALS", "CONSUMER & RETAIL"])],
  ["americanbanker.com", new Set(["FINANCIAL SERVICES"])],
  ["bankingdive.com", new Set(["FINANCIAL SERVICES"])],
  ["canarymedia.com", new Set(["ENERGY"])],
  ["utilitydive.com", new Set(["ENERGY"])],
]);

const PROCEDURAL_HEADLINE_PATTERNS = [
  /\bnotice of filing\b/i,
  /\bconference notice\b/i,
  /\bguidance published\b/i,
  /\badministrative update\b/i,
  /\bclosed meeting\b/i,
  /\bnotice of (availability|hearing|meeting|proposed)/i,
];

const STRATEGIC_IMPLICATION_PATTERNS = [
  /\b(regulatory impact|compliance cost|margin|pricing|operations?|strategy|investment|m&a|partnership)\b/i,
  /\b(approval|approved|enforcement|rule|rulemaking|settlement|tariff|layoff|capex|restructuring)\b/i,
  /\b(demand|supply chain|factory|manufacturing|clinical|trial|payer|provider|bank|lender|utility)\b/i,
];

function classifySourceTypeClass(sourceType) {
  const st = String(sourceType || "").trim().toLowerCase();
  if (st === "reported_media" || st === "trade_specialist") return "reported";
  if (st === "primary_official") return "official";
  if (st === "corporate_pr") return "corporate";
  if (st === "analysis_blog") return "commentary";
  if (st === "aggregator_republisher" || st === "platform_user_generated") return "aggregator";
  return "unclassified";
}

function toSelectionAuditCandidate(item, extras = {}) {
  return {
    tag: String(item?.tag || "").trim().toUpperCase() || null,
    headline: String(item?.headline || "").slice(0, 160),
    url: String(item?.url || ""),
    source: String(item?.source || item?.source_domain || ""),
    source_domain: String(item?.source_domain || item?.source || ""),
    source_tier: item?.source_tier ?? null,
    source_type: String(item?.source_type || ""),
    source_type_class: classifySourceTypeClass(item?.source_type),
    source_authority: Number.isFinite(Number(item?.source_authority)) ? Number(item.source_authority) : null,
    lane: String(item?.retrieval_origin || item?.retrieval_lane || ""),
    _score: item?._score ?? null,
    _score_components: item?._score_components ?? null,
    _story_relationship: item?._story_relationship ?? "new",
    storyline_key: String(item?.storyline_key || "").trim() || null,
    cross_source_count: Number.isFinite(Number(item?.cross_source_count)) ? Number(item.cross_source_count) : null,
    published_at: String(item?.published_date || item?.published_at || item?.date || "") || null,
    freshness_hours: Number.isFinite(Number(extras?.freshness_hours))
      ? Number(Number(extras.freshness_hours).toFixed(2))
      : null,
    content_flags: Array.isArray(item?.content_flags) ? item.content_flags.slice() : [],
    strategic_relevance: item?.strategic_relevance || null,
    strategic_relevance_reason: item?.strategic_relevance_reason
      ? String(item.strategic_relevance_reason).slice(0, 120)
      : null,
    procedural_notice: item?.procedural_notice === true,
    procedural_notice_has_strategic_shift: item?.procedural_notice_has_strategic_shift === true,
    low_signal_procedural: item?._low_signal_procedural === true,
    selector_penalties: item?._selector_penalties && typeof item._selector_penalties === "object"
      ? { ...item._selector_penalties }
      : null,
    trusted_override: item?._trusted_override && typeof item._trusted_override === "object"
      ? { ...item._trusted_override }
      : null,
    better_trusted_available: item?._better_trusted_available && typeof item._better_trusted_available === "object"
      ? { ...item._better_trusted_available }
      : null,
    guardrail_swap: item?._guardrail_swap && typeof item._guardrail_swap === "object"
      ? { ...item._guardrail_swap }
      : null,
    duplicate_of: item?.duplicate_of ? String(item.duplicate_of) : null,
    ...extras,
  };
}

function textHasStrategicImplication(text) {
  const normalized = String(text || "").trim();
  if (!normalized) return false;
  return STRATEGIC_IMPLICATION_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isLowSignalProceduralItem(item) {
  const headline = String(item?.headline || item?.title || "").trim();
  const summary = String(item?.summary || "").trim();
  const strategicReason = String(item?.strategic_relevance_reason || "").trim();
  const sourceType = String(item?.source_type || "").trim().toLowerCase();
  const proceduralFlag = item?.procedural_notice === true
    || PROCEDURAL_HEADLINE_PATTERNS.some((pattern) => pattern.test(headline));
  if (!proceduralFlag) return false;
  if (item?.procedural_notice_has_strategic_shift === true) return false;
  if (textHasStrategicImplication(`${headline} ${summary} ${strategicReason}`)) return false;
  if (sourceType === "reported_media" || sourceType === "trade_specialist") return false;
  return true;
}

function filterPreSelectionSignalQuality(items = []) {
  const kept = [];
  const dropped = [];
  for (const item of (Array.isArray(items) ? items : [])) {
    if (!isLowSignalProceduralItem(item)) {
      kept.push(item);
      continue;
    }
    dropped.push({
      ...item,
      _low_signal_procedural: true,
      _selection_prefilter_reason: "selection_low_signal_procedural",
    });
  }
  return {
    kept,
    dropped,
    diagnostics: {
      removed_count: dropped.length,
      removed_reason_counts: dropped.length > 0
        ? { selection_low_signal_procedural: dropped.length }
        : {},
    },
  };
}

function normalizeBestFitText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveConfiguredTopicTags(configTopics = []) {
  return Array.from(new Set(
    (Array.isArray(configTopics) ? configTopics : [])
      .map((topic) => String(topic?.tag || "").trim().toUpperCase())
      .filter(Boolean)
  ));
}

function canonicalizeCandidateTopicTags(items = [], opts = {}) {
  const candidates = Array.isArray(items) ? items : [];
  const configTopicTags = resolveConfiguredTopicTags(opts.configTopics);
  const assignCanonicalTopic = typeof opts.assignCanonicalTopic === "function"
    ? opts.assignCanonicalTopic
    : assignCanonicalTopicDefault;
  const scoreBestFitTopicTag = typeof opts.scoreBestFitTopicTag === "function"
    ? opts.scoreBestFitTopicTag
    : scoreBestFitTopicTagDefault;
  if (configTopicTags.length === 0 || typeof assignCanonicalTopic !== "function" || typeof scoreBestFitTopicTag !== "function") {
    return { items: candidates.slice(), bestFitTopicReassignedCount: 0 };
  }

  let bestFitTopicReassignedCount = 0;
  const canonicalized = candidates.map((item) => {
    const originalTag = String(item?.tag || "").trim().toUpperCase();
    const fitText = normalizeBestFitText([
      item?.headline,
      item?.summary,
      item?.canonical_url,
      item?.url,
      ...(Array.isArray(item?.entity_keys) ? item.entity_keys : []),
      ...(Array.isArray(item?.content_flags) ? item.content_flags : []),
    ].filter(Boolean).join(" "));
    if (!fitText) return item;
    const bestTag = String(assignCanonicalTopic(configTopicTags, item) || "").trim().toUpperCase();
    if (!bestTag) return item;
    const bestScore = Number(scoreBestFitTopicTag(bestTag, fitText) || 0);
    const currentScore = originalTag ? Number(scoreBestFitTopicTag(originalTag, fitText) || 0) : 0;
    if (bestScore <= 0 || bestTag === originalTag || bestScore <= currentScore) return item;
    const sourceDomain = String(item?.source_domain || "").trim().toLowerCase();
    const domainScope = DOMAIN_TOPIC_SCOPE.get(sourceDomain);
    if (domainScope && !domainScope.has(bestTag)) return item;
    bestFitTopicReassignedCount += 1;
    return {
      ...item,
      tag: bestTag,
      original_tag: item?.original_tag || originalTag || null,
      canonical_topic_reassigned: true,
    };
  });

  return {
    items: canonicalized,
    bestFitTopicReassignedCount,
  };
}

function prepareSelectionCandidates(items = [], opts = {}) {
  const candidates = Array.isArray(items) ? items.slice() : [];
  const buildStorylineCandidates = typeof opts.buildStorylineCandidates === "function"
    ? opts.buildStorylineCandidates
    : buildStorylineCandidatesDefault;
  const annotateEditorialSignals = typeof opts.annotateEditorialSignals === "function"
    ? opts.annotateEditorialSignals
    : annotateEditorialSignalsDefault;

  let prepared = candidates;
  let storylineClusterRemovedCount = 0;
  if (typeof buildStorylineCandidates === "function" && prepared.length > 0) {
    const clustered = buildStorylineCandidates(prepared);
    if (Array.isArray(clustered) && clustered.length > 0) {
      storylineClusterRemovedCount = Math.max(0, prepared.length - clustered.length);
      prepared = clustered;
    }
  }

  const canonicalized = canonicalizeCandidateTopicTags(prepared, opts);
  prepared = canonicalized.items;

  if (typeof annotateEditorialSignals === "function" && prepared.length > 0) {
    const annotated = annotateEditorialSignals(prepared);
    if (Array.isArray(annotated) && annotated.length === prepared.length) {
      prepared = annotated;
    }
  }

  return {
    items: prepared,
    storylineClusterRemovedCount,
    bestFitTopicReassignedCount: canonicalized.bestFitTopicReassignedCount,
  };
}

module.exports = {
  canonicalizeCandidateTopicTags,
  classifySourceTypeClass,
  filterPreSelectionSignalQuality,
  isLowSignalProceduralItem,
  prepareSelectionCandidates,
  textHasStrategicImplication,
  toSelectionAuditCandidate,
};
