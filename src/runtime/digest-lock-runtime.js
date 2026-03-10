"use strict";

const fs = require("fs");

const LOCK_STATES = Object.freeze({
  VALID: "valid",
  STALE: "stale",
  CORRUPT: "corrupt",
  IO_ERROR: "io_error",
});

function readDigestLockState(lockFile, staleMs, opts = {}) {
  if (!fs.existsSync(lockFile)) return null;

  let rawText = "";
  try {
    rawText = fs.readFileSync(lockFile, "utf8");
  } catch (err) {
    return {
      state: LOCK_STATES.IO_ERROR,
      error: err.message,
      error_code: err?.code || null,
    };
  }

  let lock;
  try {
    lock = JSON.parse(rawText);
  } catch (err) {
    return {
      state: LOCK_STATES.CORRUPT,
      error: `invalid_json:${err.message}`,
    };
  }

  const startedAtIso = lock?.startedAt || null;
  const startedAtTs = Date.parse(startedAtIso || "");
  if (!Number.isFinite(startedAtTs)) {
    return {
      state: LOCK_STATES.CORRUPT,
      error: "missing_or_invalid_startedAt",
      raw: lock,
    };
  }

  const nowMs = Number.isFinite(opts.nowMs) ? opts.nowMs : Date.now();
  const lockStaleMs = Math.max(1, Number(staleMs || 0));
  const ageMs = Math.max(0, nowMs - startedAtTs);
  const state = ageMs > lockStaleMs ? LOCK_STATES.STALE : LOCK_STATES.VALID;
  return {
    ...lock,
    state,
    startedAt: startedAtIso,
    startedAtTs,
    ageMs,
    stale: state === LOCK_STATES.STALE,
  };
}

function clearDigestLockFile(lockFile) {
  const target = String(lockFile || "").trim();
  if (!target) {
    return {
      ok: false,
      code: "invalid_lock_file",
      message: "lock file path is required",
      error_code: null,
    };
  }

  if (!fs.existsSync(target)) {
    return {
      ok: true,
      code: "absent",
      message: "lock file already absent",
      error_code: null,
    };
  }

  try {
    fs.unlinkSync(target);
    return {
      ok: true,
      code: "cleared",
      message: "lock file cleared",
      error_code: null,
    };
  } catch (err) {
    return {
      ok: false,
      code: "unlink_failed",
      message: err?.message || "failed to clear lock file",
      error_code: err?.code || null,
    };
  }
}

module.exports = {
  LOCK_STATES,
  readDigestLockState,
  clearDigestLockFile,
};
