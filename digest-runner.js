"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = __dirname;
const DIGEST_SCRIPT = path.join(ROOT, "src", "entrypoints", "digest.js");
const DIGEST_RUN_LOCK_FILE = path.join(ROOT, "data", "digest-run.lock");

const DIGEST_RUN_LOCK_STALE_MS = Math.max(
  5 * 60 * 1000,
  Number(process.env.DIGEST_LOCK_STALE_MS || (2 * 60 * 60 * 1000))
);
const DIGEST_LOCK_EXIT_CODE = 4;
const DEFAULT_WAIT_TIMEOUT_MS = 12 * 60 * 1000;
const ADMISSION_POLL_MIN_MS = Math.max(250, Number(process.env.DIGEST_RUNNER_POLL_MIN_MS || 1000));
const ADMISSION_POLL_MAX_MS = Math.max(ADMISSION_POLL_MIN_MS, Number(process.env.DIGEST_RUNNER_POLL_MAX_MS || 8000));
const LOCK_STATE_VALID = "valid";
const LOCK_STATE_STALE = "stale";
const LOCK_STATE_CORRUPT = "corrupt";
const LOCK_STATE_IO_ERROR = "io_error";
const LOCK_STATE_STALE_UNCLEARED = "stale_uncleared";
const LOCK_STATE_ABSENT = "absent";
const LOCK_UNHEALTHY_STATES = new Set([
  LOCK_STATE_CORRUPT,
  LOCK_STATE_IO_ERROR,
  LOCK_STATE_STALE_UNCLEARED,
]);
const DIGEST_TRIGGER_STATUS = Object.freeze({
  OK: "ok",
  QUEUED: "queued",
  BUSY: "busy",
  LOCK_UNHEALTHY: "lock_unhealthy",
  FAILED: "failed",
  SPAWN_FAILED: "spawn_failed",
  UNKNOWN: "unknown",
});
const LOCK_WARNING_THROTTLE_MS = 60 * 1000;

let admissionQueue = Promise.resolve();
let requestCounter = 0;
let lastLockWarningKey = "";
let lastLockWarningAtMs = 0;

function sanitizeSource(value) {
  const source = String(value || "unknown")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, "_")
    .slice(0, 80);
  return source || "unknown";
}

function toPositiveIntOrDefault(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.round(parsed);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function logLockWarning(state, detail) {
  const now = Date.now();
  const key = `${state}:${detail || ""}`;
  if (key === lastLockWarningKey && (now - lastLockWarningAtMs) < LOCK_WARNING_THROTTLE_MS) return;
  lastLockWarningKey = key;
  lastLockWarningAtMs = now;
  console.warn(`[digest-runner] lock state=${state}; manual intervention required${detail ? ` (${detail})` : ""}`);
}

function readDigestRunLock() {
  if (!fs.existsSync(DIGEST_RUN_LOCK_FILE)) return null;

  let text = "";
  try {
    text = fs.readFileSync(DIGEST_RUN_LOCK_FILE, "utf8");
  } catch (err) {
    return {
      state: LOCK_STATE_IO_ERROR,
      error: err.message,
      error_code: err?.code || null,
    };
  }

  let raw;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return {
      state: LOCK_STATE_CORRUPT,
      error: err.message,
      parse: "invalid_json",
    };
  }

  try {
    const startedAtIso = raw?.startedAt || null;
    const startedAtTs = Date.parse(startedAtIso || "");
    if (!Number.isFinite(startedAtTs)) {
      return {
        state: LOCK_STATE_CORRUPT,
        error: "missing_or_invalid_startedAt",
        raw,
      };
    }
    const ageMs = Math.max(0, Date.now() - startedAtTs);
    const state = ageMs > DIGEST_RUN_LOCK_STALE_MS ? LOCK_STATE_STALE : LOCK_STATE_VALID;
    return {
      ...raw,
      state,
      startedAtIso,
      startedAtTs,
      ageMs,
      stale: state === LOCK_STATE_STALE,
    };
  } catch (err) {
    return {
      state: LOCK_STATE_CORRUPT,
      error: err.message,
    };
  }
}

function clearDigestRunLock() {
  try {
    if (fs.existsSync(DIGEST_RUN_LOCK_FILE)) fs.unlinkSync(DIGEST_RUN_LOCK_FILE);
    return true;
  } catch (err) {
    if (process.env.DEBUG_DIGEST_RUNNER === "1") {
      console.warn(`[digest-runner] failed to clear digest lock: ${err.message}`);
    }
    return false;
  }
}

function digestRunStatus() {
  const lock = readDigestRunLock();
  if (!lock) return { running: false, state: LOCK_STATE_ABSENT, lock: null };

  if (lock.state === LOCK_STATE_STALE) {
    const cleared = clearDigestRunLock();
    if (cleared) return { running: false, state: LOCK_STATE_STALE, lock: null };
    logLockWarning(LOCK_STATE_STALE_UNCLEARED, "failed_to_clear_stale_lock");
    return {
      running: true,
      state: LOCK_STATE_STALE_UNCLEARED,
      lock: {
        ...lock,
        state: LOCK_STATE_STALE_UNCLEARED,
      },
    };
  }

  if (lock.state === LOCK_STATE_VALID) {
    return { running: true, state: LOCK_STATE_VALID, lock };
  }

  if (LOCK_UNHEALTHY_STATES.has(lock.state)) {
    logLockWarning(lock.state, lock.error || lock.error_code || "unknown");
    return { running: true, state: lock.state, lock };
  }

  return { running: true, state: lock.state || "unknown", lock };
}

function enqueueAdmission(task) {
  const run = admissionQueue.then(task, task);
  admissionQueue = run.catch(() => null);
  return run;
}

