"use strict";

const {
  buildSemanticRepeatIndex,
  excludeSemanticRepeats,
} = require("./repeat-freshness-runtime");

function createArchiveHistoryRuntime(deps) {
  const {
    APP_ROOT,
    fs,
    path,
    log,
    archiveDir,
  } = deps;

  function resolveArchiveDir() {
    return archiveDir ? path.resolve(String(archiveDir)) : path.join(APP_ROOT, "archive");
  }

  function loadRecentArchiveItems(days = 3) {
    const targetArchiveDir = resolveArchiveDir();
    if (!fs.existsSync(targetArchiveDir)) return [];
    const files = fs.readdirSync(targetArchiveDir).filter((f) => f.endsWith(".json")).sort();
    if (!files.length) return [];

    const recent = files.slice(-Math.max(1, Number(days || 3)));
    const items = [];
    for (const file of recent) {
      try {
        const parsed = JSON.parse(fs.readFileSync(path.join(targetArchiveDir, file), "utf8"));
        items.push(...(parsed?.items || []));
      } catch (err) {
        log(`⚠️ Failed to parse archive file ${file}: ${err.message}`);
      }
    }
    return items;
  }

  function loadRecentArchiveByDate(days = 7) {
    const targetArchiveDir = resolveArchiveDir();
    if (!fs.existsSync(targetArchiveDir)) return [];
    const files = fs.readdirSync(targetArchiveDir).filter((f) => f.endsWith(".json")).sort();
    if (!files.length) return [];

    const recent = files.slice(-Math.max(1, Number(days || 7)));
    const byDate = [];
    for (const file of recent) {
      const date = file.replace(/\.json$/, "");
      try {
        const parsed = JSON.parse(fs.readFileSync(path.join(targetArchiveDir, file), "utf8"));
        byDate.push({ date, items: Array.isArray(parsed?.items) ? parsed.items : [] });
      } catch (err) {
        log(`⚠️ Failed to parse archive file ${file}: ${err.message}`);
      }
    }
    return byDate;
  }

  function dedupAgainstRecentArchives(items, opts = {}) {
    const dedupDays = Math.max(1, Number(opts.days || 3));
    const recentItems = loadRecentArchiveItems(dedupDays);
    if (!recentItems.length) {
      return { items: items || [], removed: 0, archive_days_used: 0, backfilled: 0 };
    }

    const repeatIndex = buildSemanticRepeatIndex(recentItems);
    const deduped = excludeSemanticRepeats(items || [], repeatIndex);

    return {
      items: deduped.items,
      removed: deduped.removed.length,
      removed_items: deduped.removed,
      archive_days_used: dedupDays,
      backfilled: 0,
    };
  }

  function buildRecentRepeatIndex(days = 3) {
    const lookbackDays = Math.max(1, Number(days || 3));
    const recentItems = loadRecentArchiveItems(lookbackDays);
    const repeatIndex = buildSemanticRepeatIndex(recentItems);
    return {
      days: lookbackDays,
      urlKeys: repeatIndex.urlKeys,
      headlineKeys: repeatIndex.headlineKeys,
      storylineKeys: repeatIndex.storylineKeys,
      freshnessKeys: repeatIndex.freshnessKeys,
      repeatKeys: repeatIndex.repeatKeys,
      recent: repeatIndex.recent,
    };
  }

  return {
    loadRecentArchiveItems,
    loadRecentArchiveByDate,
    dedupAgainstRecentArchives,
    buildRecentRepeatIndex,
  };
}

module.exports = {
  createArchiveHistoryRuntime,
};
