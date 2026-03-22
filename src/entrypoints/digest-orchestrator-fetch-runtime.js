"use strict";

const { normalizeSourcePolicyDomain } = require("../runtime/source-policy-registry-runtime");

const DEFAULT_SEARCH_BUDGET = Object.freeze({
  scheduled: Object.freeze({
    soft_calls: 24,
    hard_calls: 36,
  }),
  on_demand: Object.freeze({
    soft_calls: 6,
    hard_calls: 9,
  }),
  custom_topic_reserve_calls: 3,
});
const DEFAULT_MAX_FETCH_CONCURRENCY = 4;
const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 1_250;
const DEFAULT_RATE_LIMIT_MAX_COOLDOWN_MS = 20_000;
const DEFAULT_RATE_LIMIT_BACKOFF_LEVEL_MAX = 3;
const DEFAULT_CUSTOM_HEAVY_EXTRA_DEEP_CALLS = 2;
const TRACKED_TOPIC_QUERY_OVERRIDES = Object.freeze({
  HEALTHCARE: Object.freeze([
    "hospital system merger acquisition payer provider strategy last 48 hours",
    "Medicare Advantage payer provider value-based care last 48 hours",
    "clinical AI hospital operations FDA healthcare rollout last 48 hours",
  ]),
  ENERGY: Object.freeze([
    "utility grid transmission interconnection power demand policy last 48 hours",
    "renewables battery storage utility strategy last 48 hours",
    "oil gas LNG refinery energy markets last 48 hours",
  ]),
  "LIFE SCIENCES": Object.freeze([
    "FDA approval clinical trial pharma licensing biotech last 48 hours",
    "biopharma M&A licensing deal trial readout last 48 hours",
    "drug pricing obesity drug biotech manufacturing last 48 hours",
  ]),
  "POLICY×REGULATORY": Object.freeze([
    "FTC DOJ antitrust trade tariff regulation business last 48 hours",
    "SEC EPA FTC proposed rule enforcement business last 48 hours",
    "sanctions export controls trade compliance policy last 48 hours",
  ]),
  SUSTAINABILITY: Object.freeze([
    "SEC climate disclosure CBAM carbon markets corporate sustainability last 48 hours",
    "power demand grid decarbonization clean energy policy last 48 hours",
    "supply chain sustainability reporting emissions corporate investment last 48 hours",
  ]),
});
const CUSTOM_TOPIC_SOURCE_HINTS = Object.freeze({
  nvidia: Object.freeze(["AI×TECH", "TECHNOLOGY"]),
  "glp 1": Object.freeze(["LIFE SCIENCES", "HEALTHCARE"]),
  "agentic ai": Object.freeze(["AI×TECH", "TECHNOLOGY", "DIGITAL"]),
  "sec rulemaking": Object.freeze(["POLICY×REGULATORY", "PUBLIC SECTOR"]),
  cbam: Object.freeze(["SUSTAINABILITY", "POLICY×REGULATORY", "ENERGY"]),
  "rate cuts": Object.freeze(["FINANCIAL SERVICES", "STRATEGY"]),
  "grid infrastructure": Object.freeze(["ENERGY", "SUSTAINABILITY", "POLICY×REGULATORY", "PUBLIC SECTOR"]),
  semicap: Object.freeze(["AI×TECH", "TECHNOLOGY"]),
  "quantum computing": Object.freeze(["AI×TECH", "TECHNOLOGY"]),
  starlink: Object.freeze(["TECHNOLOGY", "PUBLIC SECTOR"]),
});
const TRACKED_DEEP_STANDARD_TAGS = new Set([
  "HEALTHCARE",
  "ENERGY",
  "LIFE SCIENCES",
  "POLICY×REGULATORY",
  "SUSTAINABILITY",
]);
const TRACKED_DEEP_CUSTOM_SLUGS = new Set([
  "custom_nvidia",
  "custom_glp_1",
  "custom_agentic_ai",
  "custom_sec_rulemaking",
  "custom_cbam",
  "custom_rate_cuts",
  "custom_grid_infrastructure",
  "custom_semicap",
]);

