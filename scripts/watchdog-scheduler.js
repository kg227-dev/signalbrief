#!/usr/bin/env node
"use strict";

const { spawnSync } = require("child_process");
const http = require("http");
const https = require("https");

const HEALTH_URL = process.env.SCHEDULER_HEALTH_URL || "http://127.0.0.1:3003/api/health/scheduler";
const HEALTH_TIMEOUT_MS = Math.max(1000, Number(process.env.SCHEDULER_HEALTH_TIMEOUT_MS || 5000));
const AUTO_RESTART = String(process.env.SCHEDULER_WATCHDOG_AUTO_RESTART || "0") === "1";
const RESTART_CMD = process.env.SCHEDULER_WATCHDOG_RESTART_CMD || "docker compose up -d worker";
const POST_RESTART_WAIT_MS = Math.max(0, Number(process.env.SCHEDULER_WATCHDOG_POST_RESTART_WAIT_MS || 10000));
const POST_RESTART_RETRIES = Math.max(1, Number(process.env.SCHEDULER_WATCHDOG_POST_RESTART_RETRIES || 4));
const POST_RESTART_RETRY_DELAY_MS = Math.max(250, Number(process.env.SCHEDULER_WATCHDOG_POST_RESTART_RETRY_DELAY_MS || 2500));
const RUN_REASON = String(process.env.SCHEDULER_WATCHDOG_RUN_REASON || "scheduled_watchdog").trim() || "scheduled_watchdog";

function log(message) {
  process.stdout.write(`[watchdog-scheduler] ${message}\n`);
}

function error(message) {
  process.stderr.write(`[watchdog-scheduler] ${message}\n`);
}

function fetchJson(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      reject(new Error(`invalid URL: ${url}`));
      return;
    }

    const transport = parsedUrl.protocol === "https:" ? https : http;
    const req = transport.request(parsedUrl, {
      method: "GET",
      timeout: timeoutMs,
      headers: { Accept: "application/json" },
    }, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += String(chunk); });
      res.on("end", () => {
        let data;
        try {
          data = JSON.parse(body || "{}");
        } catch {
          reject(new Error(`non-JSON response from health endpoint (status=${res.statusCode || 0})`));
          return;
        }
        resolve({
          status: Number(res.statusCode || 0),
          data,
        });
      });
    });

    req.on("timeout", () => req.destroy(new Error(`request timed out after ${timeoutMs}ms`)));
    req.on("error", reject);
    req.end();
  });
}

