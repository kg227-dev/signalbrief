const { toEtDateKey } = require("../../config");
const { mapArchiveItem } = require("./shared");

function buildOfflineDatasetFromArchives(appConfig, archives) {
  if (!archives.length) {
    throw new Error("Offline mode requested but no archive data found. Use --live to warm cache first.");
  }

  const latest = archives[archives.length - 1];
  const items = (latest.items || []).map((item) => mapArchiveItem(item));

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
    enriched_items: items.slice(0, itemCount),
    metadata: {
      archive_date: latest.date,
      archive_item_count: items.length,
      selection_target: itemCount,
      max_custom_items: 0,
      max_items_per_source_domain: Number(digestConfig.maxItemsPerSourceDomain || 2),
    },
  };
}

module.exports = {
  buildOfflineDatasetFromArchives,
};
