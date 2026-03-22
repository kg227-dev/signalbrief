"use strict";

/**
 * Longitudinal repetition history — tracks what storylines have been delivered
 * over the past 7–14 days and determines whether a candidate item is genuinely
 * new or a same-story repeat.
 *
 * Pure functions only. File I/O lives in archive-history-runtime.js.
 */

/**
 * Builds a history map from date-keyed archive entries.
 *
 * @param {Array<{ date: string, items: Array }>} archiveByDate
 * @returns {Map<string, { count: number, lastSeenDate: string, entityKeysSeen: Set<string>, contentFlagsSeen: Set<string>, tagsSeen: Set<string> }>}
 */
function buildRepeatHistory(archiveByDate = []) {
  const history = new Map();

  for (const entry of (Array.isArray(archiveByDate) ? archiveByDate : [])) {
    const date = String(entry?.date || "").trim();
    const items = Array.isArray(entry?.items) ? entry.items : [];

    for (const item of items) {
      const storyKey = String(item?.storyline_key || "").trim();
      if (!storyKey) continue;

      if (!history.has(storyKey)) {
        history.set(storyKey, {
          count: 0,
          lastSeenDate: date,
          entityKeysSeen: new Set(),
          contentFlagsSeen: new Set(),
          tagsSeen: new Set(),
        });
      }

      const rec = history.get(storyKey);
      rec.count += 1;
      if (date > rec.lastSeenDate) rec.lastSeenDate = date;

      for (const ek of (Array.isArray(item.entity_keys) ? item.entity_keys : [])) {
        const k = String(ek || "").trim().toLowerCase();
        if (k) rec.entityKeysSeen.add(k);
      }
      for (const cf of (Array.isArray(item.content_flags) ? item.content_flags : [])) {
        const k = String(cf || "").trim().toLowerCase();
        if (k) rec.contentFlagsSeen.add(k);
      }
      const tag = String(item?.tag || "").trim();
      if (tag) rec.tagsSeen.add(tag);
    }
  }

  return history;
}

/**
 * Returns true if the item introduces at least one entity key or content flag
 * not previously seen in the historical record for its storyline.
 */
function isMateriallyNew(item, historyEntry) {
  if (!historyEntry) return true;

  const itemEntities = (Array.isArray(item.entity_keys) ? item.entity_keys : [])
    .map((v) => String(v || "").trim().toLowerCase())
    .filter(Boolean);
  const itemFlags = (Array.isArray(item.content_flags) ? item.content_flags : [])
    .map((v) => String(v || "").trim().toLowerCase())
    .filter(Boolean);

  // No signals on the item — can't confirm it's materially new
  if (!itemEntities.length && !itemFlags.length) return false;

  for (const ek of itemEntities) {
    if (!historyEntry.entityKeysSeen.has(ek)) return true;
  }
  for (const cf of itemFlags) {
    if (!historyEntry.contentFlagsSeen.has(cf)) return true;
  }
  return false;
}

/**
 * Days elapsed from pastDate to todayKey (both YYYY-MM-DD strings).
 * Returns 999 on invalid input.
 */
function daysAgo(pastDate, todayKey) {
  if (!pastDate || !todayKey) return 999;
  const past = new Date(String(pastDate));
  const today = new Date(String(todayKey));
  if (isNaN(past.getTime()) || isNaN(today.getTime())) return 999;
  return Math.max(0, Math.round((today - past) / (1000 * 60 * 60 * 24)));
}

/**
 * Assesses one item against the longitudinal history.
 *
 * Suppresses items where:
 *   - The storyline_key was seen within suppressWithinDays
 *   - AND the item is not materially new (no new entity_keys or content_flags)
 *
 * @returns {{ storyKey: string|null, suppress: boolean, reason: string, materiallyNew: boolean, recentlySeenCount: number, lastSeenDate: string|null, daysSinceLastSeen: number, isFrequent: boolean }}
 */
