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

  function suppressRecentlySentForUser(items, user, opts = {}) {
    const arr = Array.isArray(items) ? items : [];
    const minItems = Math.max(1, Number(opts.minItems || 3));
    const recentKeys = getUserRecentDigestUrlKeys(user, opts);
    if (!recentKeys.size) {
      return { items: arr, removed: 0, recent_keys: 0, backfilled: 0 };
    }

    const kept = [];
    const removed = [];
    for (const item of arr) {
      const key = normalizeUrlForDedup(item?.url);
      if (key && recentKeys.has(key)) removed.push(item);
      else kept.push(item);
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
      recent_keys: recentKeys.size,
      backfilled,
    };
  }

  return {
    getUserRecentDigestUrlKeys,
    suppressRecentlySentForUser,
  };
}

module.exports = {
  createArchiveUserSuppressionRuntime,
};
