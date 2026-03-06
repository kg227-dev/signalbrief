#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const WORKER = path.join(ROOT, "scheduler-worker.js");
const HEARTBEAT = path.join("/tmp", `signalbrief-worker-smoke-${process.pid}.json`);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readHeartbeat() {
  const raw = fs.readFileSync(HEARTBEAT, "utf8");
  return JSON.parse(raw);
}

async function main() {
  try {
    if (fs.existsSync(HEARTBEAT)) fs.unlinkSync(HEARTBEAT);
  } catch (err) {
    if (process.env.SB_SMOKE_DEBUG === "1") {
      process.stderr.write(`[smoke-worker] pre-run heartbeat cleanup failed: ${err.message}\n`);
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
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let out = "";
  let err = "";
  child.stdout.on("data", (buf) => { out += String(buf); });
  child.stderr.on("data", (buf) => { err += String(buf); });

  try {
    await sleep(4200);
    if (!fs.existsSync(HEARTBEAT)) {
      throw new Error("heartbeat file was not created");
    }
    const hb = readHeartbeat();
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
    process.stdout.write("[smoke-worker] ok\n");
  } finally {
    child.kill("SIGTERM");
    await sleep(300);
    try {
      if (fs.existsSync(HEARTBEAT)) fs.unlinkSync(HEARTBEAT);
    } catch (err) {
      if (process.env.SB_SMOKE_DEBUG === "1") {
        process.stderr.write(`[smoke-worker] post-run heartbeat cleanup failed: ${err.message}\n`);
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
