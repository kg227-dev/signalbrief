"use strict";

const { normalizeSourcePolicyDomain } = require("../runtime/source-policy-registry-runtime");
const { canonicalizeMvpTopicTag } = require("../runtime/topic-normalization-runtime");
const { scoreCandidate } = require("../domains/scoring/score-candidate");
const {
  createConversionFunnel,
  mergeConversionFunnel,
} = require("../digest/runtime/digest-data-fetch-items-runtime");

// Topics with at least this many broker (RSS/official) candidates skip Perplexity entirely.
// Set at 2× the per-topic selection target so we always have a full candidate pool without AI search.
const BROKER_SATURATION_THRESHOLD = 10;

const DEFAULT_SEARCH_BUDGET = Object.freeze({
  scheduled: Object.freeze({
    soft_calls: 24,
    hard_calls: 36,
  }),
});
const DEFAULT_MAX_FETCH_CONCURRENCY = 4;
const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 1_250;
const DEFAULT_RATE_LIMIT_MAX_COOLDOWN_MS = 20_000;
const DEFAULT_RATE_LIMIT_BACKOFF_LEVEL_MAX = 3;
const DEFAULT_MAX_DISCOVERY_CANDIDATE_SHARE = 0.2;
const DEFAULT_RETENTION_HOURS_FOR_INVENTORY = 72;
const STANDARD_ONLY_AGGRESSIVE_RUN_MODES = new Set(["standard_topics", "standard_phase1"]);
// MVP topic set. Regulatory coverage surfaces under the closest sector topic
// through sector official sources. CONSUMER & RETAIL and INDUSTRIALS added.
const PHASE1_STANDARD_TOPIC_TAGS = new Set([
  "HEALTHCARE",
  "LIFE SCIENCES",
  "TECHNOLOGY",
  "ENERGY",
  "FINANCIAL SERVICES",
  "CONSUMER & RETAIL",
  "INDUSTRIALS",
]);
// Alias — all standard-run paths use the same MVP set, preventing drift.
const ALL_STANDARD_TOPIC_TAGS = PHASE1_STANDARD_TOPIC_TAGS;
const PHASE1_FOCUS_STANDARD_TOPIC_TAGS = new Set([
  "TECHNOLOGY",
  "ENERGY",
  "FINANCIAL SERVICES",
]);
const TRACKED_TOPIC_QUERY_OVERRIDES = Object.freeze({
  HEALTHCARE: Object.freeze([
    "hospital system merger acquisition payer provider strategy Reuters Modern Healthcare STAT last 48 hours",
    "Medicare Advantage payer provider value-based care CMS hospital strategy last 48 hours",
    "clinical AI hospital operations FDA healthcare rollout provider strategy last 48 hours",
    "health system labor reimbursement payer prior authorization healthcare last 48 hours",
  ]),
  "FINANCIAL SERVICES": Object.freeze([
    "bank regulation capital liquidity private credit lending Reuters Bloomberg FT WSJ last 48 hours",
    "Federal Reserve OCC FDIC CFPB bank supervision capital rule last 48 hours",
    "payments cards fintech bank partnership enforcement last 48 hours",
    "asset management insurance wealth regulation strategy last 48 hours",
  ]),
  ENERGY: Object.freeze([
    "utility grid transmission interconnection power demand policy Reuters Utility Dive FERC last 48 hours",
    "renewables battery storage utility strategy power demand last 48 hours",
    "oil gas LNG refinery energy markets capex strategy last 48 hours",
    "transformer transmission data center load energy reliability last 48 hours",
  ]),
  "CONSUMER & RETAIL": Object.freeze([
    "retail earnings pricing promotion store traffic consumer demand Reuters WSJ last 48 hours",
    "consumer brand strategy supply chain tariff pricing last 48 hours",
    "ecommerce marketplace retail media grocery apparel last 48 hours",
    "restaurant grocery apparel retail restructuring antitrust FTC last 48 hours",
  ]),
  "LIFE SCIENCES": Object.freeze([
    "FDA approval clinical trial pharma licensing biotech STAT Fierce last 48 hours",
    "biopharma M&A licensing deal trial readout last 48 hours",
    "drug pricing obesity drug biotech manufacturing last 48 hours",
    "clinical readout trial setback biotech financing last 48 hours",
  ]),
  TECHNOLOGY: Object.freeze([
    "enterprise software cloud infrastructure CIO platform strategy Reuters Bloomberg FT WSJ last 48 hours",
    "data center AI infrastructure enterprise tech capex export controls last 48 hours",
    "cybersecurity enterprise software vendor strategy regulation last 48 hours",
    "semiconductor cloud enterprise platform pricing product launch Reuters Bloomberg last 48 hours",
  ]),
  INDUSTRIALS: Object.freeze([
    "manufacturing automation reshoring supply chain industrial strategy Reuters last 48 hours",
    "aerospace defense logistics freight industrial demand last 48 hours",
    "factory capex industrial order book pricing last 48 hours",
    "procurement tariff trade industrial supply chain last 48 hours",
  ]),
});
const TRACKED_DEEP_STANDARD_TAGS = new Set([
  "HEALTHCARE",
  "LIFE SCIENCES",
  "TECHNOLOGY",
  "ENERGY",
  "FINANCIAL SERVICES",
  "CONSUMER & RETAIL",
  "INDUSTRIALS",
]);
const FULL_EXHAUST_STANDARD_TAGS = new Set([
  "HEALTHCARE",
  "LIFE SCIENCES",
  "TECHNOLOGY",
  "ENERGY",
  "FINANCIAL SERVICES",
]);

function resolveSelectionTarget(dueUsers, defaultItemCount = 5) {
  return 5;
}

function buildTagPriority(dueUsers, normalizeTopicToken) {
  const topicNormalizer = typeof normalizeTopicToken === "function"
    ? normalizeTopicToken
    : (value) => String(value || "").toLowerCase().trim();
  const priority = {};
  for (const user of (Array.isArray(dueUsers) ? dueUsers : [])) {
    for (const topic of (Array.isArray(user?.topics) ? user.topics : [])) {
      const key = topicNormalizer(topic);
      if (!key) continue;
      priority[key] = (priority[key] || 0) + 1;
    }
  }
  return priority;
}

function sanitizeConfigTopicsToMvp(configTopics = []) {
  const seenTags = new Set();
  const topics = [];
  for (const rawTopic of (Array.isArray(configTopics) ? configTopics : [])) {
    const canonicalTag = canonicalizeMvpTopicTag(rawTopic?.tag);
    if (!canonicalTag || seenTags.has(canonicalTag)) continue;
    seenTags.add(canonicalTag);
    const overrideQueries = TRACKED_TOPIC_QUERY_OVERRIDES[canonicalTag];
    topics.push({
      ...(rawTopic && typeof rawTopic === "object" ? rawTopic : {}),
      tag: canonicalTag,
      queries: Array.isArray(overrideQueries) && overrideQueries.length > 0
        ? overrideQueries.slice()
        : (Array.isArray(rawTopic?.queries) ? rawTopic.queries.slice() : []),
    });
  }
  return topics;
}

