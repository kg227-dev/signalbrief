#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const WORKER = path.join(ROOT, "src", "entrypoints", "scheduler-worker.js");
const HEARTBEAT = path.join("/tmp", `signalbrief-worker-smoke-${process.pid}.json`);
const CONTROL = path.join("/tmp", `signalbrief-worker-control-smoke-${process.pid}.json`);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readHeartbeat() {
  const raw = fs.readFileSync(HEARTBEAT, "utf8");
  return JSON.parse(raw);
}

async function waitFor(predicate, opts = {}) {
  const timeoutMs = Math.max(1000, Number(opts.timeoutMs || 20000));
  const pollMs = Math.max(50, Number(opts.pollMs || 200));
  const start = Date.now();
  let lastErr = null;
  while ((Date.now() - start) < timeoutMs) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (err) {
      lastErr = err;
    }
    await sleep(pollMs);
  }
  if (lastErr) throw lastErr;
  throw new Error(`timed out after ${timeoutMs}ms`);
}

async function waitForChildExit(child, timeoutMs = 1500) {
  if (!child || child.killed) return;
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    sleep(timeoutMs),
  ]);
}

async function main() {
  try {
    if (fs.existsSync(HEARTBEAT)) fs.unlinkSync(HEARTBEAT);
    if (fs.existsSync(CONTROL)) fs.unlinkSync(CONTROL);
  } catch (err) {
    if (process.env.SB_SMOKE_DEBUG === "1") {
      process.stderr.write(`[smoke-worker] pre-run temp cleanup failed: ${err.message}\n`);
    }
  }

  const child = spawn(process.execPath, [WORKER], {
    cwd: ROOT,
    env: {
      ...process.env,
      SCHEDULER_HEARTBEAT_FILE: HEARTBEAT,
      DIGEST_WORKER_ARGS: "--dry-run",
      DIGEST_POLL_MS: "1500",
      DIGEST_STARTUP_DELAY_MS: "100",
      DIGEST_RUN_TIMEOUT_MS: "60000",
      SCHEDULER_CONTROL_FILE: CONTROL,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let out = "";
  let err = "";
  let exitState = null;
  child.stdout.on("data", (buf) => { out += String(buf); });
  child.stderr.on("data", (buf) => { err += String(buf); });
  child.on("exit", (code, signal) => {
    exitState = { code, signal };
  });

  try {
    const hb = await waitFor(() => {
      if (!fs.existsSync(HEARTBEAT)) return null;
      const next = readHeartbeat();
      if (!next || !next.last_run) return null;
      return next;
    }, {
      timeoutMs: 25000,
      pollMs: 250,
    });
    if (!hb || hb.worker !== "scheduler-worker") {
      throw new Error("heartbeat payload missing worker identity");
    }
    if (!hb.last_run) {
      throw new Error("worker did not record a digest run");
    }
    if (hb.last_run.exit_code !== 0) {
      throw new Error(`digest run exited non-zero (${hb.last_run.exit_code})`);
    }
    if (!Array.isArray(hb.digest_worker_args) || hb.digest_worker_args.join(" ") !== "--dry-run") {
      throw new Error("worker args were not applied");
    }

    fs.writeFileSync(CONTROL, JSON.stringify({
      restart_worker: {
        request_id: `smoke_restart_${process.pid}`,
        requested_at: new Date().toISOString(),
        requested_by: "smoke",
        reason: "smoke_test",
        source: "smoke_worker",
      },
    }, null, 2));

    const restarted = await waitFor(() => exitState, {
      timeoutMs: 12000,
      pollMs: 200,
    });
    if (!restarted) throw new Error("worker did not exit on restart request");
    if (restarted.signal) throw new Error(`worker exited by signal ${restarted.signal}`);
    if (Number(restarted.code) !== 0) throw new Error(`worker restart exit code was ${restarted.code}`);
    if (fs.existsSync(CONTROL)) throw new Error("worker did not clear scheduler control file after restart request");

    process.stdout.write("[smoke-worker] ok\n");
  } finally {
    if (!exitState) {
      child.kill("SIGTERM");
      await waitForChildExit(child, 2000);
    }
    try {
      if (fs.existsSync(HEARTBEAT)) fs.unlinkSync(HEARTBEAT);
      if (fs.existsSync(CONTROL)) fs.unlinkSync(CONTROL);
    } catch (err) {
      if (process.env.SB_SMOKE_DEBUG === "1") {
        process.stderr.write(`[smoke-worker] post-run temp cleanup failed: ${err.message}\n`);
      }
    }
  }

  if (err.trim()) process.stdout.write(`[smoke-worker] stderr:\n${err}\n`);
  if (out.trim()) process.stdout.write(`[smoke-worker] stdout:\n${out}\n`);
}

main().catch((e) => {
  process.stderr.write(`[smoke-worker] fail: ${e.message}\n`);
  process.exit(1);
});
