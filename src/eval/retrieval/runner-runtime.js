"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");

const {
  createDigestArchiveRuntime,
  createDigestDataRuntime,
  createDigestDeliveryRecordRuntime,
  createDigestFormattingRuntime,
  createDigestPolicies,
  buildRecentEntityHistory,
  buildStorylineCandidates,
  clusterStorylines,
  annotateEditorialSignals,
  applyEntityCoverageCap,
  applyDigestDepth,
  applyStrategicQualityGate,
  applyTopicRelevanceScores,
  buildCustomTopicQueries,
  computeDigestQualityScore,
  customKeywordMatches,
  filterItemsByTopics,
  headlineFingerprint,
  isRepeatedItem,
  normalizeMatchText,
  normalizeTopicToken,
  normalizeUrlForDedup,
  reserveCustomKeywordSlot,
  selectDigestItemsDetailed,
  setAdminSourceRegistry,
  setLearnedDomainAdjustments,
  setPreferredSourceRegistry,
  splitUserTopics,
} = require("../../domains/digest");
const { createDigestOrchestratorDeliveryRankingRuntime } = require("../../entrypoints/digest-orchestrator-delivery-ranking-runtime");
const { createDigestOrchestratorEnrichmentRuntime } = require("../../entrypoints/digest-orchestrator-enrichment-runtime");
const { createDigestOrchestratorFetchRuntime } = require("../../entrypoints/digest-orchestrator-fetch-runtime");
const { createDigestOrchestratorTransportRuntime } = require("../../entrypoints/digest-orchestrator-transport-runtime");
const { computeMaxCustomItems } = require("../../entrypoints/digest-orchestrator-selection-runtime");
const { articleAgeTooOld } = require("../../digest/runtime/digest-data-fetch-items-runtime");
const {
  computeLearnedAuthorityAdjustments,
  loadDomainStats,
} = require("../../digest/domain/domain-learning-runtime");
const { loadConfig } = require("../../runtime/config-provider");
const {
  createPreferredSourceRegistryRuntime,
  buildPreferredDomainShortlist,
} = require("../../runtime/preferred-source-registry-runtime");
const { createSourceRegistryRuntime } = require("../../runtime/source-policy-registry-runtime");
const { resolveSignalBriefRuntimePaths } = require("../../runtime/runtime-state-paths-runtime");
const { buildHistoricalComparison } = require("./historical-runtime");
const {
  CURRENT_DQS_FORMULA,
  DEFAULT_BUDGET_CAP_USD,
  DEFAULT_SCENARIOS,
  DEFAULT_MANUAL_REVIEW_SAMPLE_COUNT,
  EVAL_VERSION,
} = require("./constants-runtime");
const { buildScenarioMatrix } = require("./personas-runtime");
const {
  ageHoursForItem,
  buildManualReviewQueue,
  buildSourceLevelSummary,
  computeSetQuality,
  describeScarcity,
  itemSourceScore,
  rankItemsBySourceScore,
} = require("./scoring-runtime");
const {
  createRetrievalEvalStorageRuntime,
  normalizeBudget,
} = require("./storage-runtime");