async function waitForAdmission(opts = {}) {
  const queue = opts.queue !== false;
  const maxWaitMs = toPositiveIntOrDefault(opts.maxAdmissionWaitMs, queue ? 60_000 : 0);
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
      ADMISSION_POLL_MAX_MS,
      Math.round(ADMISSION_POLL_MIN_MS * Math.pow(1.4, attempts))
    );
    await sleep(Math.min(nextDelay, Math.max(0, maxWaitMs - waitedMs)));
    attempts += 1;
  }
}

function buildDigestArgs(opts = {}) {
  const args = [];
  if (opts.chatId != null && String(opts.chatId).trim()) {
    args.push("--chatId", String(opts.chatId).trim());
  }
  if (opts.suppressWelcome) args.push("--suppressWelcome");
  if (Array.isArray(opts.extraArgs)) {
    for (const value of opts.extraArgs) {
      const text = String(value || "").trim();
      if (text) args.push(text);
    }
  }
  return args;
}

function buildTriggerEnv(opts = {}) {
  const source = sanitizeSource(opts.source);
  const trigger = String(opts.trigger || source).trim() || source;
  const requestId = String(opts.requestId || `${Date.now()}-${++requestCounter}`);
  const env = {
    ...process.env,
    ...(opts.env && typeof opts.env === "object" ? opts.env : {}),
    SIGNALBRIEF_DIGEST_TRIGGER_SOURCE: source,
    SIGNALBRIEF_DIGEST_TRIGGER: trigger,
    SIGNALBRIEF_DIGEST_REQUEST_ID: requestId,
    SIGNALBRIEF_DIGEST_REQUESTED_AT: new Date().toISOString(),
  };
  if (opts.chatId != null && String(opts.chatId).trim()) {
    env.SIGNALBRIEF_DIGEST_CHAT_ID = String(opts.chatId).trim();
  }
  return { env, source, trigger, requestId };
}

function spawnDetached(args, env) {
  const child = spawn(process.execPath, [DIGEST_SCRIPT, ...args], {
    cwd: ROOT,
    detached: true,
    stdio: "ignore",
    env,
  });
  child.unref();
  return { pid: child.pid || null };
}

function runAndWait(args, env, opts = {}) {
  const timeoutMs = Math.max(15_000, toPositiveIntOrDefault(opts.timeoutMs, DEFAULT_WAIT_TIMEOUT_MS));
  const stderrLimit = Math.max(2000, toPositiveIntOrDefault(opts.stderrLimit, 8000));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [DIGEST_SCRIPT, ...args], {
      cwd: ROOT,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    const timer = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch (err) {
        if (process.env.DEBUG_DIGEST_RUNNER === "1") {
          console.warn(`[digest-runner] SIGTERM failed: ${err.message}`);
        }
      }
      setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch (err) {
          if (process.env.DEBUG_DIGEST_RUNNER === "1") {
            console.warn(`[digest-runner] SIGKILL failed: ${err.message}`);
          }
        }
      }, 1500);
    }, timeoutMs);
    child.stdout.on("data", (buf) => {
      if (typeof opts.onStdout === "function") opts.onStdout(buf);
    });
    child.stderr.on("data", (buf) => {
      if (typeof opts.onStderr === "function") opts.onStderr(buf);
      stderr += String(buf);
      if (stderr.length > stderrLimit) stderr = stderr.slice(-stderrLimit);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({
        code: Number.isFinite(code) ? code : null,
        signal: signal || null,
        stderr,
      });
    });
  });
}

async function triggerDigest(opts = {}) {
  const queue = opts.queue !== false;
  const shouldSerialize = opts.serializeAdmission !== false;
  const requestId = `${Date.now()}-${++requestCounter}`;
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

  if (opts.waitForExit) {
    const run = await runAndWait(args, metadata.env, opts);
    const isBusyExit = run.code === DIGEST_LOCK_EXIT_CODE;
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
    return {
      ok: true,
      code: "queued",
      admission,
      metadata,
      launched,
    };
  } catch (err) {
    return {
      ok: false,
      code: "spawn_failed",
      admission,
      metadata,
      error: err.message,
    };
  }
}

function normalizeDigestTriggerResult(run) {
  if (!run || typeof run !== "object") {
    return { ok: false, status: DIGEST_TRIGGER_STATUS.UNKNOWN, code: null };
  }

  const code = run.code == null ? null : String(run.code);
  if (run.ok) {
    if (code === "queued") return { ok: true, status: DIGEST_TRIGGER_STATUS.QUEUED, code };
    if (code === "ok") return { ok: true, status: DIGEST_TRIGGER_STATUS.OK, code };
    return { ok: true, status: code || DIGEST_TRIGGER_STATUS.OK, code };
  }

  if (code === "busy") {
    return { ok: false, status: DIGEST_TRIGGER_STATUS.BUSY, code };
  }

  if (LOCK_UNHEALTHY_STATES.has(code) || run?.admission?.reason === "lock_unhealthy") {
    return { ok: false, status: DIGEST_TRIGGER_STATUS.LOCK_UNHEALTHY, code };
  }

  if (code === "spawn_failed") {
    return { ok: false, status: DIGEST_TRIGGER_STATUS.SPAWN_FAILED, code };
  }

  return { ok: false, status: DIGEST_TRIGGER_STATUS.FAILED, code };
}

module.exports = {
  DIGEST_TRIGGER_STATUS,
  DIGEST_LOCK_EXIT_CODE,
  DIGEST_RUN_LOCK_FILE,
  clearDigestRunLock,
  digestRunStatus,
  normalizeDigestTriggerResult,
  readDigestRunLock,
  triggerDigest,
};
