"use strict";

const {
  annotateEditorialSignals: annotateEditorialSignalsDefault,
  buildStorylineCandidates: buildStorylineCandidatesDefault,
} = require("../domains/digest");
const { scoreCandidates } = require("../domains/scoring/score-candidate");
const {
  assignCanonicalTopic: assignCanonicalTopicDefault,
  scoreBestFitTopicTag: scoreBestFitTopicTagDefault,
} = require("../runtime/standard-topic-broker-runtime");
const { classifyCandidates } = require("../domains/classification/strategic-relevance-classifier");
const { filterLowRelevance, boostHighRelevance } = require("../domains/classification/strategic-relevance-scoring");
const { loadCache } = require("../domains/classification/strategic-relevance-cache");
const {
  resolveStrictQualityConfig,
  runPreRankingFilter,
} = require("../digest/domain/strict-quality-domain-runtime");
const path = require("path");

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

function computeItemAgeHours(item, nowMs) {
  const ts = item?.published_date || item?.published_at || item?.date || item?.timestamp;
  if (!ts) return Infinity;
  const ms = typeof ts === "number" ? ts : new Date(ts).getTime();
  if (!Number.isFinite(ms)) return Infinity;
  return Math.max(0, (nowMs - ms) / (1000 * 60 * 60));
}

function splitByFreshnessTiers(items, nowMs) {
  const tier1 = []; // 0–24h: breaking / today
  const tier2 = []; // 24–48h: yesterday
  const tier3 = []; // >48h: stale overflow, never eligible in the active MVP path
  for (const item of (Array.isArray(items) ? items : [])) {
    const age = computeItemAgeHours(item, nowMs);
    if (age <= 24) tier1.push(item);
    else if (age <= 48) tier2.push(item);
    else tier3.push(item);
  }
  return { tier1, tier2, tier3 };
}

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

const SOURCE_TIER_ALIASES = Object.freeze({
  1: 1,
  2: 2,
  3: 3,
  premium: 1,
  strong: 2,
  standard: 3,
});

function normalizeSourceTier(itemOrTier) {
  const rawTier = itemOrTier && typeof itemOrTier === "object" ? itemOrTier.source_tier : itemOrTier;
  const numeric = Number(rawTier);
  if (numeric === 1 || numeric === 2 || numeric === 3) return numeric;
  const alias = SOURCE_TIER_ALIASES[String(rawTier || "").trim().toLowerCase()];
  return alias || null;
}

function isTrustedSourceTier(item) {
  const tier = normalizeSourceTier(item);
  return tier != null && tier <= 2;
}

