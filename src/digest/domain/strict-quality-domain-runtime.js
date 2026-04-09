"use strict";

const { validateStrategicWriteup } = require("../runtime/digest-data-enrich-result-runtime");
const {
  computeItemAgeHours,
  normalizeSourceTier,
} = require("../../domains/digest/candidate-quality-runtime");
const { normalizeCanonicalUrl } = require("../../runtime/url-normalization-runtime");
const { normalizeMatchText } = require("../../runtime/topic-normalization-runtime");
const { isWeakSourceItem } = require("./storyline-domain-runtime");

const DEFAULT_STRICT_QUALITY = Object.freeze({
  enabled: false,
  freshness_hours_cap: 48,
  topic_fit_min: 0.7,
  max_backfills_per_slot: 2,
  max_exceptions_per_digest: 1,
  allow_tier3_in_thin_pool: true,
  major_story: Object.freeze({
    enabled: true,
    min_cross_source_count: 2,
    escape_hatch_primary_trusted: true,
    escape_hatch_high_corroboration: true,
  }),
  ship_ready: Object.freeze({
    allow_underfill: true,
    extreme_underfill_item_count: 1,
    extreme_underfill_warn_rate_pct: 2,
    anchor_base_score: 8.5,
    anchor_strategic_value: 0.8,
  }),
});

const TRUSTED_SOURCE_TYPES = new Set([
  "primary_official",
  "reported_media",
  "trade_specialist",
]);

function clamp(value, lo, hi) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return lo;
  return Math.max(lo, Math.min(hi, numeric));
}

function normalizeTopicFit(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  if (numeric >= 0 && numeric <= 1) return numeric;
  if (numeric > 1 && numeric <= 100) return clamp(numeric / 100, 0, 1);
  return clamp(numeric, 0, 1);
}

function normalizeText(value) {
  return normalizeMatchText(value || "");
}

function leadingPhraseKey(value, words = 6) {
  const normalized = normalizeText(value);
  if (!normalized) return "";
  return normalized.split(" ").slice(0, words).join(" ");
}

function normalizeUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return String(normalizeCanonicalUrl(raw) || raw).trim().toLowerCase();
}

function headlineFingerprint(value) {
  return normalizeText(value).slice(0, 120);
}

function jaccard(leftValues, rightValues) {
  const left = new Set((Array.isArray(leftValues) ? leftValues : []).map((value) => normalizeText(value)).filter(Boolean));
  const right = new Set((Array.isArray(rightValues) ? rightValues : []).map((value) => normalizeText(value)).filter(Boolean));
  if (!left.size && !right.size) return 0;
  let intersection = 0;
  for (const value of left) {
    if (right.has(value)) intersection += 1;
  }
  const union = new Set([...left, ...right]).size || 1;
  return intersection / union;
}

