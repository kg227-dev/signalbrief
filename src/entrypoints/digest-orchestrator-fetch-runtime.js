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
  const topics = Array.isArray(configTopics) ? configTopics : [];
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
  for (const user of (Array.isArray(dueUsers) ? dueUsers : [])) {
    for (const topic of (Array.isArray(user?.topics) ? user.topics : [])) {
      const topicRaw = String(topic || "");
      if (!topicRaw.startsWith("custom_")) continue;
      customTopicCounts.set(topicRaw, (customTopicCounts.get(topicRaw) || 0) + 1);
    }
  }

  const configuredMax = Number(maxCustomFetchPerRun);
  const dynamicCap = Number.isFinite(configuredMax) && configuredMax > 0
    ? configuredMax
    : Math.min(18, Math.max(6, Math.ceil(((Array.isArray(dueUsers) ? dueUsers.length : 0) || 1) / 4)));

  const rankedCustomTopicSlugs = [...customTopicCounts.entries()]
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    })
    .map(([slug]) => slug);
  const customTopicSlugs = rankedCustomTopicSlugs.slice(0, dynamicCap);
  if (rankedCustomTopicSlugs.length > customTopicSlugs.length) {
    logger(`Custom topic fetch cap hit: ${customTopicSlugs.length}/${rankedCustomTopicSlugs.length} topics this run`);
  }
  return customTopicSlugs;
}