function countTrustedSourceTier(items = []) {
  return (Array.isArray(items) ? items : []).filter((item) => isTrustedSourceTier(item)).length;
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
    const hasReported = cluster.some((i) => {
      const st = String(i?.source_type || "").toLowerCase();
      return st === "reported_media" || st === "trade_specialist";
    });
    if (!hasReported) continue;
    for (const item of cluster) {
      if (String(item?.source_type || "").toLowerCase() === "primary_official") {
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
  const { tier1, tier2, tier3 } = splitByFreshnessTiers(items, nowMs);
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
  const configuredAdequateCandidateCount = Number(trustedFloorConfig.adequateTopicCandidateCount);
  const minTrustedItems = Number.isFinite(configuredMinTrustedItems)
    ? Math.min(targetCount, Math.max(0, Math.trunc(configuredMinTrustedItems)))
    : Math.min(4, targetCount);
  const adequateCandidateCount = Number.isFinite(configuredAdequateCandidateCount)
    ? Math.max(targetCount, Math.trunc(configuredAdequateCandidateCount))
    : Math.max(15, targetCount * 3);
  const trustedCandidateCount = countTrustedSourceTier(freshSelectablePool);
  const trustedFloor = {
    enabled: trustedFloorConfig.enabled === true,
    active: trustedFloorConfig.enabled === true
      && freshSelectablePool.length >= adequateCandidateCount
      && trustedCandidateCount >= minTrustedItems
      && minTrustedItems > 0,
    minTrustedItemsPerTopic: minTrustedItems,
    adequateTopicCandidateCount: adequateCandidateCount,
    candidate_count: freshSelectablePool.length,
    trusted_candidate_count: trustedCandidateCount,
  };
  const selected = [];
  const selectedSet = new Set();
  const rejectionReasonByItem = new Map();
  const domainCounts = Object.create(null);
  let discoveryCount = 0;
  let commentarySelectedCount = 0;

  function recordRejection(item, reason) {
    if (!item || selectedSet.has(item) || rejectionReasonByItem.has(item)) return;
    rejectionReasonByItem.set(item, String(reason || "selection_not_selected"));
  }

  function attemptStage(items, stageName, { commentaryCap = 0 } = {}) {
    for (const item of (Array.isArray(items) ? items : [])) {
      if (!item || selectedSet.has(item)) continue;
      const isCommentary = isAnalysisOrCommentaryItem(item);
      if (commentaryCap > 0 && isCommentary && commentarySelectedCount >= commentaryCap) {
        recordRejection(item, "selection_commentary_cap");
        continue;
      }

      if (selected.length >= targetCount) {
        recordRejection(item, "selection_pool_full");
        continue;
      }

      const domain = String(item?.source_domain || item?.source || "unknown").trim().toLowerCase();
      const domainCount = domainCounts[domain] || 0;
      if (domainCount >= perSourceCap) {
        recordRejection(item, `selection_source_cap (${domain}: ${domainCount}/${perSourceCap})`);
        continue;
      }

      if (isDiscoveryLaneItem(item) && discoveryCount >= discoveryCap) {
        recordRejection(item, "selection_discovery_cap");
        continue;
      }

      selected.push(item);
      selectedSet.add(item);
      item._selection_stage = `stage_${stageName}`;
      domainCounts[domain] = domainCount + 1;
      if (isDiscoveryLaneItem(item)) discoveryCount += 1;
      if (isCommentary) commentarySelectedCount += 1;
    }
  }

  if (trustedFloor.active) {
    attemptStage(pools.eventTier1.filter((item) => isTrustedSourceTier(item)), "trusted_floor_event_tier1");
    if (countTrustedSourceTier(selected) < trustedFloor.minTrustedItemsPerTopic && selected.length < targetCount) {
      attemptStage(pools.eventTier2.filter((item) => isTrustedSourceTier(item)), "trusted_floor_event_tier2");
    }
    if (countTrustedSourceTier(selected) < trustedFloor.minTrustedItemsPerTopic && selected.length < targetCount) {
      attemptStage(pools.commentaryPool.filter((item) => isTrustedSourceTier(item)), "trusted_floor_commentary", { commentaryCap: 1 });
    }
  }

  attemptStage(pools.eventTier1, "event_tier1");
  if (selected.length < targetCount) attemptStage(pools.eventTier2, "event_tier2");
  if (selected.length < targetCount) attemptStage(pools.commentaryPool, "commentary", { commentaryCap: 1 });

  trustedFloor.selected_trusted_count = countTrustedSourceTier(selected);

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
  if (domainCount >= perSourceCap) {
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
  return [
    ...(Array.isArray(pools.eventTier1) ? pools.eventTier1 : []),
    ...(Array.isArray(pools.eventTier2) ? pools.eventTier2 : []),
    ...(Array.isArray(pools.commentaryPool) ? pools.commentaryPool : []),
    ...(Array.isArray(pools.suppressedOfficials) ? pools.suppressedOfficials : []),
  ].filter((item) => !selectedUrls.has(String(item?.url || "").trim()));
}

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

function resolveTrustedSelectionFloor(configDigest = {}, itemsPerTopic = 5) {
  const raw = configDigest?.trustedSelectionFloor;
  const rawObject = raw && typeof raw === "object" ? raw : {};
  const targetCount = Math.max(1, Number(itemsPerTopic || 5));
  const configuredMin = Number(rawObject.minTrustedItemsPerTopic ?? configDigest?.minTrustedItemsPerTopic);
  const configuredAdequate = Number(rawObject.adequateTopicCandidateCount ?? configDigest?.trustedFloorAdequateTopicCandidateCount);
  const minTrustedItemsPerTopic = Number.isFinite(configuredMin)
    ? Math.min(targetCount, Math.max(0, Math.trunc(configuredMin)))
    : Math.min(4, targetCount);
  const adequateTopicCandidateCount = Number.isFinite(configuredAdequate)
    ? Math.max(targetCount, Math.trunc(configuredAdequate))
    : Math.max(15, targetCount * 3);
  return {
    enabled: raw !== false && rawObject.enabled !== false,
    minTrustedItemsPerTopic,
    adequateTopicCandidateCount,
  };
}

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
    duplicate_of: item?.duplicate_of ? String(item.duplicate_of) : null,
    ...extras,
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
    // Domain-scope guard: if the source domain is a known specialist, only allow
    // reassignment to topics within its authoritative scope.
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

    // MVP transparent scoring: score every candidate before selection.
    // The formula (spec §2.4): score = freshness×0.35 + source_tier×0.35 + lane_bonus×0.15 + novelty×0.15
    // Scored items are sorted by _score descending so the selection policy
    // always sees the highest-scoring items first.
    const scoringConfig = paramScoringConfig && typeof paramScoringConfig === "object"
      ? paramScoringConfig
      : (CONFIG.digest?.scoring || {});
    const scoredItems = scoreCandidates(scoringInput, { scoringConfig, nowMs });

    // --- Post-score strategic boost ---
    let postScoreItems = scoredItems;
    if (classificationEnabled) {
      const boostAmount = CONFIG.digest?.classification?.boost_amount ?? 0.12;
      const boostInThinPool = CONFIG.digest?.classification?.boost_in_thin_pool ?? true;
      const { boosted, diagnostics: bDiag } = boostHighRelevance(scoredItems, { boostAmount, boostInThinPool, log });
      boostDiagnostics = bDiag;
      // Re-sort after boost so selection sees correct order
      boosted.sort((a, b) => (b._score || 0) - (a._score || 0));
      postScoreItems = boosted;
    }

    if (postScoreItems.length > 0) {
      const topScore = postScoreItems[0]?._score?.toFixed(3) ?? "?";
      const bottomScore = postScoreItems[postScoreItems.length - 1]?._score?.toFixed(3) ?? "?";
      log(`Scored ${postScoreItems.length} candidate(s): top=${topScore}, bottom=${bottomScore}`);
    }

    // MVP per-topic selection: exactly 5 items per topic when the pool supports it.
    // Fallback hierarchy stays inside the 48h cap:
    // 1. event-driven items from the last 24h
    // 2. event-driven items from 24–48h
    // 3. at most one strong analysis/commentary item if still needed
    const itemsPerTopic = 5;
    const maxDiscoveryPerTopic = Math.max(0, Number(CONFIG.digest.maxDiscoveryItemsPerTopic ?? 1));
    const effectiveMaxItemsPerSourceDomain = resolveEffectiveSourceCap(paramScoringConfig, CONFIG.digest);
    const trustedSelectionFloor = resolveTrustedSelectionFloor(CONFIG.digest || {}, itemsPerTopic);

    // Group scored+sorted candidates by topic tag.
    const byTag = new Map();
    for (const item of postScoreItems) {
      const topicTag = String(item?.tag || "").trim().toUpperCase() || "__untagged__";
      if (!byTag.has(topicTag)) byTag.set(topicTag, []);
      byTag.get(topicTag).push(item);
    }

    // Select per topic with a controlled fallback hierarchy that never exceeds 48h.
    const perTopicSelected = [];
    const selectedByTopic = Object.create(null);
    const reserveByTopic = Object.create(null);
    const trustedFloorByTopic = Object.create(null);
    let totalDiscoveryCapped = 0;
    const topicSelectionAudit = [];
    const selectionRejectionCounts = Object.create(null);
    for (const [topicTag, topicItems] of byTag.entries()) {
      const topicSelection = selectTopicItemsWithFallback({
        topicItems,
        itemsPerTopic,
        maxItemsPerSourceDomain: effectiveMaxItemsPerSourceDomain,
        maxDiscoveryPerTopic,
        nowMs,
        trustedSelectionFloor,
      });
      const {
        selected: topicAcceptedItems,
        rejectionReasonByItem,
        pools,
        commentarySelectedCount,
        trustedFloor,
      } = topicSelection;
      trustedFloorByTopic[topicTag] = {
        ...trustedFloor,
      };
      const { tier1, tier2, tier3, commentaryPool } = pools;
      const tieredPool = [...tier1, ...tier2];

      if (topicAcceptedItems.length < itemsPerTopic) {
        log(`⚠️ Topic ${topicTag}: only ${topicAcceptedItems.length}/${itemsPerTopic} items selected (event_0_24=${pools.eventTier1.length}, event_24_48=${pools.eventTier2.length}, commentary=${commentaryPool.length}, stale=${tier3.length})`);
      }

      totalDiscoveryCapped += Array.from(rejectionReasonByItem.values()).filter((reason) => reason === "selection_discovery_cap").length;
      perTopicSelected.push(...topicAcceptedItems);
      selectedByTopic[topicTag] = topicAcceptedItems.slice();
      reserveByTopic[topicTag] = buildTopicReserveQueue({
        pools,
        selectedItems: topicAcceptedItems,
      });

      const topicReasonCounts = Object.create(null);
      const selectedSet = new Set(topicAcceptedItems);
      const topicCandidates = tieredPool.map((item) => {
        const selectedForTopic = selectedSet.has(item);
        const selectionReason = selectedForTopic
          ? (item._selection_stage || "primary_selection")
          : String(rejectionReasonByItem.get(item) || "selection_not_selected");
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
        rejected_count: Math.max(0, topicItems.length - topicAcceptedItems.length),
        tier_counts: {
          tier1: tier1.length,
          tier2: tier2.length,
          tier3: tier3.length,
        },
        fallback_stage_counts: {
          event_tier1: pools.eventTier1.length,
          event_tier2: pools.eventTier2.length,
          commentary_candidates: commentaryPool.length,
          commentary_selected: commentarySelectedCount,
        },
        trusted_floor: {
          ...trustedFloor,
        },
        reserve_candidate_count: reserveByTopic[topicTag].length,
        per_source_cap: effectiveMaxItemsPerSourceDomain,
        lane_breakdown: topicLaneCounts,
        rejection_reason_counts: topicReasonCounts,
        candidates: topicCandidates,
      });
    }
    let selected = perTopicSelected;
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

    log(`Selected ${selected.length} items (${byTag.size} topic(s), ${itemsPerTopic}/topic, discoveryCapPerTopic=${maxDiscoveryPerTopic}, sourceCap=${effectiveMaxItemsPerSourceDomain})`);

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
        },
        candidate_pool_after_pre_ranking_quality: strictQualityConfig.enabled ? preRankingItems.length : annotatedItems.length,
        candidate_pool_after_classification: classificationEnabled ? scoringInput.length : null,
        effective_max_items_per_source_domain: effectiveMaxItemsPerSourceDomain,
        storyline_cluster_removed_count: storylineClusterRemovedCount,
        best_fit_topic_reassigned_count: bestFitTopicReassignedCount,
        candidate_pool_scored: postScoreItems.length,
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
        score_top: postScoreItems[0]?._score ?? null,
        score_bottom: postScoreItems.length > 0 ? postScoreItems[postScoreItems.length - 1]?._score ?? null : null,
        selection_rejection_counts: selectionRejectionCounts,
        scored_candidates: postScoreItems.map((item) => toSelectionAuditCandidate(item)),
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