function resolveStrictQualityConfig(configDigest = {}) {
  const configured = configDigest?.strict_quality && typeof configDigest.strict_quality === "object"
    ? configDigest.strict_quality
    : {};
  const majorStory = configured.major_story && typeof configured.major_story === "object"
    ? configured.major_story
    : {};
  const shipReady = configured.ship_ready && typeof configured.ship_ready === "object"
    ? configured.ship_ready
    : {};
  return {
    enabled: configured.enabled === true,
    freshness_hours_cap: clamp(configured.freshness_hours_cap ?? DEFAULT_STRICT_QUALITY.freshness_hours_cap, 1, 168),
    topic_fit_min: clamp(configured.topic_fit_min ?? DEFAULT_STRICT_QUALITY.topic_fit_min, 0, 1),
    max_backfills_per_slot: Math.max(1, Number(configured.max_backfills_per_slot || DEFAULT_STRICT_QUALITY.max_backfills_per_slot)),
    max_exceptions_per_digest: Math.max(0, Number(configured.max_exceptions_per_digest ?? DEFAULT_STRICT_QUALITY.max_exceptions_per_digest)),
    allow_tier3_in_thin_pool: configured.allow_tier3_in_thin_pool !== false,
    major_story: {
      enabled: majorStory.enabled !== false,
      min_cross_source_count: Math.max(1, Number(majorStory.min_cross_source_count || DEFAULT_STRICT_QUALITY.major_story.min_cross_source_count)),
      escape_hatch_primary_trusted: majorStory.escape_hatch_primary_trusted !== false,
      escape_hatch_high_corroboration: majorStory.escape_hatch_high_corroboration !== false,
    },
    ship_ready: {
      allow_underfill: shipReady.allow_underfill !== false,
      extreme_underfill_item_count: Math.max(1, Number(shipReady.extreme_underfill_item_count || DEFAULT_STRICT_QUALITY.ship_ready.extreme_underfill_item_count)),
      extreme_underfill_warn_rate_pct: clamp(
        shipReady.extreme_underfill_warn_rate_pct ?? DEFAULT_STRICT_QUALITY.ship_ready.extreme_underfill_warn_rate_pct,
        0,
        100
      ),
      anchor_base_score: clamp(shipReady.anchor_base_score ?? DEFAULT_STRICT_QUALITY.ship_ready.anchor_base_score, 0, 10),
      anchor_strategic_value: clamp(shipReady.anchor_strategic_value ?? DEFAULT_STRICT_QUALITY.ship_ready.anchor_strategic_value, 0, 1),
    },
  };
}

function classifySourceQualityBand(item = {}) {
  const sourceType = String(item?.source_type || "").trim().toLowerCase();
  const sourcePolicy = String(item?.source_policy || "").trim().toLowerCase();
  const sourceAuthority = Number(item?.source_authority || 0);
  const tier = normalizeSourceTier(item?.source_tier);
  if (item?.source_hard_block === true || sourcePolicy === "blocked" || sourceType === "corporate_pr" || isWeakSourceItem(item)) {
    return "weak";
  }
  if (tier != null && tier <= 2) return "trusted";
  if (TRUSTED_SOURCE_TYPES.has(sourceType) && (sourcePolicy === "preferred" || sourcePolicy === "allowed") && sourceAuthority >= 0.58) {
    return "trusted";
  }
  if (tier === 3) return "tier3";
  if (TRUSTED_SOURCE_TYPES.has(sourceType) && sourceAuthority >= 0.42 && sourcePolicy !== "review") {
    return "tier3";
  }
  return "weak";
}

function evaluateWriteupStrength(item = {}) {
  const status = String(item?.writeup_status || "").trim().toLowerCase();
  const existingReasons = Array.isArray(item?.writeup_rejection_reasons) ? item.writeup_rejection_reasons.slice() : [];
  const validation = validateStrategicWriteup(item, item);
  const mergedReasons = Array.from(new Set([
    ...existingReasons,
    ...(Array.isArray(validation?.reasons) ? validation.reasons : []),
  ]));
  const hasWriteup = String(item?.wim || "").trim().length > 0 && String(item?.wim_brief || "").trim().length > 0;
  const passed = hasWriteup
    && (status === "model_pass" || status === "repair_pass" || !status)
    && mergedReasons.length === 0
    && validation?.ok === true;
  return {
    pass: passed,
    reasons: mergedReasons,
    status,
  };
}

function hasDistinctFollowUpAngle(candidate, existing) {
  const candidateSignal = normalizeText(candidate?.signal_shift || "");
  const existingSignal = normalizeText(existing?.signal_shift || "");
  if (candidateSignal && existingSignal && candidateSignal !== existingSignal) return true;
  const candidateLead = leadingPhraseKey(candidate?.wim_brief || candidate?.wim || "");
  const existingLead = leadingPhraseKey(existing?.wim_brief || existing?.wim || "");
  if (candidateLead && existingLead && candidateLead !== existingLead) return true;
  if (jaccard(candidate?.event_markers, existing?.event_markers) < 0.85) return true;
  if (jaccard(candidate?.entity_keys, existing?.entity_keys) < 1) return true;
  return false;
}

