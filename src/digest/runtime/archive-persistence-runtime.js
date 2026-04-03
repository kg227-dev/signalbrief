"use strict";

function createArchivePersistenceRuntime(deps) {
  const {
    APP_ROOT,
    fs,
    path,
    log,
    formatEtDateKey,
    parseSourceDomain,
    archiveDir,
  } = deps;

  function resolveArchiveDir() {
    return archiveDir ? path.resolve(String(archiveDir)) : path.join(APP_ROOT, "archive");
  }

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
      // Intentionally silent: a corrupt archive index should not block archive reads.
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
        // Intentionally silent: temp-file cleanup is best-effort after a failed archive-index write.
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

    const targetArchiveDir = resolveArchiveDir();
    if (!fs.existsSync(targetArchiveDir)) fs.mkdirSync(targetArchiveDir, { recursive: true });
    const key = formatEtDateKey(date);
    const file = path.join(targetArchiveDir, `${key}.json`);
    if (fs.existsSync(file) && !overwrite) {
      ensureArchiveIndexContains(targetArchiveDir, key);
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
        signal_shift: i.signal_shift || null,
        implication_type: i.implication_type || null,
        wim_brief: i.wim_brief || null,
        wim: i.wim,
        implications: i.implications || null,
        watch_next: i.watch_next || null,
        writeup_status: i.writeup_status || null,
        writeup_attempt_count: Number.isFinite(Number(i.writeup_attempt_count)) ? Number(i.writeup_attempt_count) : null,
        writeup_rejection_reasons: Array.isArray(i.writeup_rejection_reasons) ? i.writeup_rejection_reasons : [],
        writeup_version: i.writeup_version || null,
        url: i.url,
        source: i.source,
        source_domain: i.source_domain || parseSourceDomain(i),
        published_date: i.published_date || null,
        baseScore: i.baseScore != null ? i.baseScore : null,
        topicMatch: i.topicMatch != null ? i.topicMatch : null,
        relevanceScore: i.relevanceScore != null ? i.relevanceScore : null,
        why_shown: Array.isArray(i.why_shown) ? i.why_shown : [],
        entity_keys: Array.isArray(i.entity_keys) ? i.entity_keys : [],
        storyline_id: i.storyline_id || null,
        storyline_key: i.storyline_key || null,
        freshness_key: i.freshness_key || null,
        storyline_size: i.storyline_size != null ? i.storyline_size : null,
        supporting_sources: Array.isArray(i.supporting_sources) ? i.supporting_sources : [],
        supporting_headlines: Array.isArray(i.supporting_headlines) ? i.supporting_headlines : [],
        cross_source_count: i.cross_source_count != null ? i.cross_source_count : null,
        content_flags: Array.isArray(i.content_flags) ? i.content_flags : [],
        storyline_hints: Array.isArray(i.storyline_hints) ? i.storyline_hints : [],
        source_tier: i.source_tier || null,
        source_authority: i.source_authority != null ? i.source_authority : null,
        strategic_value: i.strategic_value != null ? i.strategic_value : null,
        routine_item_score: i.routine_item_score != null ? i.routine_item_score : null,
        score_breakdown: i.score_breakdown && typeof i.score_breakdown === "object"
          ? i.score_breakdown
          : null,
      })),
      generatedAt: date.toISOString(),
    };

    fs.writeFileSync(file, JSON.stringify(entry, null, 2));
    ensureArchiveIndexContains(targetArchiveDir, key);
    log(`📁 Archived: ${key}${overwrite ? " (overwrite)" : ""}`);
  }

  return {
    saveToArchive,
  };
}

module.exports = {
  createArchivePersistenceRuntime,
};