function resolveTopicsToFetch({ configTopics, dueUsers, runMode, log }) {
  const topics = sanitizeConfigTopicsToMvp(configTopics);
  const logger = typeof log === "function" ? log : () => {};
  if (String(runMode || "").trim() === "admin_topic_audit_rerun") {
    const focusedTags = new Set(
      flattenDueUserTopics(dueUsers)
        .map((value) => canonicalizeMvpTopicTag(value))
        .filter(Boolean)
    );
    const focusedTopics = topics.filter((topic) => focusedTags.has(String(topic?.tag || "").trim().toUpperCase()));
    logger(`Admin topic audit rerun: fetching ${focusedTopics.length}/${topics.length} topic(s) for ${Array.from(focusedTags).join(", ") || "none"}`);
    return focusedTopics;
  }
  if (String(runMode || "").trim() === "standard_core") {
    const focusedTags = buildFocusedStandardTagSet(dueUsers, (value) => String(value || "").trim().toUpperCase());
    const focusedTopics = topics.filter((topic) => focusedTags.has(String(topic?.tag || "").trim().toUpperCase()));
    logger(`Focused eval: fetching ${focusedTopics.length}/${topics.length} standard topic(s) for ${runMode}`);
    return focusedTopics;
  }
  if (String(runMode || "").trim() === "standard_phase1") {
    const phase1Topics = topics.filter((topic) => PHASE1_STANDARD_TOPIC_TAGS.has(String(topic?.tag || "").trim().toUpperCase()));
    logger(`Phase 1 eval: fetching ${phase1Topics.length}/${topics.length} standard topic(s) for ${runMode}`);
    return phase1Topics;
  }
  if (String(runMode || "").trim() === "standard_phase1_focus") {
    const focusTopics = topics.filter((topic) => PHASE1_FOCUS_STANDARD_TOPIC_TAGS.has(String(topic?.tag || "").trim().toUpperCase()));
    logger(`Focused Phase 1 eval: fetching ${focusTopics.length}/${topics.length} standard topic(s) for ${runMode}`);
    return focusTopics;
  }
  if (isAggressiveStandardRun(runMode)) {
    const focusedTags = buildAllStandardTagSet(dueUsers, (value) => String(value || "").trim().toUpperCase());
    const focusedTopics = topics.filter((topic) => focusedTags.has(String(topic?.tag || "").trim().toUpperCase()));
    logger(`Standard-only eval: fetching ${focusedTopics.length}/${topics.length} standard topic(s) for ${runMode}`);
    return focusedTopics;
  }
  return topics;
}

function isTrackedDeepCoverageState(state) {
  const tag = String(state?.topic?.tag || "").trim().toUpperCase();
  return TRACKED_DEEP_STANDARD_TAGS.has(tag);
}

function buildFocusedStandardTagSet(dueUsers = [], normalizeTopicToken = (value) => String(value || "").trim().toUpperCase()) {
  const normalized = typeof normalizeTopicToken === "function"
    ? normalizeTopicToken
    : (value) => String(value || "").trim().toUpperCase();
  const focused = new Set();
  for (const topic of flattenDueUserTopics(dueUsers)) {
    const key = canonicalizeMvpTopicTag(topic) || String(normalized(topic) || "").trim().toUpperCase();
    if (!key) continue;
    if (FULL_EXHAUST_STANDARD_TAGS.has(key)) focused.add(key);
  }
  return focused;
}

function buildAllStandardTagSet(dueUsers = [], normalizeTopicToken = (value) => String(value || "").trim().toUpperCase()) {
  const normalized = typeof normalizeTopicToken === "function"
    ? normalizeTopicToken
    : (value) => String(value || "").trim().toUpperCase();
  const focused = new Set();
  for (const topic of flattenDueUserTopics(dueUsers)) {
    const key = canonicalizeMvpTopicTag(topic) || String(normalized(topic) || "").trim().toUpperCase();
    if (!key || !ALL_STANDARD_TOPIC_TAGS.has(key)) continue;
    focused.add(key);
  }
  return focused;
}

function isFocusedStandardDeepCoverageState(state, focusedStandardTags) {
  const tag = String(state?.topic?.tag || "").trim().toUpperCase();
  return focusedStandardTags instanceof Set && focusedStandardTags.has(tag);
}

function flattenDueUserTopics(dueUsers = []) {
  const topics = [];
  for (const user of (Array.isArray(dueUsers) ? dueUsers : [])) {
    for (const topic of (Array.isArray(user?.topics) ? user.topics : [])) {
      topics.push(topic);
    }
  }
  return topics;
}

function uniqueValues(values = []) {
  return Array.from(new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  ));
}

function isAggressiveStandardRun(runMode) {
  return STANDARD_ONLY_AGGRESSIVE_RUN_MODES.has(String(runMode || "").trim());
}

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

function toBoundedInt(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.trunc(parsed);
  if (normalized < min) return min;
  if (normalized > max) return max;
  return normalized;
}

function resolveSearchBudget(digestConfig) {
  const configured = digestConfig?.search_budget || {};
  const modeKey = "scheduled";
  const modeDefaults = DEFAULT_SEARCH_BUDGET[modeKey];
  const modeConfigured = configured?.[modeKey] || {};
  const hardCalls = toBoundedInt(modeConfigured?.hard_calls, modeDefaults.hard_calls, { min: 1, max: 200 });
  const softCalls = Math.min(
    hardCalls,
    toBoundedInt(modeConfigured?.soft_calls, modeDefaults.soft_calls, { min: 1, max: 200 })
  );
  return {
    mode: modeKey,
    soft_calls: softCalls,
    hard_calls: hardCalls,
  };
}

function applyRunModeSearchBudgetOverrides(searchBudget, { runMode, standardTopicCount = 0 } = {}) {
  const base = searchBudget && typeof searchBudget === "object" ? searchBudget : resolveSearchBudget({});
  if (!isAggressiveStandardRun(runMode)) return base;
  const standardCount = Math.max(0, Number(standardTopicCount || 0));
  return {
    ...base,
    soft_calls: Math.max(base.soft_calls, Math.min(96, (standardCount * 3) + 8)),
    hard_calls: Math.max(base.hard_calls, Math.min(120, (standardCount * 4) + 12)),
  };
}

function resolveFetchConcurrency(digestConfig) {
  const configured = digestConfig?.providerResilience?.perplexity?.maxConcurrentFetches;
  return toBoundedInt(
    process.env.SIGNALBRIEF_PERPLEXITY_MAX_CONCURRENT_FETCHES || configured,
    DEFAULT_MAX_FETCH_CONCURRENCY,
    { min: 1, max: 24 }
  );
}