function resolveSelectionTarget(dueUsers, defaultItemCount = 7) {
  const requestedCounts = (Array.isArray(dueUsers) ? dueUsers : [])
    .map((user) => Number(user?.preferences?.items_per_digest))
    .filter((value) => Number.isFinite(value) && value > 0);
  return Math.max(
    Number(defaultItemCount || 7),
    requestedCounts.length ? Math.max(...requestedCounts) : 0
  );
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

function resolveTopicsToFetch({ configTopics, dueUsers, targetChatId, log }) {
  const topics = (Array.isArray(configTopics) ? configTopics : []).map((topic) => {
    const tag = String(topic?.tag || "").trim().toUpperCase();
    const overrideQueries = TRACKED_TOPIC_QUERY_OVERRIDES[tag];
    if (!Array.isArray(overrideQueries) || overrideQueries.length === 0) return topic;
    return {
      ...topic,
      queries: overrideQueries.slice(),
    };
  });
  const logger = typeof log === "function" ? log : () => {};
  // Always fetch all configured topics — even for targeted on-demand runs.
  // Narrowing to the user's subscribed topics produced thin raw pools that
  // were decimated by cross-day dedup, resulting in 2-3 signal digests.
  // Per-user topic filtering downstream handles relevance just fine.
  if (targetChatId && Array.isArray(dueUsers) && dueUsers.length === 1) {
    const userTopicCount = (Array.isArray(dueUsers[0]?.topics) ? dueUsers[0].topics : [])
      .filter((topic) => !String(topic || "").startsWith("custom_")).length;
    logger(`On-demand: fetching all ${topics.length} topic(s) (user subscribes to ${userTopicCount})`);
  }
  return topics;
}

function resolveCustomTopicSlugs({ dueUsers, maxCustomFetchPerRun, log }) {
  const logger = typeof log === "function" ? log : () => {};
  const customTopicCounts = new Map();
  const firstSeenIndex = new Map();
  let cursor = 0;
  let customUserCount = 0;
  for (const user of (Array.isArray(dueUsers) ? dueUsers : [])) {
    let userHasCustomTopic = false;
    for (const topic of (Array.isArray(user?.topics) ? user.topics : [])) {
      const topicRaw = String(topic || "");
      if (!topicRaw.startsWith("custom_")) continue;
      userHasCustomTopic = true;
      if (!firstSeenIndex.has(topicRaw)) firstSeenIndex.set(topicRaw, cursor);
      customTopicCounts.set(topicRaw, (customTopicCounts.get(topicRaw) || 0) + 1);
      cursor += 1;
    }
    if (userHasCustomTopic) customUserCount += 1;
  }

  const configuredMax = Number(maxCustomFetchPerRun);
  const totalDueUsers = Math.max(0, Array.isArray(dueUsers) ? dueUsers.length : 0);
  const customHeavyRun = customTopicCounts.size > 0
    && customUserCount >= Math.max(2, Math.ceil(totalDueUsers * 0.5));
  const dynamicCap = Number.isFinite(configuredMax) && configuredMax > 0
    ? configuredMax
    : customHeavyRun
      ? customTopicCounts.size
      : Math.min(18, Math.max(6, Math.ceil((totalDueUsers || 1) / 4)));

  const rankedCustomTopicSlugs = [...customTopicCounts.entries()]
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return (firstSeenIndex.get(a[0]) || 0) - (firstSeenIndex.get(b[0]) || 0);
    })
    .map(([slug]) => slug);
  const customTopicSlugs = rankedCustomTopicSlugs.slice(0, dynamicCap);
  if (rankedCustomTopicSlugs.length > customTopicSlugs.length) {
    logger(`Custom topic fetch cap hit: ${customTopicSlugs.length}/${rankedCustomTopicSlugs.length} topics this run`);
  }
  return customTopicSlugs;
}

function normalizeCustomHintKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildCustomFetchTargets(customTopicSlugs, buildCustomTopicQueries) {
  const queryBuilder = typeof buildCustomTopicQueries === "function"
    ? buildCustomTopicQueries
    : () => [];
  return (Array.isArray(customTopicSlugs) ? customTopicSlugs : []).map((slug) => {
    const keyword = String(slug || "").replace(/^custom_/, "").replace(/_/g, " ").trim();
    const queries = queryBuilder(keyword);
    const preferredTopicHints = Array.isArray(CUSTOM_TOPIC_SOURCE_HINTS[normalizeCustomHintKey(keyword)])
      ? CUSTOM_TOPIC_SOURCE_HINTS[normalizeCustomHintKey(keyword)].slice()
      : [];
    return {
      tag: keyword.toUpperCase(),
      custom_slug: slug,
      queries: Array.isArray(queries) && queries.length > 0
        ? queries
        : [`${keyword} business strategy developments last 48 hours`],
      isCustom: true,
      preferred_topic_hints: preferredTopicHints,
    };
  });
}

