"use strict";

const fs = require("fs");
const path = require("path");
const {
  LOCK_STATES,
  readDigestLockState,
  clearDigestLockFile,
  getDigestLockOwnerStatus,
} = require("../runtime/digest-lock-runtime");
const {
  toPositiveIntOrDefault,
  sleep,
} = require("./digest-runner-utils-runtime");
const { createDigestRunnerSpawnRuntime } = require("./digest-runner-spawn-runtime");
const { resolveSignalBriefRuntimePaths } = require("../runtime/runtime-state-paths-runtime");

const ROOT = path.resolve(__dirname, "..", "..");
const DIGEST_SCRIPT = path.join(ROOT, "src", "entrypoints", "digest.js");
const RUNTIME_PATHS = resolveSignalBriefRuntimePaths({
  appRoot: ROOT,
  env: process.env,
});
const DIGEST_RUN_LOCK_FILE = RUNTIME_PATHS.digestRunLockPath;
const DIGEST_ON_DEMAND_COOLDOWN_FILE = RUNTIME_PATHS.digestOnDemandCooldownPath;

const DIGEST_LOCK_EXIT_CODE = 4;
const DEFAULT_WAIT_TIMEOUT_MS = 12 * 60 * 1000;
const DEFAULT_ON_DEMAND_COOLDOWN_MS = 15 * 60 * 1000;
const ON_DEMAND_COOLDOWN_MIN_MS = 30 * 1000;
const ON_DEMAND_COOLDOWN_LOCK_WAIT_MS = 2_000;
const ON_DEMAND_COOLDOWN_LOCK_POLL_MS = 40;
const ON_DEMAND_COOLDOWN_LOCK_STALE_MS = 15_000;
const LOCK_STATE_VALID = LOCK_STATES.VALID;
const LOCK_STATE_STALE = LOCK_STATES.STALE;
const LOCK_STATE_CORRUPT = LOCK_STATES.CORRUPT;
const LOCK_STATE_IO_ERROR = LOCK_STATES.IO_ERROR;
const LOCK_STATE_STALE_UNCLEARED = "stale_uncleared";
const LOCK_STATE_PID_DEAD_UNCLEARED = "pid_dead_uncleared";
const LOCK_STATE_ABSENT = "absent";
const LOCK_UNHEALTHY_STATES = new Set([
  LOCK_STATE_CORRUPT,
  LOCK_STATE_IO_ERROR,
  LOCK_STATE_STALE_UNCLEARED,
  LOCK_STATE_PID_DEAD_UNCLEARED,
]);
const DIGEST_TRIGGER_STATUS = Object.freeze({
  QUEUED: "queued",
  OK: "ok",
  BUSY: "busy",
  COOLDOWN: "cooldown",
  LOCK_UNHEALTHY: "lock_unhealthy",
  FAILED: "failed",
  SPAWN_FAILED: "spawn_failed",
});
const LOCK_WARNING_THROTTLE_MS = 60 * 1000;
const QUEUE_START_CONFIRM_TIMEOUT_MS = 4_000;
const QUEUE_START_CONFIRM_POLL_MS = 120;

const digestRunnerSpawnRuntime = createDigestRunnerSpawnRuntime({
  root: ROOT,
  digestScript: DIGEST_SCRIPT,
  defaultWaitTimeoutMs: DEFAULT_WAIT_TIMEOUT_MS,
  toPositiveIntOrDefault,
  isDigestRunnerDebug,
});
const {
  sanitizeSource,
  buildDigestArgs,
  buildTriggerEnv,
  spawnDetached,
  isPidRunning,
  runAndWait,
} = digestRunnerSpawnRuntime;

function getDigestRunLockStaleMs() {
  return Math.max(
    5 * 60 * 1000,
    Number(process.env.DIGEST_LOCK_STALE_MS || (2 * 60 * 60 * 1000))
  );
}

function getAdmissionPollMinMs() {
  return Math.max(250, Number(process.env.DIGEST_RUNNER_POLL_MIN_MS || 1000));
}

function getAdmissionPollMaxMs() {
  return Math.max(getAdmissionPollMinMs(), Number(process.env.DIGEST_RUNNER_POLL_MAX_MS || 8000));
}

function getQueueStartConfirmTimeoutMs() {
  return Math.max(500, Number(process.env.DIGEST_RUNNER_QUEUE_CONFIRM_MS || QUEUE_START_CONFIRM_TIMEOUT_MS));
}

