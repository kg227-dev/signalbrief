"use strict";

function createDigestOrchestratorLockRuntime(deps) {
  const {
    fs,
    path,
    lockFilePath,
    lockStaleMs,
    lockStates,
    readDigestLockState,
    clearDigestLockFile,
    getDigestLockOwnerStatus,
    log,
    getPid = () => process.pid,
    nowIso = () => new Date().toISOString(),
  } = deps || {};
  const logger = typeof log === "function" ? log : () => {};
  const states = lockStates || {};
  let lockOwned = false;

  function readDigestLock() {
    return readDigestLockState(lockFilePath, lockStaleMs);
  }

  function clearDigestLock() {
    const outcome = clearDigestLockFile(lockFilePath);
    if (!outcome.ok) {
      const detail = outcome.message ? ` (${outcome.message})` : "";
      logger(`WARN Failed to clear digest lock [${outcome.code || "unknown"}]${detail}`);
    }
    return outcome;
  }

  function acquireDigestLock(mode) {
    const existing = readDigestLock();
    if (existing) {
      if (existing.state === states.STALE) {
        const clearOutcome = clearDigestLock();
        if (!clearOutcome.ok) {
          return {
            ok: false,
            reason: "stale_uncleared",
            lock: {
              ...existing,
              state: "stale_uncleared",
              error: `stale_lock_clear_failed:${clearOutcome.code || "unknown"}`,
              clear_error: clearOutcome.message || null,
              clear_error_code: clearOutcome.error_code || null,
            },
          };
        }
      } else if (existing.state === states.VALID) {
        const owner = getDigestLockOwnerStatus(existing);
        if (owner.alive === false) {
          const clearOutcome = clearDigestLock();
          if (!clearOutcome.ok) {
            return {
              ok: false,
              reason: "pid_dead_uncleared",
              lock: {
                ...existing,
                state: "pid_dead_uncleared",
                error: `dead_pid_lock_clear_failed:${clearOutcome.code || "unknown"}`,
                clear_error: clearOutcome.message || null,
                clear_error_code: clearOutcome.error_code || null,
                owner_pid: owner.pid,
                owner_alive: false,
              },
            };
          }
        } else {
          return { ok: false, reason: "locked", lock: existing };
        }
      } else {
        logger(`WARN Digest lock requires manual intervention (state=${existing.state}, detail=${existing.error || "unknown"})`);
        return { ok: false, reason: existing.state, lock: existing };
      }
    }

    const dir = path.dirname(lockFilePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const payload = {
      startedAt: nowIso(),
      pid: getPid(),
      mode: mode || "scheduled",
    };
    try {
      const fd = fs.openSync(lockFilePath, "wx");
      try {
        fs.writeFileSync(fd, JSON.stringify(payload));
      } finally {
        fs.closeSync(fd);
      }
      lockOwned = true;
      return { ok: true, lock: payload };
    } catch (err) {
      if (err?.code !== "EEXIST") {
        logger(`WARN Failed to acquire digest lock: ${err.message}`);
      }
      const lock = readDigestLock();
      return { ok: false, reason: "race_or_locked", lock };
    }
  }

  function releaseDigestLock() {
    if (!lockOwned) return;
    lockOwned = false;
    clearDigestLock();
  }

  return {
    readDigestLock,
    clearDigestLock,
    acquireDigestLock,
    releaseDigestLock,
  };
}

module.exports = {
  createDigestOrchestratorLockRuntime,
};
