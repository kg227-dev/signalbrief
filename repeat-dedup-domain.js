"use strict";

const { normalizeMatchText } = require("./topic-domain");

function normalizeUrlForDedup(value) {
  const raw = String(value || "").trim();
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

function headlineFingerprint(text, width = 60) {
  return normalizeMatchText(text).slice(0, width);
}

function createRepeatIndex(items = []) {
  const recentItems = Array.isArray(items) ? items : [];
  return {
    urlKeys: new Set(recentItems.map((item) => normalizeUrlForDedup(item?.url)).filter(Boolean)),
    headlineKeys: new Set(recentItems.map((item) => headlineFingerprint(item?.headline)).filter(Boolean)),
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
  const urlKey = normalizeUrlForDedup(item?.url);
  const headKey = headlineFingerprint(item?.headline);
  return (urlKey && urlKeys.has(urlKey)) || (headKey && headlineKeys.has(headKey));
}

function dedupItemsAgainstRepeatIndex(items, repeatIndex, opts = {}) {
  const arr = Array.isArray(items) ? items : [];
  if (!repeatIndex || typeof repeatIndex !== "object") {
    return { items: arr, removed: 0, backfilled: 0 };
  }

  const minBackfillItems = Math.max(1, Number(opts.minBackfillItems || 3));
  const targetCount = Math.max(1, Number(opts.targetCount || 7));

  const kept = [];
  const removed = [];

  for (const item of arr) {
    if (isRepeatedItem(item, repeatIndex)) {
      removed.push(item);
    } else {
      kept.push(item);
    }
  }

  let backfilled = 0;
  if (kept.length < minBackfillItems && removed.length > 0) {
    const addTarget = Math.min(targetCount, minBackfillItems);
    const add = removed.slice(0, addTarget - kept.length);
    kept.push(...add);
    backfilled = add.length;
  }

  return {
    items: kept,
    removed: removed.length,
    backfilled,
  };
}

module.exports = {
  normalizeUrlForDedup,
  headlineFingerprint,
  createRepeatIndex,
  isRepeatedItem,
  dedupItemsAgainstRepeatIndex,
};
