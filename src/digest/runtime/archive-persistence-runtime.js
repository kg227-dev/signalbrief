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

  function archiveIndexFile(archiveDir) {
    return path.join(archiveDir, "index.json");
  }

  function normalizeArchiveDateList(values) {
    return Array.from(new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || "").trim())
        .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
    )).sort((a, b) => (a < b ? 1 : -1));
  }

  function readArchiveIndexDates(archiveDir) {
    const indexPath = archiveIndexFile(archiveDir);
    if (!fs.existsSync(indexPath)) return [];
    try {
      const parsed = JSON.parse(fs.readFileSync(indexPath, "utf8"));
      return normalizeArchiveDateList(parsed?.dates);
    } catch {
      return [];
    }
  }

  function writeArchiveIndexDates(archiveDir, dates) {
    const indexPath = archiveIndexFile(archiveDir);
    const tmpPath = `${indexPath}.tmp`;
    const payload = {
      version: 1,
      updated_at: new Date().toISOString(),
      dates: normalizeArchiveDateList(dates),
    };
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2));
      fs.renameSync(tmpPath, indexPath);
    } catch {
      try {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      } catch {
        // best-effort temp cleanup
      }
    }
  }

  function ensureArchiveIndexContains(archiveDir, key) {
    const current = readArchiveIndexDates(archiveDir);
    if (current.includes(key)) return;
    writeArchiveIndexDates(archiveDir, [...current, key]);
  }

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
    if (fs.existsSync(file) && !overwrite) {
      ensureArchiveIndexContains(archiveDir, key);
      return;
    }

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
    ensureArchiveIndexContains(archiveDir, key);
    log(`📁 Archived: ${key}${overwrite ? " (overwrite)" : ""}`);
  }

  return {
    saveToArchive,
  };
}

module.exports = {
  createArchivePersistenceRuntime,
};
