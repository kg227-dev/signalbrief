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
const DATA_DIR = path.join("/tmp", `signalbrief-admin-data-smoke-${process.pid}`);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, opts = {}) {
  const timeoutMs = Math.max(1000, Number(opts.timeoutMs || 15000));
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

function buildHeartbeatPayload({ updatedAt, status = "ok" } = {}) {
  const nowIso = new Date().toISOString();
  return {
    worker: "scheduler-worker",
    updated_at: updatedAt || nowIso,
    poll_ms: 300000,
    in_flight: false,
    status,
    blocked: false,
    last_run: {
      trigger: "smoke",
      started_at: new Date(Date.now() - 1200).toISOString(),
      finished_at: nowIso,
      duration_ms: 1200,
      exit_code: 0,
      signal: null,
      success: true,
    },
  };
}

async function main() {
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  const staleTs = new Date(Date.now() - (20 * 60 * 1000)).toISOString();
  fs.writeFileSync(HEARTBEAT, JSON.stringify(buildHeartbeatPayload({
    updatedAt: staleTs,
    status: "smoke_stale_seed",
  }), null, 2));

  const child = spawn(process.execPath, [SERVER], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      ADMIN_LOCAL_BYPASS: "1",
      SCHEDULER_HEARTBEAT_FILE: HEARTBEAT,
      SIGNALBRIEF_DATA_DIR: DATA_DIR,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let err = "";
  child.stderr.on("data", (buf) => { err += String(buf); });
  child.stdout.on("data", () => {});

  try {
    const staleHealth = await waitFor(async () => {
      const candidate = await getJson(`http://127.0.0.1:${PORT}/api/health/scheduler`);
      if (candidate.status !== 503) return null;
      const scheduler = candidate.data && candidate.data.scheduler;
      if (!scheduler || scheduler.healthy !== false) return null;
      const summary = String(scheduler.summary || "").toLowerCase();
      if (!summary.includes("stale")) return null;
      return candidate;
    }, {
      timeoutMs: 20000,
      pollMs: 250,
    });

    if (staleHealth.status !== 503 || staleHealth?.data?.ok !== false) {
      throw new Error("scheduler health endpoint did not report stale state deterministically");
    }
    process.stdout.write("[smoke-admin-scheduler] stale-health ok\n");

    fs.writeFileSync(HEARTBEAT, JSON.stringify(buildHeartbeatPayload({
      updatedAt: new Date().toISOString(),
      status: "smoke_fresh_seed",
    }), null, 2));

    const { res, scheduler, executiveSummary } = await waitFor(async () => {
      const candidate = await getJson(`http://127.0.0.1:${PORT}/api/admin/stats`);
      if (candidate.status !== 200) return null;
      const health = candidate.data && candidate.data.health;
      const worker = health && health.scheduler_worker;
      const summary = health && health.executive_summary;
      if (!worker) return null;
      if (!worker.available || !worker.healthy) return null;
      if (!summary) return null;
      return { res: candidate, scheduler: worker, executiveSummary: summary };
    }, {
      timeoutMs: 20000,
      pollMs: 250,
    });

    if (res.status !== 200) throw new Error(`admin stats returned HTTP ${res.status}`);
    if (!scheduler) throw new Error("scheduler_worker block missing in stats");
    if (!scheduler.available) throw new Error("scheduler worker reported unavailable");
    if (!scheduler.healthy) throw new Error(`scheduler worker reported unhealthy: ${scheduler.summary || "unknown"}`);
    if (!executiveSummary || typeof executiveSummary !== "object") {
      throw new Error("executive_summary block missing in health payload");
    }
    if (!["green", "yellow", "red"].includes(String(executiveSummary.status || ""))) {
      throw new Error(`unexpected executive summary status: ${executiveSummary.status}`);
    }
    const commands = Array.isArray(executiveSummary.commands) ? executiveSummary.commands : [];
    const commandIds = new Set(commands.map((entry) => entry && entry.id).filter(Boolean));
    ["refresh_health", "check_scheduler", "send_test_digest", "run_full_digest", "restart_worker"].forEach((id) => {
      if (!commandIds.has(id)) throw new Error(`executive_summary missing command id: ${id}`);
    });
    process.stdout.write("[smoke-admin-scheduler] healthy-after-stale ok\n");
    process.stdout.write("[smoke-admin-scheduler] ok\n");
  } finally {
    child.kill("SIGTERM");
    await waitForChildExit(child, 2000);
    try {
      if (fs.existsSync(HEARTBEAT)) fs.unlinkSync(HEARTBEAT);
    } catch (err) {
      if (process.env.SB_SMOKE_DEBUG === "1") {
        process.stderr.write(`[smoke-admin-scheduler] heartbeat cleanup failed: ${err.message}\n`);
      }
    }
    try {
      fs.rmSync(DATA_DIR, { recursive: true, force: true });
    } catch (err) {
      if (process.env.SB_SMOKE_DEBUG === "1") {
        process.stderr.write(`[smoke-admin-scheduler] data dir cleanup failed: ${err.message}\n`);
      }
    }
  }

  if (err.trim()) process.stdout.write(`[smoke-admin-scheduler] stderr:\n${err}\n`);
}

main().catch((e) => {
  process.stderr.write(`[smoke-admin-scheduler] fail: ${e.message}\n`);
  process.exit(1);
});
