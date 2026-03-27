function summarizeStandardFetchTopics(rows) {
  return rows.map((row) => ({
    tag: row.tag,
    item_count: row.item_count,
    from_cache: row.from_cache,
    cache_file: row.cache_file,
  }));
}

function buildLiveDatasetMetadata({
  standardRawItems,
  dedupRes,
  selectedItems,
  selectionPolicy,
  enrichResult,
}) {
  return {
    standard_raw_item_count: standardRawItems.length,
    cross_day_dedup_removed: Number(dedupRes.removed || 0),
    cross_day_dedup_backfilled: Number(dedupRes.backfilled || 0),
    selected_item_count: selectedItems.length,
    selection_target: selectionPolicy.maxItems,
    max_items_per_source_domain: Number.isFinite(selectionPolicy.perSourceCap)
      ? selectionPolicy.perSourceCap
      : null,
    enrichment_usage: enrichResult.usage || { input_tokens: 0, output_tokens: 0 },
    enrichment_from_cache: enrichResult.from_cache,
    degraded_no_enrichment_cache: Boolean(enrichResult.degraded_no_enrichment_cache),
  };
}

function buildLiveDatasetResult({
  args,
  dateKey,
  standardItemsByTopic,
  allRawItems,
  dedupedRawItems,
  selectedItems,
  enrichResult,
  metadata,
}) {
  return {
    mode: args.allow_live_api ? "live_or_cache" : "cache_only",
    generated_at: new Date().toISOString(),
    date_key: dateKey,
    standard_fetch_topics: summarizeStandardFetchTopics(standardItemsByTopic),
    raw_items: allRawItems,
    raw_items_deduped: dedupedRawItems,
    selected_items: selectedItems,
    enriched_items: enrichResult.items || [],
    metadata,
  };
}

module.exports = {
  buildLiveDatasetMetadata,
  buildLiveDatasetResult,
};
