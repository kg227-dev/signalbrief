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

function fixedSelectionTarget(fallback = 5) {
  return Math.max(1, Number(fallback || 5));
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
    // Preserve enrichment and storyline metadata from archive
    entity_keys: Array.isArray(item.entity_keys) ? item.entity_keys : [],
    storyline_id: item.storyline_id || null,
    storyline_key: item.storyline_key || null,
    storyline_size: typeof item.storyline_size === "number" ? item.storyline_size : 1,
    storyline_hints: Array.isArray(item.storyline_hints) ? item.storyline_hints : [],
    supporting_sources: Array.isArray(item.supporting_sources) ? item.supporting_sources : [],
    supporting_headlines: Array.isArray(item.supporting_headlines) ? item.supporting_headlines : [],
    cross_source_count: typeof item.cross_source_count === "number" ? item.cross_source_count : 1,
    content_flags: Array.isArray(item.content_flags) ? item.content_flags : [],
    source_tier: item.source_tier || "unknown",
    source_authority: typeof item.source_authority === "number" ? item.source_authority : 0.38,
    strategic_value: typeof item.strategic_value === "number" ? item.strategic_value : 0.5,
    routine_item_score: typeof item.routine_item_score === "number" ? item.routine_item_score : 0,
    score_breakdown: item.score_breakdown || null,
  };
}

module.exports = {
  syncBudget,
  standardTopicUniverse,
  fixedSelectionTarget,
  buildRecentRepeatIndexFromArchives,
  dedupAgainstRecentArchivesForDataset,
  mapArchiveItem,
};
