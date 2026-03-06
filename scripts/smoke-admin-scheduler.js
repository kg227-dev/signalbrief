#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const http = require("http");

const ROOT = path.resolve(__dirname, "..");
const SERVER = path.join(ROOT, "web", "server.js");
const PORT = 3987;
const HEARTBEAT = path.join("/tmp", `signalbrief-heartbeat-smoke-${process.pid}.json`);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += String(chunk); });
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body || "{}") });
        } catch (e) {
          reject(new Error(`invalid json response: ${e.message}`));
        }
      });
    }).on("error", reject);
  });
}

async function main() {
  const payload = {
    worker: "scheduler-worker",
    updated_at: new Date().toISOString(),
    poll_ms: 300000,
    in_flight: false,
    last_run: {
      trigger: "smoke",
      started_at: new Date(Date.now() - 1200).toISOString(),
      finished_at: new Date().toISOString(),
      duration_ms: 1200,
      exit_code: 0,
      signal: null,
      success: true,
    },
  };
  fs.writeFileSync(HEARTBEAT, JSON.stringify(payload, null, 2));

  const child = spawn(process.execPath, [SERVER], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      ADMIN_LOCAL_BYPASS: "1",
      SCHEDULER_HEARTBEAT_FILE: HEARTBEAT,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let err = "";
  child.stderr.on("data", (buf) => { err += String(buf); });
  child.stdout.on("data", () => {});

  try {
    await sleep(900);
    const res = await getJson(`http://127.0.0.1:${PORT}/api/admin/stats`);
    if (res.status !== 200) throw new Error(`admin stats returned HTTP ${res.status}`);
    const scheduler = res.data && res.data.health && res.data.health.scheduler_worker;
    if (!scheduler) throw new Error("scheduler_worker block missing in stats");
    if (!scheduler.available) throw new Error("scheduler worker reported unavailable");
    if (!scheduler.healthy) throw new Error(`scheduler worker reported unhealthy: ${scheduler.summary || "unknown"}`);
    process.stdout.write("[smoke-admin-scheduler] ok\n");
  } finally {
    child.kill("SIGTERM");
    await sleep(250);
    try {
      fs.unlinkSync(HEARTBEAT);
    } catch (err) {
      if (process.env.SB_SMOKE_DEBUG === "1") {
        process.stderr.write(`[smoke-admin-scheduler] heartbeat cleanup failed: ${err.message}\n`);
      }
    }
  }

  if (err.trim()) process.stdout.write(`[smoke-admin-scheduler] stderr:\n${err}\n`);
}

main().catch((e) => {
  process.stderr.write(`[smoke-admin-scheduler] fail: ${e.message}\n`);
  process.exit(1);
});
