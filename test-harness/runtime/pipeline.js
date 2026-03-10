const {
  normalizeMatchText,
  normalizeTopicToken,
  topicsRelated,
  computeTopicMatch,
  matchWeightToTag,
  normalizeCustomKeyword,
  splitUserTopics,
  itemMatchesPersonaTopic,
  filterItemsByTopics,
  applyTopicRelevanceScores,
  applyDigestDepth,
  reserveCustomKeywordSlot: reserveDigestCustomKeywordSlot,
  selectItemsByPolicy,
  createSelectionPolicy,
  createRankingPolicy,
  createDepthPolicy,
  createDigestPolicies,
  normalizeUrlForDedup,
  isRepeatedItem,
  parseSourceDomain: parseSourceDomainShared,
} = require("../../src/domains/digest");

function parseItemDomain(item) {
  return parseSourceDomainShared(item, {
    onUrlParseError: (err) => {
      if (process.env.QA_DEBUG === "1") {
        console.warn(`[qa-pipeline] falling back to source domain: ${err.message}`);
      }
    },
  });
}

function selectItems(allItems, selectionPolicy = {}) {
  const policy = createSelectionPolicy(selectionPolicy);
  return selectItemsByPolicy(allItems, policy, {
    normalizeUrl: normalizeUrlForDedup,
    parseDomain: parseItemDomain,
    normalizeTopicToken,
  });
}

function applyRelevanceScores(items, userTopics, topicWeights = {}, rankingPolicy = {}, specialistMode = false) {
  const policy = createRankingPolicy(rankingPolicy);
  return applyTopicRelevanceScores(items, userTopics, topicWeights, {
    specialistMode: !!specialistMode,
    repeatPenalty: policy.repeatPenalty,
    isRecentRepeat: (item) => isRepeatedItem(item, policy.repeatIndex),
    sourceDomainForItem: parseItemDomain,
  });
}

function filterItemsForPersona(enrichedItems, userTopics, depthPolicy = {}, strictZeroFallback = false) {
  const policy = createDepthPolicy(depthPolicy);
  return filterItemsByTopics(enrichedItems, userTopics, {
    minItems: policy.minFilteredItems,
    strictZeroFallback,
  });
}

function applyDepth(items, depth) {
  return applyDigestDepth(items, depth);
}

function reserveCustomKeywordSlot(items, requestedCount, customKeywords = []) {
  return reserveDigestCustomKeywordSlot(items, requestedCount, customKeywords);
}

function buildDigestForPersona(enrichedItems, persona, policyInput = {}) {
  const prefs = persona?.preferences || {};
  const { rankingPolicy, depthPolicy } = createDigestPolicies(policyInput);
  const filterRes = filterItemsForPersona(
    enrichedItems,
    persona?.topics || [],
    depthPolicy,
    "specialist"
  );
  const customKeywords = filterRes.customKeywords || [];
  const specialistMode = !!filterRes.specialistMode;

  let scored = applyRelevanceScores(
    filterRes.items,
    persona?.topics || [],
    persona?.topic_weights || {},
    rankingPolicy,
    specialistMode
  );
  scored = scored.sort((a, b) => Number(b.relevanceScore || 0) - Number(a.relevanceScore || 0));

  const requested = Number(prefs.items_per_digest) || Number(depthPolicy.defaultItemCount) || 5;
  const minBaseScoreForFinal = Number(rankingPolicy.minBaseScoreForFinal || 6.5);
  const minStrongItems = Math.max(2, Math.min(requested, 4));
  const stronger = scored.filter((item) =>
    Number(item?.baseScore || 0) >= minBaseScoreForFinal
    || (Array.isArray(item?.why_shown) && item.why_shown.includes("custom_keyword"))
  );
  if (stronger.length >= minStrongItems) scored = stronger;

  const preTrimCount = scored.length;
  const trimmed = reserveCustomKeywordSlot(scored, requested, customKeywords);
  const preDepthItems = trimmed.map((i) => ({ ...i }));
  const depth = prefs.depth || "headline_plus_why";
  const finalItems = applyDepth(trimmed, depth);

  return {
    persona_id: persona?.id,
    persona_name: persona?.name,
    requested_count: requested,
    pre_trim_count: preTrimCount,
    delivered_count: finalItems.length,
    depth,
    was_filtered: filterRes.wasFiltered,
    filter_mode: filterRes.mode,
    filtered_match_count: filterRes.filteredCount,
    specialist_mode: specialistMode,
    pre_depth_items: preDepthItems,
    items: finalItems,
    scored_items: scored,
    raw_filtered_items: filterRes.items,
  };
}

function countAdjacencyViolations(items) {
  const arr = Array.isArray(items) ? items : [];
  let violations = 0;
  for (let i = 1; i < arr.length; i++) {
    if (arr[i - 1]?.tag && arr[i]?.tag && arr[i - 1].tag === arr[i].tag) violations++;
  }
  return violations;
}

function tagDistribution(items) {
  const counts = {};
  for (const item of items || []) {
    const tag = item?.tag || "UNKNOWN";
    counts[tag] = (counts[tag] || 0) + 1;
  }
  return counts;
}

function jaccardSimilarity(aValues, bValues) {
  const a = new Set(aValues || []);
  const b = new Set(bValues || []);
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const val of a) {
    if (b.has(val)) inter++;
  }
  const union = new Set([...a, ...b]).size;
  return union ? inter / union : 0;
}

function statusFromScore(score, pass = 80, warn = 60) {
  const n = Number(score) || 0;
  if (n >= pass) return "pass";
  if (n >= warn) return "warn";
  return "fail";
}

module.exports = {
  createSelectionPolicy,
  createRankingPolicy,
  createDepthPolicy,
  createDigestPolicies,
  selectItems,
  parseItemDomain,
  computeTopicMatch,
  matchWeightToTag,
  applyRelevanceScores,
  splitUserTopics,
  itemMatchesPersonaTopic,
  filterItemsForPersona,
  normalizeCustomKeyword,
  applyDepth,
  buildDigestForPersona,
  countAdjacencyViolations,
  tagDistribution,
  jaccardSimilarity,
  statusFromScore,
  normalizeTopicToken,
  normalizeMatchText,
};
