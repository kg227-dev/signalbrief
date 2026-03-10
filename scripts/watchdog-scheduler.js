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

function healthLooksGood(response) {
  if (!response || typeof response !== "object") return false;
  return response.status === 200 && response.data && response.data.ok === true;
}

async function checkHealth() {
  const response = await fetchJson(HEALTH_URL, HEALTH_TIMEOUT_MS);
  const summary = response?.data?.scheduler?.summary || "no summary";
  return {
    ok: healthLooksGood(response),
    response,
    summary,
  };
}

async function main() {
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
    log(`healthy (${health.summary})`);
    process.exit(0);
  }

  if (!AUTO_RESTART) {
    const detail = health ? JSON.stringify(health.response.data || {}, null, 2) : "health endpoint unavailable";
    error(`unhealthy and auto-restart disabled\n${detail}`);
    process.exit(2);
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

  let postRestart;
  try {
    postRestart = await checkHealth();
  } catch (err) {
    error(`post-restart health check failed: ${err.message}`);
    process.exit(4);
  }

  if (!postRestart.ok) {
    error(`still unhealthy after restart\n${JSON.stringify(postRestart.response.data || {}, null, 2)}`);
    process.exit(4);
  }

  log(`recovered (${postRestart.summary})`);
}

main().catch((err) => {
  error(err.message || String(err));
  process.exit(1);
});