function isTrackedDeepCoverageState(state) {
  const tag = String(state?.topic?.tag || "").trim().toUpperCase();
  const customSlug = String(state?.topic?.custom_slug || "").trim().toLowerCase();
  return TRACKED_DEEP_STANDARD_TAGS.has(tag) || TRACKED_DEEP_CUSTOM_SLUGS.has(customSlug);
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

function resolveSearchBudget(digestConfig, { targetChatId, customTopicCount = 0, dueUsers = [] } = {}) {
  const configured = digestConfig?.search_budget || {};
  const modeKey = targetChatId ? "on_demand" : "scheduled";
  const modeDefaults = DEFAULT_SEARCH_BUDGET[modeKey];
  const modeConfigured = configured?.[modeKey] || {};
  const hardCalls = toBoundedInt(modeConfigured?.hard_calls, modeDefaults.hard_calls, { min: 1, max: 200 });
  const softCalls = Math.min(
    hardCalls,
    toBoundedInt(modeConfigured?.soft_calls, modeDefaults.soft_calls, { min: 1, max: 200 })
  );
  const customReserveBase = toBoundedInt(
    configured?.custom_topic_reserve_calls,
    DEFAULT_SEARCH_BUDGET.custom_topic_reserve_calls,
    { min: 0, max: hardCalls }
  );
  const customTopicTotal = Math.max(0, Number(customTopicCount || 0));
  const customUserCount = (Array.isArray(dueUsers) ? dueUsers : []).filter((user) => {
    return (Array.isArray(user?.topics) ? user.topics : []).some((topic) => String(topic || "").startsWith("custom_"));
  }).length;
  const totalDueUsers = Math.max(0, Array.isArray(dueUsers) ? dueUsers.length : 0);
  const customHeavyRun = customTopicTotal > 0
    && customUserCount >= Math.max(2, Math.ceil(totalDueUsers * 0.5));
  const customRetryReserve = customHeavyRun
    ? Math.min(customTopicTotal, Math.max(0, Math.floor(hardCalls / 3)))
    : 0;
  const customDeepCoverageReserve = customHeavyRun
    ? Math.min(Math.max(8, customTopicTotal * 2), Math.max(0, hardCalls - customTopicTotal - customRetryReserve))
    : 0;
  const customHeavyExtraDeepCalls = customHeavyRun
    ? Math.min(
      DEFAULT_CUSTOM_HEAVY_EXTRA_DEEP_CALLS,
      Math.max(0, hardCalls - customTopicTotal - customRetryReserve - customDeepCoverageReserve)
    )
    : 0;
  const reserveTarget = customHeavyRun
    ? customTopicTotal + customRetryReserve + customDeepCoverageReserve + customHeavyExtraDeepCalls
    : Math.min(customTopicTotal, customReserveBase);
  const reserveCalls = Math.min(Math.max(0, reserveTarget), hardCalls);
  return {
    mode: modeKey,
    soft_calls: softCalls,
    hard_calls: hardCalls,
    custom_topic_reserve_calls: reserveCalls,
    custom_retry_reserve_calls: customRetryReserve,
    custom_deep_coverage_reserve_calls: customDeepCoverageReserve,
    custom_heavy_extra_deep_calls: customHeavyExtraDeepCalls,
    custom_heavy_run: customHeavyRun,
    custom_user_count: customUserCount,
    due_user_count: totalDueUsers,
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

function buildTopicState(topic, shortlist, priority, originalIndex) {
  return {
    topic,
    priority: Math.max(0, Number(priority || 0)),
    originalIndex: Math.max(0, Number(originalIndex || 0)),
    preferredDomains: Array.isArray(shortlist?.domains)
      ? shortlist.domains.map((domain) => String(domain || "").trim()).filter(Boolean)
      : [],
    topicKeys: Array.isArray(shortlist?.topic_keys) ? shortlist.topic_keys.slice() : [],
    officialFriendly: shortlist?.official_friendly === true,
    items: [],
    itemKeys: new Set(),
    totalCallsScheduled: 0,
    preferredCallsMade: 0,
    broadCallsMade: 0,
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
    searchResultDomains: [],
    preferredSearchResultDomains: [],
    preferredSearchResultHitCount: 0,
  };
}

function mergeUniqueItemsIntoState(state, items, normalizeUrlForDedup, isFetchedItemEligible) {
  const incoming = Array.isArray(items) ? items : [];
  let addedUniqueCount = 0;
  let addedUsableCount = 0;
  for (const item of incoming) {
    const key = buildItemDedupKey(item, normalizeUrlForDedup);
    if (!key || state.itemKeys.has(key)) continue;
    state.itemKeys.add(key);
    state.items.push(item);
    addedUniqueCount += 1;
    if ((typeof isFetchedItemEligible === "function" ? isFetchedItemEligible(item) : true) !== false) {
      addedUsableCount += 1;
    }
  }
  return {
    addedUniqueCount,
    addedUsableCount,
  };
}

function sortTopicStates(states) {
  return (Array.isArray(states) ? states.slice() : []).sort((left, right) => {
    if (right.priority !== left.priority) return right.priority - left.priority;
    const leftCustom = left?.topic?.isCustom === true;
    const rightCustom = right?.topic?.isCustom === true;
    if (leftCustom !== rightCustom) return leftCustom ? 1 : -1;
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

function markBudgetStop(budgetTracker, reason) {
  if (!budgetTracker || !reason) return;
  if (!budgetTracker.stop_reason) budgetTracker.stop_reason = reason;
  budgetTracker.exhausted = true;
}

function canReceiveAdditionalRetry(state, isFetchedItemEligible) {
  if (!state || state.retryBlockReason === "repeat" || state.retryBlockReason === "topic_fit") return false;
  if (Number(state.zeroYieldRetryStreak || 0) >= 2) return false;
  return countUsableItems(state.items, isFetchedItemEligible) < 2;
}

function hasBlockingProviderFailure(state) {
  const failedCalls = Math.max(0, Number(state?.provider?.failed_calls || 0));
  const rateLimitedCalls = Math.max(0, countStatusCode(state, 429));
  return Number(state?.provider?.transport_errors || 0) > 0
    || Math.max(0, failedCalls - rateLimitedCalls) > 0;
}

function shouldPreferBroadFallbackRetry(state, isFetchedItemEligible) {
  return countUsableItems(state?.items, isFetchedItemEligible) <= 0
    && Number(state?.nextBroadQueryIndex || 0) < Number(state?.topic?.queries?.length || 0);
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

function buildFetchDiagnostics(states, budgetTracker, maxFetchConcurrency) {
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
  const topicDiagnostics = attemptedStates.map((state) => ({
    tag: state?.topic?.tag || null,
    custom_slug: state?.topic?.custom_slug || null,
    is_custom: state?.topic?.isCustom === true,
    preferred_topic_hints: Array.isArray(state?.topic?.preferred_topic_hints) ? state.topic.preferred_topic_hints.slice() : [],
    query_count: Array.isArray(state?.topic?.queries) ? state.topic.queries.length : 0,
    unique_item_count: Array.isArray(state?.items) ? state.items.length : 0,
    usable_item_count: countUsableItems(state?.items, () => true),
    preferred_domains: Array.isArray(state?.preferredDomains) ? state.preferredDomains.slice() : [],
    preferred_item_count: countPreferredItems(state),
    preferred_call_count: Number(state?.preferredCallsMade || 0),
    broad_call_count: Number(state?.broadCallsMade || 0),
    next_preferred_query_index: Number(state?.nextPreferredQueryIndex || 0),
    next_broad_query_index: Number(state?.nextBroadQueryIndex || 0),
    remaining_preferred_queries: Math.max(0, Number((state?.topic?.queries || []).length || 0) - Number(state?.nextPreferredQueryIndex || 0)),
    remaining_broad_queries: Math.max(0, Number((state?.topic?.queries || []).length || 0) - Number(state?.nextBroadQueryIndex || 0)),
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
    buildCustomTopicQueries,
    buildCustomRescueItemsFromStandard,
    emitDigestIncident,
    normalizeUrlForDedup,
    isFetchedItemEligible,
  } = deps || {};
  const logger = typeof log === "function" ? log : () => {};
  const topicNormalizer = typeof normalizeTopicToken === "function"
    ? normalizeTopicToken
    : (value) => String(value || "").toLowerCase().trim();
  const fetchTopic = typeof fetchTopicNews === "function" ? fetchTopicNews : async () => ({ items: [], apiCalls: 0 });
  const buildPreferredShortlist = typeof buildPreferredDomainShortlist === "function"
    ? buildPreferredDomainShortlist
    : () => ({ domains: [], topic_keys: [], official_friendly: false });
  const buildRescueItems = typeof buildCustomRescueItemsFromStandard === "function"
    ? buildCustomRescueItemsFromStandard
    : () => [];
  const emitIncident = typeof emitDigestIncident === "function"
    ? emitDigestIncident
    : async () => false;
  const itemEligibilityFn = typeof isFetchedItemEligible === "function"
    ? isFetchedItemEligible
    : () => true;
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

      if (entry.invocation.phase === "preferred") {
        state.preferredCallsMade += 1;
        state.preferredPassItemCount += merged.addedUniqueCount;
        state.nextPreferredQueryIndex = Math.max(state.nextPreferredQueryIndex, entry.invocation.queryIndex + 1);
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

  function buildPreferredInvocation(state, queryIndex, { countsAsRetry = false } = {}) {
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
        retrievalPlan: {
          preferred_domains: Array.isArray(state.preferredDomains) ? state.preferredDomains.slice() : [],
          thin_item_threshold: 2,
          official_friendly: state.officialFriendly === true,
          topic_keys: Array.isArray(state.topicKeys) ? state.topicKeys.slice() : [],
          allow_broad_fallback: false,
        },
      },
    };
  }

  function buildBroadInvocation(state, queryIndex, { countsAsRetry = false, broadFallback = false } = {}) {
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
        retrievalPlan: {
          preferred_domains: Array.isArray(state.preferredDomains) ? state.preferredDomains.slice() : [],
          thin_item_threshold: 2,
          official_friendly: state.officialFriendly === true,
          topic_keys: Array.isArray(state.topicKeys) ? state.topicKeys.slice() : [],
          broad_only: true,
        },
      },
    };
  }

  async function orchestrateFetch({ dueUsers, targetChatId, runMode }) {
    const digestConfig = CONFIG?.digest || {};
    const selectionTarget = resolveSelectionTarget(dueUsers, Number(digestConfig.itemCount || 7));
    const tagPriority = buildTagPriority(dueUsers, topicNormalizer);
    const dueUserTopics = flattenDueUserTopics(dueUsers);
    const topicsToFetch = resolveTopicsToFetch({
      configTopics: CONFIG?.topics,
      dueUsers,
      targetChatId,
      log: logger,
    });

    const customTopicSlugs = resolveCustomTopicSlugs({
      dueUsers,
      maxCustomFetchPerRun: digestConfig.maxCustomFetchPerRun,
      log: logger,
    });
    const customFetchTargets = buildCustomFetchTargets(customTopicSlugs, buildCustomTopicQueries);
    const customTags = customFetchTargets.map((target) => target.tag);
    const searchBudget = resolveSearchBudget(digestConfig, {
      targetChatId,
      customTopicCount: customFetchTargets.length,
      dueUsers,
    });
    const budgetTracker = {
      soft_calls: searchBudget.soft_calls,
      hard_calls: searchBudget.hard_calls,
      custom_topic_reserve_calls: searchBudget.custom_topic_reserve_calls,
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
      return buildTopicState(
        topic,
        shortlist,
        tagPriority[topicNormalizer(topic?.tag)] || 0,
        index
      );
    }));
    const customStates = sortTopicStates(customFetchTargets.map((topic, index) => {
      const shortlist = buildPreferredShortlist({
        topicTag: Array.isArray(topic?.preferred_topic_hints) && topic.preferred_topic_hints.length > 0
          ? topic.preferred_topic_hints[0]
          : topic?.tag,
        dueUserTopics: [
          ...dueUserTopics,
          ...(Array.isArray(topic?.preferred_topic_hints) ? topic.preferred_topic_hints : []),
        ],
        queryText: Array.isArray(topic?.queries) ? topic.queries[0] : "",
        maxDomains: 20,
      });
      return buildTopicState(
        topic,
        shortlist,
        tagPriority[topicNormalizer(topic?.custom_slug)] || 1,
        index
      );
    }));

    const standardHardLimit = Math.max(0, budgetTracker.hard_calls - budgetTracker.custom_topic_reserve_calls);
    const standardSoftLimit = Math.max(0, Math.min(standardHardLimit, budgetTracker.soft_calls - budgetTracker.custom_topic_reserve_calls));

    const standardPhase1States = standardStates.filter((state) => (
      Array.isArray(state?.topic?.queries) && state.topic.queries.length > 0
    ));
    const allowedPhase1States = standardPhase1States.slice(0, standardHardLimit);
    if (standardPhase1States.length > allowedPhase1States.length) {
      markBudgetStop(budgetTracker, "hard_cap_reached");
    }

    await runScheduledBatch(allowedPhase1States, (state) => {
      if ((state.preferredDomains || []).length > 0) {
        return buildPreferredInvocation(state, state.nextPreferredQueryIndex);
      }
      return buildBroadInvocation(state, state.nextBroadQueryIndex, {
        countsAsRetry: false,
        broadFallback: false,
      });
    }, "standard:phase1", budgetTracker);

    let customCallsUsed = countScheduledCalls(customStates);
    let customReserveRemaining = Math.max(0, budgetTracker.custom_topic_reserve_calls - customCallsUsed);
    const customPhase1States = customStates.slice(0, customReserveRemaining);
    if (customStates.length > customPhase1States.length) {
      markBudgetStop(budgetTracker, "custom_topic_reserve_exhausted");
    }
    if (customPhase1States.length > 0) {
      logger(`Fetching ${customPhase1States.length} custom topic(s): ${customPhase1States.map((state) => state.topic.tag).join(", ")}`);
      await runScheduledBatch(customPhase1States, (state) => {
        if ((state.preferredDomains || []).length > 0) {
          return buildPreferredInvocation(state, state.nextPreferredQueryIndex);
        }
        return buildBroadInvocation(state, state.nextBroadQueryIndex, {
          countsAsRetry: false,
          broadFallback: false,
        });
      }, "custom:phase1", budgetTracker);
    }

    customCallsUsed = countScheduledCalls(customStates);
    customReserveRemaining = Math.max(0, budgetTracker.custom_topic_reserve_calls - customCallsUsed);
    const customPhase2Eligible = sortRetryStates(customStates.filter((state) => {
      const nextQueryIndex = (state.preferredDomains || []).length > 0
        ? Number(state.nextPreferredQueryIndex || 0)
        : Number(state.nextBroadQueryIndex || 0);
      return Number(state.totalCallsScheduled || 0) > 0
        && canReceiveAdditionalRetry(state, itemEligibilityFn)
        && nextQueryIndex < Number(state?.topic?.queries?.length || 0);
    }), itemEligibilityFn);
    const customPhase2Slots = Math.min(
      customReserveRemaining,
      Math.max(0, Number(searchBudget.custom_retry_reserve_calls || 0))
    );
    const customPhase2States = customPhase2Eligible.slice(0, customPhase2Slots);
    if (customPhase2States.length > 0) {
      await runScheduledBatch(customPhase2States, (state) => {
        if (shouldPreferBroadFallbackRetry(state, itemEligibilityFn)) {
          return buildBroadInvocation(state, state.nextBroadQueryIndex, {
            countsAsRetry: true,
            broadFallback: true,
          });
        }
        if ((state.preferredDomains || []).length > 0) {
          return buildPreferredInvocation(state, state.nextPreferredQueryIndex, { countsAsRetry: true });
        }
        return buildBroadInvocation(state, state.nextBroadQueryIndex, {
          countsAsRetry: true,
          broadFallback: false,
        });
      }, "custom:phase2", budgetTracker);
    }
    customCallsUsed = countScheduledCalls(customStates);
    customReserveRemaining = Math.max(0, budgetTracker.custom_topic_reserve_calls - customCallsUsed);
    let customDeepPhaseIndex = 3;
    while (customReserveRemaining > 0) {
      const customDeepEligible = sortDeepCoverageRetryStates(customStates.filter((state) => {
        return Number(state.totalCallsScheduled || 0) > 0
          && isTrackedDeepCoverageState(state)
          && countUsableItems(state.items, itemEligibilityFn) <= 0
          && state.broadFallbackUsed === true
          && Number(state.nextBroadQueryIndex || 0) < Number(state?.topic?.queries?.length || 0)
          && !hasBlockingProviderFailure(state);
      }), itemEligibilityFn);
      const customDeepStates = customDeepEligible.slice(0, customReserveRemaining);
      if (customDeepEligible.length > customDeepStates.length) {
        markBudgetStop(budgetTracker, "custom_topic_reserve_exhausted");
      }
      if (customDeepStates.length <= 0) break;
      await runScheduledBatch(customDeepStates, (state) => buildBroadInvocation(
        state,
        state.nextBroadQueryIndex,
        { countsAsRetry: true, broadFallback: true }
      ), `custom:phase${customDeepPhaseIndex}`, budgetTracker);
      customDeepPhaseIndex += 1;
      customCallsUsed = countScheduledCalls(customStates);
      customReserveRemaining = Math.max(0, budgetTracker.custom_topic_reserve_calls - customCallsUsed);
    }

    const standardDeepCoverageReserve = Math.min(
      5,
      standardStates.filter(isTrackedDeepCoverageState).length,
      Math.max(0, standardHardLimit - countScheduledCalls(standardStates))
    );
    const phase2Eligible = sortRetryStates(standardStates.filter((state) => {
      return Number(state.totalCallsScheduled || 0) > 0
        && (state.preferredDomains || []).length > 0
        && canReceiveAdditionalRetry(state, itemEligibilityFn)
        && Number(state.nextPreferredQueryIndex || 0) < Number(state?.topic?.queries?.length || 0);
    }), itemEligibilityFn);
    const standardPhase2Headroom = Math.max(0, standardHardLimit - countScheduledCalls(standardStates));
    const phase2Slots = Math.max(0, standardPhase2Headroom - standardDeepCoverageReserve);
    const phase2States = phase2Eligible.slice(0, phase2Slots);
    if (phase2Eligible.length > phase2States.length && standardPhase2Headroom > standardDeepCoverageReserve) {
      markBudgetStop(budgetTracker, "hard_cap_reached");
    }
    await runScheduledBatch(phase2States, (state) => {
      if (shouldPreferBroadFallbackRetry(state, itemEligibilityFn)) {
        return buildBroadInvocation(
          state,
          state.nextBroadQueryIndex,
          { countsAsRetry: true, broadFallback: true }
        );
      }
      return buildPreferredInvocation(
        state,
        state.nextPreferredQueryIndex,
        { countsAsRetry: true }
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
      { countsAsRetry: true, broadFallback: true }
    ), "standard:phase3", budgetTracker);

    let standardDeepPhaseIndex = 4;
    while (true) {
      const phase4Eligible = sortRetryStates(standardStates.filter((state) => {
        return Number(state.totalCallsScheduled || 0) > 0
          && isTrackedDeepCoverageState(state)
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
        { countsAsRetry: true, broadFallback: true }
      ), `standard:phase${standardDeepPhaseIndex}`, budgetTracker);
      standardDeepPhaseIndex += 1;
    }

    const standardFetchCallsPlanned = allowedPhase1States.length;
    const standardFetchCalls = standardStates.reduce((sum, state) => {
      return sum + Number(state?.apiCalls || 0);
    }, 0);
    const customFetchCalls = customStates.reduce((sum, state) => {
      return sum + Number(state?.apiCalls || 0);
    }, 0);
    const standardItems = standardStates.flatMap((state) => (Array.isArray(state?.items) ? state.items : []));
    const customItems = customStates.flatMap((state) => (Array.isArray(state?.items) ? state.items : []));
    let allItems = customItems.concat(standardItems);
    const providerDiagnostics = summarizeProviderDiagnostics([...standardStates, ...customStates]);
    const fetchDiagnostics = buildFetchDiagnostics([...standardStates, ...customStates], budgetTracker, maxFetchConcurrency);

    logger(`Fetched ${allItems.length} raw items`);

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

    if (customItems.length > 0) {
      logger(`Fetched ${customItems.length} custom topic item(s)`);
      const customKeywords = customTopicSlugs
        .map((slug) => topicNormalizer(String(slug || "").replace(/^custom_/, "").replace(/_/g, " ")))
        .filter(Boolean);
      const rescueItems = buildRescueItems(standardItems, customKeywords, allItems, 1);
      if (rescueItems.length > 0) {
        allItems = rescueItems.concat(allItems);
        logger(`Custom keyword rescue added ${rescueItems.length} item(s) from standard pool`);
      }
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
        "No raw items available after standard and custom fetches",
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
      customTags,
      standardFetchCallsPlanned,
      standardFetchCalls,
      customFetchCalls,
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
  resolveCustomTopicSlugs,
  buildCustomFetchTargets,
};
