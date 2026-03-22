"use strict";

function createDigestRetryStateRuntime(deps = {}) {
  const {
    APP_ROOT,
    fs,
    path,
    log,
    digestRetryStatePath,
  } = deps;

  const logger = typeof log === "function" ? log : () => {};
  const statePath = String(digestRetryStatePath || "").trim() || path.join(APP_ROOT, "data", "digest-retry-state.json");

  function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
    return dirPath;
  }

  function writeJsonAtomic(filePath, payload) {
    ensureDir(path.dirname(filePath));
    const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), "utf8");
    fs.renameSync(tmpPath, filePath);
  }

  function todayEt() {
    return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  }

  function normalizeEntry(input = {}) {
    return {
      user_id: String(input.user_id || "").trim(),
      date_et: String(input.date_et || "").trim(),
      attempt_count: Math.max(0, Number(input.attempt_count || 0)),
      next_retry_at: String(input.next_retry_at || "").trim() || null,
      underfill_reason: String(input.underfill_reason || "").trim() || null,
      requested_count: Math.max(0, Number(input.requested_count || 0)) || null,
      high_confidence_count: Math.max(0, Number(input.high_confidence_count || 0)),
      lower_confidence_count: Math.max(0, Number(input.lower_confidence_count || 0)),
      delivery_outcome: String(input.delivery_outcome || "").trim() || null,
      retry_pending: input.retry_pending === true,
      last_attempt_at: String(input.last_attempt_at || "").trim() || null,
      updated_at: String(input.updated_at || "").trim() || new Date().toISOString(),
    };
  }

  function buildKey(userId, dateEt) {
    return `${String(userId || "").trim()}::${String(dateEt || "").trim()}`;
  }

  function normalizeState(raw = {}) {
    const entries = {};
    const cutoff = todayEt();
    for (const [key, value] of Object.entries(raw?.entries || {})) {
      const entry = normalizeEntry(value);
      if (!entry.user_id || !entry.date_et) continue;
      if (entry.date_et < cutoff) continue;
      entries[buildKey(entry.user_id, entry.date_et)] = entry;
    }
    return {
      version: 1,
      updated_at: String(raw?.updated_at || "").trim() || null,
      entries,
    };
  }

  function loadState() {
    try {
      const parsed = JSON.parse(fs.readFileSync(statePath, "utf8"));
      const normalized = normalizeState(parsed);
      writeJsonAtomic(statePath, {
        ...normalized,
        updated_at: new Date().toISOString(),
      });
      return normalized;
    } catch (error) {
      if (error && error.code !== "ENOENT") {
        logger(`⚠️ Failed to read digest retry state ${statePath}: ${error.message}`);
      }
      const empty = normalizeState({});
      writeJsonAtomic(statePath, {
        ...empty,
        updated_at: new Date().toISOString(),
      });
      return empty;
    }
  }

  function saveState(state) {
    const normalized = normalizeState(state);
    const next = {
      ...normalized,
      updated_at: new Date().toISOString(),
    };
    writeJsonAtomic(statePath, next);
    return next;
  }

  function getRetryState(userId, dateEt) {
    const state = loadState();
    return state.entries[buildKey(userId, dateEt)] || null;
  }

  function upsertRetryState(entry) {
    const state = loadState();
    const normalized = normalizeEntry(entry);
    if (!normalized.user_id || !normalized.date_et) return null;
    state.entries[buildKey(normalized.user_id, normalized.date_et)] = normalized;
    saveState(state);
    return normalized;
  }

  function clearRetryState(userId, dateEt) {
    const state = loadState();
    delete state.entries[buildKey(userId, dateEt)];
    saveState(state);
    return true;
  }

  return {
    clearRetryState,
    getRetryState,
    loadState,
    saveState,
    statePath,
    upsertRetryState,
  };
}

module.exports = {
  createDigestRetryStateRuntime,
};
