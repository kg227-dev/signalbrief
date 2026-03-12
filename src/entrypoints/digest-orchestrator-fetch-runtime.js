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
  if (!targetChatId || !Array.isArray(dueUsers) || dueUsers.length !== 1) return topics;

  const userStandardTopics = new Set(
    (Array.isArray(dueUsers[0]?.topics) ? dueUsers[0].topics : []).filter((topic) => !String(topic || "").startsWith("custom_"))
  );
  if (userStandardTopics.size === 0) return topics;
  const filtered = topics.filter((topic) => userStandardTopics.has(topic.tag));
  logger(`On-demand: fetching ${filtered.length}/${topics.length} topic(s) for user`);
  return filtered;
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
