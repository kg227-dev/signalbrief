"use strict";

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
      queries: Array.isArray(queries) && queries.length > 0
        ? queries
        : [`${keyword} business strategy developments last 48 hours`],
      isCustom: true,
    };
  });
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

function summarizePerplexityDiagnostics(results) {
  const summary = {
    topics: 0,
    degraded_topics: 0,
    failed_calls: 0,
    transport_errors: 0,
    successful_calls: 0,
    status_counts: {},
  };
  for (const result of (Array.isArray(results) ? results : [])) {
    const diagnostics = result?.diagnostics;
    if (!diagnostics || diagnostics.provider !== "perplexity") continue;
    summary.topics += 1;
    summary.failed_calls += Number(diagnostics.failed_calls || 0);
    summary.transport_errors += Number(diagnostics.transport_errors || 0);
    summary.successful_calls += Number(diagnostics.successful_calls || 0);
    mergeStatusCounts(summary.status_counts, diagnostics.status_counts);
    if (diagnostics.degraded) summary.degraded_topics += 1;
  }
  return summary;
}

function mergePerplexityDiagnostics(base, extra) {
  return {
    topics: Number(base?.topics || 0) + Number(extra?.topics || 0),
    degraded_topics: Number(base?.degraded_topics || 0) + Number(extra?.degraded_topics || 0),
    failed_calls: Number(base?.failed_calls || 0) + Number(extra?.failed_calls || 0),
    transport_errors: Number(base?.transport_errors || 0) + Number(extra?.transport_errors || 0),
    successful_calls: Number(base?.successful_calls || 0) + Number(extra?.successful_calls || 0),
    status_counts: mergeStatusCounts(
      mergeStatusCounts({}, base?.status_counts),
      extra?.status_counts
    ),
  };
}

function createDigestOrchestratorFetchRuntime(deps) {
  const {
    CONFIG,
    log,
    normalizeTopicToken,
    fetchTopicNews,
    buildCustomTopicQueries,
    buildCustomRescueItemsFromStandard,
    emitDigestIncident,
  } = deps || {};
  const logger = typeof log === "function" ? log : () => {};
  const topicNormalizer = typeof normalizeTopicToken === "function"
    ? normalizeTopicToken
    : (value) => String(value || "").toLowerCase().trim();
  const fetchTopic = typeof fetchTopicNews === "function" ? fetchTopicNews : async () => ({ items: [], apiCalls: 0 });
  const buildRescueItems = typeof buildCustomRescueItemsFromStandard === "function"
    ? buildCustomRescueItemsFromStandard
    : () => [];
  const emitIncident = typeof emitDigestIncident === "function"
    ? emitDigestIncident
    : async () => false;

  async function orchestrateFetch({ dueUsers, targetChatId, runMode }) {
    const digestConfig = CONFIG?.digest || {};
    const selectionTarget = resolveSelectionTarget(dueUsers, Number(digestConfig.itemCount || 7));
    const tagPriority = buildTagPriority(dueUsers, topicNormalizer);
    const topicsToFetch = resolveTopicsToFetch({
      configTopics: CONFIG?.topics,
      dueUsers,
      targetChatId,
      log: logger,
    });

    const standardFetchCallsPlanned = topicsToFetch.length;
    const standardResults = await Promise.all(topicsToFetch.map(fetchTopic));
    const standardFetchCalls = standardResults.reduce((sum, result) => sum + Number(result?.apiCalls || 0), 0);
    const standardItems = standardResults.flatMap((result) => (Array.isArray(result?.items) ? result.items : []));
    let allItems = standardItems.slice();
    let providerDiagnostics = summarizePerplexityDiagnostics(standardResults);
    logger(`Fetched ${allItems.length} raw items`);

    const allStandardEmpty = standardFetchCallsPlanned > 0
      && standardResults.every((result) => Array.isArray(result?.items) && result.items.length === 0);
    if (allStandardEmpty) {
      await emitIncident(
        "zero-standard-results",
        `All ${standardFetchCallsPlanned} standard topic fetches returned zero items`,
        {
          mode: runMode,
          due_users: Array.isArray(dueUsers) ? dueUsers.length : 0,
          standard_topics: standardFetchCallsPlanned,
          selected_items: 0,
        }
      );
    }

    const customTopicSlugs = resolveCustomTopicSlugs({
      dueUsers,
      maxCustomFetchPerRun: digestConfig.maxCustomFetchPerRun,
      log: logger,
    });
    const customFetchTargets = buildCustomFetchTargets(customTopicSlugs, buildCustomTopicQueries);
    const customTags = customFetchTargets.map((target) => target.tag);
    let customFetchCalls = 0;

    if (customFetchTargets.length > 0) {
      logger(`Fetching ${customFetchTargets.length} custom topic(s): ${customFetchTargets.map((target) => target.tag).join(", ")}`);
      const customResults = await Promise.all(customFetchTargets.map(fetchTopic));
      customFetchCalls = customResults.reduce((sum, result) => sum + Number(result?.apiCalls || 0), 0);
      const customItems = customResults.flatMap((result) => (Array.isArray(result?.items) ? result.items : []));
      providerDiagnostics = mergePerplexityDiagnostics(
        providerDiagnostics,
        summarizePerplexityDiagnostics(customResults)
      );
      logger(`Fetched ${customItems.length} custom topic item(s)`);

      // Prepend so custom items are visible to selection before broad pool balancing.
      allItems.unshift(...customItems);

      const customKeywords = customTopicSlugs
        .map((slug) => topicNormalizer(String(slug || "").replace(/^custom_/, "").replace(/_/g, " ")))
        .filter(Boolean);
      const rescueItems = buildRescueItems(standardItems, customKeywords, allItems, 1);
      if (rescueItems.length > 0) {
        allItems.unshift(...rescueItems);
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
          standard_topics: standardFetchCallsPlanned,
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
          standard_topics: standardFetchCallsPlanned,
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
