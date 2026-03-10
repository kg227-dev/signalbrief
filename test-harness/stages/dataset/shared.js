const { normalizeCustomKeyword } = require("../../utils/topic-utils");
const {
  createRepeatIndex,
  dedupItemsAgainstRepeatIndex,
} = require("../../../src/digest/domain/repeat-dedup-domain-runtime");

function syncBudget(target, next) {
  if (!next || typeof next !== "object") return;
  target.cap = next.cap;
  target.spent = next.spent;
  target.remaining = next.remaining;
  target.calls = next.calls;
}

function standardTopicUniverse(appConfig) {
  return (appConfig.topics || []).map((t) => t.tag).filter(Boolean);
}

function collectCustomTopics(personas, limit = 12) {
  const values = [];
  for (const persona of personas || []) {
    for (const topic of persona.topics || []) {
      if (!String(topic).startsWith("custom_")) continue;
      values.push(normalizeCustomKeyword(topic));
    }
  }
  return [...new Set(values.filter(Boolean))].slice(0, limit);
}

function maxRequestedItems(personas, fallback = 7) {
  const requested = (personas || [])
    .map((persona) => Number(persona?.preferences?.items_per_digest))
    .filter((value) => Number.isFinite(value) && value > 0);

  return Math.max(Number(fallback || 7), requested.length ? Math.max(...requested) : 0);
}

function buildRecentRepeatIndexFromArchives(archives, days = 3) {
  const lookbackDays = Math.max(1, Number(days || 3));
  const sorted = (Array.isArray(archives) ? archives.slice() : [])
    .sort((a, b) => String(a?.date || "").localeCompare(String(b?.date || "")));
  const recent = sorted.slice(-lookbackDays);
  const recentItems = recent.flatMap((row) => (Array.isArray(row?.items) ? row.items : []));
  const repeatIndex = createRepeatIndex(recentItems);

  return {
    days: lookbackDays,
    urlKeys: repeatIndex.urlKeys,
    headlineKeys: repeatIndex.headlineKeys,
  };
}

function dedupAgainstRecentArchivesForDataset(items, archives, opts = {}) {
  const list = Array.isArray(items) ? items : [];
  const allArchives = Array.isArray(archives) ? archives : [];
  const dedupDays = Math.max(1, Number(opts.days || 3));
  const minBackfillItems = Math.max(1, Number(opts.minBackfillItems || 3));
  const targetCount = Math.max(1, Number(opts.targetCount || 7));
  const dateKey = String(opts.dateKey || "");

  const archiveRows = allArchives
    .filter((row) => {
      const day = String(row?.date || "").trim();
      if (!day) return false;
      if (!dateKey) return true;
      return day < dateKey;
    })
    .sort((a, b) => String(a?.date || "").localeCompare(String(b?.date || "")));

  const recentItems = archiveRows
    .slice(-dedupDays)
    .flatMap((row) => (Array.isArray(row?.items) ? row.items : []));

  if (!recentItems.length) {
    return { items: list, removed: 0, backfilled: 0 };
  }

  const repeatIndex = createRepeatIndex(recentItems);
  return dedupItemsAgainstRepeatIndex(list, repeatIndex, {
    minBackfillItems,
    targetCount,
  });
}

function mapArchiveItem(item) {
  return {
    headline: item.headline,
    summary: item.summary,
    source: item.source,
    source_domain: item.source_domain || item.source || null,
    why_shown: Array.isArray(item.why_shown) ? item.why_shown : [],
    url: item.url,
    tag: item.tag,
    wim_brief: item.wim_brief || null,
    wim: item.wim || null,
    implications: item.implications || null,
    watch_next: item.watch_next || null,
    baseScore: typeof item.baseScore === "number" ? item.baseScore : 5,
  };
}

module.exports = {
  syncBudget,
  standardTopicUniverse,
  collectCustomTopics,
  maxRequestedItems,
  buildRecentRepeatIndexFromArchives,
  dedupAgainstRecentArchivesForDataset,
  mapArchiveItem,
};
