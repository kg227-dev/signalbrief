"use strict";

function createArchivePersistenceRuntime(deps) {
  const {
    APP_ROOT,
    fs,
    path,
    log,
    formatEtDateKey,
    parseSourceDomain,
  } = deps;

  function saveToArchive(date, items, dateStr, quickScan, opts = {}) {
    const { overwrite = false } = opts;
    const safeItems = Array.isArray(items) ? items : [];
    if (safeItems.length === 0) {
      log("⚠️ Archive write skipped: no items");
      return;
    }

    const archiveDir = path.join(APP_ROOT, "archive");
    if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir);
    const key = formatEtDateKey(date);
    const file = path.join(archiveDir, `${key}.json`);
    if (fs.existsSync(file) && !overwrite) return;

    const entry = {
      date: key,
      dateStr,
      quickScan,
      items: safeItems.map((i) => ({
        tag: i.tag,
        headline: i.headline,
        summary: i.summary,
        wim_brief: i.wim_brief || null,
        wim: i.wim,
        implications: i.implications || null,
        watch_next: i.watch_next || null,
        url: i.url,
        source: i.source,
        source_domain: i.source_domain || parseSourceDomain(i),
        baseScore: i.baseScore != null ? i.baseScore : null,
        why_shown: Array.isArray(i.why_shown) ? i.why_shown : [],
      })),
      generatedAt: date.toISOString(),
    };

    fs.writeFileSync(file, JSON.stringify(entry, null, 2));
    log(`📁 Archived: ${key}${overwrite ? " (overwrite)" : ""}`);
  }

  return {
    saveToArchive,
  };
}

module.exports = {
  createArchivePersistenceRuntime,
};
