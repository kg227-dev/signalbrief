const {
  normalizeMatchText,
  normalizeTopicToken,
  topicsRelated,
  computeTopicMatch,
  matchWeightToTag,
  normalizeCustomKeyword,
  splitUserTopics,
  itemMatchesPersonaTopic,
} = require("../topic-domain");
const { selectItemsByPolicy } = require("../selection-domain");
const {
  createSelectionPolicy,
  createRankingPolicy,
  createDepthPolicy,
  createDigestPolicies,
} = require("../digest-policy-domain");
const {
  filterDigestItemsByTopics,
  scoreDigestItemsForUser,
  applyDigestDepth,
  reserveCustomKeywordSlot: reserveDigestCustomKeywordSlot,
} = require("../digest-pipeline-seam");

function parseItemDomain(item) {
  const urlRaw = String(item?.url || "").trim();
  if (urlRaw) {
    try {
      const parsed = new URL(urlRaw);
      return parsed.hostname.replace(/^www\./i, "").toLowerCase();
    } catch (err) {
      if (process.env.QA_DEBUG === "1") {
        console.warn(`[qa-pipeline] falling back to source domain: ${err.message}`);
      }
    }
  }

  const sourceRaw = String(item?.source || "").trim().toLowerCase();
  if (!sourceRaw) return "unknown";
  const noProto = sourceRaw.replace(/^https?:\/\//, "").replace(/^www\./, "");
  return noProto.split(/[\s/]/)[0] || "unknown";
}

function normalizeUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    parsed.hash = "";
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    return parsed.toString().toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

function selectItems(allItems, selectionPolicy = {}) {
  const policy = createSelectionPolicy(selectionPolicy);
  return selectItemsByPolicy(allItems, policy, {
    normalizeUrl,
    parseDomain: parseItemDomain,
    normalizeTopicToken,
  });
}

function isRecentRepeatItem(item, repeatIndex) {
  if (!repeatIndex || typeof repeatIndex !== "object") return false;
  const urlKeys = repeatIndex.urlKeys instanceof Set ? repeatIndex.urlKeys : new Set(repeatIndex.urlKeys || []);
  const headlineKeys = repeatIndex.headlineKeys instanceof Set ? repeatIndex.headlineKeys : new Set(repeatIndex.headlineKeys || []);
  const urlKey = normalizeUrl(item?.url || "");
  const headKey = normalizeMatchText(item?.headline || "").slice(0, 60);
  return (urlKey && urlKeys.has(urlKey)) || (headKey && headlineKeys.has(headKey));
}

function applyRelevanceScores(items, userTopics, topicWeights = {}, rankingPolicy = {}, specialistMode = false) {
  const policy = createRankingPolicy(rankingPolicy);
  return scoreDigestItemsForUser(items, userTopics, topicWeights, {
    specialistMode: !!specialistMode,
    repeatPenalty: policy.repeatPenalty,
    isRecentRepeat: (item) => isRecentRepeatItem(item, policy.repeatIndex),
    sourceDomainForItem: parseItemDomain,
  });
}

function filterItemsForPersona(enrichedItems, userTopics, depthPolicy = {}, strictZeroFallback = false) {
  const policy = createDepthPolicy(depthPolicy);
  return filterDigestItemsByTopics(enrichedItems, userTopics, {
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
