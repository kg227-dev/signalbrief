#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = __dirname;
const DIGEST_SCRIPT = path.join(ROOT, "digest.js");
const HEARTBEAT_FILE = path.join(ROOT, "data", "scheduler-heartbeat.json");

const POLL_MS = Math.max(60 * 1000, Number(process.env.DIGEST_POLL_MS || (5 * 60 * 1000)));
const STARTUP_DELAY_MS = Math.max(0, Number(process.env.DIGEST_STARTUP_DELAY_MS || 3000));
const RUN_TIMEOUT_MS = Math.max(60 * 1000, Number(process.env.DIGEST_RUN_TIMEOUT_MS || (25 * 60 * 1000)));

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
  const child = spawn(process.execPath, [DIGEST_SCRIPT], {
    cwd: ROOT,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const timeout = setTimeout(() => {
    log(`digest timed out after ${Math.round(RUN_TIMEOUT_MS / 1000)}s — terminating`);
    child.kill("SIGTERM");
  }, RUN_TIMEOUT_MS);

  child.stdout.on("data", (buf) => {
    process.stdout.write(String(buf));
  });
  child.stderr.on("data", (buf) => {
    process.stderr.write(String(buf));
  });

  child.on("close", (code, signal) => {
    clearTimeout(timeout);
    runInFlight = false;
    lastRun = {
      trigger,
      started_at: startedIso,
      finished_at: nowIso(),
      duration_ms: Date.now() - startedAt,
      exit_code: code,
      signal: signal || null,
      success: code === 0,
    };
    writeHeartbeat({
      status: code === 0 ? "ok" : "error",
      trigger,
      last_error: code === 0 ? null : `digest exit code ${code}${signal ? ` (signal ${signal})` : ""}`,
    });
    log(`digest finished (${trigger}) exit=${code}${signal ? ` signal=${signal}` : ""}`);
  });
}

function shutdown(sig) {
  log(`received ${sig}, stopping worker`);
  writeHeartbeat({ status: "stopped", stopped_at: nowIso(), signal: sig });
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

log(`boot (poll=${Math.round(POLL_MS / 1000)}s timeout=${Math.round(RUN_TIMEOUT_MS / 1000)}s)`);
writeHeartbeat({ status: "booting", booted_at: nowIso() });

setTimeout(() => runDigest("startup"), STARTUP_DELAY_MS);
setInterval(() => runDigest("interval"), POLL_MS);