function evaluateDuplicateStoryline(item, acceptedItems = []) {
  const itemUrl = normalizeUrl(item?.url);
  const itemHeadline = headlineFingerprint(item?.headline);
  const itemFreshness = String(item?.freshness_key || "").trim();
  const itemStoryline = String(item?.storyline_key || "").trim();
  const followUpTagged = String(item?._story_relationship || "").trim().toLowerCase() === "follow_up";

  for (const accepted of (Array.isArray(acceptedItems) ? acceptedItems : [])) {
    const acceptedUrl = normalizeUrl(accepted?.url);
    if (itemUrl && acceptedUrl && itemUrl === acceptedUrl) {
      return { pass: false, reason: "exact_duplicate_url", follow_up_allowed: false };
    }
    const acceptedHeadline = headlineFingerprint(accepted?.headline);
    if (itemHeadline && acceptedHeadline && itemHeadline === acceptedHeadline) {
      return { pass: false, reason: "exact_duplicate_headline", follow_up_allowed: false };
    }
    const acceptedFreshness = String(accepted?.freshness_key || "").trim();
    if (itemFreshness && acceptedFreshness && itemFreshness === acceptedFreshness) {
      return { pass: false, reason: "exact_duplicate_freshness", follow_up_allowed: false };
    }
    const acceptedStoryline = String(accepted?.storyline_key || "").trim();
    if (itemStoryline && acceptedStoryline && itemStoryline === acceptedStoryline) {
      const followUpAllowed = followUpTagged || hasDistinctFollowUpAngle(item, accepted);
      if (followUpAllowed) {
        return { pass: true, reason: "follow_up_allowed", follow_up_allowed: true };
      }
      return { pass: false, reason: "same_story_no_new_angle", follow_up_allowed: false };
    }
  }

  return { pass: true, reason: null, follow_up_allowed: false };
}

function buildRuleResult(rule, pass, reason, detail = null) {
  return {
    rule,
    pass: pass === true,
    reason: String(reason || "").trim() || null,
    detail: detail == null ? null : detail,
  };
}

