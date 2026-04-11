"use strict";

const {
  FETCH_ORCHESTRATOR_DEFAULTS,
} = require("../platform/config/provider-defaults");
const {
  createConversionFunnel,
  mergeConversionFunnel,
} = require("../digest/runtime/digest-data-fetch-items-runtime");
const {
  applyRunModeSearchBudgetOverrides,
  buildAllStandardTagSet,
  buildFocusedStandardTagSet,
  buildTagPriority,
  flattenDueUserTopics,
  isAggressiveStandardRun,
  isFocusedStandardDeepCoverageState,
  isTrackedDeepCoverageState,
  resolveSearchBudget,
  resolveSelectionTarget,
  resolveTopicsToFetch,
} = require("./digest-orchestrator-fetch-plan-runtime");
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
const {
  buildBroadInvocation,
  buildPreferredInvocation,
  buildTrustedFamilyInvocation,
  canReceiveAdditionalRetry,
  hasBlockingProviderFailure,
  markBudgetStop,
  needsStandardTrustedSourcePass,
  resolveBatchConcurrency,
  resolveFetchConcurrency,
  shouldPreferBroadFallbackRetry,
  uniqueValues,
} = require("./digest-orchestrator-fetch-policy-runtime");

// Topics with at least this many broker (RSS/official) candidates skip Perplexity entirely.
// Set at 2× the per-topic selection target so we always have a full candidate pool without AI search.
const BROKER_SATURATION_THRESHOLD = 10;
const DEFAULT_RATE_LIMIT_BACKOFF_LEVEL_MAX = 3;

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

  async function runWithConcurrency(entries, worker, batchName, budgetTracker) {
    const jobs = Array.isArray(entries) ? entries : [];
    if (jobs.length === 0) return [];
    const results = new Array(jobs.length);
    let cursor = 0;
    const workerCount = resolveBatchConcurrency(batchName, jobs.length, budgetTracker, maxFetchConcurrency);

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
      state.provider.usage = state.provider.usage && typeof state.provider.usage === "object"
        ? state.provider.usage
        : { input_tokens: 0, output_tokens: 0 };
      state.provider.usage.input_tokens += Number(diagnostics?.usage?.input_tokens || 0);
      state.provider.usage.output_tokens += Number(diagnostics?.usage?.output_tokens || 0);

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
        searchUsage: { input_tokens: 0, output_tokens: 0 },
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
    const searchUsage = standardStates.reduce((usage, state) => {
      usage.input_tokens += Number(state?.provider?.usage?.input_tokens || 0);
      usage.output_tokens += Number(state?.provider?.usage?.output_tokens || 0);
      return usage;
    }, { input_tokens: 0, output_tokens: 0 });
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
      searchUsage,
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
