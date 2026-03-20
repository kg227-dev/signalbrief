"use strict";

const {
  buildSemanticRepeatIndex,
  isSemanticRepeatItem,
} = require("./repeat-freshness-runtime");

function createArchiveUserSuppressionRuntime(deps) {
  const { normalizeUrlForDedup } = deps;

  function getUserRecentDigestUrlKeys(user, opts = {}) {
    const maxDigests = Math.max(1, Number(opts.maxDigests || 3));
    const keys = new Set();
    const history = Array.isArray(user?.recent_digest_url_history)
      ? user.recent_digest_url_history.slice(-maxDigests)
      : [];

    if (history.length > 0) {
      for (const row of history) {
        const urls = Array.isArray(row?.urls) ? row.urls : [];
        for (const url of urls) {
          const key = normalizeUrlForDedup(url);
          if (key) keys.add(key);
        }
      }
    } else if (Array.isArray(user?.last_digest_items)) {
      for (const item of user.last_digest_items) {
        const key = normalizeUrlForDedup(item?.url);
        if (key) keys.add(key);
      }
    }
    return keys;
  }

  function getUserRecentStorylineKeys(user, opts = {}) {
    const maxDigests = Math.max(1, Number(opts.maxDigests || 3));
    const keys = new Set();
    const history = Array.isArray(user?.recent_digest_url_history)
      ? user.recent_digest_url_history.slice(-maxDigests)
      : [];
    for (const row of history) {
      const storylineKeys = Array.isArray(row?.storyline_keys) ? row.storyline_keys : [];
      for (const key of storylineKeys) {
        if (key) keys.add(key);
      }
    }
    return keys;
  }

  function getUserRecentRepeatSeedItems(user, opts = {}) {
    const maxDigests = Math.max(1, Number(opts.maxDigests || 3));
    const history = Array.isArray(user?.recent_digest_url_history)
      ? user.recent_digest_url_history.slice(-maxDigests)
      : [];
    const seedItems = [];

    for (const row of history) {
      const urls = Array.isArray(row?.urls) ? row.urls : [];
      for (const url of urls) {
        seedItems.push({ url });
      }
      const storylineKeys = Array.isArray(row?.storyline_keys) ? row.storyline_keys : [];
      for (const storylineKey of storylineKeys) {
        seedItems.push({ storyline_key: storylineKey });
      }
    }

    if (seedItems.length === 0 && Array.isArray(user?.last_digest_items)) {
      seedItems.push(...user.last_digest_items);
    }

    return seedItems;
  }

  function suppressRecentlySentForUser(items, user, opts = {}) {
    const arr = Array.isArray(items) ? items : [];
    const recentUrlKeys = getUserRecentDigestUrlKeys(user, opts);
    const recentStorylineKeys = getUserRecentStorylineKeys(user, opts);
    const recentRepeatIndex = buildSemanticRepeatIndex(getUserRecentRepeatSeedItems(user, opts));
    if (!recentUrlKeys.size && !recentStorylineKeys.size && recentRepeatIndex.recent.length === 0) {
      return { items: arr, removed: 0, recent_keys: 0, backfilled: 0, storyline_suppressed: 0, semantic_suppressed: 0 };
    }

    const kept = [];
    let removed = 0;
    let storylineSuppressed = 0;
    let semanticSuppressed = 0;
    for (const item of arr) {
      const urlKey = normalizeUrlForDedup(item?.url);
      if (urlKey && recentUrlKeys.has(urlKey)) {
        removed += 1;
        continue;
      }
      const storylineKey = String(item?.storyline_key || "").trim();
      if (storylineKey && recentStorylineKeys.has(storylineKey)) {
        removed += 1;
        storylineSuppressed++;
        continue;
      }
      if (isSemanticRepeatItem(item, recentRepeatIndex)) {
        removed += 1;
        semanticSuppressed++;
        continue;
      }
      kept.push(item);
    }

    return {
      items: kept,
      removed,
      recent_keys: recentUrlKeys.size + recentStorylineKeys.size + recentRepeatIndex.repeatKeys.size,
      backfilled: 0,
      storyline_suppressed: storylineSuppressed,
      semantic_suppressed: semanticSuppressed,
    };
  }

  return {
    getUserRecentDigestUrlKeys,
    getUserRecentStorylineKeys,
    getUserRecentRepeatSeedItems,
    suppressRecentlySentForUser,
  };
}

module.exports = {
  createArchiveUserSuppressionRuntime,
};
