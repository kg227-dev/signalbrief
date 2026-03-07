const {
  customKeywordMatches,
  filterItemsByTopics,
  applyTopicRelevanceScores,
  normalizeMatchText,
  normalizeTopicToken,
} = require("./topic-domain");

function filterDigestItemsByTopics(items, userTopics, opts = {}) {
  const minItems = Math.max(1, Number(opts.minItems || 3));
  const strictZeroFallback = Object.prototype.hasOwnProperty.call(opts, "strictZeroFallback")
    ? opts.strictZeroFallback
    : false;
  return filterItemsByTopics(items, userTopics, {
    minItems,
    strictZeroFallback,
  });
}

function scoreDigestItemsForUser(items, userTopics, topicWeights = {}, opts = {}) {
  const repeatPenalty = Math.max(0, Number(opts.repeatPenalty || 0));
  const sourceDomainForItem = typeof opts.sourceDomainForItem === "function"
    ? opts.sourceDomainForItem
    : undefined;
  const isRecentRepeat = typeof opts.isRecentRepeat === "function"
    ? opts.isRecentRepeat
    : (() => false);
  return applyTopicRelevanceScores(items, userTopics, topicWeights, {
    specialistMode: !!opts.specialistMode,
    repeatPenalty,
    isRecentRepeat,
    sourceDomainForItem,
  });
}

function applyDigestDepth(items, depth) {
  const d = String(depth || "").toLowerCase();
  if (d === "headline_only" || d === "headlines" || d === "scan") {
    return (items || []).map((i) => ({ ...i, wim: null }));
  }
  if (d === "oneliner" || d === "headline_plus_oneliner") {
    return (items || []).map((i) => {
      const brief = i?.wim_brief
        ? String(i.wim_brief).trim()
        : (i?.wim
          ? String(i.wim).replace(/<strong>(.*?)<\/strong>/s, "$1").split(".")[0] + "."
          : null);
      return { ...i, wim: brief };
    });
  }
  return (items || []).map((i) => ({ ...i }));
}

function itemMatchesAnyCustomKeyword(item, customKeywords = []) {
  if (!Array.isArray(customKeywords) || customKeywords.length === 0) return false;
  const tagNormalized = normalizeTopicToken(item?.tag || "");
  const bodyText = normalizeMatchText(`${String(item?.headline || "")} ${String(item?.summary || "")}`);
  return customKeywords.some((kw) => customKeywordMatches(kw, bodyText, tagNormalized));
}

function reserveCustomKeywordSlot(items, requestedCount, customKeywords = []) {
  const scored = Array.isArray(items) ? items : [];
  const count = Math.max(1, Number(requestedCount || 5));
  const base = scored.slice(0, count);
  if (!base.length) return base;
  if (!Array.isArray(customKeywords) || customKeywords.length === 0) return base;

  const alreadyCovered = base.some((item) => itemMatchesAnyCustomKeyword(item, customKeywords));
  if (alreadyCovered) return base;

  const fallbackCandidate = scored.find((item) => itemMatchesAnyCustomKeyword(item, customKeywords));
  if (!fallbackCandidate) return base;

  const replaced = base.slice(0, Math.max(0, count - 1));
  const exists = replaced.some((item) =>
    String(item?.headline || "") === String(fallbackCandidate?.headline || "")
    && String(item?.url || "") === String(fallbackCandidate?.url || "")
  );
  if (!exists) replaced.push(fallbackCandidate);
  return replaced
    .sort((a, b) => Number(b?.relevanceScore || 0) - Number(a?.relevanceScore || 0))
    .slice(0, count);
}

module.exports = {
  filterDigestItemsByTopics,
  scoreDigestItemsForUser,
  applyDigestDepth,
  reserveCustomKeywordSlot,
};
