"use strict";

function createArchiveHistoryRuntime(deps) {
  const {
    APP_ROOT,
    fs,
    path,
    log,
    createRepeatIndex,
    dedupItemsAgainstRepeatIndex,
  } = deps;

  function loadRecentArchiveItems(days = 3) {
    const archiveDir = path.join(APP_ROOT, "archive");
    if (!fs.existsSync(archiveDir)) return [];
    const files = fs.readdirSync(archiveDir).filter((f) => f.endsWith(".json")).sort();
    if (!files.length) return [];

    const recent = files.slice(-Math.max(1, Number(days || 3)));
    const items = [];
    for (const file of recent) {
      try {
        const parsed = JSON.parse(fs.readFileSync(path.join(archiveDir, file), "utf8"));
        items.push(...(parsed?.items || []));
      } catch (err) {
        log(`⚠️ Failed to parse archive file ${file}: ${err.message}`);
      }
    }
    return items;
  }

  function dedupAgainstRecentArchives(items, opts = {}) {
    const dedupDays = Math.max(1, Number(opts.days || 3));
    const target = Math.max(1, Number(opts.targetCount || 7));
    const minBackfillItems = Math.max(1, Number(opts.minBackfillItems || 3));
    const recentItems = loadRecentArchiveItems(dedupDays);
    if (!recentItems.length) {
      return { items: items || [], removed: 0, archive_days_used: 0, backfilled: 0 };
    }

    const repeatIndex = createRepeatIndex(recentItems);
    const deduped = dedupItemsAgainstRepeatIndex(items || [], repeatIndex, {
      targetCount: target,
      minBackfillItems,
    });

    return {
      items: deduped.items,
      removed: deduped.removed,
      archive_days_used: dedupDays,
      backfilled: deduped.backfilled,
    };
  }

  function buildRecentRepeatIndex(days = 3) {
    const lookbackDays = Math.max(1, Number(days || 3));
    const recentItems = loadRecentArchiveItems(lookbackDays);
    const repeatIndex = createRepeatIndex(recentItems);
    return {
      days: lookbackDays,
      urlKeys: repeatIndex.urlKeys,
      headlineKeys: repeatIndex.headlineKeys,
    };
  }

  return {
    loadRecentArchiveItems,
    dedupAgainstRecentArchives,
    buildRecentRepeatIndex,
  };
}

module.exports = {
  createArchiveHistoryRuntime,
};
