"use strict";

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

  function suppressRecentlySentForUser(items, user, opts = {}) {
    const arr = Array.isArray(items) ? items : [];
    const minItems = Math.max(1, Number(opts.minItems || 3));
    const recentUrlKeys = getUserRecentDigestUrlKeys(user, opts);
    const recentStorylineKeys = getUserRecentStorylineKeys(user, opts);
    if (!recentUrlKeys.size && !recentStorylineKeys.size) {
      return { items: arr, removed: 0, recent_keys: 0, backfilled: 0, storyline_suppressed: 0 };
    }

    const kept = [];
    const removed = [];
    let storylineSuppressed = 0;
    for (const item of arr) {
      const urlKey = normalizeUrlForDedup(item?.url);
      if (urlKey && recentUrlKeys.has(urlKey)) {
        removed.push(item);
        continue;
      }
      const storylineKey = String(item?.storyline_key || "").trim();
      if (storylineKey && recentStorylineKeys.has(storylineKey)) {
        removed.push(item);
        storylineSuppressed++;
        continue;
      }
      kept.push(item);
    }

    let backfilled = 0;
    if (kept.length < minItems && removed.length > 0) {
      const add = removed.slice(0, minItems - kept.length);
      kept.push(...add);
      backfilled = add.length;
    }

    return {
      items: kept,
      removed: removed.length,
      recent_keys: recentUrlKeys.size,
      backfilled,
      storyline_suppressed: storylineSuppressed,
    };
  }

  return {
    getUserRecentDigestUrlKeys,
    getUserRecentStorylineKeys,
    suppressRecentlySentForUser,
  };
}

module.exports = {
  createArchiveUserSuppressionRuntime,
};