function evaluateTopicItem(item, ctx = {}) {
  const strictQualityConfig = ctx.strictQualityConfig || resolveStrictQualityConfig(ctx.configDigest || {});
  const nowMs = Number.isFinite(ctx.nowMs) ? ctx.nowMs : Date.now();
  const acceptedItems = Array.isArray(ctx.acceptedItems) ? ctx.acceptedItems : [];
  const topicCandidateCount = Math.max(0, Number(ctx.topicCandidateCount || acceptedItems.length + 1));
  const thinPool = ctx.thinPool === true || topicCandidateCount < 15;
  const remainingExceptions = Math.max(0, Number(ctx.remainingExceptions ?? strictQualityConfig.max_exceptions_per_digest));
  const results = [];

  const ageHours = computeItemAgeHours(item, nowMs);
  const freshnessPass = ageHours <= strictQualityConfig.freshness_hours_cap;
  results.push(buildRuleResult("freshness", freshnessPass, freshnessPass ? "fresh" : "stale", {
    age_hours: Number.isFinite(ageHours) ? Number(ageHours.toFixed(2)) : null,
    cap_hours: strictQualityConfig.freshness_hours_cap,
  }));
  if (!freshnessPass) {
    return {
      pass: false,
      rejected_rule: "freshness",
      rejected_reason: "stale",
      quality_rule_results: results,
      exception_used: false,
      exception_reason: null,
      follow_up_allowed: false,
      inclusion_reason: null,
    };
  }

  const duplicate = evaluateDuplicateStoryline(item, acceptedItems);
  results.push(buildRuleResult("duplicate_storyline", duplicate.pass, duplicate.reason || "unique", {
    follow_up_allowed: duplicate.follow_up_allowed === true,
  }));
  if (!duplicate.pass) {
    return {
      pass: false,
      rejected_rule: "duplicate_storyline",
      rejected_reason: duplicate.reason,
      quality_rule_results: results,
      exception_used: false,
      exception_reason: null,
      follow_up_allowed: false,
      inclusion_reason: null,
    };
  }

  const topicFit = normalizeTopicFit(item?.topic_fit);
  const topicFitPass = topicFit >= strictQualityConfig.topic_fit_min;
  results.push(buildRuleResult("topic_fit", topicFitPass, topicFitPass ? "topic_fit_ok" : "topic_fit_low", {
    topic_fit: Number(topicFit.toFixed(3)),
    min_topic_fit: strictQualityConfig.topic_fit_min,
  }));
  if (!topicFitPass) {
    return {
      pass: false,
      rejected_rule: "topic_fit",
      rejected_reason: "topic_fit_low",
      quality_rule_results: results,
      exception_used: false,
      exception_reason: null,
      follow_up_allowed: duplicate.follow_up_allowed === true,
      inclusion_reason: null,
    };
  }

  const writeup = evaluateWriteupStrength(item);
  results.push(buildRuleResult("wim_strength", writeup.pass, writeup.pass ? "wim_pass" : "wim_weak", {
    writeup_status: writeup.status || null,
    reasons: writeup.reasons.slice(),
  }));
  if (!writeup.pass) {
    return {
      pass: false,
      rejected_rule: "wim_strength",
      rejected_reason: "wim_weak",
      quality_rule_results: results,
      exception_used: false,
      exception_reason: null,
      follow_up_allowed: duplicate.follow_up_allowed === true,
      inclusion_reason: null,
    };
  }

  const sourceBand = classifySourceQualityBand(item);
  const allowTier3Exception = strictQualityConfig.allow_tier3_in_thin_pool
    && thinPool
    && sourceBand === "tier3"
    && remainingExceptions > 0;
  const sourcePass = sourceBand === "trusted" || allowTier3Exception;
  results.push(buildRuleResult("source_quality", sourcePass, sourcePass
    ? (allowTier3Exception ? "thin_pool_tier3_exception" : "trusted_source")
    : "source_quality_rejected", {
    source_band: sourceBand,
    thin_pool: thinPool,
    remaining_exceptions: remainingExceptions,
  }));
  if (!sourcePass) {
    return {
      pass: false,
      rejected_rule: "source_quality",
      rejected_reason: "source_quality_rejected",
      quality_rule_results: results,
      exception_used: false,
      exception_reason: null,
      follow_up_allowed: duplicate.follow_up_allowed === true,
      inclusion_reason: null,
    };
  }

  return {
    pass: true,
    rejected_rule: null,
    rejected_reason: null,
    quality_rule_results: results,
    exception_used: allowTier3Exception,
    exception_reason: allowTier3Exception ? "thin_pool_tier3_exception" : null,
    follow_up_allowed: duplicate.follow_up_allowed === true,
    inclusion_reason: duplicate.follow_up_allowed === true
      ? "follow_up_allowed"
      : (allowTier3Exception ? "thin_pool_exception" : "quality_pass"),
  };
}

function runPreRankingFilter(candidates, ctx = {}) {
  const items = Array.isArray(candidates) ? candidates : [];
  const strictQualityConfig = ctx.strictQualityConfig || resolveStrictQualityConfig(ctx.configDigest || {});
  const nowMs = Number.isFinite(ctx.nowMs) ? ctx.nowMs : Date.now();
  const kept = [];
  const dropped = [];
  const rejectionCounts = Object.create(null);
  const seenUrls = new Set();
  const seenFreshness = new Set();
  const seenHeadlines = new Set();

  function recordDrop(item, reason) {
    dropped.push({ item, reason });
    rejectionCounts[reason] = (rejectionCounts[reason] || 0) + 1;
  }

  for (const item of items) {
    if (!item) {
      recordDrop(item, "invalid_candidate");
      continue;
    }
    const ageHours = computeItemAgeHours(item, nowMs);
    if (ageHours > strictQualityConfig.freshness_hours_cap) {
      recordDrop(item, "stale");
      continue;
    }
    if (item?.hard_exclude === true || item?.source_hard_block === true) {
      recordDrop(item, "hard_exclude");
      continue;
    }
    if (normalizeTopicFit(item?.topic_fit) < strictQualityConfig.topic_fit_min) {
      recordDrop(item, "topic_fit_low");
      continue;
    }
    const urlKey = normalizeUrl(item?.url);
    if (urlKey && seenUrls.has(urlKey)) {
      recordDrop(item, "exact_duplicate_url");
      continue;
    }
    const freshnessKey = String(item?.freshness_key || "").trim();
    if (freshnessKey && seenFreshness.has(freshnessKey)) {
      recordDrop(item, "exact_duplicate_freshness");
      continue;
    }
    const headlineKey = headlineFingerprint(item?.headline);
    if (headlineKey && seenHeadlines.has(headlineKey)) {
      recordDrop(item, "exact_duplicate_headline");
      continue;
    }
    if (urlKey) seenUrls.add(urlKey);
    if (freshnessKey) seenFreshness.add(freshnessKey);
    if (headlineKey) seenHeadlines.add(headlineKey);
    kept.push(item);
  }

  return {
    kept,
    dropped,
    diagnostics: {
      before_count: items.length,
      after_count: kept.length,
      removed_count: dropped.length,
      rejection_counts: rejectionCounts,
    },
  };
}