function getQueueStartConfirmPollMs() {
  return Math.max(50, Number(process.env.DIGEST_RUNNER_QUEUE_CONFIRM_POLL_MS || QUEUE_START_CONFIRM_POLL_MS));
}

function isDigestRunnerDebug() {
  return process.env.DEBUG_DIGEST_RUNNER === "1";
}

function resolveOnDemandCooldownFilePath(explicitPath = "") {
  const fromArgs = String(explicitPath || "").trim();
  if (fromArgs) return path.resolve(fromArgs);
  const fromEnv = String(process.env.DIGEST_ON_DEMAND_COOLDOWN_FILE || "").trim();
  if (fromEnv) return path.resolve(fromEnv);
  return DIGEST_ON_DEMAND_COOLDOWN_FILE;
}

function normalizeCooldownChatKey(chatId) {
  return String(chatId || "").trim();
}

function resolveOnDemandCooldownMs(value) {
  return Math.max(
    ON_DEMAND_COOLDOWN_MIN_MS,
    toPositiveIntOrDefault(
      value,
      toPositiveIntOrDefault(process.env.DIGEST_ON_DEMAND_COOLDOWN_MS, DEFAULT_ON_DEMAND_COOLDOWN_MS)
    )
  );
}

function readOnDemandCooldownLeases(opts = {}) {
  const cooldownFilePath = resolveOnDemandCooldownFilePath(opts.cooldownFilePath);
  if (!fs.existsSync(cooldownFilePath)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(cooldownFilePath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const leases = parsed.leases;
    if (!leases || typeof leases !== "object" || Array.isArray(leases)) return {};
    return { ...leases };
  } catch (err) {
    if (isDigestRunnerDebug()) {
      console.warn(`[digest-runner] cooldown lease parse failed (${cooldownFilePath}): ${err.message}`);
    }
    return {};
  }
}

function pruneExpiredCooldownLeases(leases, nowMs) {
  const normalizedLeases = leases && typeof leases === "object" ? leases : {};
  const cutoff = Number(nowMs || Date.now());
  let changed = false;
  const out = {};
  for (const [key, value] of Object.entries(normalizedLeases)) {
    const chatKey = normalizeCooldownChatKey(key);
    if (!chatKey) {
      changed = true;
      continue;
    }
    const expiresAtMs = Number(value?.expiresAtMs || 0);
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= cutoff) {
      changed = true;
      continue;
    }
    out[chatKey] = {
      expiresAtMs,
      updatedAtMs: Number(value?.updatedAtMs || cutoff),
    };
  }
  if (!changed && Object.keys(out).length !== Object.keys(normalizedLeases).length) {
    changed = true;
  }
  return { leases: out, changed };
}