function normalizeCandidateDomain(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return normalizeSourcePolicyDomain(new URL(raw).hostname);
  } catch {
    return normalizeSourcePolicyDomain(raw.replace(/^https?:\/\//i, "").split("/")[0]);
  }
}

function matchesDomain(sourceDomain, candidateDomain) {
  const source = normalizeCandidateDomain(sourceDomain);
  const candidate = normalizeCandidateDomain(candidateDomain);
  if (!source || !candidate) return false;
  return source === candidate || source.endsWith(`.${candidate}`);
}

function buildItemDedupKey(item, normalizeUrlForDedup) {
  const url = String(item?.url || "").trim();
  const normalizedUrl = typeof normalizeUrlForDedup === "function"
    ? String(normalizeUrlForDedup(url) || "").trim()
    : url.toLowerCase();
  if (normalizedUrl) return `url:${normalizedUrl}`;
  const headline = String(item?.headline || "").trim().toLowerCase();
  const source = normalizeCandidateDomain(item?.source_domain || item?.source || item?.url);
  if (headline) return `headline:${headline}::${source}`;
  return "";
}

function countUsableItems(items, isFetchedItemEligible) {
  const eligibilityFn = typeof isFetchedItemEligible === "function"
    ? isFetchedItemEligible
    : () => true;
  return (Array.isArray(items) ? items : []).reduce((sum, item) => {
    return sum + (eligibilityFn(item) !== false ? 1 : 0);
  }, 0);
}

function isBrokerRetrievalOrigin(value) {
  const origin = String(value || "").trim().toLowerCase();
  return origin === "broker_official" || origin === "broker_publisher_feed";
}

function isDiscoverySupplementItem(item) {
  return !isBrokerRetrievalOrigin(item?.retrieval_origin || item?.retrieval_lane || "");
}

function resolveMaxDiscoveryCandidateShare(digestConfig) {
  const configured = Number(digestConfig?.maxDiscoveryCandidateShare ?? DEFAULT_MAX_DISCOVERY_CANDIDATE_SHARE);
  if (!Number.isFinite(configured)) return DEFAULT_MAX_DISCOVERY_CANDIDATE_SHARE;
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

function buildStateCandidateInventory(state) {
  const retrievalOriginCounts = {
    preferred: 0,
    broad: 0,
    trusted_official: 0,
    trusted_reported: 0,
    broker_official: 0,
    broker_publisher_feed: 0,
  };
  const retrievalSourceFamilyCounts = {
    official: 0,
    reported: 0,
    specialist: 0,
    corporate: 0,
    other_unknown: 0,
  };
  let brokerItemCount = 0;
  let brokerOfficialItemCount = 0;
  let brokerPublisherFeedItemCount = 0;
  let discoveryItemCount = 0;
  const brokerSourceIds = [];
  const brokerSourceIdSet = new Set();

  for (const item of (Array.isArray(state?.items) ? state.items : [])) {
    const originKey = String(item?.retrieval_origin || "").trim().toLowerCase() || "broad";
    retrievalOriginCounts[originKey] = Number(retrievalOriginCounts[originKey] || 0) + 1;
    const sourceFamily = String(item?.retrieval_source_family || "").trim() || classifyRetrievedSourceFamily(item, state);
    retrievalSourceFamilyCounts[sourceFamily] = Number(retrievalSourceFamilyCounts[sourceFamily] || 0) + 1;
    if (isBrokerRetrievalOrigin(originKey)) {
      brokerItemCount += 1;
      if (originKey === "broker_official") brokerOfficialItemCount += 1;
      if (originKey === "broker_publisher_feed") brokerPublisherFeedItemCount += 1;
      const sourceId = String(item?.broker_source_id || "").trim();
      if (sourceId && !brokerSourceIdSet.has(sourceId)) {
        brokerSourceIdSet.add(sourceId);
        brokerSourceIds.push(sourceId);
      }
    } else {
      discoveryItemCount += 1;
    }
  }

  const totalCount = Math.max(0, Number((Array.isArray(state?.items) ? state.items.length : 0) || 0));
  return {
    totalCount,
    brokerItemCount,
    brokerOfficialItemCount,
    brokerPublisherFeedItemCount,
    discoveryItemCount,
    discoveryCandidateSharePct: totalCount > 0 ? Number(((discoveryItemCount / totalCount) * 100).toFixed(2)) : 0,
    brokerCandidateSharePct: totalCount > 0 ? Number(((brokerItemCount / totalCount) * 100).toFixed(2)) : 0,
    retrievalOriginCounts,
    retrievalSourceFamilyCounts,
    brokerSourceIds,
  };
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

function annotateItemsForFetch(items, annotateFetchedItems) {
  if (typeof annotateFetchedItems !== "function") return Array.isArray(items) ? items : [];
  try {
    return annotateFetchedItems(Array.isArray(items) ? items : []);
  } catch {
    return Array.isArray(items) ? items : [];
  }
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

function classifyRetrievedSourceFamily(item, state) {
  const sourceDomain = normalizeCandidateDomain(item?.source_domain || item?.source || item?.url);
  const sourceType = String(item?.source_type || "").trim().toLowerCase();
  const sourceTier = normalizeSourceTierForFetch(item?.source_tier);
  const officialDomains = Array.isArray(state?.officialDomains) ? state.officialDomains : [];
  const reportedDomains = Array.isArray(state?.reportedDomains) ? state.reportedDomains : [];
  const globalReportedDomains = Array.isArray(state?.globalReportedDomains) ? state.globalReportedDomains : [];
  if (sourceDomain && officialDomains.some((domain) => matchesDomain(sourceDomain, domain))) return "official";
  if (sourceType === "corporate_pr" || sourceTier === "corporate") return "corporate";
  if (sourceDomain && reportedDomains.some((domain) => matchesDomain(sourceDomain, domain))) {
    const isGlobalReported = globalReportedDomains.some((domain) => matchesDomain(sourceDomain, domain));
    return isGlobalReported ? "reported" : "specialist";
  }
  if (sourceType === "trade_specialist" || sourceType === "analysis_blog") return "specialist";
  if (sourceType === "reported_media") return "reported";
  return "other_unknown";
}

function buildTrustedFamilyQueue(shortlist = {}, familyShortlists = {}) {
  const queue = [];
  const seenDomains = new Set();

  function pushFamily(name, domains, officialFriendly) {
    const normalizedDomains = (Array.isArray(domains) ? domains : [])
      .map((domain) => String(domain || "").trim())
      .filter(Boolean)
      .filter((domain) => {
        if (seenDomains.has(domain)) return false;
        seenDomains.add(domain);
        return true;
      });
    if (normalizedDomains.length <= 0) return;
    queue.push({
      name,
      domains: normalizedDomains,
      official_friendly: officialFriendly === true,
    });
  }

  const officialFriendly = shortlist?.official_friendly === true || familyShortlists?.official_friendly === true;
  if (officialFriendly) {
    pushFamily("official", familyShortlists?.official_domains, true);
    pushFamily("reported", familyShortlists?.reported_domains, false);
  } else {
    pushFamily("reported", familyShortlists?.reported_domains, false);
    pushFamily("official", familyShortlists?.official_domains, true);
  }
  return queue;
}

function buildTopicState(topic, shortlist, familyShortlists, priority, originalIndex) {
  return {
    topic,
    priority: Math.max(0, Number(priority || 0)),
    originalIndex: Math.max(0, Number(originalIndex || 0)),
    preferredDomains: Array.isArray(shortlist?.domains)
      ? shortlist.domains.map((domain) => String(domain || "").trim()).filter(Boolean)
      : [],
    topicKeys: Array.isArray(shortlist?.topic_keys) ? shortlist.topic_keys.slice() : [],
    officialFriendly: shortlist?.official_friendly === true,
    officialDomains: Array.isArray(familyShortlists?.official_domains) ? familyShortlists.official_domains.slice() : [],
    reportedDomains: Array.isArray(familyShortlists?.reported_domains) ? familyShortlists.reported_domains.slice() : [],
    globalOfficialDomains: Array.isArray(familyShortlists?.global_official_domains) ? familyShortlists.global_official_domains.slice() : [],
    globalReportedDomains: Array.isArray(familyShortlists?.global_reported_domains) ? familyShortlists.global_reported_domains.slice() : [],
    trustedFamilyQueue: buildTrustedFamilyQueue(shortlist, familyShortlists),
    nextTrustedFamilyIndex: 0,
    items: [],
    itemKeys: new Set(),
    totalCallsScheduled: 0,
    preferredCallsMade: 0,
    broadCallsMade: 0,
    trustedFamilyCallsMade: 0,
    trustedOfficialCallsMade: 0,
    trustedReportedCallsMade: 0,
    broadFallbackUsed: false,
    nextPreferredQueryIndex: 0,
    nextBroadQueryIndex: 0,
    zeroYieldRetryCount: 0,
    zeroYieldRetryStreak: 0,
    retryBlockReason: null,
    apiCalls: 0,
    provider: {
      degraded: false,
      failed_calls: 0,
      transport_errors: 0,
      successful_calls: 0,
      status_counts: {},
      last_error: null,
    },
    preferredPassItemCount: 0,
    broadPassItemCount: 0,
    trustedFamilyPassItemCount: 0,
    retrievalOriginCounts: {
      preferred: 0,
      broad: 0,
      trusted_official: 0,
      trusted_reported: 0,
      broker_official: 0,
      broker_publisher_feed: 0,
    },
    retrievalSourceFamilyCounts: {
      official: 0,
      reported: 0,
      specialist: 0,
      corporate: 0,
      other_unknown: 0,
    },
    conversionFunnel: createConversionFunnel(),
    searchResultDomains: [],
    preferredSearchResultDomains: [],
    preferredSearchResultHitCount: 0,
    brokerItemCount: 0,
    brokerOfficialItemCount: 0,
    brokerPublisherFeedItemCount: 0,
    brokerSourceIds: [],
  };
}

function mergeUniqueItemsIntoState(state, items, normalizeUrlForDedup, isFetchedItemEligible) {
  const incoming = Array.isArray(items) ? items : [];
  let addedUniqueCount = 0;
  let addedUsableCount = 0;
  const addedItems = [];
  for (const item of incoming) {
    const key = buildItemDedupKey(item, normalizeUrlForDedup);
    if (!key || state.itemKeys.has(key)) continue;
    state.itemKeys.add(key);
    state.items.push(item);
    addedItems.push(item);
    addedUniqueCount += 1;
    if ((typeof isFetchedItemEligible === "function" ? isFetchedItemEligible(item) : true) !== false) {
      addedUsableCount += 1;
    }
  }
  return {
    addedUniqueCount,
    addedUsableCount,
    addedItems,
  };
}

function mergeBrokerItemsIntoState(state, items, normalizeUrlForDedup, isFetchedItemEligible, annotateFetchedItems) {
  const merged = mergeUniqueItemsIntoState(state, items, normalizeUrlForDedup, isFetchedItemEligible);
  const annotatedAddedItems = annotateItemsForFetch(merged.addedItems, annotateFetchedItems);
  for (let index = 0; index < merged.addedItems.length; index += 1) {
    const item = merged.addedItems[index];
    const annotatedItem = annotatedAddedItems[index] || item;
    const originKey = String(item?.retrieval_origin || "").trim() === "broker_official"
      ? "broker_official"
      : "broker_publisher_feed";
    const sourceFamily = String(item?.retrieval_source_family || "").trim()
      || classifyRetrievedSourceFamily(annotatedItem, state);
    item.retrieval_origin = originKey;
    item.retrieval_source_family = sourceFamily;
    state.retrievalOriginCounts[originKey] = (state.retrievalOriginCounts[originKey] || 0) + 1;
    state.retrievalSourceFamilyCounts[sourceFamily] = (state.retrievalSourceFamilyCounts[sourceFamily] || 0) + 1;
    state.brokerItemCount += 1;
    if (originKey === "broker_official") state.brokerOfficialItemCount += 1;
    if (originKey === "broker_publisher_feed") state.brokerPublisherFeedItemCount += 1;
    const sourceId = String(item?.broker_source_id || "").trim();
    if (sourceId && !state.brokerSourceIds.includes(sourceId)) state.brokerSourceIds.push(sourceId);
  }
  return merged;
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

function preloadBrokerInventoryIntoStates(states, brokerCandidateInventory, helpers = {}) {
  if (!brokerCandidateInventory) return 0;
  const normalizeUrlForDedup = typeof helpers.normalizeUrlForDedup === "function" ? helpers.normalizeUrlForDedup : null;
  const itemEligibilityFn = typeof helpers.isFetchedItemEligible === "function" ? helpers.isFetchedItemEligible : null;
  const annotateFetched = typeof helpers.annotateFetchedItems === "function" ? helpers.annotateFetchedItems : null;
  const nowMs = Number.isFinite(Number(helpers.nowMs)) ? Number(helpers.nowMs) : Date.now();
  const maxAgeHours = Number.isFinite(Number(helpers.maxAgeHours)) ? Number(helpers.maxAgeHours) : 48;
  let loadedCount = 0;
  for (const state of (Array.isArray(states) ? states : [])) {
    const tag = String(state?.topic?.tag || "").trim().toUpperCase();
    if (!tag) continue;
    const cachedItems = brokerCandidateInventory.loadRecentTopicItems(tag, { nowMs, maxAgeHours });
    if (!Array.isArray(cachedItems) || cachedItems.length <= 0) continue;
    const merged = mergeBrokerItemsIntoState(state, cachedItems, normalizeUrlForDedup, itemEligibilityFn, annotateFetched);
    loadedCount += Number(merged?.addedUniqueCount || 0);
  }
  return loadedCount;
}

function persistBrokerInventory(brokerCandidateInventory, topicItems, opts = {}) {
  if (!brokerCandidateInventory) return null;
  const nowMs = Number.isFinite(Number(opts.nowMs)) ? Number(opts.nowMs) : Date.now();
  const maxAgeHours = Number.isFinite(Number(opts.maxAgeHours)) ? Number(opts.maxAgeHours) : 48;
  return brokerCandidateInventory.persistBrokerTopicItems(topicItems, {
    nowMs,
    retentionHours: Math.max(DEFAULT_RETENTION_HOURS_FOR_INVENTORY, maxAgeHours + 24),
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

function hasBlockingProviderFailure(state) {
  const failedCalls = Math.max(0, Number(state?.provider?.failed_calls || 0));
  const rateLimitedCalls = Math.max(0, countStatusCode(state, 429));
  return Number(state?.provider?.transport_errors || 0) > 0
    || Math.max(0, failedCalls - rateLimitedCalls) > 0;
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
  if (hasBlockingProviderFailure(state)) return "provider_failure_blocked";
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

function buildFetchDiagnostics(states, budgetTracker, maxFetchConcurrency, brokerDiagnostics) {
  const attemptedStates = (Array.isArray(states) ? states : []).filter((state) => Number(state?.totalCallsScheduled || 0) > 0);
  const preferredDomainsUsed = uniqueValues(attemptedStates.flatMap((state) => state.preferredDomains || []));
  const searchResultDomains = uniqueValues(attemptedStates.flatMap((state) => state.searchResultDomains || []));
  const preferredSearchResultDomains = uniqueValues(attemptedStates.flatMap((state) => state.preferredSearchResultDomains || []));
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
    max_concurrent_fetches: Math.max(1, Number(maxFetchConcurrency || DEFAULT_MAX_FETCH_CONCURRENCY)),
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

function createDigestOrchestratorFetchRuntime(deps) {
  const {
    CONFIG,
    log,
    normalizeTopicToken,
    fetchTopicNews,
    buildPreferredDomainShortlist,
    buildPreferredSourceFamilyShortlists,
    emitDigestIncident,
    normalizeUrlForDedup,
    isFetchedItemEligible,
    annotateFetchedItems,
    standardTopicBrokerRuntime,
    brokerCandidateInventoryRuntime,
  } = deps || {};
  const logger = typeof log === "function" ? log : () => {};
  const topicNormalizer = typeof normalizeTopicToken === "function"
    ? normalizeTopicToken
    : (value) => String(value || "").toLowerCase().trim();
  const fetchTopic = typeof fetchTopicNews === "function" ? fetchTopicNews : async () => ({ items: [], apiCalls: 0 });
  const buildPreferredShortlist = typeof buildPreferredDomainShortlist === "function"
    ? buildPreferredDomainShortlist
    : () => ({ domains: [], topic_keys: [], official_friendly: false });
  const buildPreferredFamilyShortlists = typeof buildPreferredSourceFamilyShortlists === "function"
    ? buildPreferredSourceFamilyShortlists
    : null;
  const emitIncident = typeof emitDigestIncident === "function"
    ? emitDigestIncident
    : async () => false;
  const itemEligibilityFn = typeof isFetchedItemEligible === "function"
    ? isFetchedItemEligible
    : () => true;
  const annotateFetched = typeof annotateFetchedItems === "function"
    ? annotateFetchedItems
    : (items) => Array.isArray(items) ? items : [];
  const standardTopicBroker = standardTopicBrokerRuntime
    && typeof standardTopicBrokerRuntime.fetchBrokerCandidates === "function"
    ? standardTopicBrokerRuntime
    : null;
  const brokerCandidateInventory = brokerCandidateInventoryRuntime
    && typeof brokerCandidateInventoryRuntime.loadRecentTopicItems === "function"
    && typeof brokerCandidateInventoryRuntime.persistBrokerTopicItems === "function"
    ? brokerCandidateInventoryRuntime
    : null;
  const maxFetchConcurrency = resolveFetchConcurrency(CONFIG?.digest);

  function resolveBatchConcurrency(batchName, jobCount, budgetTracker) {
    const batch = String(batchName || "").trim().toLowerCase();
    let limit = Math.max(1, Number(maxFetchConcurrency || DEFAULT_MAX_FETCH_CONCURRENCY));
    if (batch.startsWith("custom:")) limit = Math.min(limit, 2);
    if (batch === "standard:phase1" && Number(jobCount || 0) >= 10) limit = Math.min(limit, 3);
    const backoffLevel = Math.max(0, Number(budgetTracker?.rate_limit_backoff_level || 0));
    if (backoffLevel > 0) {
      limit = Math.max(1, limit - backoffLevel);
      if (batch.startsWith("custom:")) limit = 1;
    }
    return Math.max(1, Math.min(limit, Number(jobCount || 0) || 1));
  }

  async function runWithConcurrency(entries, worker, batchName, budgetTracker) {
    const jobs = Array.isArray(entries) ? entries : [];
    if (jobs.length === 0) return [];
    const results = new Array(jobs.length);
    let cursor = 0;
    const workerCount = resolveBatchConcurrency(batchName, jobs.length, budgetTracker);

    async function consume() {
      while (cursor < jobs.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await worker(jobs[index], index);
      }
    }

    await Promise.all(Array.from({ length: workerCount }, () => consume()));
    return results;
  }

  async function applyRateLimitCooldown(batchName, batchResults, budgetTracker) {
    const results = Array.isArray(batchResults) ? batchResults : [];
    const rateLimitCount = results.reduce((sum, entry) => {
      return sum + Number(entry?.result?.diagnostics?.status_counts?.[429] || 0);
    }, 0);
    if (rateLimitCount <= 0) {
      budgetTracker.rate_limit_backoff_level = Math.max(0, Number(budgetTracker?.rate_limit_backoff_level || 0) - 1);
      return;
    }
    const retryAfterMs = results.reduce((maxDelay, entry) => {
      return Math.max(maxDelay, Number(entry?.result?.diagnostics?.rate_limit_retry_after_ms || 0));
    }, 0);
    budgetTracker.rate_limit_backoff_level = Math.min(
      DEFAULT_RATE_LIMIT_BACKOFF_LEVEL_MAX,
      Math.max(0, Number(budgetTracker?.rate_limit_backoff_level || 0)) + 1
    );
    const adaptiveDelayMs = DEFAULT_RATE_LIMIT_COOLDOWN_MS
      * Math.max(1, rateLimitCount)
      * Math.max(1, Number(budgetTracker.rate_limit_backoff_level || 1));
    const delayMs = Math.min(
      DEFAULT_RATE_LIMIT_MAX_COOLDOWN_MS,
      Math.max(retryAfterMs, adaptiveDelayMs)
    );
    budgetTracker.rate_limit_cooldown_ms = Number(budgetTracker?.rate_limit_cooldown_ms || 0) + delayMs;
    logger(
      `Fetch phase ${batchName}: cooling down ${delayMs}ms after ${rateLimitCount} rate-limit response(s)`
      + ` (backoff level ${budgetTracker.rate_limit_backoff_level})`
    );
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  async function runScheduledBatch(states, buildInvocation, batchName, budgetTracker) {
    const invocations = [];
    for (const state of (Array.isArray(states) ? states : [])) {
      const invocation = buildInvocation(state);
      if (!invocation) continue;
      invocations.push({ state, invocation });
    }
    if (invocations.length === 0) return [];

    budgetTracker.calls_used += invocations.length;
    for (const { state } of invocations) {
      state.totalCallsScheduled += 1;
    }
    logger(`Fetch phase ${batchName}: ${invocations.map(({ state }) => state.topic.tag).join(", ")}`);

    const results = await runWithConcurrency(invocations, async ({ invocation }) => {
      try {
        return await fetchTopic(invocation.topic, invocation.opts);
      } catch (err) {
        return {
          apiCalls: 0,
          items: [],
          diagnostics: {
            provider: "perplexity",
            degraded: true,
            failed_calls: 1,
            transport_errors: 1,
            successful_calls: 0,
            status_counts: {},
            last_error: String(err?.message || err).slice(0, 180),
          },
        };
      }
    }, batchName, budgetTracker);

    const batchResults = invocations.map((entry, idx) => {
      const result = results[idx] || {};
      const state = entry.state;
      const diagnostics = result?.diagnostics && typeof result.diagnostics === "object"
        ? result.diagnostics
        : {};
      state.apiCalls += Math.max(0, Number(result?.apiCalls || 0));
      const usableBefore = countUsableItems(state.items, itemEligibilityFn);
      const merged = mergeUniqueItemsIntoState(state, result?.items, normalizeUrlForDedup, itemEligibilityFn);
      const originKey = entry.invocation.phase === "trusted"
        ? `trusted_${String(entry.invocation.trustedFamilyName || "reported").trim().toLowerCase()}`
        : entry.invocation.phase === "preferred"
          ? "preferred"
          : "broad";
      const annotatedAddedItems = annotateItemsForFetch(merged.addedItems, annotateFetched);
      for (let index = 0; index < merged.addedItems.length; index += 1) {
        const item = merged.addedItems[index];
        const annotatedItem = annotatedAddedItems[index] || item;
        const sourceFamily = classifyRetrievedSourceFamily(annotatedItem, state);
        item.retrieval_origin = originKey;
        item.retrieval_source_family = sourceFamily;
        state.retrievalOriginCounts[originKey] = (state.retrievalOriginCounts[originKey] || 0) + 1;
        state.retrievalSourceFamilyCounts[sourceFamily] = (state.retrievalSourceFamilyCounts[sourceFamily] || 0) + 1;
      }
      const usableAfter = countUsableItems(state.items, itemEligibilityFn);

      state.provider.degraded = state.provider.degraded || diagnostics.degraded === true;
      state.provider.failed_calls += Number(diagnostics.failed_calls || 0);
      state.provider.transport_errors += Number(diagnostics.transport_errors || 0);
      state.provider.successful_calls += Number(diagnostics.successful_calls || 0);
      state.provider.last_error = diagnostics.last_error || state.provider.last_error || null;
      mergeStatusCounts(state.provider.status_counts, diagnostics.status_counts);

      state.searchResultDomains = uniqueValues([
        ...(state.searchResultDomains || []),
        ...(Array.isArray(diagnostics.search_result_domains) ? diagnostics.search_result_domains : []),
      ]);
      state.preferredSearchResultDomains = uniqueValues([
        ...(state.preferredSearchResultDomains || []),
        ...(Array.isArray(diagnostics.preferred_search_result_domains) ? diagnostics.preferred_search_result_domains : []),
      ]);
      state.preferredSearchResultHitCount += Number(diagnostics.preferred_search_result_hit_count || 0);
      mergeConversionFunnel(state.conversionFunnel, diagnostics.conversion_funnel);

      if (entry.invocation.phase === "preferred") {
        state.preferredCallsMade += 1;
        state.preferredPassItemCount += merged.addedUniqueCount;
        state.nextPreferredQueryIndex = Math.max(state.nextPreferredQueryIndex, entry.invocation.queryIndex + 1);
      } else if (entry.invocation.phase === "trusted") {
        const familyName = String(entry.invocation.trustedFamilyName || "").trim().toLowerCase();
        state.trustedFamilyCallsMade += 1;
        state.trustedFamilyPassItemCount += merged.addedUniqueCount;
        state.nextTrustedFamilyIndex = Math.max(
          Number(state.nextTrustedFamilyIndex || 0),
          Number(state.nextTrustedFamilyIndex || 0) + 1
        );
        if (familyName === "official") state.trustedOfficialCallsMade += 1;
        if (familyName === "reported") state.trustedReportedCallsMade += 1;
      } else {
        state.broadCallsMade += 1;
        state.broadPassItemCount += merged.addedUniqueCount;
        state.nextBroadQueryIndex = Math.max(state.nextBroadQueryIndex, entry.invocation.queryIndex + 1);
        if (entry.invocation.broadFallback) state.broadFallbackUsed = true;
      }

      if (entry.invocation.countsAsRetry) {
        if (merged.addedUsableCount <= 0 || usableAfter <= usableBefore) {
          state.zeroYieldRetryCount += 1;
          state.zeroYieldRetryStreak += 1;
          state.retryBlockReason = usableBefore > 0 ? "repeat" : "topic_fit";
        } else {
          state.zeroYieldRetryStreak = 0;
          state.retryBlockReason = null;
        }
      } else if (merged.addedUsableCount > 0) {
        state.zeroYieldRetryStreak = 0;
        state.retryBlockReason = null;
      }

      return {
        state,
        result,
      };
    });
    await applyRateLimitCooldown(batchName, batchResults, budgetTracker);
    return batchResults;
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

  async function orchestrateFetch({ dueUsers, runMode, scoringConfig = null }) {
    const digestConfig = CONFIG?.digest || {};
    const resolvedMaxAgeHours = Number(
      scoringConfig && scoringConfig.maxAgeHours != null
        ? scoringConfig.maxAgeHours
        : (digestConfig.maxArticleAgeHours || 48)
    );
    // On Mondays the 07:00 ET run window covers Saturday→Monday (the weekend trough).
    // Extend the lookback to 72h so Friday content is eligible, supplementing the thin
    // weekend pool. Cross-day dedup prevents repeating items already selected Sunday.
    const etDayOfWeek = new Date().toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short" });
    const isMonday = etDayOfWeek.startsWith("Mon");
    const maxAgeCapHours = isMonday ? 72 : 48;
    const maxAgeHours = Number.isFinite(resolvedMaxAgeHours)
      ? Math.min(maxAgeCapHours, Math.max(1, resolvedMaxAgeHours))
      : maxAgeCapHours;
    const inventoryRefreshOnly = String(runMode || "").trim() === "inventory_refresh";
    const aggressiveStandardRun = isAggressiveStandardRun(runMode);
    const selectionTarget = resolveSelectionTarget(dueUsers, Number(digestConfig.itemCount || 5));
    const tagPriority = buildTagPriority(dueUsers, topicNormalizer);
    const dueUserTopics = flattenDueUserTopics(dueUsers);
    const allStandardTags = buildAllStandardTagSet(dueUsers, (value) => String(value || "").trim().toUpperCase());
    const focusedStandardTags = aggressiveStandardRun
      ? allStandardTags
      : buildFocusedStandardTagSet(dueUsers, (value) => String(value || "").trim().toUpperCase());
    const topicsToFetch = resolveTopicsToFetch({
      configTopics: CONFIG?.topics,
      dueUsers,
      runMode,
      log: logger,
    });

    const searchBudget = resolveSearchBudget(digestConfig);
    const adjustedSearchBudget = applyRunModeSearchBudgetOverrides(searchBudget, {
      runMode,
      standardTopicCount: topicsToFetch.length,
    });
    const budgetTracker = {
      soft_calls: adjustedSearchBudget.soft_calls,
      hard_calls: adjustedSearchBudget.hard_calls,
      calls_used: 0,
      exhausted: false,
      stop_reason: null,
      rate_limit_cooldown_ms: 0,
      rate_limit_backoff_level: 0,
    };

    const standardStates = sortTopicStates(topicsToFetch.map((topic, index) => {
      const shortlist = buildPreferredShortlist({
        topicTag: topic?.tag,
        dueUserTopics,
        queryText: Array.isArray(topic?.queries) ? topic.queries[0] : "",
        maxDomains: 20,
      });
      const familyShortlists = buildPreferredFamilyShortlists
        ? buildPreferredFamilyShortlists({
          topicTag: topic?.tag,
          dueUserTopics,
          queryText: Array.isArray(topic?.queries) ? topic.queries[0] : "",
          maxDomains: 20,
        })
        : {
          reported_domains: [],
          official_domains: [],
          combined_domains: [],
          topic_keys: Array.isArray(shortlist?.topic_keys) ? shortlist.topic_keys.slice() : [],
          official_friendly: shortlist?.official_friendly === true,
        };
      return buildTopicState(
        topic,
        shortlist,
        familyShortlists,
        tagPriority[topicNormalizer(topic?.tag)] || 0,
        index
      );
    }));
    const standardHardLimit = Math.max(0, budgetTracker.hard_calls);
    const standardSoftLimit = Math.max(0, Math.min(standardHardLimit, budgetTracker.soft_calls));

    if (!inventoryRefreshOnly && brokerCandidateInventory) {
      const inventoryLoadedCount = preloadBrokerInventoryIntoStates(standardStates, brokerCandidateInventory, {
        normalizeUrlForDedup,
        isFetchedItemEligible: itemEligibilityFn,
        annotateFetchedItems: annotateFetched,
        nowMs: Date.now(),
        maxAgeHours,
      });
      if (inventoryLoadedCount > 0) {
        logger(`[broker-inventory] preloaded ${inventoryLoadedCount} recent broker candidate(s)`);
      }
    }

    const standardPhase1States = standardStates.filter((state) => (
      Array.isArray(state?.topic?.queries) && state.topic.queries.length > 0
    ));
    const allowedPhase1States = standardPhase1States.slice(0, standardHardLimit);
    if (standardPhase1States.length > allowedPhase1States.length) {
      markBudgetStop(budgetTracker, "hard_cap_reached");
    }

    // Phase 0 (broker-first): Run RSS/official broker before Perplexity so direct-feed
    // candidates are available before any AI search calls are made.
    // Topics that reach BROKER_SATURATION_THRESHOLD candidates skip Perplexity entirely.
    let brokerDiagnostics = null;
    if (standardTopicBroker && standardStates.length > 0) {
      const brokerRetrievedAt = new Date().toISOString();
      const brokerResult = await standardTopicBroker.fetchBrokerCandidates({
        topicStates: standardStates,
        retrievedAt: brokerRetrievedAt,
        maxAgeHours,
      });
      brokerDiagnostics = brokerResult?.diagnostics || null;
      for (const state of standardStates) {
        const tag = String(state?.topic?.tag || "").trim().toUpperCase();
        const brokerItems = Array.isArray(brokerResult?.topicItems?.[tag]) ? brokerResult.topicItems[tag] : [];
        if (brokerItems.length > 0) {
          mergeBrokerItemsIntoState(state, brokerItems, normalizeUrlForDedup, itemEligibilityFn, annotateFetched);
        }
      }
      if (brokerCandidateInventory) {
        try {
          persistBrokerInventory(brokerCandidateInventory, brokerResult?.topicItems || {}, {
            nowMs: Date.now(),
            maxAgeHours,
          });
        } catch (error) {
          logger(`[broker-inventory] persist failed: ${error.message}`);
        }
      }
      const brokerSaturated = standardStates.filter((s) => Number(s.brokerItemCount || 0) >= BROKER_SATURATION_THRESHOLD);
      if (brokerSaturated.length > 0) {
        logger(`Broker-first: ${brokerSaturated.length} topic(s) reached saturation threshold (${BROKER_SATURATION_THRESHOLD}), skipping Perplexity: ${brokerSaturated.map((s) => s.topic.tag).join(", ")}`);
      }
    }
    if (inventoryRefreshOnly) {
      const allItems = standardStates.flatMap((state) => (Array.isArray(state?.items) ? state.items : []));
      const fetchDiagnostics = buildFetchDiagnostics(standardStates, budgetTracker, maxFetchConcurrency, brokerDiagnostics);
      logger(`Inventory refresh captured ${allItems.length} broker candidate(s) across ${standardStates.length} topic(s)`);
      return {
        selectionTarget,
        tagPriority,
        allItems,
        standardFetchCallsPlanned: 0,
        standardFetchCalls: 0,
        fetchDiagnostics,
      };
    }
    // Filter Perplexity phase1 to topics that are not already broker-saturated.
    const perplexityEligiblePhase1States = allowedPhase1States.filter(
      (state) => Number(state.brokerItemCount || 0) < BROKER_SATURATION_THRESHOLD
    );

    await runScheduledBatch(perplexityEligiblePhase1States, (state) => {
      if ((state.preferredDomains || []).length > 0) {
        return buildPreferredInvocation(state, state.nextPreferredQueryIndex, { maxAgeHours });
      }
      return buildBroadInvocation(state, state.nextBroadQueryIndex, {
        countsAsRetry: false,
        broadFallback: false,
        maxAgeHours,
      });
    }, "standard:phase1", budgetTracker);

    const trackedStandardDeepStates = standardStates.filter(isTrackedDeepCoverageState).length;
    const standardTrustedSecondPassStates = standardStates.filter((state) => (
      Array.isArray(state?.trustedFamilyQueue) && state.trustedFamilyQueue.length > 0
    )).length;
    const standardTrustedSecondPassReserve = standardTrustedSecondPassStates > 0
      ? Math.min(
        Math.max(4, Math.ceil(standardTrustedSecondPassStates / 2)),
        Math.max(0, standardHardLimit - countScheduledCalls(standardStates))
      )
      : 0;
    const standardDeepCoverageReserve = Math.min(
      aggressiveStandardRun
        ? Math.max(12, focusedStandardTags.size * 3)
        : Math.max(5, focusedStandardTags.size * 2),
      aggressiveStandardRun
        ? Math.max(standardStates.length, focusedStandardTags.size)
        : Math.max(trackedStandardDeepStates, focusedStandardTags.size),
      Math.max(0, standardHardLimit - countScheduledCalls(standardStates))
    );
    const phase2Eligible = sortRetryStates(standardStates.filter((state) => {
      return Number(state.totalCallsScheduled || 0) > 0
        && (state.preferredDomains || []).length > 0
        && canReceiveAdditionalRetry(state, itemEligibilityFn)
        && Number(state.nextPreferredQueryIndex || 0) < Number(state?.topic?.queries?.length || 0);
    }), itemEligibilityFn);
    const standardPhase2Headroom = Math.max(0, standardHardLimit - countScheduledCalls(standardStates));
    const phase2Slots = Math.max(0, standardPhase2Headroom - standardDeepCoverageReserve - standardTrustedSecondPassReserve);
    const phase2States = phase2Eligible.slice(0, phase2Slots);
    if (phase2Eligible.length > phase2States.length && standardPhase2Headroom > standardDeepCoverageReserve) {
      markBudgetStop(budgetTracker, "hard_cap_reached");
    }
    await runScheduledBatch(phase2States, (state) => {
      if (shouldPreferBroadFallbackRetry(state, itemEligibilityFn)) {
        return buildBroadInvocation(
          state,
          state.nextBroadQueryIndex,
          { countsAsRetry: true, broadFallback: true, maxAgeHours }
        );
      }
      return buildPreferredInvocation(
        state,
        state.nextPreferredQueryIndex,
        { countsAsRetry: true, maxAgeHours }
      );
    }, "standard:phase2", budgetTracker);

    const phase3Eligible = sortRetryStates(standardStates.filter((state) => {
      return Number(state.totalCallsScheduled || 0) > 0
        && canReceiveAdditionalRetry(state, itemEligibilityFn)
        && state.broadFallbackUsed !== true
        && Number(state.nextBroadQueryIndex || 0) < Number(state?.topic?.queries?.length || 0);
    }), itemEligibilityFn);
    const phase3Slots = Math.max(0, standardSoftLimit - countScheduledCalls(standardStates));
    const phase3States = phase3Eligible.slice(0, phase3Slots);
    if (phase3Eligible.length > phase3States.length) {
      markBudgetStop(budgetTracker, "soft_cap_reached");
    }
    await runScheduledBatch(phase3States, (state) => buildBroadInvocation(
      state,
      state.nextBroadQueryIndex,
      { countsAsRetry: true, broadFallback: true, maxAgeHours }
    ), "standard:phase3", budgetTracker);

    let standardDeepPhaseIndex = 4;
    while (true) {
      const trustedPhaseEligible = sortTrustedSourceRetryStates(standardStates.filter((state) => {
        return Number(state.totalCallsScheduled || 0) > 0
          && needsStandardTrustedSourcePass(state, annotateFetched, itemEligibilityFn);
      }), annotateFetched, itemEligibilityFn);
      const trustedPhaseSlots = Math.max(0, standardHardLimit - countScheduledCalls(standardStates));
      const trustedPhaseStates = trustedPhaseEligible.slice(0, trustedPhaseSlots);
      if (trustedPhaseEligible.length > trustedPhaseStates.length) {
        markBudgetStop(budgetTracker, "hard_cap_reached");
      }
      if (trustedPhaseStates.length <= 0) break;
      await runScheduledBatch(trustedPhaseStates, (state) => buildTrustedFamilyInvocation(
        state,
        { countsAsRetry: true, maxAgeHours }
      ), `standard:trusted${standardDeepPhaseIndex - 3}`, budgetTracker);
      standardDeepPhaseIndex += 1;
    }

    while (true) {
      const phase4Eligible = sortRetryStates(standardStates.filter((state) => {
        return Number(state.totalCallsScheduled || 0) > 0
          && (aggressiveStandardRun || isTrackedDeepCoverageState(state))
          && countUsableItems(state.items, itemEligibilityFn) <= 0
          && state.broadFallbackUsed === true
          && Number(state.nextBroadQueryIndex || 0) < Number(state?.topic?.queries?.length || 0)
          && !hasBlockingProviderFailure(state);
      }), itemEligibilityFn);
      const phase4Slots = Math.max(0, standardHardLimit - countScheduledCalls(standardStates));
      const phase4States = phase4Eligible.slice(0, phase4Slots);
      if (phase4Eligible.length > phase4States.length) {
        markBudgetStop(budgetTracker, "hard_cap_reached");
      }
      if (phase4States.length <= 0) break;
      await runScheduledBatch(phase4States, (state) => buildBroadInvocation(
        state,
        state.nextBroadQueryIndex,
        { countsAsRetry: true, broadFallback: true, maxAgeHours }
      ), `standard:phase${standardDeepPhaseIndex}`, budgetTracker);
      standardDeepPhaseIndex += 1;
    }

    while (true) {
      const focusedPhaseEligible = sortDeepCoverageRetryStates(standardStates.filter((state) => {
        return Number(state.totalCallsScheduled || 0) > 0
          && isFocusedStandardDeepCoverageState(state, focusedStandardTags)
          && state.broadFallbackUsed === true
          && Number(state.nextBroadQueryIndex || 0) < Number(state?.topic?.queries?.length || 0)
          && !hasBlockingProviderFailure(state);
      }), itemEligibilityFn);
      const focusedPhaseSlots = Math.max(0, standardHardLimit - countScheduledCalls(standardStates));
      const focusedPhaseStates = focusedPhaseEligible.slice(0, focusedPhaseSlots);
      if (focusedPhaseEligible.length > focusedPhaseStates.length) {
        markBudgetStop(budgetTracker, "hard_cap_reached");
      }
      if (focusedPhaseStates.length <= 0) break;
      await runScheduledBatch(focusedPhaseStates, (state) => buildBroadInvocation(
        state,
        state.nextBroadQueryIndex,
        { countsAsRetry: true, broadFallback: true, maxAgeHours }
      ), `standard:phase${standardDeepPhaseIndex}`, budgetTracker);
      standardDeepPhaseIndex += 1;
    }

    const standardFetchCallsPlanned = allowedPhase1States.length;
    const standardFetchCalls = standardStates.reduce((sum, state) => {
      return sum + Number(state?.apiCalls || 0);
    }, 0);
    // brokerDiagnostics was set in Phase 0 (broker-first block above).
    const discoverySupplementDiagnostics = enforceDiscoveryCandidateShare(standardStates, digestConfig, logger);
    const standardItems = standardStates.flatMap((state) => (Array.isArray(state?.items) ? state.items : []));
    let allItems = standardItems.slice();
    const providerDiagnostics = summarizeProviderDiagnostics(standardStates);
    const fetchDiagnostics = buildFetchDiagnostics(standardStates, budgetTracker, maxFetchConcurrency, brokerDiagnostics);
    fetchDiagnostics.discovery_candidate_cap_count = Number(discoverySupplementDiagnostics?.discovery_candidate_cap_count || 0);
    fetchDiagnostics.max_discovery_candidate_share_pct = Number(discoverySupplementDiagnostics?.max_discovery_candidate_share_pct || 0);

    logger(`Fetched ${allItems.length} retained candidate(s) after lane balancing`);

    const attemptedStandardStates = standardStates.filter((state) => Number(state?.totalCallsScheduled || 0) > 0);
    const allStandardEmpty = attemptedStandardStates.length > 0
      && attemptedStandardStates.every((state) => Array.isArray(state?.items) && state.items.length === 0);
    if (allStandardEmpty) {
      await emitIncident(
        "zero-standard-results",
        `All ${attemptedStandardStates.length} standard topic fetches returned zero items`,
        {
          mode: runMode,
          due_users: Array.isArray(dueUsers) ? dueUsers.length : 0,
          standard_topics: attemptedStandardStates.length,
          selected_items: 0,
        }
      );
    }

    if (providerDiagnostics.degraded_topics > 0) {
      await emitIncident(
        "perplexity-partial-degradation",
        `Perplexity degraded for ${providerDiagnostics.degraded_topics}/${providerDiagnostics.topics} fetched topics`,
        {
          mode: runMode,
          due_users: Array.isArray(dueUsers) ? dueUsers.length : 0,
          standard_topics: attemptedStandardStates.length,
          selected_items: allItems.length,
          provider: "perplexity",
          degraded_topics: providerDiagnostics.degraded_topics,
          fetched_topics: providerDiagnostics.topics,
          failed_calls: providerDiagnostics.failed_calls,
          transport_errors: providerDiagnostics.transport_errors,
          status_counts: providerDiagnostics.status_counts,
        }
      );
    }

    if (allItems.length === 0) {
      await emitIncident(
        "zero-raw-items",
        "No raw items available after standard fetches",
        {
          mode: runMode,
          due_users: Array.isArray(dueUsers) ? dueUsers.length : 0,
          standard_topics: attemptedStandardStates.length,
          selected_items: 0,
        }
      );
    }

    return {
      selectionTarget,
      tagPriority,
      allItems,
      standardFetchCallsPlanned,
      standardFetchCalls,
      fetchDiagnostics,
    };
  }

  return {
    orchestrateFetch,
  };
}

module.exports = {
  createDigestOrchestratorFetchRuntime,
  resolveSelectionTarget,
  buildTagPriority,
  resolveTopicsToFetch,
  resolveMaxDiscoveryCandidateShare,
  resolveDiscoveryCandidateCapCount,
};
