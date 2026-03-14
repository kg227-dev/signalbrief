"use strict";

function sanitizePathSegment(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .slice(0, 120) || "unknown";
}

function sortIsoDescending(left, right) {
  return String(right || "").localeCompare(String(left || ""));
}

function createDigestDeliveryRecordRuntime(deps) {
  const {
    APP_ROOT,
    fs,
    path,
    log,
  } = deps;

  const logger = typeof log === "function" ? log : () => {};

  function recordsRoot() {
    return path.join(APP_ROOT, "data", "digest-records");
  }

  function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
    return dirPath;
  }

  function userDir(userId) {
    return path.join(recordsRoot(), sanitizePathSegment(userId));
  }

  function recordFile(userId, dateKey, mode) {
    return path.join(userDir(userId), `${sanitizePathSegment(dateKey)}--${sanitizePathSegment(mode)}.json`);
  }

  function writeJsonAtomic(filePath, payload) {
    const tmpPath = `${filePath}.tmp`;
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2));
    fs.renameSync(tmpPath, filePath);
  }

  function readDigestRecord(userId, dateKey, mode) {
    const filePath = recordFile(userId, dateKey, mode);
    if (!fs.existsSync(filePath)) return null;
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (err) {
      logger(`⚠️ Failed to read digest record ${filePath}: ${err.message}`);
      return null;
    }
  }

  function normalizeVersionEntry(input = {}) {
    return {
      version: Math.max(1, Number(input.version || 1)),
      digest_id: String(input.digest_id || "").trim(),
      user_id: String(input.user_id || "").trim(),
      date_et: String(input.date_et || "").trim(),
      mode: String(input.mode || "").trim(),
      run_id: String(input.run_id || "").trim() || null,
      source: String(input.source || "").trim() || null,
      trigger: String(input.trigger || "").trim() || null,
      status: String(input.status || "selected").trim(),
      selected_at: String(input.selected_at || "").trim() || null,
      sending_at: String(input.sending_at || "").trim() || null,
      sent_at: String(input.sent_at || "").trim() || null,
      failed_at: String(input.failed_at || "").trim() || null,
      error: String(input.error || "").trim() || null,
      channels: Array.isArray(input.channels) ? input.channels.slice() : [],
      date_str: String(input.date_str || "").trim() || null,
      quick_scan: String(input.quick_scan || "").trim() || null,
      quality_score: Number.isFinite(Number(input.quality_score)) ? Number(input.quality_score) : null,
      quality_band: String(input.quality_band || "").trim() || null,
      items: Array.isArray(input.items) ? input.items.slice() : [],
    };
  }

  function buildEnvelope(base, currentEntry, versions) {
    return {
      user_id: String(base.user_id || "").trim(),
      date_et: String(base.date_et || "").trim(),
      mode: String(base.mode || "").trim(),
      updated_at: new Date().toISOString(),
      current: normalizeVersionEntry(currentEntry),
      versions: (Array.isArray(versions) ? versions : []).map(normalizeVersionEntry).sort((left, right) => Number(left.version || 0) - Number(right.version || 0)),
    };
  }

  function beginDigestDeliveryRecord(input = {}) {
    const userId = String(input.user_id || "").trim();
    const dateKey = String(input.date_et || "").trim();
    const mode = String(input.mode || "scheduled").trim();
    if (!userId || !dateKey || !mode) return { ok: false, skipped: false, reason: "missing_identity" };

    const existing = readDigestRecord(userId, dateKey, mode);
    const existingCurrent = existing?.current ? normalizeVersionEntry(existing.current) : null;
    if (mode === "scheduled" && existingCurrent?.status === "sent") {
      return {
        ok: true,
        skipped: true,
        reason: "scheduled_already_sent",
        record: existingCurrent,
      };
    }

    const version = existingCurrent ? Math.max(1, Number(existingCurrent.version || 1) + 1) : 1;
    const nowIso = new Date().toISOString();
    const entry = normalizeVersionEntry({
      ...input,
      version,
      status: "selected",
      selected_at: nowIso,
    });

    const priorVersions = Array.isArray(existing?.versions) ? existing.versions.map(normalizeVersionEntry) : [];
    const nextVersions = priorVersions.filter((row) => Number(row.version || 0) !== version);
    nextVersions.push(entry);
    const envelope = buildEnvelope({ user_id: userId, date_et: dateKey, mode }, entry, nextVersions.slice(-20));
    writeJsonAtomic(recordFile(userId, dateKey, mode), envelope);

    return {
      ok: true,
      skipped: false,
      version,
      record: entry,
    };
  }

  function updateDigestDeliveryRecord(input = {}) {
    const userId = String(input.user_id || "").trim();
    const dateKey = String(input.date_et || "").trim();
    const mode = String(input.mode || "scheduled").trim();
    const version = Math.max(1, Number(input.version || 1));
    if (!userId || !dateKey || !mode) return { ok: false, reason: "missing_identity" };

    const existing = readDigestRecord(userId, dateKey, mode);
    const priorVersions = Array.isArray(existing?.versions) ? existing.versions.map(normalizeVersionEntry) : [];
    const current = existing?.current ? normalizeVersionEntry(existing.current) : null;
    const baseEntry = priorVersions.find((row) => Number(row.version || 0) === version)
      || current
      || normalizeVersionEntry({
        version,
        user_id: userId,
        date_et: dateKey,
        mode,
      });
    const nextEntry = normalizeVersionEntry({
      ...baseEntry,
      ...input,
      version,
    });
    const nextVersions = priorVersions.filter((row) => Number(row.version || 0) !== version);
    nextVersions.push(nextEntry);
    const envelope = buildEnvelope({ user_id: userId, date_et: dateKey, mode }, nextEntry, nextVersions.slice(-20));
    writeJsonAtomic(recordFile(userId, dateKey, mode), envelope);
    return { ok: true, record: nextEntry };
  }

  function loadRecordFilesForUser(userId) {
    const dirPath = userDir(userId);
    if (!fs.existsSync(dirPath)) return [];
    return fs.readdirSync(dirPath)
      .filter((fileName) => fileName.endsWith(".json"))
      .map((fileName) => path.join(dirPath, fileName));
  }

  function loadCurrentRecordsForUser(userId) {
    const files = loadRecordFilesForUser(userId);
    const records = [];
    for (const filePath of files) {
      try {
        const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
        if (parsed?.current && typeof parsed.current === "object") {
          records.push(normalizeVersionEntry(parsed.current));
        }
      } catch (err) {
        logger(`⚠️ Failed to parse digest record ${filePath}: ${err.message}`);
      }
    }
    return records;
  }

  function loadRecentSentDigests(userId, opts = {}) {
    const limit = Math.max(1, Number(opts.limit || 3));
    const rows = loadCurrentRecordsForUser(userId)
      .filter((row) => row.status === "sent" && row.sent_at)
      .sort((left, right) => sortIsoDescending(left.sent_at, right.sent_at));

    const seenDates = new Set();
    const recent = [];
    for (const row of rows) {
      const dateKey = String(row.date_et || "").trim();
      if (!dateKey || seenDates.has(dateKey)) continue;
      seenDates.add(dateKey);
      recent.push(row);
      if (recent.length >= limit) break;
    }
    return recent;
  }

  function loadLatestDigestSnapshot(userId, dateKey) {
    const targetDate = String(dateKey || "").trim();
    if (!targetDate) return null;
    const records = loadCurrentRecordsForUser(userId)
      .filter((row) => row.status === "sent" && row.date_et === targetDate)
      .sort((left, right) => sortIsoDescending(left.sent_at, right.sent_at));
    return records[0] || null;
  }

  function loadDigestSnapshotByRunId(userId, dateKey, runId) {
    const targetDate = String(dateKey || "").trim();
    const targetRunId = String(runId || "").trim();
    if (!targetDate || !targetRunId) return null;

    const files = loadRecordFilesForUser(userId);
    const matches = [];
    for (const filePath of files) {
      try {
        const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
        const versions = Array.isArray(parsed?.versions) ? parsed.versions : [];
        for (const rawVersion of versions) {
          const row = normalizeVersionEntry(rawVersion);
          if (row.status !== "sent") continue;
          if (row.date_et !== targetDate) continue;
          if (row.run_id !== targetRunId) continue;
          matches.push(row);
        }
      } catch (err) {
        logger(`⚠️ Failed to parse digest record ${filePath}: ${err.message}`);
      }
    }

    matches.sort((left, right) => sortIsoDescending(left.sent_at, right.sent_at));
    return matches[0] || null;
  }

  function hasSentDigestRecord(userId, dateKey, mode = "scheduled") {
    const current = readDigestRecord(userId, dateKey, mode)?.current;
    const normalized = current ? normalizeVersionEntry(current) : null;
    return normalized?.status === "sent";
  }

  return {
    beginDigestDeliveryRecord,
    hasSentDigestRecord,
    loadDigestSnapshotByRunId,
    loadLatestDigestSnapshot,
    loadRecentSentDigests,
    readDigestRecord,
    recordFile,
    recordsRoot,
    updateDigestDeliveryRecord,
  };
}

module.exports = {
  createDigestDeliveryRecordRuntime,
};
