"use strict";

function parsePerplexityItems(content) {
  const cleaned = String(content || "")
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .trim();
  return JSON.parse(cleaned);
}

function findCitationForHostname(citations, hostname) {
  return citations.find((candidate) => {
    try {
      return new URL(candidate).hostname === hostname;
    } catch {
      return false;
    }
  });
}

function enrichWithCitationUrls(items, citations, topicTag, log) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => {
    if (!item?.url || item.url === "#") return { ...item, tag: topicTag };
    try {
      const itemUrl = new URL(item.url);
      if (itemUrl.pathname === "/" || itemUrl.pathname === "") {
        const match = findCitationForHostname(citations, itemUrl.hostname);
        if (match) return { ...item, url: match, tag: topicTag };
      }
    } catch (err) {
      if (typeof log === "function") {
        log(`⚠️ Invalid item URL for ${topicTag}: ${err.message}`);
      }
    }
    return { ...item, tag: topicTag };
  });
}

function collectUniqueItems(items, seenHeadline, seenUrl, out, normalizeUrlForDedup) {
  for (const item of items) {
    if (!item || !item.headline) continue;
    const headKey = String(item.headline || "").toLowerCase().trim().slice(0, 80);
    const urlKey = normalizeUrlForDedup(item.url || "");
    if (headKey && seenHeadline.has(headKey)) continue;
    if (urlKey && seenUrl.has(urlKey)) continue;
    if (headKey) seenHeadline.add(headKey);
    if (urlKey) seenUrl.add(urlKey);
    out.push(item);
    if (out.length >= 3) break;
  }
}

function shouldStopAttempts(topic, collected) {
  if (collected.length >= 3) return true;
  if (!topic?.isCustom && collected.length >= 1) return true;
  if (topic?.isCustom && collected.length >= 2) return true;
  return false;
}

module.exports = {
  parsePerplexityItems,
  enrichWithCitationUrls,
  collectUniqueItems,
  shouldStopAttempts,
};
