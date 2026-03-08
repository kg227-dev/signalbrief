#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const {
  DIGEST_LOCK_EXIT_CODE,
  runDigestTrigger,
} = require("../../digest-runner");

const APP_ROOT = path.resolve(__dirname, "..", "..");
const HEARTBEAT_FILE = process.env.SCHEDULER_HEARTBEAT_FILE
  ? path.resolve(process.env.SCHEDULER_HEARTBEAT_FILE)
  : path.join(APP_ROOT, "data", "scheduler-heartbeat.json");

const POLL_MS = Math.max(60 * 1000, Number(process.env.DIGEST_POLL_MS || (5 * 60 * 1000)));
const STARTUP_DELAY_MS = Math.max(0, Number(process.env.DIGEST_STARTUP_DELAY_MS || 3000));
const RUN_TIMEOUT_MS = Math.max(60 * 1000, Number(process.env.DIGEST_RUN_TIMEOUT_MS || (25 * 60 * 1000)));
const WORKER_ARGS = String(process.env.DIGEST_WORKER_ARGS || "")
  .trim()
  .split(/\s+/)
  .filter(Boolean);

let runInFlight = false;
let lastRun = null;

function nowIso() {
  return new Date().toISOString();
}

function ensureDataDir() {
  const dir = path.dirname(HEARTBEAT_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function writeHeartbeat(extra = {}) {
  try {
    ensureDataDir();
    const payload = {
      worker: "scheduler-worker",
      pid: process.pid,
      updated_at: nowIso(),
      poll_ms: POLL_MS,
      startup_delay_ms: STARTUP_DELAY_MS,
      run_timeout_ms: RUN_TIMEOUT_MS,
      digest_worker_args: WORKER_ARGS,
      in_flight: runInFlight,
      last_run: lastRun,
      ...extra,
    };
    fs.writeFileSync(HEARTBEAT_FILE, JSON.stringify(payload, null, 2));
  } catch (err) {
    // Keep worker alive even if heartbeat write fails.
    process.stderr.write(`[worker] heartbeat write failed: ${err.message}\n`);
  }
}

function log(msg) {
  process.stdout.write(`[worker] ${msg}\n`);
}

function runDigest(trigger) {
  if (runInFlight) {
    log(`skip run (${trigger}) — digest already in flight`);
    writeHeartbeat({ skip_reason: "digest_in_flight" });
    return;
  }
  runInFlight = true;
  const startedAt = Date.now();
  const startedIso = nowIso();
  writeHeartbeat({
    trigger,
    started_at: startedIso,
    status: "running",
  });

  log(`starting digest (${trigger})`);
  runDigestTrigger({
    source: "scheduler-worker",
    trigger,
    timeoutMs: RUN_TIMEOUT_MS,
    extraArgs: WORKER_ARGS,
    onStdout: (buf) => process.stdout.write(String(buf)),
    onStderr: (buf) => process.stderr.write(String(buf)),
  }).then((outcome) => {
    runInFlight = false;
    const lockUnhealthy = outcome.lockUnhealthy;
    const skipped = outcome.busy;
    const code = outcome.exitCode != null
      ? outcome.exitCode
      : (skipped ? DIGEST_LOCK_EXIT_CODE : null);
    const signal = outcome.signal;
    const success = outcome.ok;
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
    });
    if (skipped) {
      log(`digest skipped (${trigger}) — lock active`);
      return;
    }
    if (lockUnhealthy) {
      log(`digest blocked (${trigger}) — unhealthy lock state ${outcome.code}: ${outcome.lockError || "manual intervention required"}`);
      return;
    }
    log(`digest finished (${trigger}) exit=${code}${signal ? ` signal=${signal}` : ""}`);
  }).catch((err) => {
    runInFlight = false;
    lastRun = {
      trigger,
      started_at: startedIso,
      finished_at: nowIso(),
      duration_ms: Date.now() - startedAt,
      exit_code: null,
      signal: null,
      success: false,
      skipped: false,
    };
    writeHeartbeat({
      status: "error",
      trigger,
      last_error: `digest trigger failed: ${err.message}`,
    });
    log(`digest failed (${trigger}): ${err.message}`);
  });
}

function shutdown(sig) {
  log(`received ${sig}, stopping worker`);
  writeHeartbeat({ status: "stopped", stopped_at: nowIso(), signal: sig });
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

log(
  `boot (poll=${Math.round(POLL_MS / 1000)}s timeout=${Math.round(RUN_TIMEOUT_MS / 1000)}s args=${WORKER_ARGS.join(" ") || "none"})`
);
writeHeartbeat({ status: "booting", booted_at: nowIso() });

setTimeout(() => runDigest("startup"), STARTUP_DELAY_MS);
setInterval(() => runDigest("interval"), POLL_MS);
