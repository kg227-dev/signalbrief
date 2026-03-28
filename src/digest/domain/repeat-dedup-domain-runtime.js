"use strict";

const { normalizeMatchText } = require("../../runtime/topic-normalization-runtime");
const { normalizeCanonicalUrl } = require("../../runtime/url-normalization-runtime");

function normalizeUrlForDedup(value) {
  return normalizeCanonicalUrl(value);
}

function headlineFingerprint(text, width = 60) {
  return normalizeMatchText(text).slice(0, width);
}

function createRepeatIndex(items = []) {
  const recentItems = Array.isArray(items) ? items : [];
  return {
    urlKeys: new Set(recentItems.map((item) => normalizeUrlForDedup(item?.url)).filter(Boolean)),
    headlineKeys: new Set(recentItems.map((item) => headlineFingerprint(item?.headline)).filter(Boolean)),
    storylineKeys: new Set(recentItems.map((item) => String(item?.storyline_key || "").trim()).filter(Boolean)),
    freshnessKeys: new Set(recentItems.map((item) => String(item?.freshness_key || "").trim()).filter(Boolean)),
  };
}

function isRepeatedItem(item, repeatIndex) {
  if (!repeatIndex || typeof repeatIndex !== "object") return false;
  const urlKeys = repeatIndex.urlKeys instanceof Set
    ? repeatIndex.urlKeys
    : new Set(Array.isArray(repeatIndex.urlKeys) ? repeatIndex.urlKeys : []);
  const headlineKeys = repeatIndex.headlineKeys instanceof Set
    ? repeatIndex.headlineKeys
    : new Set(Array.isArray(repeatIndex.headlineKeys) ? repeatIndex.headlineKeys : []);
  const storylineKeys = repeatIndex.storylineKeys instanceof Set
    ? repeatIndex.storylineKeys
    : new Set(Array.isArray(repeatIndex.storylineKeys) ? repeatIndex.storylineKeys : []);
  const freshnessKeys = repeatIndex.freshnessKeys instanceof Set
    ? repeatIndex.freshnessKeys
    : new Set(Array.isArray(repeatIndex.freshnessKeys) ? repeatIndex.freshnessKeys : []);
  const urlKey = normalizeUrlForDedup(item?.url);
  const headKey = headlineFingerprint(item?.headline);
  const storyKey = String(item?.storyline_key || "").trim();
  const freshnessKey = String(item?.freshness_key || "").trim();
  return (urlKey && urlKeys.has(urlKey))
    || (headKey && headlineKeys.has(headKey))
    || (storyKey && storylineKeys.has(storyKey))
    || (freshnessKey && freshnessKeys.has(freshnessKey));
}

function dedupItemsAgainstRepeatIndex(items, repeatIndex, opts = {}) {
  const arr = Array.isArray(items) ? items : [];
  if (!repeatIndex || typeof repeatIndex !== "object") {
    return { items: arr, removed: 0, backfilled: 0 };
  }

  const minBackfillItems = Math.max(1, Number(opts.minBackfillItems || 3));
  const targetCount = Math.max(1, Number(opts.targetCount || 5));

  const kept = [];
  const removed = [];

  for (const item of arr) {
    if (isRepeatedItem(item, repeatIndex)) {
      removed.push(item);
    } else {
      kept.push(item);
    }
  }

  return {
    items: kept,
    removed: removed.length,
    backfilled: 0,
  };
}

module.exports = {
  normalizeUrlForDedup,
  headlineFingerprint,
  createRepeatIndex,
  isRepeatedItem,
  dedupItemsAgainstRepeatIndex,
};