function isTrustedPrimaryMajorStory(item = {}) {
  return String(item?.source_type || "").trim().toLowerCase() === "primary_official"
    && classifySourceQualityBand(item) === "trusted"
    && Number(item?.source_authority || 0) >= 0.74;
}

function isHighCorroborationMajorStory(item = {}, strictQualityConfig) {
  const minCrossSourceCount = Math.max(
    Number(strictQualityConfig?.major_story?.min_cross_source_count || 2) + 1,
    3
  );
  return Number(item?.cross_source_count || 0) >= minCrossSourceCount;
}

function isMajorStoryCandidate(item, ctx = {}) {
  const strictQualityConfig = ctx.strictQualityConfig || resolveStrictQualityConfig(ctx.configDigest || {});
  if (strictQualityConfig.major_story.enabled !== true) return false;
  const ageHours = computeItemAgeHours(item, Number.isFinite(ctx.nowMs) ? ctx.nowMs : Date.now());
  if (ageHours > Math.min(24, strictQualityConfig.freshness_hours_cap)) return false;

  const topicFit = normalizeTopicFit(item?.topic_fit);
  if (topicFit < Math.max(strictQualityConfig.topic_fit_min, 0.7)) return false;

  const selectedItems = Array.isArray(ctx.selectedItems) ? ctx.selectedItems : [];
  const selectedScores = selectedItems
    .map((candidate) => Number(candidate?._score))
    .filter((value) => Number.isFinite(value));
  const selectedFloor = selectedScores.length > 0 ? Math.min(...selectedScores) : 0.65;
  const score = Number(item?._score || 0);
  const scoreNearSelected = score >= Math.max(0.55, selectedFloor - 0.06);
  const trusted = classifySourceQualityBand(item) === "trusted";
  const corroborated = Number(item?.cross_source_count || 0) >= Number(strictQualityConfig.major_story.min_cross_source_count || 2);

  if (trusted && corroborated && scoreNearSelected) return true;
  if (strictQualityConfig.major_story.escape_hatch_primary_trusted !== false && isTrustedPrimaryMajorStory(item)) return true;
  if (strictQualityConfig.major_story.escape_hatch_high_corroboration !== false && trusted && isHighCorroborationMajorStory(item, strictQualityConfig)) return true;
  return false;
}

