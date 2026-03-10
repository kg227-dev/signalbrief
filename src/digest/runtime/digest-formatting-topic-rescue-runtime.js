"use strict";

function buildSeenSet(items, projector) {
  return new Set(items.map(projector).filter(Boolean));
}

function createDigestFormattingTopicRescueRuntime(deps) {
  const {
    normalizeTopicToken,
    customKeywordMatches,
    normalizeMatchText,
    headlineFingerprint,
    normalizeUrlForDedup,
  } = deps;

  function itemMatchesKeyword(item, keyword) {
    const text = normalizeMatchText(`${item?.headline || ""} ${item?.summary || ""}`);
    const tag = normalizeTopicToken(item?.tag || "");
    return customKeywordMatches(keyword, text, tag);
  }

  function buildCustomRescueItemsFromStandard(standardItems, customKeywords = [], existingItems = [], maxPerKeyword = 1) {
    const standard = Array.isArray(standardItems) ? standardItems : [];
    const existing = Array.isArray(existingItems) ? existingItems : [];
    const output = [];
    const seenHeadlines = buildSeenSet(existing, (item) => headlineFingerprint(item?.headline));
    const seenUrls = buildSeenSet(existing, (item) => normalizeUrlForDedup(item?.url));
    const cap = Math.max(1, Number(maxPerKeyword || 1));

    for (const rawKeyword of customKeywords) {
      const keyword = normalizeTopicToken(rawKeyword);
      if (!keyword) continue;

      const alreadyCovered = existing.some((item) => itemMatchesKeyword(item, keyword));
      if (alreadyCovered) continue;

      const matches = standard.filter((item) => itemMatchesKeyword(item, keyword));
      if (!matches.length) continue;

      let used = 0;
      for (const item of matches) {
        if (used >= cap) break;
        const headKey = headlineFingerprint(item?.headline);
        const urlKey = normalizeUrlForDedup(item?.url);
        if ((headKey && seenHeadlines.has(headKey)) || (urlKey && seenUrls.has(urlKey))) continue;
        if (headKey) seenHeadlines.add(headKey);
        if (urlKey) seenUrls.add(urlKey);
        output.push({
          ...item,
          tag: String(rawKeyword || "").toUpperCase(),
          custom_rescue: true,
        });
        used += 1;
      }
    }

    return output;
  }

  return {
    buildCustomRescueItemsFromStandard,
  };
}

module.exports = {
  createDigestFormattingTopicRescueRuntime,
};
