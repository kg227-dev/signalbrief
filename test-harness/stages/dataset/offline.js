const { toEtDateKey } = require("../../config");
const { mapArchiveItem } = require("./shared");

/**
 * Merge items from the most recent archives into a single deduped pool.
 * Prioritizes the latest archive's items, then backfills from older ones.
 */
function mergeRecentArchiveItems(archives, lookbackDays = 5) {
  const recent = archives.slice(-Math.max(1, lookbackDays));
  const seen = new Set();
  const merged = [];

  // Walk newest → oldest so latest items win dedup
  for (let i = recent.length - 1; i >= 0; i--) {
    const row = recent[i];
    for (const item of row.items || []) {
      const url = String(item.url || "").toLowerCase().replace(/\/+$/, "");
      if (!url || seen.has(url)) continue;
      seen.add(url);
      merged.push(mapArchiveItem(item));
    }
  }

  return merged;
}

function buildOfflineDatasetFromArchives(appConfig, archives) {
  if (!archives.length) {
    throw new Error("Offline mode requested but no archive data found. Use --live to warm cache first.");
  }

  const latest = archives[archives.length - 1];
  const items = mergeRecentArchiveItems(archives);

  const digestConfig = appConfig.digest || {};
  const itemCount = Number(digestConfig.itemCount || 7);

  return {
    mode: "offline_archive",
    generated_at: new Date().toISOString(),
    date_key: latest.date || toEtDateKey(),
    standard_fetch_topics: [],
    custom_fetch_topics: [],
    raw_items: items,
    selected_items: items.slice(0, itemCount),
    enriched_items: items,
    metadata: {
      archive_date: latest.date,
      archive_item_count: items.length,
      archive_days_merged: Math.min(5, archives.length),
      selection_target: itemCount,
      max_custom_items: 0,
      max_items_per_source_domain: Number(digestConfig.maxItemsPerSourceDomain || 2),
    },
  };
}

module.exports = {
  buildOfflineDatasetFromArchives,
};