function isLeadItem(item = {}, ctx = {}) {
  const strictQualityConfig = ctx.strictQualityConfig || resolveStrictQualityConfig(ctx.configDigest || {});
  const sourceBand = classifySourceQualityBand(item);
  if (sourceBand !== "trusted") return { pass: false, reason: "anchor_not_trusted" };
  if (evaluateWriteupStrength(item).pass !== true) return { pass: false, reason: "anchor_weak_wim" };

  const topicCandidates = Array.isArray(ctx.topicCandidates)
    ? ctx.topicCandidates
    : [];
  const rankedScores = topicCandidates
    .map((candidate) => Number(candidate?._score))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => right - left);
  const itemScore = Number(item?._score || 0);
  const topDecileCount = Math.max(1, Math.ceil(Math.max(1, rankedScores.length || 1) * 0.1));
  const topDecileCutoff = rankedScores.length > 0
    ? rankedScores[Math.min(rankedScores.length - 1, topDecileCount - 1)]
    : null;
  if (topDecileCutoff != null && (!Number.isFinite(itemScore) || itemScore < topDecileCutoff)) {
    return {
      pass: false,
      reason: "anchor_not_top_decile",
      cutoff_score: topDecileCutoff,
      candidate_count: rankedScores.length,
    };
  }

  const baseScore = Number(item?.baseScore || 0);
  const strategicValue = Number(item?.strategic_value || 0);
  const corroborated = Number(item?.cross_source_count || 0) >= 2;
  const strategicallyStrong = baseScore >= strictQualityConfig.ship_ready.anchor_base_score
    || strategicValue >= strictQualityConfig.ship_ready.anchor_strategic_value;
  if (corroborated || strategicallyStrong) {
    return {
      pass: true,
      reason: strategicallyStrong ? "top_decile_trusted_strong_lead" : "top_decile_trusted_corroborated_lead",
      cutoff_score: topDecileCutoff,
      candidate_count: rankedScores.length,
    };
  }
  return { pass: false, reason: "anchor_not_strong_enough" };
}

function isBorderlineItem(item = {}, ctx = {}) {
  const strictQualityConfig = ctx.strictQualityConfig || resolveStrictQualityConfig(ctx.configDigest || {});
  const baseScore = Number(item?.baseScore || 0);
  const strategicValue = Number(item?.strategic_value || 0);
  const corroborated = Number(item?.cross_source_count || 0) >= 2;
  const exceptionUsed = item?.exception_used === true || item?.strict_quality?.exception_used === true;
  if (exceptionUsed) return true;
  const borderlineBaseThreshold = Math.max(6.8, strictQualityConfig.ship_ready.anchor_base_score - 1.2);
  const borderlineStrategicThreshold = Math.max(0.62, strictQualityConfig.ship_ready.anchor_strategic_value - 0.18);
  return baseScore < borderlineBaseThreshold
    && strategicValue < borderlineStrategicThreshold
    && !corroborated;
}

function isClearlyStrongItem(item = {}, ctx = {}) {
  const sourceBand = classifySourceQualityBand(item);
  if (sourceBand !== "trusted") return false;
  if (evaluateWriteupStrength(item).pass !== true) return false;
  const leadCheck = isLeadItem(item, ctx);
  if (leadCheck.pass === true) return true;
  const corroborated = Number(item?.cross_source_count || 0) >= 2;
  const strategicValue = Number(item?.strategic_value || 0);
  const baseScore = Number(item?.baseScore || 0);
  return corroborated && (strategicValue >= 0.7 || baseScore >= 7.8);
}