function writeOnDemandCooldownLeases(leases, opts = {}) {
  const cooldownFilePath = resolveOnDemandCooldownFilePath(opts.cooldownFilePath);
  const dir = path.dirname(cooldownFilePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${cooldownFilePath}.tmp-${process.pid}-${Date.now()}`;
  const payload = {
    updated_at: new Date().toISOString(),
    leases: leases && typeof leases === "object" ? leases : {},
  };
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2));
    fs.renameSync(tmpPath, cooldownFilePath);
  } finally {
    if (fs.existsSync(tmpPath)) {
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        // best-effort temp file cleanup
      }
    }
  }
  return cooldownFilePath;
}

async function withOnDemandCooldownLeaseLock(task, opts = {}) {
  const cooldownFilePath = resolveOnDemandCooldownFilePath(opts.cooldownFilePath);
  const lockFilePath = `${cooldownFilePath}.lock`;
  const lockWaitMs = Math.max(
    100,
    toPositiveIntOrDefault(opts.lockWaitMs, ON_DEMAND_COOLDOWN_LOCK_WAIT_MS)
  );
  const lockPollMs = Math.max(
    10,
    toPositiveIntOrDefault(opts.lockPollMs, ON_DEMAND_COOLDOWN_LOCK_POLL_MS)
  );
  const lockStaleMs = Math.max(
    500,
    toPositiveIntOrDefault(opts.lockStaleMs, ON_DEMAND_COOLDOWN_LOCK_STALE_MS)
  );
  const startedAtMs = Date.now();

  while (Date.now() - startedAtMs <= lockWaitMs) {
    try {
      const lockDir = path.dirname(lockFilePath);
      if (!fs.existsSync(lockDir)) fs.mkdirSync(lockDir, { recursive: true });
      const fd = fs.openSync(lockFilePath, "wx");
      try {
        fs.writeFileSync(fd, JSON.stringify({
          pid: process.pid,
          acquired_at: new Date().toISOString(),
        }));
      } finally {
        fs.closeSync(fd);
      }
      try {
        return await task();
      } finally {
        try {
          fs.unlinkSync(lockFilePath);
        } catch {
          // best-effort lock release
        }
      }
    } catch (err) {
      if (err?.code !== "EEXIST") {
        if (isDigestRunnerDebug()) {
          console.warn(`[digest-runner] cooldown lock acquire failed (${lockFilePath}): ${err.message}`);
        }
        break;
      }

      let stale = false;
      try {
        const stat = fs.statSync(lockFilePath);
        stale = (Date.now() - Number(stat.mtimeMs || 0)) > lockStaleMs;
      } catch {
        stale = true;
      }
      if (stale) {
        try {
          fs.unlinkSync(lockFilePath);
        } catch {
          // best-effort stale lock cleanup
        }
      }
      await sleep(lockPollMs);
    }
  }

  // Fail open so on-demand digest remains available even if lock file coordination fails.
  return task();
}

async function reserveOnDemandCooldownLease(opts = {}) {
  const chatKey = normalizeCooldownChatKey(opts.chatId);
  if (!chatKey) return { ok: true, reserved: false, reason: "missing_chat_id" };

  return withOnDemandCooldownLeaseLock(async () => {
    const nowMs = Number.isFinite(opts.nowMs) ? Number(opts.nowMs) : Date.now();
    const cooldownMs = resolveOnDemandCooldownMs(opts.cooldownMs);
    const cooldownFilePath = resolveOnDemandCooldownFilePath(opts.cooldownFilePath);
    const readLeases = readOnDemandCooldownLeases({ cooldownFilePath });
    const pruned = pruneExpiredCooldownLeases(readLeases, nowMs);
    const existing = Number(pruned.leases?.[chatKey]?.expiresAtMs || 0);
    if (existing > nowMs) {
      if (pruned.changed) {
        writeOnDemandCooldownLeases(pruned.leases, { cooldownFilePath });
      }
      return {
        ok: false,
        code: "cooldown",
        chatId: chatKey,
        remainingMs: Math.max(0, existing - nowMs),
        expiresAtMs: existing,
      };
    }

    const expiresAtMs = nowMs + cooldownMs;
    const nextLeases = {
      ...pruned.leases,
      [chatKey]: {
        expiresAtMs,
        updatedAtMs: nowMs,
      },
    };
    writeOnDemandCooldownLeases(nextLeases, { cooldownFilePath });
    return {
      ok: true,
      reserved: true,
      chatId: chatKey,
      expiresAtMs,
      remainingMs: cooldownMs,
    };
  }, opts);
}

async function releaseOnDemandCooldownLease(opts = {}) {
  const chatKey = normalizeCooldownChatKey(opts.chatId);
  if (!chatKey) return { ok: true, cleared: false, reason: "missing_chat_id" };

  return withOnDemandCooldownLeaseLock(async () => {
    const nowMs = Number.isFinite(opts.nowMs) ? Number(opts.nowMs) : Date.now();
    const cooldownFilePath = resolveOnDemandCooldownFilePath(opts.cooldownFilePath);
    const readLeases = readOnDemandCooldownLeases({ cooldownFilePath });
    const pruned = pruneExpiredCooldownLeases(readLeases, nowMs);
    const hadKey = Object.prototype.hasOwnProperty.call(pruned.leases, chatKey);
    if (!hadKey && !pruned.changed) {
      return { ok: true, cleared: false, reason: "absent" };
    }
    const nextLeases = { ...pruned.leases };
    delete nextLeases[chatKey];
    writeOnDemandCooldownLeases(nextLeases, { cooldownFilePath });
    return { ok: true, cleared: hadKey };
  }, opts);
}

function createRunnerState() {
  return {
    admissionQueue: Promise.resolve(),
    requestCounter: 0,
    lastLockWarningKey: "",
    lastLockWarningAtMs: 0,
  };
}

let RUNNER_STATE = createRunnerState();

function resetRunnerState() {
  RUNNER_STATE = createRunnerState();
  return RUNNER_STATE;
}

function logLockWarning(state, detail) {
  const now = Date.now();
  const key = `${state}:${detail || ""}`;
  if (key === RUNNER_STATE.lastLockWarningKey && (now - RUNNER_STATE.lastLockWarningAtMs) < LOCK_WARNING_THROTTLE_MS) return;
  RUNNER_STATE.lastLockWarningKey = key;
  RUNNER_STATE.lastLockWarningAtMs = now;
  console.warn(`[digest-runner] lock state=${state}; manual intervention required${detail ? ` (${detail})` : ""}`);
}

function readDigestRunLock() {
  return readDigestLockState(DIGEST_RUN_LOCK_FILE, getDigestRunLockStaleMs());
}

function clearDigestRunLock() {
  const outcome = clearDigestLockFile(DIGEST_RUN_LOCK_FILE);
  if (!outcome.ok && isDigestRunnerDebug()) {
    const detail = outcome.message ? ` (${outcome.message})` : "";
    console.warn(`[digest-runner] failed to clear digest lock [${outcome.code || "unknown"}]${detail}`);
  }
  return outcome;
}

function digestRunStatus() {
  const lock = readDigestRunLock();
  if (!lock) return { running: false, state: LOCK_STATE_ABSENT, lock: null };

  if (lock.state === LOCK_STATE_STALE) {
    const clearOutcome = clearDigestRunLock();
    if (clearOutcome.ok) return { running: false, state: LOCK_STATE_STALE, lock: null };
    logLockWarning(
      LOCK_STATE_STALE_UNCLEARED,
      `failed_to_clear_stale_lock:${clearOutcome.code || "unknown"}`
    );
    return {
      running: true,
      state: LOCK_STATE_STALE_UNCLEARED,
      lock: {
        ...lock,
        state: LOCK_STATE_STALE_UNCLEARED,
        error: `failed_to_clear_stale_lock:${clearOutcome.code || "unknown"}`,
        clear_error: clearOutcome.message || null,
        clear_error_code: clearOutcome.error_code || null,
      },
    };
  }

  if (lock.state === LOCK_STATE_VALID) {
    const owner = getDigestLockOwnerStatus(lock);
    if (owner.alive === false) {
      const clearOutcome = clearDigestRunLock();
      if (clearOutcome.ok) {
        if (isDigestRunnerDebug()) {
          console.warn(`[digest-runner] cleared lock owned by dead pid=${owner.pid}`);
        }
        return { running: false, state: LOCK_STATE_ABSENT, lock: null };
      }
      logLockWarning(
        LOCK_STATE_PID_DEAD_UNCLEARED,
        `pid=${owner.pid};failed_to_clear_dead_lock:${clearOutcome.code || "unknown"}`
      );
      return {
        running: true,
        state: LOCK_STATE_PID_DEAD_UNCLEARED,
        lock: {
          ...lock,
          state: LOCK_STATE_PID_DEAD_UNCLEARED,
          error: `failed_to_clear_dead_lock:${clearOutcome.code || "unknown"}`,
          clear_error: clearOutcome.message || null,
          clear_error_code: clearOutcome.error_code || null,
          owner_pid: owner.pid,
          owner_alive: false,
        },
      };
    }
    return { running: true, state: LOCK_STATE_VALID, lock };
  }

  if (LOCK_UNHEALTHY_STATES.has(lock.state)) {
    logLockWarning(lock.state, lock.error || lock.error_code || "unknown");
    return { running: true, state: lock.state, lock };
  }

  return { running: true, state: lock.state || "unknown", lock };
}

function enqueueAdmission(task) {
  const run = RUNNER_STATE.admissionQueue.then(task, task);
  RUNNER_STATE.admissionQueue = run.catch(() => null);
  return run;
}

function isDigestLockUnhealthyCode(code) {
  return LOCK_UNHEALTHY_STATES.has(String(code || ""));
}

function normalizeDigestTriggerResult(result) {
  const code = String(result?.code || "");
  const cooldownRemainingMs = Math.max(0, Number(result?.cooldown_remaining_ms || 0));
  const cooldownExpiresAtMs = Number(result?.cooldown_expires_at_ms || 0);
  if (result?.ok && code === "queued") {
    return {
      status: DIGEST_TRIGGER_STATUS.QUEUED,
      code,
      lock_state: null,
      lock_error: null,
      exit_code: null,
      signal: null,
      cooldown_remaining_ms: null,
      cooldown_expires_at_ms: null,
    };
  }
  if (result?.ok) {
    return {
      status: DIGEST_TRIGGER_STATUS.OK,
      code: code || "ok",
      lock_state: null,
      lock_error: null,
      exit_code: Number.isFinite(result?.run?.code) ? result.run.code : null,
      signal: result?.run?.signal || null,
      cooldown_remaining_ms: null,
      cooldown_expires_at_ms: null,
    };
  }
  if (code === "cooldown") {
    return {
      status: DIGEST_TRIGGER_STATUS.COOLDOWN,
      code,
      lock_state: null,
      lock_error: null,
      exit_code: null,
      signal: null,
      cooldown_remaining_ms: cooldownRemainingMs,
      cooldown_expires_at_ms: Number.isFinite(cooldownExpiresAtMs) ? cooldownExpiresAtMs : null,
    };
  }
  if (code === "busy") {
    return {
      status: DIGEST_TRIGGER_STATUS.BUSY,
      code,
      lock_state: result?.admission?.lockState || null,
      lock_error: result?.admission?.lock?.error || null,
      exit_code: Number.isFinite(result?.run?.code) ? result.run.code : null,
      signal: result?.run?.signal || null,
      cooldown_remaining_ms: null,
      cooldown_expires_at_ms: null,
    };
  }
  if (isDigestLockUnhealthyCode(code)) {
    return {
      status: DIGEST_TRIGGER_STATUS.LOCK_UNHEALTHY,
      code,
      lock_state: code,
      lock_error: result?.admission?.lock?.error || result?.admission?.lock?.error_code || null,
      exit_code: Number.isFinite(result?.run?.code) ? result.run.code : null,
      signal: result?.run?.signal || null,
      cooldown_remaining_ms: null,
      cooldown_expires_at_ms: null,
    };
  }
  if (code === "spawn_failed") {
    return {
      status: DIGEST_TRIGGER_STATUS.SPAWN_FAILED,
      code,
      lock_state: null,
      lock_error: null,
      exit_code: null,
      signal: null,
      cooldown_remaining_ms: null,
      cooldown_expires_at_ms: null,
    };
  }
  return {
    status: DIGEST_TRIGGER_STATUS.FAILED,
    code: code || "failed",
    lock_state: result?.admission?.lockState || null,
    lock_error: result?.admission?.lock?.error || null,
    exit_code: Number.isFinite(result?.run?.code) ? result.run.code : null,
    signal: result?.run?.signal || null,
    cooldown_remaining_ms: null,
    cooldown_expires_at_ms: null,
  };
}

function toDigestTriggerOutcome(result) {
  const normalized = normalizeDigestTriggerResult(result);
  const status = normalized.status;
  return {
    ok: !!result?.ok,
    status,
    code: normalized.code,
    busy: status === DIGEST_TRIGGER_STATUS.BUSY,
    cooldown: status === DIGEST_TRIGGER_STATUS.COOLDOWN,
    cooldownRemainingMs: normalized.cooldown_remaining_ms,
    cooldownExpiresAtMs: normalized.cooldown_expires_at_ms,
    lockUnhealthy: status === DIGEST_TRIGGER_STATUS.LOCK_UNHEALTHY,
    lockState: normalized.lock_state,
    lockError: normalized.lock_error,
    exitCode: normalized.exit_code,
    signal: normalized.signal,
    normalized,
    raw: result,
  };
}

async function waitForAdmission(opts = {}) {
  const queue = opts.queue !== false;
  const maxWaitMs = toPositiveIntOrDefault(opts.maxAdmissionWaitMs, queue ? 60_000 : 0);
  const pollMinMs = getAdmissionPollMinMs();
  const pollMaxMs = Math.max(pollMinMs, getAdmissionPollMaxMs());
  const startedMs = Date.now();
  let attempts = 0;
  while (true) {
    const status = digestRunStatus();
    const waitedMs = Math.max(0, Date.now() - startedMs);

    if (LOCK_UNHEALTHY_STATES.has(status.state)) {
      return {
        admitted: false,
        waitedMs,
        checks: attempts + 1,
        lock: status.lock || null,
        lockState: status.state,
        reason: "lock_unhealthy",
      };
    }

    if (!status.running) {
      return {
        admitted: true,
        waitedMs,
        checks: attempts + 1,
        lock: null,
      };
    }

    if (!queue || waitedMs >= maxWaitMs) {
      return {
        admitted: false,
        waitedMs,
        checks: attempts + 1,
        lock: status.lock || null,
        lockState: status.state || LOCK_STATE_VALID,
        reason: "busy",
      };
    }
    const nextDelay = Math.min(
      pollMaxMs,
      Math.round(pollMinMs * Math.pow(1.4, attempts))
    );
    await sleep(Math.min(nextDelay, Math.max(0, maxWaitMs - waitedMs)));
    attempts += 1;
  }
}

async function confirmQueuedRunStarted(launched, opts = {}) {
  const pid = Number(launched?.pid || 0);
  if (!Number.isInteger(pid) || pid <= 0) {
    return { ok: false, code: "spawn_failed", reason: "missing_pid", lock: null };
  }
  const timeoutMs = Math.max(
    500,
    toPositiveIntOrDefault(opts.timeoutMs, getQueueStartConfirmTimeoutMs())
  );
  const pollMs = Math.max(
    50,
    toPositiveIntOrDefault(opts.pollMs, getQueueStartConfirmPollMs())
  );
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    const status = digestRunStatus();
    if (LOCK_UNHEALTHY_STATES.has(status.state)) {
      return {
        ok: false,
        code: status.state,
        reason: "lock_unhealthy",
        lock: status.lock || null,
      };
    }
    if (status.state === LOCK_STATE_VALID) {
      const lockPid = Number(status?.lock?.pid || 0);
      if (lockPid === pid) {
        return {
          ok: true,
          code: "queued",
          reason: "lock_confirmed",
          lock: status.lock || null,
        };
      }
      if (!isPidRunning(pid)) {
        return {
          ok: false,
          code: "busy",
          reason: "lock_owned_by_other_process",
          lock: status.lock || null,
        };
      }
    } else if (!isPidRunning(pid)) {
      return {
        ok: false,
        code: "busy",
        reason: "spawned_process_exited_before_lock",
        lock: status.lock || null,
      };
    }
    await sleep(pollMs);
  }

  const finalStatus = digestRunStatus();
  if (finalStatus.state === LOCK_STATE_VALID && Number(finalStatus?.lock?.pid || 0) === pid) {
    return { ok: true, code: "queued", reason: "lock_confirmed_late", lock: finalStatus.lock || null };
  }

  return {
    ok: false,
    code: finalStatus.state === LOCK_STATE_VALID ? "busy" : "spawn_failed",
    reason: "queue_start_handshake_timeout",
    lock: finalStatus.lock || null,
  };
}

async function triggerDigest(opts = {}) {
  const queue = opts.queue !== false;
  const shouldSerialize = opts.serializeAdmission !== false;
  const enforceOnDemandCooldown = opts.enforceOnDemandCooldown === true
    && !!normalizeCooldownChatKey(opts.chatId);
  const requestId = `${Date.now()}-${++RUNNER_STATE.requestCounter}`;
  const admissionTask = () => waitForAdmission({ queue, maxAdmissionWaitMs: opts.maxAdmissionWaitMs });
  const admission = shouldSerialize
    ? await enqueueAdmission(admissionTask)
    : await admissionTask();
  const metadata = buildTriggerEnv({
    ...opts,
    source: sanitizeSource(opts.source),
    requestId,
  });
  const args = buildDigestArgs(opts);
  let reservedCooldown = null;

  async function releaseReservedCooldownIfNeeded() {
    if (!reservedCooldown?.reserved) return;
    reservedCooldown = null;
    try {
      await releaseOnDemandCooldownLease({
        chatId: opts.chatId,
        cooldownFilePath: opts.cooldownFilePath,
      });
    } catch (err) {
      if (isDigestRunnerDebug()) {
        console.warn(`[digest-runner] cooldown lease release failed: ${err.message}`);
      }
    }
  }

  if (!admission.admitted) {
    const blockedByUnhealthyLock = admission.reason === "lock_unhealthy"
      && LOCK_UNHEALTHY_STATES.has(admission.lockState);
    return {
      ok: false,
      code: blockedByUnhealthyLock ? admission.lockState : "busy",
      admission,
      metadata,
    };
  }

  if (enforceOnDemandCooldown) {
    const reservation = await reserveOnDemandCooldownLease({
      chatId: opts.chatId,
      cooldownMs: opts.cooldownMs,
      cooldownFilePath: opts.cooldownFilePath,
    });
    if (!reservation.ok && reservation.code === "cooldown") {
      return {
        ok: false,
        code: "cooldown",
        admission,
        metadata,
        cooldown_remaining_ms: Number(reservation.remainingMs || 0),
        cooldown_expires_at_ms: Number(reservation.expiresAtMs || 0),
      };
    }
    if (reservation.ok && reservation.reserved) {
      reservedCooldown = reservation;
    }
  }

  if (opts.waitForExit) {
    const run = await runAndWait(args, metadata.env, opts);
    const isBusyExit = run.code === DIGEST_LOCK_EXIT_CODE;
    if (run.code !== 0) {
      await releaseReservedCooldownIfNeeded();
    }
    return {
      ok: run.code === 0,
      code: isBusyExit ? "busy" : (run.code === 0 ? "ok" : "failed"),
      admission,
      metadata,
      run,
    };
  }

  try {
    const launched = spawnDetached(args, metadata.env);
    const handshake = await confirmQueuedRunStarted(launched, {
      timeoutMs: opts.queueConfirmMs,
      pollMs: opts.queueConfirmPollMs,
    });
    if (!handshake.ok) {
      await releaseReservedCooldownIfNeeded();
      return {
        ok: false,
        code: handshake.code || "busy",
        admission: {
          ...admission,
          lock: handshake.lock || admission.lock || null,
          lockState: handshake.code || admission.lockState || null,
          reason: handshake.reason || admission.reason || "queue_handshake_failed",
        },
        metadata,
        launched,
      };
    }
    return {
      ok: true,
      code: "queued",
      admission,
      metadata,
      launched,
    };
  } catch (err) {
    await releaseReservedCooldownIfNeeded();
    return {
      ok: false,
      code: "spawn_failed",
      admission,
      metadata,
      error: err.message,
    };
  }
}

async function queueDigestTrigger(opts = {}) {
  const result = await triggerDigest({
    source: opts.source,
    trigger: opts.trigger,
    chatId: opts.chatId,
    enforceOnDemandCooldown: opts.enforceOnDemandCooldown === true,
    cooldownMs: opts.cooldownMs,
    cooldownFilePath: opts.cooldownFilePath,
    queue: true,
    maxAdmissionWaitMs: toPositiveIntOrDefault(opts.maxAdmissionWaitMs, 60_000),
    serializeAdmission: true,
    env: opts.env,
    extraArgs: opts.extraArgs,
  });
  return toDigestTriggerOutcome(result);
}

async function startDigestTrigger(opts = {}) {
  const result = await triggerDigest({
    source: opts.source,
    trigger: opts.trigger,
    chatId: opts.chatId,
    suppressWelcome: !!opts.suppressWelcome,
    queue: false,
    maxAdmissionWaitMs: 0,
    serializeAdmission: true,
    env: opts.env,
    extraArgs: opts.extraArgs,
  });
  return toDigestTriggerOutcome(result);
}

async function runDigestTrigger(opts = {}) {
  const result = await triggerDigest({
    source: opts.source,
    trigger: opts.trigger,
    chatId: opts.chatId,
    suppressWelcome: !!opts.suppressWelcome,
    waitForExit: true,
    timeoutMs: opts.timeoutMs,
    queue: false,
    maxAdmissionWaitMs: 0,
    serializeAdmission: true,
    env: opts.env,
    extraArgs: opts.extraArgs,
    onStdout: opts.onStdout,
    onStderr: opts.onStderr,
  });
  return toDigestTriggerOutcome(result);
}

module.exports = {
  DIGEST_TRIGGER_STATUS,
  DIGEST_LOCK_EXIT_CODE,
  DIGEST_RUN_LOCK_FILE,
  DIGEST_ON_DEMAND_COOLDOWN_FILE,
  clearDigestRunLock,
  confirmQueuedRunStarted,
  digestRunStatus,
  isDigestLockUnhealthyCode,
  normalizeDigestTriggerResult,
  normalizeCooldownChatKey,
  readOnDemandCooldownLeases,
  writeOnDemandCooldownLeases,
  reserveOnDemandCooldownLease,
  releaseOnDemandCooldownLease,
  resolveOnDemandCooldownMs,
  resolveOnDemandCooldownFilePath,
  queueDigestTrigger,
  readDigestRunLock,
  resetRunnerState,
  runDigestTrigger,
  startDigestTrigger,
  toDigestTriggerOutcome,
  triggerDigest,
  createRunnerState,
};