function buildCustomFetchTargets(customTopicSlugs, buildCustomTopicQueries) {
  const queryBuilder = typeof buildCustomTopicQueries === "function"
    ? buildCustomTopicQueries
    : () => [];
  return (Array.isArray(customTopicSlugs) ? customTopicSlugs : []).map((slug) => {
    const keyword = String(slug || "").replace(/^custom_/, "").replace(/_/g, " ").trim();
    const queries = queryBuilder(keyword);
    return {
      tag: keyword.toUpperCase(),
      custom_slug: slug,
      queries: Array.isArray(queries) && queries.length > 0
        ? queries
        : [`${keyword} business strategy developments last 48 hours`],
      isCustom: true,
    };
  });
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

function resolveSearchBudget(digestConfig, { targetChatId, customTopicCount = 0 } = {}) {
  const configured = digestConfig?.search_budget || {};
  const modeKey = targetChatId ? "on_demand" : "scheduled";
  const modeDefaults = DEFAULT_SEARCH_BUDGET[modeKey];
  const modeConfigured = configured?.[modeKey] || {};
  const hardCalls = toBoundedInt(modeConfigured?.hard_calls, modeDefaults.hard_calls, { min: 1, max: 200 });
  const softCalls = Math.min(
    hardCalls,
    toBoundedInt(modeConfigured?.soft_calls, modeDefaults.soft_calls, { min: 1, max: 200 })
  );
  const customReserveMax = toBoundedInt(
    configured?.custom_topic_reserve_calls,
    DEFAULT_SEARCH_BUDGET.custom_topic_reserve_calls,
    { min: 0, max: hardCalls }
  );
  const reserveCalls = Math.min(customReserveMax, Math.max(0, Number(customTopicCount || 0)), hardCalls);
  return {
    mode: modeKey,
    soft_calls: softCalls,
    hard_calls: hardCalls,
    custom_topic_reserve_calls: reserveCalls,
  };
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

function buildFetchDiagnostics(states, budgetTracker) {
  const attemptedStates = (Array.isArray(states) ? states : []).filter((state) => Number(state?.totalCallsScheduled || 0) > 0);
  const preferredDomainsUsed = uniqueValues(attemptedStates.flatMap((state) => state.preferredDomains || []));
  const searchResultDomains = uniqueValues(attemptedStates.flatMap((state) => state.searchResultDomains || []));
  const preferredSearchResultDomains = uniqueValues(attemptedStates.flatMap((state) => state.preferredSearchResultDomains || []));
  const preferredCandidateCount = attemptedStates.reduce((sum, state) => sum + countPreferredItems(state), 0);
  const totalItems = attemptedStates.reduce((sum, state) => sum + (Array.isArray(state?.items) ? state.items.length : 0), 0);

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
    zero_yield_retry_count: attemptedStates.reduce((sum, state) => sum + Number(state?.zeroYieldRetryCount || 0), 0),
    budget_stop_reason: String(budgetTracker?.stop_reason || "").trim() || null,
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

    const results = await Promise.all(invocations.map(async ({ invocation }) => {
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
    }));

    return invocations.map((entry, idx) => {
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
    });
    const budgetTracker = {
      soft_calls: searchBudget.soft_calls,
      hard_calls: searchBudget.hard_calls,
      custom_topic_reserve_calls: searchBudget.custom_topic_reserve_calls,
      calls_used: 0,
      exhausted: false,
      stop_reason: null,
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
        topicTag: topic?.tag,
        dueUserTopics,
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

    const phase2Eligible = sortRetryStates(standardStates.filter((state) => {
      return Number(state.totalCallsScheduled || 0) > 0
        && (state.preferredDomains || []).length > 0
        && canReceiveAdditionalRetry(state, itemEligibilityFn)
        && Number(state.nextPreferredQueryIndex || 0) < Number(state?.topic?.queries?.length || 0);
    }), itemEligibilityFn);
    const phase2Slots = Math.max(0, standardHardLimit - budgetTracker.calls_used);
    const phase2States = phase2Eligible.slice(0, phase2Slots);
    if (phase2Eligible.length > phase2States.length) {
      markBudgetStop(budgetTracker, "hard_cap_reached");
    }
    await runScheduledBatch(phase2States, (state) => buildPreferredInvocation(
      state,
      state.nextPreferredQueryIndex,
      { countsAsRetry: true }
    ), "standard:phase2", budgetTracker);

    const phase3Eligible = sortRetryStates(standardStates.filter((state) => {
      return Number(state.totalCallsScheduled || 0) > 0
        && canReceiveAdditionalRetry(state, itemEligibilityFn)
        && state.broadFallbackUsed !== true
        && Number(state.nextBroadQueryIndex || 0) < Number(state?.topic?.queries?.length || 0);
    }), itemEligibilityFn);
    const phase3Slots = Math.max(0, standardSoftLimit - budgetTracker.calls_used);
    const phase3States = phase3Eligible.slice(0, phase3Slots);
    if (phase3Eligible.length > phase3States.length) {
      markBudgetStop(budgetTracker, "soft_cap_reached");
    }
    await runScheduledBatch(phase3States, (state) => buildBroadInvocation(
      state,
      state.nextBroadQueryIndex,
      { countsAsRetry: true, broadFallback: true }
    ), "standard:phase3", budgetTracker);

    const customSlots = Math.max(0, Math.min(
      budgetTracker.custom_topic_reserve_calls,
      budgetTracker.hard_calls - budgetTracker.calls_used
    ));
    const customPhaseStates = customStates.slice(0, customSlots);
    if (customStates.length > customPhaseStates.length) {
      markBudgetStop(budgetTracker, "custom_topic_reserve_exhausted");
    }
    if (customPhaseStates.length > 0) {
      logger(`Fetching ${customPhaseStates.length} custom topic(s): ${customPhaseStates.map((state) => state.topic.tag).join(", ")}`);
      await runScheduledBatch(customPhaseStates, (state) => {
        if ((state.preferredDomains || []).length > 0) {
          return buildPreferredInvocation(state, state.nextPreferredQueryIndex);
        }
        return buildBroadInvocation(state, state.nextBroadQueryIndex, {
          countsAsRetry: false,
          broadFallback: false,
        });
      }, "custom:phase1", budgetTracker);
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
    const fetchDiagnostics = buildFetchDiagnostics([...standardStates, ...customStates], budgetTracker);

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