function evaluateTopicBucketShipReady(items, ctx = {}) {
  const rows = Array.isArray(items) ? items : [];
  const strictQualityConfig = ctx.strictQualityConfig || resolveStrictQualityConfig(ctx.configDigest || {});
  const maxItemsPerSourceDomain = Math.max(1, Number(ctx.maxItemsPerSourceDomain || 5));
  const sourceCounts = Object.create(null);
  const accepted = [];
  let duplicateViolation = false;
  let remainingExceptions = Math.max(0, Number(
    ctx.remainingExceptions ?? strictQualityConfig.max_exceptions_per_digest
  ));

  for (const item of rows) {
    const evaluation = evaluateTopicItem(item, {
      ...ctx,
      acceptedItems: accepted,
      remainingExceptions,
    });
    if (!evaluation.pass) {
      return {
        pass: false,
        reason: evaluation.rejected_reason || "bucket_item_failed",
        lead_item_reason: null,
        signal_density: 0,
      };
    }
    accepted.push(item);
    if (evaluation.exception_used === true) {
      remainingExceptions = Math.max(0, remainingExceptions - 1);
    }
    const domain = String(item?.source_domain || item?.source || "unknown").trim().toLowerCase();
    sourceCounts[domain] = (sourceCounts[domain] || 0) + 1;
    if (sourceCounts[domain] > maxItemsPerSourceDomain) duplicateViolation = true;
  }

  if (!rows.length) {
    return {
      pass: false,
      reason: "bucket_empty",
      lead_item_reason: null,
      signal_density: 0,
    };
  }

  if (duplicateViolation) {
    return {
      pass: false,
      reason: "source_cap_exceeded",
      lead_item_reason: null,
      signal_density: 0,
    };
  }

  const leadResult = rows
    .map((item) => ({ item, result: isLeadItem(item, ctx) }))
    .find((entry) => entry.result.pass === true) || null;
  if (!leadResult) {
    return {
      pass: false,
      reason: "missing_lead_item",
      lead_item_reason: null,
      signal_density: 0,
    };
  }

  const borderlineItemCount = rows.filter((item) => isBorderlineItem(item, ctx)).length;
  const strongItemCount = rows.filter((item) => isClearlyStrongItem(item, ctx)).length;
  const signalDensity = Number((strongItemCount - (borderlineItemCount * 0.5)).toFixed(3));
  if (borderlineItemCount > 1 || strongItemCount < 1) {
    return {
      pass: false,
      reason: "signal_density_low",
      lead_item_reason: leadResult.result.reason,
      signal_density: signalDensity,
      borderline_item_count: borderlineItemCount,
      strong_item_count: strongItemCount,
    };
  }

  return {
    pass: true,
    reason: "bucket_ship_ready",
    lead_item_reason: leadResult.result.reason,
    lead_item_url: String(leadResult.item?.url || "").trim() || null,
    signal_density: signalDensity,
    borderline_item_count: borderlineItemCount,
    strong_item_count: strongItemCount,
  };
}

function bucketStrength(tag, items = [], ctx = {}) {
  const rows = Array.isArray(items) ? items : [];
  if (!rows.length) return 0;
  const topicCandidatesByTag = ctx.topicCandidatesByTag && typeof ctx.topicCandidatesByTag === "object"
    ? ctx.topicCandidatesByTag
    : {};
  const topicCandidates = Array.isArray(topicCandidatesByTag[tag]) ? topicCandidatesByTag[tag] : rows;
  const lead = rows
    .map((item) => ({
      item,
      anchor: isLeadItem(item, {
        ...ctx,
        topicCandidates,
      }),
    }))
    .sort((left, right) => Number(right.item?._score || 0) - Number(left.item?._score || 0))[0];
  return Number(lead?.item?._score || 0) + (lead?.anchor?.pass ? 1 : 0);
}

function bucketsConflict(leftItems = [], rightItems = []) {
  for (const left of leftItems) {
    for (const right of rightItems) {
      const leftUrl = normalizeUrl(left?.url);
      const rightUrl = normalizeUrl(right?.url);
      if (leftUrl && rightUrl && leftUrl === rightUrl) return true;
      const leftFreshness = String(left?.freshness_key || "").trim();
      const rightFreshness = String(right?.freshness_key || "").trim();
      if (leftFreshness && rightFreshness && leftFreshness === rightFreshness) return true;
      const leftStory = String(left?.storyline_key || "").trim();
      const rightStory = String(right?.storyline_key || "").trim();
      if (leftStory && rightStory && leftStory === rightStory) return true;
    }
  }
  const leftLead = leadingPhraseKey(leftItems[0]?.wim_brief || leftItems[0]?.signal_shift || leftItems[0]?.headline || "");
  const rightLead = leadingPhraseKey(rightItems[0]?.wim_brief || rightItems[0]?.signal_shift || rightItems[0]?.headline || "");
  return !!leftLead && !!rightLead && leftLead === rightLead;
}

