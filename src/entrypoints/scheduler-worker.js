#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const {
  DIGEST_LOCK_EXIT_CODE,
  runDigestTrigger,
} = require("../jobs/digest-runner-runtime");

function getWorkerConfig() {
  const appRoot = path.resolve(__dirname, "..", "..");
  const heartbeatFile = process.env.SCHEDULER_HEARTBEAT_FILE
    ? path.resolve(process.env.SCHEDULER_HEARTBEAT_FILE)
    : path.join(appRoot, "data", "scheduler-heartbeat.json");
  const pollMs = Math.max(60 * 1000, Number(process.env.DIGEST_POLL_MS || (5 * 60 * 1000)));
  const startupDelayMs = Math.max(0, Number(process.env.DIGEST_STARTUP_DELAY_MS || 3000));
  const runTimeoutMs = Math.max(60 * 1000, Number(process.env.DIGEST_RUN_TIMEOUT_MS || (25 * 60 * 1000)));
  const workerArgs = String(process.env.DIGEST_WORKER_ARGS || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return {
    heartbeatFile,
    pollMs,
    startupDelayMs,
    runTimeoutMs,
    workerArgs,
  };
}

let runInFlight = false;
let lastRun = null;
let signalHandlersBound = false;
let startupTimer = null;
let intervalTimer = null;
let consecutiveLockUnhealthy = 0;
let schedulerBlockedState = null;

function getLockUnhealthyBlockThreshold() {
  return Math.max(1, Number(process.env.DIGEST_LOCK_UNHEALTHY_BLOCK_THRESHOLD || 3));
}

function getBlockedSnapshot() {
  if (!schedulerBlockedState) return null;
  return { ...schedulerBlockedState };
}

function getSchedulerWorkerState() {
  return {
    runInFlight,
    consecutiveLockUnhealthy,
    blocked: Boolean(schedulerBlockedState),
    blockedState: getBlockedSnapshot(),
    lastRun,
  };
}

function emitBlockedAlert(trigger, outcome) {
  const detail = outcome?.lockError || "manual intervention required";
  process.stderr.write(
    `[worker][ALERT] scheduler entered blocked mode after repeated lock_unhealthy outcomes; trigger=${trigger}; lock_state=${outcome?.code || "unknown"}; detail=${detail}\n`
  );
}

function blockScheduler(trigger, outcome, config) {
  if (schedulerBlockedState) return;
  schedulerBlockedState = {
    blocked_at: nowIso(),
    trigger,
    reason: "lock_unhealthy_threshold",
    lock_state: outcome?.code || null,
    lock_error: outcome?.lockError || null,
    threshold: getLockUnhealthyBlockThreshold(),
    consecutive_lock_unhealthy: consecutiveLockUnhealthy,
  };
  emitBlockedAlert(trigger, outcome);
  log(
    `scheduler blocked (${trigger}) — lock unhealthy threshold reached (${consecutiveLockUnhealthy}/${schedulerBlockedState.threshold})`
  );
  writeHeartbeat(
    {
      status: "blocked",
      trigger,
      blocked: true,
      blocked_state: schedulerBlockedState,
      skip_reason: "lock_unhealthy_blocked",
    },
    config
  );
}

function clearLockUnhealthyCounter() {
  consecutiveLockUnhealthy = 0;
}

function resetSchedulerBlockState(note = "manual-reset", config = getWorkerConfig()) {
  schedulerBlockedState = null;
  clearLockUnhealthyCounter();
  writeHeartbeat({
    status: "ready",
    blocked: false,
    reset_note: String(note || "manual-reset"),
    reset_at: nowIso(),
  }, config);
}

function nowIso() {
  return new Date().toISOString();
}

function ensureDataDir(config) {
  const dir = path.dirname(config.heartbeatFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function writeHeartbeat(extra = {}, config = getWorkerConfig()) {
  try {
    ensureDataDir(config);
    const payload = {
      worker: "scheduler-worker",
      pid: process.pid,
      updated_at: nowIso(),
      poll_ms: config.pollMs,
      startup_delay_ms: config.startupDelayMs,
      run_timeout_ms: config.runTimeoutMs,
      digest_worker_args: config.workerArgs,
      in_flight: runInFlight,
      last_run: lastRun,
      ...extra,
    };
    fs.writeFileSync(config.heartbeatFile, JSON.stringify(payload, null, 2));
  } catch (err) {
    // Keep worker alive even if heartbeat write fails.
    process.stderr.write(`[worker] heartbeat write failed: ${err.message}\n`);
  }
}

function log(msg) {
  process.stdout.write(`[worker] ${msg}\n`);
}

function setLastRunState({
  trigger,
  startedIso,
  startedAt,
  code,
  signal,
  success,
  skipped,
}) {
  lastRun = {
    trigger,
    started_at: startedIso,
    finished_at: nowIso(),
    duration_ms: Date.now() - startedAt,
    exit_code: code,
    signal,
    success,
    skipped,
  };
}

function handleDigestOutcome(outcome, trigger, config, startedAt, startedIso) {
  const lockUnhealthy = outcome.lockUnhealthy;
  const skipped = outcome.busy;
  if (lockUnhealthy) {
    consecutiveLockUnhealthy += 1;
  } else {
    clearLockUnhealthyCounter();
  }

  const code = outcome.exitCode != null
    ? outcome.exitCode
    : (skipped ? DIGEST_LOCK_EXIT_CODE : null);
  const signal = outcome.signal;
  const success = outcome.ok;

  setLastRunState({
    trigger,
    startedIso,
    startedAt,
    code,
    signal,
    success,
    skipped,
  });

  if (lockUnhealthy && consecutiveLockUnhealthy >= getLockUnhealthyBlockThreshold()) {
    blockScheduler(trigger, outcome, config);
    return;
  }

  writeHeartbeat({
    status: success ? "ok" : (skipped ? "skip" : "error"),
    trigger,
    last_error: success ? null : (skipped
      ? "digest lock active"
      : (lockUnhealthy
        ? `digest lock unhealthy (${outcome.code}): ${outcome.lockError || "manual intervention required"}`
        : `digest exit code ${code}${signal ? ` (signal ${signal})` : ""}`)
    ),
    lock_state: outcome.lockState,
    lock_error: outcome.lockError,
    consecutive_lock_unhealthy: consecutiveLockUnhealthy,
  }, config);

  if (skipped) {
    log(`digest skipped (${trigger}) — lock active`);
    return;
  }
  if (lockUnhealthy) {
    log(`digest blocked (${trigger}) — unhealthy lock state ${outcome.code}: ${outcome.lockError || "manual intervention required"}`);
    return;
  }
  log(`digest finished (${trigger}) exit=${code}${signal ? ` signal=${signal}` : ""}`);
}

function handleDigestError(err, trigger, config, startedAt, startedIso) {
  clearLockUnhealthyCounter();
  setLastRunState({
    trigger,
    startedIso,
    startedAt,
    code: null,
    signal: null,
    success: false,
    skipped: false,
  });
  writeHeartbeat({
    status: "error",
    trigger,
    last_error: `digest trigger failed: ${err.message}`,
  }, config);
  log(`digest failed (${trigger}): ${err.message}`);
}

function runDigest(trigger, config = getWorkerConfig()) {
  if (schedulerBlockedState) {
    log(`skip run (${trigger}) — scheduler blocked pending manual reset`);
    writeHeartbeat(
      {
        status: "blocked",
        trigger,
        blocked: true,
        blocked_state: schedulerBlockedState,
        skip_reason: "lock_unhealthy_blocked",
      },
      config
    );
    return;
  }
  if (runInFlight) {
    log(`skip run (${trigger}) — digest already in flight`);
    writeHeartbeat({ skip_reason: "digest_in_flight" }, config);
    return;
  }
  runInFlight = true;
  const startedAt = Date.now();
  const startedIso = nowIso();
  writeHeartbeat({
    trigger,
    started_at: startedIso,
    status: "running",
  }, config);

  log(`starting digest (${trigger})`);
  runDigestTrigger({
    source: "scheduler-worker",
    trigger,
    timeoutMs: config.runTimeoutMs,
    extraArgs: config.workerArgs,
    onStdout: (buf) => process.stdout.write(String(buf)),
    onStderr: (buf) => process.stderr.write(String(buf)),
  }).then((outcome) => {
    runInFlight = false;
    handleDigestOutcome(outcome, trigger, config, startedAt, startedIso);
  }).catch((err) => {
    runInFlight = false;
    handleDigestError(err, trigger, config, startedAt, startedIso);
  });
}

function shutdown(sig, opts = {}) {
  log(`received ${sig}, stopping worker`);
  writeHeartbeat({ status: "stopped", stopped_at: nowIso(), signal: sig });
  if (opts.exit !== false) process.exit(0);
}

function bindSignalHandlers() {
  if (signalHandlersBound) return;
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  signalHandlersBound = true;
}

function startSchedulerWorker() {
  const config = getWorkerConfig();
  bindSignalHandlers();
  log(
    `boot (poll=${Math.round(config.pollMs / 1000)}s timeout=${Math.round(config.runTimeoutMs / 1000)}s args=${config.workerArgs.join(" ") || "none"})`
  );
  writeHeartbeat({ status: "booting", booted_at: nowIso() }, config);
  startupTimer = setTimeout(() => runDigest("startup", config), config.startupDelayMs);
  intervalTimer = setInterval(() => runDigest("interval", config), config.pollMs);
  return { startupTimer, intervalTimer };
}

function stopSchedulerWorker() {
  if (startupTimer) {
    clearTimeout(startupTimer);
    startupTimer = null;
  }
  if (intervalTimer) {
    clearInterval(intervalTimer);
    intervalTimer = null;
  }
}

function resetSchedulerWorkerState() {
  runInFlight = false;
  lastRun = null;
  clearLockUnhealthyCounter();
  schedulerBlockedState = null;
  return getSchedulerWorkerState();
}

if (require.main === module) {
  startSchedulerWorker();
}

module.exports = {
  nowIso,
  getWorkerConfig,
  getLockUnhealthyBlockThreshold,
  getSchedulerWorkerState,
  resetSchedulerWorkerState,
  resetSchedulerBlockState,
  writeHeartbeat,
  runDigest,
  shutdown,
  startSchedulerWorker,
  stopSchedulerWorker,
};