function assessItemHistory(item, history, todayKey, opts = {}) {
  const suppressWithinDays = Number(opts.suppressWithinDays || 3);
  const frequentThreshold = Number(opts.frequentThreshold || 3);

  const storyKey = String(item?.storyline_key || "").trim();
  if (!storyKey) {
    return { storyKey: null, suppress: false, reason: "no_storyline_key", materiallyNew: true, recentlySeenCount: 0, lastSeenDate: null, daysSinceLastSeen: 999, isFrequent: false };
  }

  const rec = history.get(storyKey);
  if (!rec) {
    return { storyKey, suppress: false, reason: "new_storyline", materiallyNew: true, recentlySeenCount: 0, lastSeenDate: null, daysSinceLastSeen: 999, isFrequent: false };
  }

  const days = daysAgo(rec.lastSeenDate, todayKey);
  const materiallyNew = isMateriallyNew(item, rec);
  const isFrequent = rec.count >= frequentThreshold;

  if (days <= suppressWithinDays && !materiallyNew) {
    return { storyKey, suppress: true, reason: `seen_${days}d_ago_not_new`, materiallyNew, recentlySeenCount: rec.count, lastSeenDate: rec.lastSeenDate, daysSinceLastSeen: days, isFrequent };
  }

  return { storyKey, suppress: false, reason: "ok", materiallyNew, recentlySeenCount: rec.count, lastSeenDate: rec.lastSeenDate, daysSinceLastSeen: days, isFrequent };
}

/**
 * Storylines seen >= threshold times in the lookback window, sorted by count desc.
 *
 * @returns {Array<{ storylineKey: string, count: number, lastSeenDate: string, tag: string }>}
 */
function detectStreaks(history, opts = {}) {
  const threshold = Number(opts.threshold || 3);
  const streaks = [];

  for (const [storyKey, rec] of history.entries()) {
    if (rec.count >= threshold) {
      const tag = Array.from(rec.tagsSeen)[0] || storyKey;
      streaks.push({ storylineKey: storyKey, count: rec.count, lastSeenDate: rec.lastSeenDate, tag });
    }
  }

  return streaks.sort((a, b) => b.count - a.count);
}

/**
 * Filters items against the longitudinal history.
 * Items that match a recent storyline_key AND are not materially new are suppressed.
 *
 * @returns {{ items: Array, suppressedCount: number, suppressedFrequentCount: number, streaks: Array }}
 */
function filterItemsAgainstHistory(items, history, todayKey, opts = {}) {
  const arr = Array.isArray(items) ? items : [];
  const kept = [];
  let suppressedCount = 0;
  let suppressedFrequentCount = 0;

  for (const item of arr) {
    const assessment = assessItemHistory(item, history, todayKey, opts);
    if (assessment.suppress) {
      suppressedCount++;
      if (assessment.isFrequent) suppressedFrequentCount++;
    } else {
      kept.push(item);
    }
  }

  const streaks = detectStreaks(history, opts);

  return {
    items: kept,
    suppressedCount,
    suppressedFrequentCount,
    streaks,
  };
}

/**
 * Builds a short human-readable note for the digest when repetition suppression was active.
 * Returns empty string if nothing to surface.
 */
function buildRepetitionNote(streaks, suppressedCount) {
  if (!suppressedCount || !Array.isArray(streaks) || !streaks.length) return "";

  const topStreaks = streaks.slice(0, 2);
  const labels = topStreaks.map((s) => {
    const raw = String(s.tag || s.storylineKey || "").replace(/_/g, " ");
    const label = raw.replace(/\b\w/g, (c) => c.toUpperCase());
    return `${label} (${s.count}×)`;
  });

  const suffix = labels.length === 1
    ? `${labels[0]} filtered this week`
    : `${labels.join(", ")} filtered this week`;

  return `Showing only new developments — ${suffix}`;
}

module.exports = {
  buildRepeatHistory,
  isMateriallyNew,
  daysAgo,
  assessItemHistory,
  detectStreaks,
  filterItemsAgainstHistory,
  buildRepetitionNote,
};
