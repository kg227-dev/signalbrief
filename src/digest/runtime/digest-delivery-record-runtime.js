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
    digestRecordsDir,
  } = deps;

  const logger = typeof log === "function" ? log : () => {};

  function recordsRoot() {
    if (digestRecordsDir) return path.resolve(String(digestRecordsDir));
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
      withheld_reason: String(input.withheld_reason || "").trim() || null,
      delivery_outcome: String(input.delivery_outcome || "").trim() || null,
      attempt_count: Math.max(0, Number(input.attempt_count || 0)),
      retry_scheduled_for: String(input.retry_scheduled_for || "").trim() || null,
      high_confidence_count: Math.max(0, Number(input.high_confidence_count || 0)),
      lower_confidence_count: Math.max(0, Number(input.lower_confidence_count || 0)),
      high_confidence_available_count: Math.max(0, Number(input.high_confidence_available_count || 0)),
      lower_confidence_available_count: Math.max(0, Number(input.lower_confidence_available_count || 0)),
      lower_confidence_used: input.lower_confidence_used === true,
      lower_confidence_assist_7d_count: Math.max(0, Number(input.lower_confidence_assist_7d_count || 0)),
      internal_thinness_label: String(input.internal_thinness_label || "").trim() || null,
      error: String(input.error || "").trim() || null,
      channels: Array.isArray(input.channels) ? input.channels.slice() : [],
      depth: String(input.depth || "").trim() || null,
      date_str: String(input.date_str || "").trim() || null,
      quick_scan: String(input.quick_scan || "").trim() || null,
      subject_line: String(input.subject_line || "").trim() || null,
      editorial_note: String(input.editorial_note || "").trim() || null,
      regenerated_at: String(input.regenerated_at || "").trim() || null,
      regenerated_by: String(input.regenerated_by || "").trim() || null,
      quality_score: Number.isFinite(Number(input.quality_score)) ? Number(input.quality_score) : null,
      quality_band: String(input.quality_band || "").trim() || null,
      requested_count: Math.max(0, Number(input.requested_count || 0)) || null,
      freshness_block_count: Math.max(0, Number(input.freshness_block_count || 0)),
      semantic_repeat_block_count: Math.max(0, Number(input.semantic_repeat_block_count || 0)),
      alternate_queries_used: Math.max(0, Number(input.alternate_queries_used || 0)),
      preferred_domains_count: Math.max(0, Number(input.preferred_domains_count || 0)),
      preferred_candidate_count: Math.max(0, Number(input.preferred_candidate_count || 0)),
      non_preferred_candidate_count: Math.max(0, Number(input.non_preferred_candidate_count || 0)),
      final_selected_preferred_count: Math.max(0, Number(input.final_selected_preferred_count || 0)),
      preferred_displaced_weak_count: Math.max(0, Number(input.preferred_displaced_weak_count || 0)),
      derivative_suppressed_count: Math.max(0, Number(input.derivative_suppressed_count || 0)),
      specialist_trade_beat_preferred_count: Math.max(0, Number(input.specialist_trade_beat_preferred_count || 0)),
      platform_identity_ambiguity_count: Math.max(0, Number(input.platform_identity_ambiguity_count || 0)),
      broader_retrieval_found_better_count: Math.max(0, Number(input.broader_retrieval_found_better_count || 0)),
      coverage_gap_preferred_missing_count: Math.max(0, Number(input.coverage_gap_preferred_missing_count || 0)),
      coverage_gap_preferred_weaker_count: Math.max(0, Number(input.coverage_gap_preferred_weaker_count || 0)),
      search_budget_soft_calls: Math.max(0, Number(input.search_budget_soft_calls || 0)),
      search_budget_hard_calls: Math.max(0, Number(input.search_budget_hard_calls || 0)),
      search_budget_calls_used: Math.max(0, Number(input.search_budget_calls_used || 0)),
      search_budget_exhausted: input.search_budget_exhausted === true,
      broad_fallback_topics_used: Math.max(0, Number(input.broad_fallback_topics_used || 0)),
      zero_yield_retry_count: Math.max(0, Number(input.zero_yield_retry_count || 0)),
      budget_stop_reason: String(input.budget_stop_reason || "").trim() || null,
      candidate_pool_before_dedup: Number.isFinite(Number(input.candidate_pool_before_dedup))
        ? Number(input.candidate_pool_before_dedup)
        : null,
      candidate_pool_after_dedup: Number.isFinite(Number(input.candidate_pool_after_dedup))
        ? Number(input.candidate_pool_after_dedup)
        : null,
      fallback_reason: String(input.fallback_reason || "").trim() || null,
      refill_count: Math.max(0, Number(input.refill_count || 0)),
      thin_pool: input.thin_pool === true,
      dominant_failure_mode: String(input.dominant_failure_mode || "").trim() || null,
      surviving_topic_bucket_count: Number.isFinite(Number(input.surviving_topic_bucket_count))
        ? Number(input.surviving_topic_bucket_count)
        : null,
      strict_quality_exception_count: Number.isFinite(Number(input.strict_quality_exception_count))
        ? Number(input.strict_quality_exception_count)
        : null,
      extreme_underfill: input.extreme_underfill === true,
      blocked_topic_list: Array.isArray(input.blocked_topic_list)
        ? input.blocked_topic_list.map((row) => ({
            tag: String(row?.tag || "").trim() || null,
            reason: String(row?.reason || "").trim() || null,
          }))
        : [],
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

  function walkRecordFiles(dirPath = recordsRoot()) {
    if (!fs.existsSync(dirPath)) return [];
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        files.push(...walkRecordFiles(fullPath));
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".json")) files.push(fullPath);
    }
    return files;
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

  function loadCurrentDigestSnapshot(userId, dateKey, mode = "scheduled") {
    const targetDate = String(dateKey || "").trim();
    const targetMode = String(mode || "scheduled").trim();
    if (!targetDate || !targetMode) return null;
    const record = readDigestRecord(userId, targetDate, targetMode);
    if (!record?.current || typeof record.current !== "object") return null;
    return normalizeVersionEntry(record.current);
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

  function loadAllCurrentRecords(opts = {}) {
    const sinceDateEt = String(opts.sinceDateEt || "").trim();
    const statusFilter = String(opts.status || "").trim().toLowerCase();
    const userIdFilter = String(opts.userId || "").trim();
    const rows = [];

    for (const filePath of walkRecordFiles()) {
      try {
        const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
        if (!parsed?.current || typeof parsed.current !== "object") continue;
        const row = normalizeVersionEntry(parsed.current);
        if (sinceDateEt && String(row.date_et || "").trim() < sinceDateEt) continue;
        if (statusFilter && String(row.status || "").trim().toLowerCase() !== statusFilter) continue;
        if (userIdFilter && String(row.user_id || "").trim() !== userIdFilter) continue;
        rows.push(row);
      } catch (err) {
        logger(`⚠️ Failed to parse digest record ${filePath}: ${err.message}`);
      }
    }

    rows.sort((left, right) => sortIsoDescending(
      left.sent_at || left.selected_at || left.sending_at || "",
      right.sent_at || right.selected_at || right.sending_at || ""
    ));
    return rows;
  }

  function summarizeRecordsState() {
    const files = walkRecordFiles();
    let latestTimestamp = "";
    let currentRecordCount = 0;

    for (const filePath of files) {
      try {
        const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
        const candidate = String(
          parsed?.current?.sent_at
          || parsed?.current?.sending_at
          || parsed?.current?.selected_at
          || parsed?.updated_at
          || ""
        ).trim();
        if (candidate && candidate > latestTimestamp) latestTimestamp = candidate;
        if (parsed?.current && typeof parsed.current === "object") currentRecordCount += 1;
      } catch (err) {
        logger(`⚠️ Failed to summarize digest record ${filePath}: ${err.message}`);
      }
    }

    return {
      root: recordsRoot(),
      file_count: files.length,
      current_record_count: currentRecordCount,
      latest_timestamp: latestTimestamp || null,
    };
  }

  return {
    beginDigestDeliveryRecord,
    hasSentDigestRecord,
    loadAllCurrentRecords,
    loadCurrentDigestSnapshot,
    loadDigestSnapshotByRunId,
    loadLatestDigestSnapshot,
    loadRecentSentDigests,
    readDigestRecord,
    recordFile,
    recordsRoot,
    summarizeRecordsState,
    updateDigestDeliveryRecord,
  };
}

module.exports = {
  createDigestDeliveryRecordRuntime,
};
