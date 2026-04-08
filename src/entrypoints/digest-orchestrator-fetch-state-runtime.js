"use strict";

const { normalizeSourcePolicyDomain } = require("../runtime/source-policy-registry-runtime");
const { createConversionFunnel } = require("../digest/runtime/digest-data-fetch-items-runtime");

const DEFAULT_RETENTION_HOURS_FOR_INVENTORY = 72;

function normalizeSourceTierForFetch(value) {
  const tier = String(value || "").trim().toLowerCase();
  return tier.startsWith("learned-") ? tier.slice("learned-".length) : tier;
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

function annotateItemsForFetch(items, annotateFetchedItems) {
  if (typeof annotateFetchedItems !== "function") return Array.isArray(items) ? items : [];
  try {
    return annotateFetchedItems(Array.isArray(items) ? items : []);
  } catch {
    return Array.isArray(items) ? items : [];
  }
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

function isBrokerRetrievalOrigin(value) {
  const origin = String(value || "").trim().toLowerCase();
  return origin === "broker_official" || origin === "broker_publisher_feed";
}

function isDiscoverySupplementItem(item) {
  return !isBrokerRetrievalOrigin(item?.retrieval_origin || item?.retrieval_lane || "");
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
  const nowMs = Number.isFinite(Number(opts.nowMs)) ? opts.nowMs : Date.now();
  const maxAgeHours = Number.isFinite(Number(opts.maxAgeHours)) ? opts.maxAgeHours : 48;
  return brokerCandidateInventory.persistBrokerTopicItems(topicItems, {
    nowMs,
    retentionHours: Math.max(DEFAULT_RETENTION_HOURS_FOR_INVENTORY, maxAgeHours + 24),
  });
}

module.exports = {
  DEFAULT_RETENTION_HOURS_FOR_INVENTORY,
  normalizeCandidateDomain,
  matchesDomain,
  annotateItemsForFetch,
  buildItemDedupKey,
  classifyRetrievedSourceFamily,
  buildTrustedFamilyQueue,
  buildTopicState,
  mergeUniqueItemsIntoState,
  mergeBrokerItemsIntoState,
  buildStateCandidateInventory,
  preloadBrokerInventoryIntoStates,
  persistBrokerInventory,
  isDiscoverySupplementItem,
};