function log(message) {
  process.stdout.write(`[retrieval-eval] ${String(message || "")}\n`);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function itemKey(item = {}) {
  const url = String(item?.url || "").trim();
  const headline = String(item?.headline || "").trim().toLowerCase();
  if (url) return `url:${url}`;
  if (headline) return `headline:${headline}`;
  return `${String(item?.tag || "").trim()}:${headline}`;
}

function ensureBudgetCanAfford(budget, estimateUsd, context) {
  const remainingAfterReserve = Number(budget.remaining_usd || 0) - Number(budget.reserve_usd || 0);
  const estimate = Number(estimateUsd || 0);
  if (remainingAfterReserve < estimate) {
    throw new Error(
      `Budget guard triggered before ${context}. Estimated $${estimate.toFixed(4)}, `
      + `remaining after reserve $${Math.max(0, remainingAfterReserve).toFixed(4)}.`
    );
  }
}

function budgetGuardStatus(budget, estimateUsd) {
  const remainingAfterReserve = Number(budget.remaining_usd || 0) - Number(budget.reserve_usd || 0);
  const estimate = Number(estimateUsd || 0);
  return {
    ok: remainingAfterReserve >= estimate,
    estimate_usd: Number(estimate.toFixed(6)),
    remaining_after_reserve_usd: Number(Math.max(0, remainingAfterReserve).toFixed(6)),
  };
}

function summarizeTrace(trace) {
  const reasonCounts = {};
  const transitions = Array.isArray(trace?.transitions) ? trace.transitions : [];
  for (const row of transitions) {
    const reason = String(row?.reason || "").trim() || "unknown";
    reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
  }
  return {
    transitions,
    reason_counts: reasonCounts,
  };
}

function buildFailedPersonaQuality() {
  return {
    score: 0,
    band: "weak",
    avg_item_score: 0,
    avg_relevance: 0,
    avg_freshness: 0,
    preferred_hit_rate: 0,
    weak_source_rate: 0,
    unique_domain_count: 0,
    top_domain_share: 0,
    stale_item_share: 0,
    item_count: 0,
    requested_count: 0,
    fill_rate: 0,
  };
}

function serializeItem(item, extra = {}) {
  return {
    key: itemKey(item),
    headline: String(item?.headline || "").trim() || null,
    url: String(item?.url || "").trim() || null,
    tag: String(item?.tag || "").trim() || null,
    source: String(item?.source || "").trim() || null,
    source_domain: String(item?.source_domain || "").trim() || null,
    source_tier: String(item?.source_tier || "").trim() || null,
    source_policy: String(item?.source_policy || "").trim() || null,
    source_authority: Number.isFinite(Number(item?.source_authority)) ? Number(item.source_authority) : null,
    published_date: String(item?.published_date || "").trim() || null,
    retrieved_at: String(item?.retrieved_at || "").trim() || null,
    topicMatch: Number.isFinite(Number(item?.topicMatch)) ? Number(item.topicMatch) : null,
    relevanceScore: Number.isFinite(Number(item?.relevanceScore)) ? Number(item.relevanceScore) : null,
    preferred_source_match: String(item?.preferred_source_match || "none").trim(),
    preferred_source_strength: Number.isFinite(Number(item?.preferred_source_strength)) ? Number(item.preferred_source_strength) : null,
    weak_source: extra.weak_source === true,
    age_hours: ageHoursForItem(item) == null ? null : Number(ageHoursForItem(item).toFixed(2)),
    source_eval_item_score: Number(itemSourceScore(item).toFixed(2)),
    why_shown: Array.isArray(item?.why_shown) ? item.why_shown.slice() : [],
    stage_reason: extra.stage_reason || null,
  };
}

function diffItems(before = [], after = []) {
  const kept = new Set((Array.isArray(after) ? after : []).map((item) => itemKey(item)));
  return (Array.isArray(before) ? before : []).filter((item) => !kept.has(itemKey(item)));
}

function normalizeEvalTopicKey(value) {
  return normalizeTopicToken(String(value || "").replace(/^custom_/, "").replace(/_/g, " "));
}

function findMatchingPersonaResults(topicDiagnostic, personaResults = []) {
  const key = normalizeEvalTopicKey(topicDiagnostic?.custom_slug || topicDiagnostic?.tag);
  if (!key) return [];
  return (Array.isArray(personaResults) ? personaResults : []).filter((row) => {
    const personaKey = normalizeEvalTopicKey(row?.persona_label || row?.persona_id);
    return personaKey === key;
  });
}

function groupRejectedReasonsByTopic(rejected = []) {
  const grouped = {};
  for (const row of (Array.isArray(rejected) ? rejected : [])) {
    const key = normalizeEvalTopicKey(row?.item?.custom_slug || row?.item?.tag);
    if (!key) continue;
    if (!grouped[key]) grouped[key] = {};
    const reason = String(row?.reason || "").trim() || "unknown";
    grouped[key][reason] = (grouped[key][reason] || 0) + 1;
  }
  return grouped;
}

function classifyTopicGapAudit({
  topicDiagnostic,
  matchingPersonaResults,
  rejectionCounts,
}) {
  const topic = topicDiagnostic && typeof topicDiagnostic === "object" ? topicDiagnostic : {};
  const personas = Array.isArray(matchingPersonaResults) ? matchingPersonaResults : [];
  const rejections = rejectionCounts && typeof rejectionCounts === "object" ? rejectionCounts : {};
  const candidatePoolCount = personas.reduce((sum, row) => sum + Number(row?.candidate_pool_count || 0), 0);
  const finalCount = personas.reduce((sum, row) => sum + Number(row?.final_selected_quality?.item_count || 0), 0);
  const status429 = Number(topic?.status_counts?.[429] || 0);
  const staleRejected = Number(rejections.stale_age_filter || 0);
  const hasProviderFailure = status429 > 0
    || Number(topic?.failed_calls || 0) > 0
    || Number(topic?.transport_errors || 0) > 0
    || topic?.degraded === true;
  const hasRemainingBroadQueries = Number(topic?.remaining_broad_queries || 0) > 0;
  const preferredOnlyZeroYield = Number(topic?.unique_item_count || 0) <= 0
    && Number(topic?.preferred_call_count || 0) > 0
    && Number(topic?.broad_call_count || 0) <= 0
    && Array.isArray(topic?.preferred_domains)
    && topic.preferred_domains.length > 0;
  const offTopicQueryMiss = topic?.is_custom === true
    && Number(topic?.unique_item_count || 0) > 0
    && candidatePoolCount <= 0;
  let rootCause = "covered";
  let failureReason = null;
  if (hasProviderFailure) {
    rootCause = "provider_429_or_transport";
    failureReason = status429 > 0 ? "provider_429" : "provider_transport";
  } else if (staleRejected > 0 && candidatePoolCount <= 0) {
    rootCause = "freshness_filter_collapse";
    failureReason = "stale_age_filter";
  } else if (preferredOnlyZeroYield) {
    rootCause = "preferred_only_query_design";
    failureReason = "preferred_only_zero_yield";
  } else if (Number(topic?.unique_item_count || 0) <= 0 && Number(topic?.broad_call_count || 0) > 0 && hasRemainingBroadQueries) {
    rootCause = "query_plan_not_exhausted";
    failureReason = "unused_broad_queries";
  } else if (offTopicQueryMiss) {
    rootCause = "keyword_ambiguity_or_off_topic_query";
    failureReason = "topic_filter_miss";
  } else if (Number(topic?.unique_item_count || 0) <= 0 && Number(topic?.broad_call_count || 0) > 0) {
    rootCause = "provider_no_recent_coverage";
    failureReason = "zero_yield_broad";
  } else if (candidatePoolCount > 0 && finalCount <= 0) {
    rootCause = "ranking_or_quality_gate";
    failureReason = "final_quality_gate";
  } else if (Number(topic?.unique_item_count || 0) > 0 && finalCount > 0 && finalCount < Math.max(1, personas[0]?.requested_count || 1)) {
    rootCause = "thin_but_precise";
    failureReason = "thin_pool";
  }

  let betterSourceOpportunity = "unlikely";
  let betterSourceNote = null;
  if (rootCause === "preferred_only_query_design") {
    betterSourceOpportunity = "likely";
    betterSourceNote = "Preferred-only retries exhausted before a real broad fallback ran.";
  } else if (rootCause === "query_plan_not_exhausted") {
    betterSourceOpportunity = "likely";
    betterSourceNote = "A broad fallback ran, but alternate broad queries were left unused.";
  } else if (rootCause === "keyword_ambiguity_or_off_topic_query") {
    betterSourceOpportunity = "likely";
    betterSourceNote = "Items were retrieved, but none survived keyword/topic matching.";
  } else if (Number(topic?.preferred_search_result_hit_count || 0) > 0 && Number(topic?.preferred_item_count || 0) <= 0) {
    betterSourceOpportunity = "possible";
    betterSourceNote = "Preferred/trusted domains appeared in search results but did not convert into retained items.";
  } else if (rootCause === "freshness_filter_collapse") {
    betterSourceOpportunity = "possible";
    betterSourceNote = "Retrieved coverage existed, but it missed the freshness policy.";
  } else if (rootCause === "provider_429_or_transport") {
    betterSourceOpportunity = "unknown";
    betterSourceNote = "Provider failures limited the evidence available for this topic.";
  } else if (rootCause === "provider_no_recent_coverage") {
    betterSourceOpportunity = "unclear";
    betterSourceNote = "Broad retrieval ran but still found no usable recent items.";
  }

  const sourceScore = personas.length > 0
    ? Number((personas.reduce((sum, row) => sum + Number(row?.final_selected_quality?.score || 0), 0) / personas.length).toFixed(2))
    : 0;
  const selectionLift = personas.length > 0
    ? Number((personas.reduce((sum, row) => sum + Number(row?.selection_lift || 0), 0) / personas.length).toFixed(2))
    : 0;

  return {
    tag: topic?.tag || null,
    custom_slug: topic?.custom_slug || null,
    is_custom: topic?.is_custom === true,
    raw_count: Number(topic?.unique_item_count || 0),
    cleaned_count: candidatePoolCount,
    final_count: finalCount,
    source_score: sourceScore,
    selection_lift: selectionLift,
    stale_rate: Number(topic?.unique_item_count || 0) > 0
      ? Number(((staleRejected / Math.max(1, Number(topic?.unique_item_count || 0))) * 100).toFixed(2))
      : 0,
    provider_429_count: status429,
    preferred_call_count: Number(topic?.preferred_call_count || 0),
    broad_call_count: Number(topic?.broad_call_count || 0),
    query_count: Number(topic?.query_count || 0),
    remaining_broad_queries: Number(topic?.remaining_broad_queries || 0),
    coverage_status: String(topic?.coverage_status || "").trim() || null,
    root_cause: rootCause,
    failure_reason: failureReason,
    better_source_opportunity: betterSourceOpportunity,
    better_source_note: betterSourceNote,
    preferred_domains: Array.isArray(topic?.preferred_domains) ? topic.preferred_domains.slice() : [],
    preferred_topic_hints: Array.isArray(topic?.preferred_topic_hints) ? topic.preferred_topic_hints.slice() : [],
  };
}

function buildTopicGapAudit(globalResult, personaResults) {
  const topicDiagnostics = Array.isArray(globalResult?.fetchResult?.fetchDiagnostics?.topic_diagnostics)
    ? globalResult.fetchResult.fetchDiagnostics.topic_diagnostics
    : [];
  const rejectedByTopic = groupRejectedReasonsByTopic(globalResult?.rejected);
  return topicDiagnostics.map((topicDiagnostic) => classifyTopicGapAudit({
    topicDiagnostic,
    matchingPersonaResults: findMatchingPersonaResults(topicDiagnostic, personaResults),
    rejectionCounts: rejectedByTopic[normalizeEvalTopicKey(topicDiagnostic?.custom_slug || topicDiagnostic?.tag)] || {},
  }));
}

function createEvalServices() {
  const CONFIG = loadConfig();
  const runtimePaths = resolveSignalBriefRuntimePaths({
    appRoot: path.resolve(__dirname, "..", "..", ".."),
    env: process.env,
    nodeEnv: process.env.NODE_ENV,
  });
  const transportRuntime = createDigestOrchestratorTransportRuntime({
    https,
    defaultTimeoutMs: 30_000,
  });
  const httpsPostWithRetry = (...args) => transportRuntime.httpsPostWithRetry(...args);
  const sourceRegistryRuntime = createSourceRegistryRuntime({
    fs,
    path,
    sourceRegistryPath: runtimePaths.sourceRegistryPath,
  });
  const preferredSourceRegistryRuntime = createPreferredSourceRegistryRuntime({
    fs,
    preferredSourcesPath: runtimePaths.preferredSourcesPath,
  });
  const archiveRuntime = createDigestArchiveRuntime({
    APP_ROOT: runtimePaths.appRoot,
    archiveDir: runtimePaths.archiveDir,
    fs,
    path,
    log,
    formatEtDateKey: (value = new Date()) => new Date(value).toLocaleDateString("en-CA", { timeZone: "America/New_York" }),
    isRepeatedItem,
    normalizeUrlForDedup,
    parseSourceDomainShared: (item, opts = {}) => {
      try {
        const parsed = new URL(String(item?.url || ""));
        return String(parsed.hostname || "").replace(/^www\./, "").toLowerCase();
      } catch (error) {
        if (typeof opts.onUrlParseError === "function") opts.onUrlParseError(error);
        return String(item?.source_domain || item?.source || "").trim().toLowerCase();
      }
    },
  });
  const dataRuntime = createDigestDataRuntime({
    CONFIG,
    log,
    httpsPostWithRetry,
    normalizeUrlForDedup,
    isFetchedItemEligible: (item) => {
      const annotated = annotateEditorialSignals([item]);
      return annotated.length > 0 && annotated[0].hard_exclude !== true;
    },
  });
  const formattingRuntime = createDigestFormattingRuntime({
    CONFIG,
    EMAIL_TEMPLATE: "",
    BASE_URL: process.env.BASE_URL || "https://getsignalbrief.com",
    httpsPostWithRetry,
    buildPublicDigestUrl: () => "",
    normalizeTopicToken,
    customKeywordMatches,
    normalizeMatchText,
    headlineFingerprint,
    normalizeUrlForDedup,
  });
  const deliveryRecordRuntime = createDigestDeliveryRecordRuntime({
    APP_ROOT: runtimePaths.appRoot,
    digestRecordsDir: runtimePaths.digestRecordsDir,
    fs,
    path,
    log,
  });
  const rankingRuntime = createDigestOrchestratorDeliveryRankingRuntime({
    CONFIG,
    log,
    filterItemsByTopics,
    applyTopicRelevanceScores,
    buildRecentEntityHistory,
    suppressRecentlySentForUser: archiveRuntime.suppressRecentlySentForUser,
    isRecentRepeatItem: archiveRuntime.isRecentRepeatItem,
    parseSourceDomain: archiveRuntime.parseSourceDomain,
    applyEntityCoverageCap,
    reserveCustomKeywordSlot,
  });
  const enrichmentRuntime = createDigestOrchestratorEnrichmentRuntime({
    enrichItems: dataRuntime.enrichItems,
  });
  return {
    CONFIG,
    archiveRuntime,
    dataRuntime,
    deliveryRecordRuntime,
    enrichmentRuntime,
    formattingRuntime,
    preferredSourceRegistryRuntime,
    rankingRuntime,
    runtimePaths,
    sourceRegistryRuntime,
  };
}

function buildScenarioEstimate(services, scenario) {
  const digestConfig = services.CONFIG?.digest || {};
  const hardCalls = Number(digestConfig?.search_budget?.scheduled?.hard_calls || 36);
  const perplexityEstimate = Math.max(1, hardCalls) * 0.005;
  const claudeEstimate = 0.08;
  const personaCount = Array.isArray(scenario?.dueUsers) ? scenario.dueUsers.length : 0;
  return Number((perplexityEstimate + claudeEstimate + (personaCount * 0.0005)).toFixed(4));
}

function recordBudgetEvent(storage, budget, entry) {
  const next = normalizeBudget({
    ...budget,
    spent_usd: Number((Number(budget.spent_usd || 0) + Number(entry.cost_usd || 0)).toFixed(6)),
    calls: [...(Array.isArray(budget.calls) ? budget.calls : []), entry],
  });
  return storage.saveBudget(next);
}

function computeScenarioCost(result = {}) {
  const fetchResult = result?.fetchResult || {};
  const enrichResult = result?.enrichResult || {};
  const perplexityCost = (
    Number(fetchResult.standardFetchCalls || 0)
    + Number(fetchResult.customFetchCalls || 0)
  ) * 0.005;
  const claudeCost = (
    (Number(enrichResult.claudeUsage?.input_tokens || 0) / 1_000_000) * 0.8
    + (Number(enrichResult.claudeUsage?.output_tokens || 0) / 1_000_000) * 4.0
  );
  return {
    perplexityCost: Number(perplexityCost.toFixed(6)),
    claudeCost: Number(claudeCost.toFixed(6)),
    totalCost: Number((perplexityCost + claudeCost).toFixed(6)),
  };
}

function buildGlobalSelection({
  services,
  scenarioId,
  dueUsers,
}) {
  const {
    CONFIG,
    archiveRuntime,
    dataRuntime,
    enrichmentRuntime,
    formattingRuntime,
    preferredSourceRegistryRuntime,
  } = services;
  const preferredSourceRegistry = preferredSourceRegistryRuntime.loadPreferredSourceRegistry();
  const fetchRuntime = createDigestOrchestratorFetchRuntime({
    CONFIG,
    log,
    normalizeTopicToken,
    fetchTopicNews: dataRuntime.fetchTopicNews,
    buildPreferredDomainShortlist: (options) => buildPreferredDomainShortlist(preferredSourceRegistry, options),
    buildCustomTopicQueries,
    buildCustomRescueItemsFromStandard: formattingRuntime.buildCustomRescueItemsFromStandard,
    emitDigestIncident: async () => false,
    normalizeUrlForDedup,
    isFetchedItemEligible: (item) => {
      const annotated = annotateEditorialSignals([item]);
      return annotated.length > 0 && annotated[0].hard_exclude !== true;
    },
  });

  return fetchRuntime.orchestrateFetch({
    dueUsers,
    targetChatId: null,
    runMode: scenarioId,
  }).then(async (fetchResult) => {
    let dedupRes = { items: [], removed: 0 };
    let freshItems = [];
    let cleanedAnnotated = [];
    let globalSelection = { selected: [], rejected: [] };
    let enrichResult = { enriched: [], claudeUsage: { input_tokens: 0, output_tokens: 0 } };
    let clusters = [];
    let storylineCandidates = [];
    let storylinePool = [];
    let rejected = [];

    try {
      const digestPolicies = createDigestPolicies(CONFIG.digest || {});
      const selectionTarget = fetchResult.selectionTarget;
      const crossDayDedupDays = Math.max(1, Number(CONFIG.digest.crossDayDedupDays || 3));
      dedupRes = archiveRuntime.dedupAgainstRecentArchives(fetchResult.allItems, {
        days: crossDayDedupDays,
        targetCount: selectionTarget,
        minBackfillItems: Math.max(1, Number(CONFIG.digest.minBackfillItemsAfterDedup || digestPolicies.depthPolicy.defaultItemCount || 5)),
      });
      const maxArticleAgeHours = Number(CONFIG.digest.maxArticleAgeHours || 48);
      freshItems = dedupRes.items.filter((item) => !articleAgeTooOld(item, maxArticleAgeHours));
      const staleRejected = diffItems(dedupRes.items, freshItems).map((item) => ({
        item,
        reason: "stale_age_filter",
      }));
      const dedupRejected = diffItems(fetchResult.allItems, dedupRes.items).map((item) => ({
        item,
        reason: "archive_dedup",
      }));
      const maxCustomItems = computeMaxCustomItems({
        configuredMaxCustom: Number(CONFIG.digest.maxCustomItemsPerRun),
        selectionTarget,
        customTags: fetchResult.customTags,
      });
      globalSelection = selectDigestItemsDetailed(freshItems, {
        maxItems: selectionTarget,
        maxItemsPerTag: CONFIG.digest.maxItemsPerTag,
        customTags: fetchResult.customTags,
        maxCustomItems,
        tagPriority: fetchResult.tagPriority,
        maxItemsPerSourceDomain: CONFIG.digest.maxItemsPerSourceDomain,
        normalizeUrl: normalizeUrlForDedup,
        parseDomain: archiveRuntime.parseSourceDomain,
        normalizeTopicToken,
        isCandidate: (_item, ctx) => Boolean(ctx.headlineKey),
      });
      enrichResult = await enrichmentRuntime.enrichSelectedItems({
        selected: globalSelection.selected,
        runMode: "scheduled",
        dueUsersCount: dueUsers.length,
      });
      clusters = clusterStorylines(enrichResult.enriched);
      storylineCandidates = buildStorylineCandidates(enrichResult.enriched);
      storylinePool = applyStrategicQualityGate(storylineCandidates, {
        minStrategicValue: 0.34,
        maxRoutineScore: 0.65,
        minKeep: Math.min(Math.max(2, Number(selectionTarget || 3)), Math.max(3, storylineCandidates.length)),
      });
      const clusterRejected = clusters.flatMap((cluster) => {
        const representativeKey = itemKey(cluster?.representative || {});
        return (Array.isArray(cluster?.items) ? cluster.items : [])
          .filter((item) => itemKey(item) !== representativeKey)
          .map((item) => ({
            item,
            reason: item?.suppressed_by_preferred_source
              ? "storyline_preferred_substitute"
              : item?.suppressed_by_derivative_source
                ? "storyline_derivative_suppressed"
                : "storyline_displaced",
          }));
      });
      const strategicRejected = diffItems(storylineCandidates, storylinePool).map((item) => ({
        item,
        reason: "storyline_quality_gate",
      }));
      cleanedAnnotated = annotateEditorialSignals(freshItems);
      rejected = [
        ...dedupRejected,
        ...staleRejected,
        ...globalSelection.rejected,
        ...clusterRejected,
        ...strategicRejected,
      ];
    } catch (error) {
      error.partialEvalResult = {
        fetchResult,
        dedupRes,
        freshItems,
        cleanedAnnotated: cleanedAnnotated.length > 0 ? cleanedAnnotated : annotateEditorialSignals(freshItems),
        globalSelection,
        enrichResult,
        clusters,
        storylineCandidates,
        storylinePool,
        rejected,
      };
      throw error;
    }

    return {
      fetchResult,
      dedupRes,
      freshItems,
      cleanedAnnotated,
      globalSelection,
      enrichResult,
      clusters,
      storylineCandidates,
      storylinePool,
      rejected,
    };
  });
}

function computePersonaRawBaseline(items, user, parseSourceDomain) {
  const topics = Array.isArray(user?.topics) ? user.topics : [];
  const { customKeywords } = splitUserTopics(topics);
  const filteredResult = filterItemsByTopics(items, topics, {
    minItems: 1,
    strictZeroFallback: customKeywords.length > 0 ? true : "specialist",
  });
  let filtered = filteredResult.items;
  if (customKeywords.length > 0) {
    filtered = filtered.filter((item) => {
      const tagNormalized = normalizeTopicToken(item?.tag || "");
      const bodyText = normalizeMatchText(`${String(item?.headline || "")} ${String(item?.summary || "")}`);
      return customKeywords.some((keyword) => customKeywordMatches(keyword, bodyText, tagNormalized));
    });
  }
  const scored = applyTopicRelevanceScores(filtered, topics, user.topic_weights || {}, {
    specialistMode: false,
    repeatPenalty: 0,
    isRecentRepeat: () => false,
    sourceDomainForItem: parseSourceDomain,
    recentEntityCounts: {},
    recentStorylineKeys: new Set(),
    blockedSources: new Set(),
    trustedSources: new Set(),
  });
  const requestedCount = Math.max(1, Number(user?.preferences?.items_per_digest || 5));
  const rawBaselineItems = rankItemsBySourceScore(scored).slice(0, requestedCount);
  return {
    filtered,
    scored,
    requestedCount,
    custom_keyword_count: customKeywords.length,
    filter_mode: filteredResult.mode,
    rawBaselineItems,
    candidatePoolQuality: computeSetQuality(scored, { requestedCount }),
    rawBaselineQuality: computeSetQuality(rawBaselineItems, { requestedCount }),
  };
}

function classifyPersonaCoverage(rawBaseline, finalItems, errorMessage) {
  const candidateCount = Math.max(0, Number(rawBaseline?.scored?.length || 0));
  const rawBaselineCount = Math.max(0, Number(rawBaseline?.rawBaselineItems?.length || 0));
  const finalCount = Math.max(0, Number(finalItems?.length || 0));
  if (finalCount > 0) return candidateCount < Math.max(1, Number(rawBaseline?.requestedCount || 0)) ? "retrieval_limited" : "covered";
  if (candidateCount <= 0 || rawBaselineCount <= 0) return "retrieval_limited";
  if (errorMessage) return "ranking_limited";
  return "noisy_baseline_blocked";
}

function evaluatePersona({
  services,
  scenarioId,
  user,
  storylinePool,
  repeatIndex,
  repeatPenalty,
  rankingPolicy,
  depthPolicy,
  cleanedAnnotated,
  fetchDiagnostics,
  selectionDiagnostics,
}) {
  const { archiveRuntime, rankingRuntime } = services;
  const rawBaseline = computePersonaRawBaseline(cleanedAnnotated, user, archiveRuntime.parseSourceDomain);
  const requestedCount = rawBaseline.requestedCount;
  try {
    const ranking = rankingRuntime.rankAndSuppressUserItems({
      user,
      enriched: storylinePool,
      repeatIndex,
      repeatPenalty,
      depthPolicy,
      rankingPolicy,
      recentDigestRecords: [],
      nowIso: new Date().toISOString(),
      deliveryMode: "scheduled",
      runDiagnostics: {
        ...(fetchDiagnostics || {}),
        candidate_pool_before_dedup: selectionDiagnostics?.candidate_pool_before_dedup,
        candidate_pool_after_dedup: selectionDiagnostics?.candidate_pool_after_dedup,
      },
      captureDiagnostics: true,
    });
    const finalItems = applyDigestDepth(ranking.userItems, user?.preferences?.depth || "headline_plus_why");
    const finalQuality = computeSetQuality(finalItems, { requestedCount });
    const digestQuality = computeDigestQualityScore({
      items: finalItems,
      user,
      previous_items: [],
    });
    const selectionLift = Number((finalQuality.score - rawBaseline.rawBaselineQuality.score).toFixed(2));
    return {
      status: "completed",
      scenario_id: scenarioId,
      persona_id: user.chatId,
      persona_label: user.eval_label || user.email || user.chatId,
      group: user.eval_group || "unknown",
      requested_count: requestedCount,
      candidate_pool_count: rawBaseline.scored.length,
      candidate_pool_quality: rawBaseline.candidatePoolQuality,
      raw_baseline_quality: rawBaseline.rawBaselineQuality,
      final_selected_quality: finalQuality,
      selection_lift: selectionLift,
      coverage_limiter: classifyPersonaCoverage(rawBaseline, finalItems, null),
      scarcity_profile: describeScarcity({
        itemCount: finalItems.length,
        requestedCount,
        score: finalQuality.score,
        selectionLift,
      }),
      current_digest_quality: digestQuality,
      candidate_pool_items: rawBaseline.scored.map((item) => serializeItem(item)),
      raw_baseline_items: rawBaseline.rawBaselineItems.map((item) => serializeItem(item)),
      final_items: finalItems.map((item) => serializeItem(item)),
      failure_reasons: summarizeTrace(ranking?.diagnostics?.item_trace),
      final_trace: ranking?.diagnostics?.item_trace || null,
      error: null,
    };
  } catch (error) {
    const message = String(error?.message || error || "unknown persona failure");
    return {
      status: "failed",
      scenario_id: scenarioId,
      persona_id: user.chatId,
      persona_label: user.eval_label || user.email || user.chatId,
      group: user.eval_group || "unknown",
      requested_count: requestedCount,
      candidate_pool_count: rawBaseline.scored.length,
      candidate_pool_quality: rawBaseline.candidatePoolQuality,
      raw_baseline_quality: rawBaseline.rawBaselineQuality,
      final_selected_quality: {
        ...buildFailedPersonaQuality(),
        requested_count: requestedCount,
      },
      selection_lift: Number((0 - rawBaseline.rawBaselineQuality.score).toFixed(2)),
      coverage_limiter: classifyPersonaCoverage(rawBaseline, [], message),
      scarcity_profile: describeScarcity({
        itemCount: 0,
        requestedCount,
        score: 0,
      }),
      current_digest_quality: {
        score: 0,
        band: "poor",
        quality_label: "poor",
      },
      candidate_pool_items: rawBaseline.scored.map((item) => serializeItem(item)),
      raw_baseline_items: rawBaseline.rawBaselineItems.map((item) => serializeItem(item)),
      final_items: [],
      failure_reasons: {
        transitions: [
          {
            stage: "ranking",
            reason: "no_deliverable_items",
            message,
          },
        ],
        reason_counts: {
          no_deliverable_items: 1,
        },
      },
      final_trace: null,
      error: message,
    };
  }
}

function buildScenarioSummary(scenario, globalResult, personaResults) {
  const rawSourceSummary = buildSourceLevelSummary(globalResult.cleanedAnnotated);
  const finalItems = personaResults.flatMap((row) => row.final_items || []);
  const finalSourceSummary = buildSourceLevelSummary(finalItems);
  const topicGapAudit = buildTopicGapAudit(globalResult, personaResults);
  const strongest = personaResults.slice().sort((left, right) => Number(right.final_selected_quality?.score || 0) - Number(left.final_selected_quality?.score || 0))[0] || null;
  const weakest = personaResults.slice().sort((left, right) => Number(left.final_selected_quality?.score || 0) - Number(right.final_selected_quality?.score || 0))[0] || null;
  const negativeLiftCount = personaResults.filter((row) => Number(row.selection_lift || 0) < 0).length;
  const failedPersonaCount = personaResults.filter((row) => row?.status === "failed").length;
  const scarcityCounts = {};
  const reasonCounts = {};
  const coverageLimiterCounts = {};
  const topicRootCauseCounts = {};
  for (const row of personaResults) {
    const scarcityKey = String(row?.scarcity_profile || "").trim() || "unknown";
    scarcityCounts[scarcityKey] = (scarcityCounts[scarcityKey] || 0) + 1;
    const limiterKey = String(row?.coverage_limiter || "").trim() || "unknown";
    coverageLimiterCounts[limiterKey] = (coverageLimiterCounts[limiterKey] || 0) + 1;
    for (const [reason, count] of Object.entries(row?.failure_reasons?.reason_counts || {})) {
      reasonCounts[reason] = (reasonCounts[reason] || 0) + Number(count || 0);
    }
  }
  for (const row of topicGapAudit) {
    const rootCause = String(row?.root_cause || "").trim() || "unknown";
    topicRootCauseCounts[rootCause] = (topicRootCauseCounts[rootCause] || 0) + 1;
  }
  const recommendations = [];
  const avgFinalScore = personaResults.length
    ? personaResults.reduce((sum, row) => sum + Number(row?.final_selected_quality?.score || 0), 0) / personaResults.length
    : 0;
  const avgFreshness = personaResults.length
    ? personaResults.reduce((sum, row) => sum + Number(row?.final_selected_quality?.avg_freshness || 0), 0) / personaResults.length
    : 0;
  const avgFillRate = personaResults.length
    ? personaResults.reduce((sum, row) => sum + Number(row?.final_selected_quality?.fill_rate || 0), 0) / personaResults.length
    : 0;
  const topDomainShare = finalSourceSummary[0]?.top_domain_share || 0;
  const provider429Rate = Number(globalResult?.fetchResult?.fetchDiagnostics?.provider_429_rate || 0);
  const provider429Count = Number(globalResult?.fetchResult?.fetchDiagnostics?.provider_429_count || 0);
  const retrievalLimitedCount = Number(coverageLimiterCounts.retrieval_limited || 0);
  const rankingLimitedCount = Number(coverageLimiterCounts.ranking_limited || 0);
  const staleRejectedCount = globalResult.rejected.filter((row) => row?.reason === "stale_age_filter").length;
  const rawCandidateCount = Math.max(0, Number(globalResult?.fetchResult?.allItems?.length || 0));
  const cleanedCandidateCount = Math.max(0, Number(globalResult?.cleanedAnnotated?.length || 0));
  if (avgFreshness < 75) recommendations.push("Freshness is slipping below the 24-48h target in final selections.");
  if (negativeLiftCount > 0) recommendations.push("Selection is reducing quality for some personas; inspect negative-lift cases.");
  if (topDomainShare > 50) recommendations.push("Source concentration is high in final selections; review source-cap behavior.");
  if (failedPersonaCount > 0) recommendations.push("Some personas failed to produce deliverable items after fallback; inspect thin-pool and retrieval coverage.");
  if ((scarcityCounts.short_but_precise || 0) > 0) recommendations.push("Some digests are intentionally short but precise; treat fill-rate separately from quality.");
  if (provider429Count > 0) recommendations.push("Provider rate limits are collapsing coverage for part of this scenario; inspect batching and query sequencing.");
  if (retrievalLimitedCount > rankingLimitedCount && retrievalLimitedCount > 0) recommendations.push("Most failures are retrieval-limited rather than ranking-limited; prioritize candidate yield.");
  if ((topicRootCauseCounts.preferred_only_query_design || 0) > 0) recommendations.push("Zero-yield preferred-domain topics are still missing broad fallback coverage; fix retry sequencing before adding more fallback.");
  if ((topicRootCauseCounts.query_plan_not_exhausted || 0) > 0) recommendations.push("Zero-yield topics still have unused alternate broad queries; one more broad pass is likely higher-leverage than looser fallback.");
  if ((topicRootCauseCounts.keyword_ambiguity_or_off_topic_query || 0) > 0) recommendations.push("Broad custom keywords are retrieving off-topic items; tighten keyword/source hints rather than padding.");
  return {
    scenario_id: scenario.id,
    label: scenario.label,
    status: failedPersonaCount > 0 ? "completed_with_errors" : "completed",
    persona_count: scenario.personaCount,
    failed_persona_count: failedPersonaCount,
    raw_candidate_count: globalResult.fetchResult.allItems ? globalResult.fetchResult.allItems.length : globalResult.fetchResult?.allItems,
    cleaned_candidate_count: globalResult.cleanedAnnotated.length,
    global_selected_count: globalResult.globalSelection.selected.length,
    storyline_pool_count: globalResult.storylinePool.length,
    fetch_calls: {
      standard: Number(globalResult.fetchResult.standardFetchCalls || 0),
      custom: Number(globalResult.fetchResult.customFetchCalls || 0),
    },
    strongest_persona: strongest ? {
      id: strongest.persona_id,
      label: strongest.persona_label,
      score: strongest.final_selected_quality.score,
    } : null,
    weakest_persona: weakest ? {
      id: weakest.persona_id,
      label: weakest.persona_label,
      score: weakest.final_selected_quality.score,
    } : null,
    negative_lift_count: negativeLiftCount,
    scarcity_counts: scarcityCounts,
    coverage_limiter_counts: coverageLimiterCounts,
    reason_counts: reasonCounts,
    topic_root_cause_counts: topicRootCauseCounts,
    topic_gap_audit: topicGapAudit,
    raw_source_summary: rawSourceSummary,
    final_source_summary: finalSourceSummary,
    provider_429_count: provider429Count,
    provider_429_rate: provider429Rate,
    degraded_topic_rate: Number(globalResult?.fetchResult?.fetchDiagnostics?.degraded_topic_rate || 0),
    retrieval_limited_topic_count: Number(globalResult?.fetchResult?.fetchDiagnostics?.retrieval_limited_topic_count || 0),
    thin_topic_count: Number(globalResult?.fetchResult?.fetchDiagnostics?.thin_topic_count || 0),
    stale_rejection_rate: rawCandidateCount > 0 ? Number(((staleRejectedCount / rawCandidateCount) * 100).toFixed(2)) : 0,
    candidate_collapse_rate: rawCandidateCount > 0 ? Number((((rawCandidateCount - cleanedCandidateCount) / rawCandidateCount) * 100).toFixed(2)) : 0,
    recommendations,
    average_final_score: Number(avgFinalScore.toFixed(2)),
    average_final_freshness: Number(avgFreshness.toFixed(2)),
    average_fill_rate: Number(avgFillRate.toFixed(2)),
  };
}

function buildOverallSummary(scenarios, personaResults) {
  const strongest = personaResults.slice().sort((left, right) => Number(right.final_selected_quality?.score || 0) - Number(left.final_selected_quality?.score || 0))[0] || null;
  const weakest = personaResults.slice().sort((left, right) => Number(left.final_selected_quality?.score || 0) - Number(right.final_selected_quality?.score || 0))[0] || null;
  const overallScore = personaResults.length
    ? personaResults.reduce((sum, row) => sum + Number(row?.final_selected_quality?.score || 0), 0) / personaResults.length
    : 0;
  return {
    scenario_count: scenarios.length,
    persona_count: personaResults.length,
    overall_score: Number(overallScore.toFixed(2)),
    strongest_band: strongest?.final_selected_quality?.band || null,
    weakest_band: weakest?.final_selected_quality?.band || null,
    strongest_persona: strongest ? {
      scenario_id: strongest.scenario_id,
      persona_id: strongest.persona_id,
      persona_label: strongest.persona_label,
      score: strongest.final_selected_quality.score,
    } : null,
    weakest_persona: weakest ? {
      scenario_id: weakest.scenario_id,
      persona_id: weakest.persona_id,
      persona_label: weakest.persona_label,
      score: weakest.final_selected_quality.score,
    } : null,
  };
}

async function runRetrievalEval(options = {}) {
  const scenarios = Array.isArray(options.scenarios) && options.scenarios.length > 0
    ? options.scenarios
    : DEFAULT_SCENARIOS.slice();
  const services = options.services || createEvalServices();
  const storage = options.storage || createRetrievalEvalStorageRuntime({
    appRoot: services.runtimePaths.appRoot,
    env: process.env,
    nodeEnv: process.env.NODE_ENV,
  });
  storage.ensureRoot();
  let budget = storage.loadBudget();
  if (options.resetBudget === true) {
    budget = storage.saveBudget({
      cap_usd: Number(options.budgetCapUsd || DEFAULT_BUDGET_CAP_USD),
      reserve_usd: Number(options.budgetReserveUsd || budget.reserve_usd),
      spent_usd: 0,
      calls: [],
      stop_reason: null,
    });
  }
  const runId = String(options.runId || `retrieval-eval:${new Date().toISOString().replace(/[:.]/g, "-")}`);
  const scenarioDefs = Array.isArray(options.scenarioDefs) && options.scenarioDefs.length > 0
    ? options.scenarioDefs
    : buildScenarioMatrix(scenarios);
  const runRecord = {
    version: EVAL_VERSION,
    run_id: runId,
    status: "running",
    started_at: new Date().toISOString(),
    completed_at: null,
    delivery_disabled: true,
    transport_channels_disabled: ["email", "telegram"],
    budget: cloneJson(budget),
    historical: null,
    dqs_formula: CURRENT_DQS_FORMULA,
    scenarios: [],
    manual_review_queue: [],
    overall_summary: null,
    recommendations: [],
  };
  storage.saveActiveRun({
    run_id: runId,
    status: "running",
    started_at: runRecord.started_at,
    scenarios: scenarioDefs.map((row) => row.id),
  });
  storage.saveRun(runRecord);

  const sourceRegistry = services.sourceRegistryRuntime.loadSourceRegistry();
  const preferredRegistry = services.preferredSourceRegistryRuntime.loadPreferredSourceRegistry();
  setAdminSourceRegistry(services.sourceRegistryRuntime.buildRegistryMap(sourceRegistry));
  setPreferredSourceRegistry(preferredRegistry);
  const learnedAdjustments = computeLearnedAuthorityAdjustments(loadDomainStats());
  if (learnedAdjustments.size > 0) setLearnedDomainAdjustments(learnedAdjustments);

  try {
    runRecord.historical = buildHistoricalComparison({
      digestDeliveryRecordRuntime: services.deliveryRecordRuntime,
      days: Number(options.historicalDays || 14),
    });
    storage.saveRun(runRecord);

    const allPersonaResults = [];
    for (const scenario of scenarioDefs) {
      const estimatedScenarioCost = buildScenarioEstimate(services, scenario);
      const budgetGuard = budgetGuardStatus(budget, estimatedScenarioCost);
      if (!budgetGuard.ok) {
        budget = storage.saveBudget({
          ...budget,
          stop_reason: `budget_cap_before:${scenario.id}`,
        });
        runRecord.budget = cloneJson(budget);
        runRecord.recommendations.push(
          `Stopped before ${scenario.id} because the remaining budget after reserve `
          + `($${budgetGuard.remaining_after_reserve_usd.toFixed(2)}) was below the `
          + `estimated scenario cost ($${budgetGuard.estimate_usd.toFixed(2)}).`
        );
        break;
      }
      log(`Running scenario ${scenario.id} (${scenario.personaCount} personas)`);
      try {
        const globalResult = await buildGlobalSelection({
          services,
          scenarioId: scenario.id,
          dueUsers: scenario.dueUsers,
        });
        const digestPolicies = createDigestPolicies(services.CONFIG.digest || {});
        const repeatIndex = services.archiveRuntime.buildRecentRepeatIndex(Math.max(1, Number(services.CONFIG.digest.crossDayDedupDays || 3)));
        const repeatPenalty = Number(digestPolicies.rankingPolicy.repeatPenalty || 0);
        const selectionDiagnostics = {
          candidate_pool_before_dedup: Array.isArray(globalResult.fetchResult.allItems) ? globalResult.fetchResult.allItems.length : globalResult.fetchResult?.allItems?.length || globalResult.fetchResult?.allItems || globalResult.fetchResult.allItems,
          candidate_pool_after_dedup: globalResult.freshItems.length,
        };
        const personaResults = scenario.dueUsers.map((user) => evaluatePersona({
          services,
          scenarioId: scenario.id,
          user,
          storylinePool: globalResult.storylinePool,
          repeatIndex,
          repeatPenalty,
          rankingPolicy: digestPolicies.rankingPolicy,
          depthPolicy: digestPolicies.depthPolicy,
          cleanedAnnotated: globalResult.cleanedAnnotated,
          fetchDiagnostics: globalResult.fetchResult.fetchDiagnostics,
          selectionDiagnostics,
        }));
        allPersonaResults.push(...personaResults);

        const scenarioCost = computeScenarioCost(globalResult);
        budget = recordBudgetEvent(storage, budget, {
          ts: new Date().toISOString(),
          provider: "eval_scenario",
          purpose: scenario.id,
          cost_usd: scenarioCost.totalCost,
          standard_fetch_calls: Number(globalResult.fetchResult.standardFetchCalls || 0),
          custom_fetch_calls: Number(globalResult.fetchResult.customFetchCalls || 0),
          claude_usage: globalResult.enrichResult.claudeUsage,
        });

        const summary = buildScenarioSummary(scenario, globalResult, personaResults);
        const scenarioRecord = {
          id: scenario.id,
          label: scenario.label,
          status: summary.status,
          error: null,
          due_users_count: scenario.dueUsers.length,
          budget_cost_usd: scenarioCost.totalCost,
          fetch_diagnostics: globalResult.fetchResult.fetchDiagnostics,
          raw_candidates: globalResult.fetchResult.allItems.map((item) => serializeItem(item)),
          cleaned_candidates: globalResult.cleanedAnnotated.map((item) => serializeItem(item)),
          global_selected_items: globalResult.enrichResult.enriched.map((item) => serializeItem(item)),
          storyline_pool_items: globalResult.storylinePool.map((item) => serializeItem(item)),
          global_rejections: globalResult.rejected.map((row) => serializeItem(row.item, { stage_reason: row.reason })),
          clusters: globalResult.clusters.map((cluster) => ({
            storyline_id: cluster.storyline_id,
            canonical_headline: cluster.canonical_headline,
            representative: serializeItem(cluster.representative || {}),
            items: (Array.isArray(cluster.items) ? cluster.items : []).map((item) => serializeItem(item, {
              stage_reason: item?.suppressed_by_preferred_source
                ? "storyline_preferred_substitute"
                : item?.suppressed_by_derivative_source
                  ? "storyline_derivative_suppressed"
                  : null,
              weak_source: false,
            })),
          })),
          summary,
          persona_results: personaResults,
        };
        runRecord.scenarios.push(scenarioRecord);
      } catch (error) {
        const message = String(error?.message || error || "scenario failed");
        const partialResult = error?.partialEvalResult && typeof error.partialEvalResult === "object"
          ? error.partialEvalResult
          : null;
        const partialCost = computeScenarioCost(partialResult || {});
        if (partialCost.totalCost > 0) {
          budget = recordBudgetEvent(storage, budget, {
            ts: new Date().toISOString(),
            provider: "eval_scenario_partial_failure",
            purpose: scenario.id,
            cost_usd: partialCost.totalCost,
            standard_fetch_calls: Number(partialResult?.fetchResult?.standardFetchCalls || 0),
            custom_fetch_calls: Number(partialResult?.fetchResult?.customFetchCalls || 0),
            claude_usage: partialResult?.enrichResult?.claudeUsage || null,
            failed: true,
          });
        }
        runRecord.scenarios.push({
          id: scenario.id,
          label: scenario.label,
          status: "failed",
          error: message,
          due_users_count: scenario.dueUsers.length,
          budget_cost_usd: partialCost.totalCost,
          fetch_diagnostics: partialResult?.fetchResult?.fetchDiagnostics || null,
          raw_candidates: (Array.isArray(partialResult?.fetchResult?.allItems) ? partialResult.fetchResult.allItems : []).map((item) => serializeItem(item)),
          cleaned_candidates: (Array.isArray(partialResult?.cleanedAnnotated) ? partialResult.cleanedAnnotated : []).map((item) => serializeItem(item)),
          global_selected_items: (Array.isArray(partialResult?.enrichResult?.enriched) ? partialResult.enrichResult.enriched : []).map((item) => serializeItem(item)),
          storyline_pool_items: (Array.isArray(partialResult?.storylinePool) ? partialResult.storylinePool : []).map((item) => serializeItem(item)),
          global_rejections: (Array.isArray(partialResult?.rejected) ? partialResult.rejected : []).map((row) => serializeItem(row.item, { stage_reason: row.reason })),
          clusters: (Array.isArray(partialResult?.clusters) ? partialResult.clusters : []).map((cluster) => ({
            storyline_id: cluster.storyline_id,
            canonical_headline: cluster.canonical_headline,
            representative: serializeItem(cluster.representative || {}),
            items: (Array.isArray(cluster.items) ? cluster.items : []).map((item) => serializeItem(item)),
          })),
          summary: {
            scenario_id: scenario.id,
            label: scenario.label,
            status: "failed",
            persona_count: scenario.personaCount,
            failed_persona_count: scenario.personaCount,
            reason_counts: {
              scenario_failed: 1,
            },
            raw_candidate_count: Math.max(0, Number(partialResult?.fetchResult?.allItems?.length || 0)),
            cleaned_candidate_count: Math.max(0, Number(partialResult?.cleanedAnnotated?.length || 0)),
            average_fill_rate: 0,
            recommendations: [
              `Scenario failed before final selection: ${message}`,
            ],
            average_final_score: 0,
            average_final_freshness: 0,
          },
          persona_results: [],
        });
        runRecord.recommendations.push(`Scenario ${scenario.id} failed: ${message}`);
      }
      runRecord.budget = cloneJson(budget);
      storage.saveRun(runRecord);
    }

    runRecord.manual_review_queue = buildManualReviewQueue(allPersonaResults, Number(options.manualReviewSampleCount || DEFAULT_MANUAL_REVIEW_SAMPLE_COUNT));
    runRecord.overall_summary = buildOverallSummary(runRecord.scenarios, allPersonaResults);
    runRecord.recommendations = Array.from(new Set([
      ...(Array.isArray(runRecord.recommendations) ? runRecord.recommendations : []),
      ...runRecord.scenarios.flatMap((scenario) => scenario.summary?.recommendations || []),
    ]));
    runRecord.completed_at = new Date().toISOString();
    runRecord.status = runRecord.scenarios.some((scenario) => scenario?.status === "failed")
      || runRecord.scenarios.some((scenario) => scenario?.status === "completed_with_errors")
      ? "completed_with_errors"
      : "completed";
    runRecord.budget = cloneJson(budget);
    storage.saveRun(runRecord);
    storage.clearActiveRun();
    return runRecord;
  } catch (error) {
    runRecord.completed_at = new Date().toISOString();
    runRecord.status = "failed";
    runRecord.error = String(error?.message || error);
    runRecord.budget = cloneJson(storage.loadBudget());
    storage.saveRun(runRecord);
    storage.saveActiveRun({
      run_id: runId,
      status: "failed",
      started_at: runRecord.started_at,
      completed_at: runRecord.completed_at,
      error: runRecord.error,
    });
    throw error;
  } finally {
    setLearnedDomainAdjustments(null);
    setPreferredSourceRegistry(null);
    setAdminSourceRegistry(null);
  }
}

module.exports = {
  budgetGuardStatus,
  buildGlobalSelection,
  buildScenarioEstimate,
  buildTopicGapAudit,
  classifyTopicGapAudit,
  computeScenarioCost,
  computePersonaRawBaseline,
  createEvalServices,
  ensureBudgetCanAfford,
  runRetrievalEval,
  serializeItem,
};