function runRestartCommand(command) {
  return spawnSync("/bin/zsh", ["-lc", command], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function compactJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function analyzeHealth(response) {
  if (!response || typeof response !== "object") {
    return {
      ok: false,
      reasonCode: "endpoint_unavailable",
      reasonDetail: "health endpoint unavailable",
      summary: "health endpoint unavailable",
    };
  }

  const status = Number(response.status || 0);
  const payload = response.data && typeof response.data === "object" ? response.data : {};
  const scheduler = payload.scheduler && typeof payload.scheduler === "object" ? payload.scheduler : {};
  const digestLock = payload.digest_lock && typeof payload.digest_lock === "object" ? payload.digest_lock : {};
  const summary = String(scheduler.summary || "").trim()
    || String(payload.error || "").trim()
    || `HTTP ${status}`;

  if (status === 200 && payload.ok === true && scheduler.healthy === true && !scheduler.blocked && !digestLock.unhealthy) {
    return {
      ok: true,
      reasonCode: "healthy",
      reasonDetail: "scheduler heartbeat healthy",
      summary,
    };
  }

  if (scheduler.available === false) {
    return {
      ok: false,
      reasonCode: "heartbeat_missing",
      reasonDetail: "scheduler heartbeat file missing/unavailable",
      summary,
    };
  }
  if (scheduler.blocked) {
    return {
      ok: false,
      reasonCode: "worker_blocked",
      reasonDetail: "scheduler worker is blocked",
      summary,
    };
  }
  if (digestLock.unhealthy) {
    return {
      ok: false,
      reasonCode: "digest_lock_unhealthy",
      reasonDetail: String(digestLock.state || "digest lock unhealthy"),
      summary,
    };
  }
  if (scheduler.healthy === false) {
    const ageSec = Number(scheduler.age_seconds);
    return {
      ok: false,
      reasonCode: "heartbeat_stale",
      reasonDetail: Number.isFinite(ageSec)
        ? `last heartbeat ${ageSec}s ago`
        : "scheduler heartbeat reported unhealthy",
      summary,
    };
  }
  if (status !== 200) {
    return {
      ok: false,
      reasonCode: "health_http_non_200",
      reasonDetail: `health endpoint status ${status}`,
      summary,
    };
  }
  return {
    ok: false,
    reasonCode: "health_not_ok",
    reasonDetail: `ok=${payload.ok}`,
    summary,
  };
}

function healthDebug(health) {
  if (!health) return "health result unavailable";
  const response = health.response && typeof health.response === "object"
    ? health.response
    : null;
  const lines = [
    `reason_code=${health.reasonCode || "unknown"}`,
    `reason_detail=${health.reasonDetail || "-"}`,
    `summary=${health.summary || "-"}`,
    `status=${Number(response?.status || 0)}`,
  ];
  if (response && response.data && typeof response.data === "object") {
    lines.push(`payload=${compactJson(response.data)}`);
  }
  return lines.join("\n");
}

async function checkHealth() {
  const response = await fetchJson(HEALTH_URL, HEALTH_TIMEOUT_MS);
  const analysis = analyzeHealth(response);
  return {
    ok: analysis.ok,
    response,
    summary: analysis.summary,
    reasonCode: analysis.reasonCode,
    reasonDetail: analysis.reasonDetail,
  };
}

async function checkHealthWithRetries({ attempts, delayMs, label }) {
  let last = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const health = await checkHealth();
      last = health;
      if (health.ok) {
        return {
          ok: true,
          attempt,
          health,
        };
      }
      log(
        `${label} attempt ${attempt}/${attempts}: unhealthy`
        + ` reason=${health.reasonCode || "unknown"}`
        + ` detail=${health.reasonDetail || "-"}`
        + ` summary=${health.summary || "-"}`
      );
    } catch (err) {
      last = {
        ok: false,
        response: null,
        summary: "health request failed",
        reasonCode: "health_request_error",
        reasonDetail: err.message || String(err),
      };
      log(`${label} attempt ${attempt}/${attempts}: request error (${last.reasonDetail})`);
    }

    if (attempt < attempts && delayMs > 0) {
      await sleep(delayMs);
    }
  }

  return {
    ok: false,
    attempt: attempts,
    health: last,
  };
}

async function main() {
  const runId = `${Date.now().toString(36)}-${process.pid}`;
  log(`start run_id=${runId} run_reason=${RUN_REASON} auto_restart=${AUTO_RESTART ? "1" : "0"}`);
  log(`checking scheduler health: ${HEALTH_URL}`);
  let health;
  try {
    health = await checkHealth();
  } catch (err) {
    error(`health check failed: ${err.message}`);
    if (!AUTO_RESTART) process.exit(2);
    health = null;
  }

  if (health && health.ok) {
    log(`healthy (${health.summary}) reason=${health.reasonCode} run_reason=${RUN_REASON}`);
    process.exit(0);
  }

  if (!AUTO_RESTART) {
    const detail = health ? healthDebug(health) : "health endpoint unavailable";
    error(`unhealthy and auto-restart disabled\n${detail}`);
    process.exit(2);
  }

  if (health) {
    log(
      `unhealthy: reason=${health.reasonCode || "unknown"}`
      + ` detail=${health.reasonDetail || "-"}`
      + ` summary=${health.summary || "-"}`
    );
  }
  log(`unhealthy; restarting worker via: ${RESTART_CMD}`);
  const restart = runRestartCommand(RESTART_CMD);
  if (restart.status !== 0) {
    const detail = [
      String(restart.stdout || "").trim(),
      String(restart.stderr || "").trim(),
    ].filter(Boolean).join("\n");
    error(`restart command failed (exit=${Number(restart.status || 1)})\n${detail}`);
    process.exit(3);
  }

  if (POST_RESTART_WAIT_MS > 0) {
    log(`waiting ${POST_RESTART_WAIT_MS}ms for worker recovery`);
    await sleep(POST_RESTART_WAIT_MS);
  }

  const postRestart = await checkHealthWithRetries({
    attempts: POST_RESTART_RETRIES,
    delayMs: POST_RESTART_RETRY_DELAY_MS,
    label: "post-restart health check",
  });
  if (!postRestart.ok) {
    error(`still unhealthy after restart\n${healthDebug(postRestart.health)}`);
    process.exit(4);
  }

  log(
    `recovered (${postRestart.health.summary})`
    + ` reason=${postRestart.health.reasonCode}`
    + ` run_reason=${RUN_REASON}`
    + ` attempts=${postRestart.attempt}`
  );
}

main().catch((err) => {
  error(err.message || String(err));
  process.exit(1);
});