function evaluateFinalDigestAssembly(topicBuckets, ctx = {}) {
  const strictQualityConfig = ctx.strictQualityConfig || resolveStrictQualityConfig(ctx.configDigest || {});
  const subscribedTopics = Array.isArray(ctx.subscribedTopics) ? ctx.subscribedTopics.map((topic) => String(topic || "").trim()).filter(Boolean) : [];
  const orderedTopics = subscribedTopics.length > 0
    ? subscribedTopics
    : Object.keys(topicBuckets || {});

  const allEntries = orderedTopics
    .map((tag) => ({
      tag,
      items: Array.isArray(topicBuckets?.[tag]) ? topicBuckets[tag].slice() : [],
      exception_count: (Array.isArray(topicBuckets?.[tag]) ? topicBuckets[tag] : []).filter((item) => item?.strict_quality?.exception_used === true).length,
    }))
    .filter((entry) => entry.items.length > 0);

  const sortedByStrength = allEntries
    .slice()
    .sort((left, right) => bucketStrength(right.tag, right.items, ctx) - bucketStrength(left.tag, left.items, ctx));
  const kept = [];
  const blockedTopics = [];

  for (const entry of sortedByStrength) {
    const conflicting = kept.find((candidate) => bucketsConflict(entry.items, candidate.items));
    if (conflicting) {
      blockedTopics.push({
        tag: entry.tag,
        reason: "repeated_framing_across_topics",
      });
      continue;
    }
    kept.push(entry);
  }

  let totalExceptions = kept.reduce((sum, entry) => sum + Number(entry.exception_count || 0), 0);
  if (totalExceptions > strictQualityConfig.max_exceptions_per_digest) {
    const removable = kept
      .slice()
      .filter((entry) => Number(entry.exception_count || 0) > 0)
      .sort((left, right) => bucketStrength(left.tag, left.items, ctx) - bucketStrength(right.tag, right.items, ctx));
    while (totalExceptions > strictQualityConfig.max_exceptions_per_digest && removable.length > 0) {
      const next = removable.shift();
      const index = kept.findIndex((entry) => entry.tag === next.tag);
      if (index === -1) continue;
      kept.splice(index, 1);
      totalExceptions -= Number(next.exception_count || 0);
      blockedTopics.push({
        tag: next.tag,
        reason: "exception_budget_exceeded",
      });
    }
  }

  const keptMap = Object.create(null);
  for (const tag of orderedTopics) {
    const found = kept.find((entry) => entry.tag === tag);
    if (found) keptMap[tag] = found.items.slice();
  }
  const flatItems = orderedTopics.flatMap((tag) => Array.isArray(keptMap[tag]) ? keptMap[tag] : []);
  const topicCandidatesByTag = ctx.topicCandidatesByTag && typeof ctx.topicCandidatesByTag === "object"
    ? ctx.topicCandidatesByTag
    : {};
  const hasLeadBucket = kept.some((entry) => evaluateTopicBucketShipReady(entry.items, {
    ...ctx,
    topicCandidates: Array.isArray(topicCandidatesByTag[entry.tag]) ? topicCandidatesByTag[entry.tag] : entry.items,
  }).pass === true);
  const extremeUnderfill = flatItems.length === strictQualityConfig.ship_ready.extreme_underfill_item_count;

  return {
    delivery_eligible: flatItems.length > 0 && hasLeadBucket,
    topic_buckets: keptMap,
    blocked_topics: blockedTopics,
    items: flatItems,
    total_exceptions_used: kept.reduce((sum, entry) => sum + Number(entry.exception_count || 0), 0),
    surviving_topic_bucket_count: kept.length,
    extreme_underfill: extremeUnderfill,
    extreme_underfill_target_rate_pct: Number(strictQualityConfig.ship_ready.extreme_underfill_warn_rate_pct || 0),
  };
}

module.exports = {
  DEFAULT_STRICT_QUALITY,
  classifySourceQualityBand,
  computeItemAgeHours,
  evaluateDuplicateStoryline,
  evaluateFinalDigestAssembly,
  evaluateTopicBucketShipReady,
  evaluateTopicItem,
  evaluateWriteupStrength,
  isLeadItem,
  isMajorStoryCandidate,
  resolveStrictQualityConfig,
  runPreRankingFilter,
};
