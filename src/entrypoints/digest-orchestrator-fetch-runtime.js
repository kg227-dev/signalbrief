"use strict";

const { getPerplexityMaxConcurrentFetchesOverride } = require("../runtime/config-provider");
const {
  FETCH_ORCHESTRATOR_DEFAULTS,
  PERPLEXITY_PROVIDER_DEFAULTS,
} = require("../platform/config/provider-defaults");
const { MVP_TOPIC_TAGS, isMvpTopic } = require("../platform/config/mvp-topics");
const { canonicalizeMvpTopicTag } = require("../runtime/topic-normalization-runtime");
const {
  createConversionFunnel,
  mergeConversionFunnel,
} = require("../digest/runtime/digest-data-fetch-items-runtime");
const {
  annotateItemsForFetch,
  buildTopicState,
  classifyRetrievedSourceFamily,
  isDiscoverySupplementItem,
  mergeBrokerItemsIntoState,
  mergeUniqueItemsIntoState,
  persistBrokerInventory,
  preloadBrokerInventoryIntoStates,
} = require("./digest-orchestrator-fetch-state-runtime");
const {
  buildFetchDiagnostics,
  countScheduledCalls,
  countStatusCode,
  countUsableItems,
  enforceDiscoveryCandidateShare,
  mergeStatusCounts,
  resolveDiscoveryCandidateCapCount,
  resolveMaxDiscoveryCandidateShare,
  sortDeepCoverageRetryStates,
  sortRetryStates,
  sortTopicStates,
  sortTrustedSourceRetryStates,
  summarizeAnnotatedTrustMix,
  summarizeProviderDiagnostics,
} = require("./digest-orchestrator-fetch-diagnostics-runtime");

// Topics with at least this many broker (RSS/official) candidates skip Perplexity entirely.
// Set at 2× the per-topic selection target so we always have a full candidate pool without AI search.
const BROKER_SATURATION_THRESHOLD = 10;

const DEFAULT_SEARCH_BUDGET = Object.freeze({
  scheduled: Object.freeze({
    soft_calls: 24,
    hard_calls: 36,
  }),
});
const DEFAULT_RATE_LIMIT_BACKOFF_LEVEL_MAX = 3;
const STANDARD_ONLY_AGGRESSIVE_RUN_MODES = new Set(["standard_topics", "standard_phase1"]);
const PHASE1_STANDARD_TOPIC_TAGS = new Set(MVP_TOPIC_TAGS);
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
const TRACKED_DEEP_STANDARD_TAGS = new Set(MVP_TOPIC_TAGS);
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
    if (!isMvpTopic(key)) continue;
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
    const adaptiveDelayMs = FETCH_ORCHESTRATOR_DEFAULTS.rateLimitCooldownMs
      * Math.max(1, rateLimitCount)
      * Math.max(1, Number(budgetTracker.rate_limit_backoff_level || 1));
    const delayMs = Math.min(
      FETCH_ORCHESTRATOR_DEFAULTS.rateLimitMaxCooldownMs,
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
    // Sat/Sun/Mon all run against a thin publishing window — trade pubs don't publish
    // on weekends. Extend lookback to 72h so earlier-week content stays eligible.
    // Archive dedup still prevents repeating items already selected in prior runs.
    const etDayOfWeek = new Date().toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short" });
    const isLowPublishDay = etDayOfWeek.startsWith("Mon") || etDayOfWeek.startsWith("Sat") || etDayOfWeek.startsWith("Sun");
    const maxAgeCapHours = isLowPublishDay ? 72 : 48;
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

    const discoveryAuditItems = standardStates.flatMap((state) => {
      const topicTag = String(state?.topic?.tag || "");
      return (Array.isArray(state?.items) ? state.items : [])
        .filter((item) => isDiscoverySupplementItem(item))
        .map((item) => ({
          stage: "fetch",
          lane: "discovery",
          status: "passed",
          topic: topicTag,
          url: String(item?.url || ""),
          title: String(item?.headline || item?.title || "").slice(0, 160),
          domain: String(item?.source_domain || item?.source || "").toLowerCase().replace(/^www\./, ""),
          published_at: item?.published_at || null,
        }));
    });
    fetchDiagnostics.discovery_fetch_items = discoveryAuditItems;

    const brokerAuditItems = standardStates.flatMap((state) => {
      const topicTag = String(state?.topic?.tag || "");
      return (Array.isArray(state?.items) ? state.items : [])
        .filter((item) => !isDiscoverySupplementItem(item))
        .map((item) => ({
          stage: "fetch",
          lane: "broker",
          status: "passed",
          topic: topicTag,
          url: String(item?.url || ""),
          title: String(item?.headline || item?.title || "").slice(0, 160),
          domain: String(item?.source_domain || item?.source || "").toLowerCase().replace(/^www\./, ""),
          published_at: item?.published_at || null,
        }));
    });
    fetchDiagnostics.broker_fetch_items = brokerAuditItems;

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
