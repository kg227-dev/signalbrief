#!/usr/bin/env node
"use strict";

const { execSync, spawnSync } = require("child_process");
const http = require("http");
const https = require("https");

const REQUIRED_SERVICES = ["web", "bot", "worker"];
const HEALTH_URL = process.env.SCHEDULER_HEALTH_URL || "http://127.0.0.1:3003/api/health/scheduler";
const HEALTH_TIMEOUT_MS = Math.max(1000, Number(process.env.SCHEDULER_HEALTH_TIMEOUT_MS || 5000));
const CANARY_CMD = process.env.DIGEST_CANARY_CMD || "node src/entrypoints/digest.js --dry-run";
const SKIP_CANARY = process.argv.includes("--skip-canary");

function log(message) {
  process.stdout.write(`[verify-runtime] ${message}\n`);
}

function fail(message, detail) {
  process.stderr.write(`[verify-runtime] FAIL: ${message}\n`);
  if (detail) process.stderr.write(`${detail}\n`);
  process.exit(1);
}

function runCommand(command) {
  try {
    const stdout = execSync(command, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, stdout };
  } catch (error) {
    return {
      ok: false,
      code: Number(error?.status || 1),
      stdout: String(error?.stdout || ""),
      stderr: String(error?.stderr || error?.message || ""),
    };
  }
}

function parseComposePsRows(rawOutput) {
  const trimmed = String(rawOutput || "").trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [];
  }

  const rows = [];
  for (const line of trimmed.split(/\r?\n/)) {
    const value = line.trim();
    if (!value) continue;
    rows.push(JSON.parse(value));
  }
  return rows;
}

function rowServiceName(row) {
  return String(row?.Service || row?.Name || "").trim();
}

function rowState(row) {
  return String(row?.State || row?.Status || "").toLowerCase().trim();
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

function runCanary(command) {
  return spawnSync("/bin/zsh", ["-lc", command], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function main() {
  log("Checking compose service definitions");
  const declaredRes = runCommand("docker compose config --services");
  if (!declaredRes.ok) {
    fail("unable to read docker compose services", declaredRes.stderr || declaredRes.stdout);
  }
  const declaredServices = declaredRes.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const missingDeclared = REQUIRED_SERVICES.filter((service) => !declaredServices.includes(service));
  if (missingDeclared.length > 0) {
    fail(
      `missing required services in compose: ${missingDeclared.join(", ")}`,
      `declared services: ${declaredServices.join(", ")}`
    );
  }

  log("Checking required services are running");
  const psRes = runCommand("docker compose ps --format json");
  if (!psRes.ok) {
    fail("unable to inspect docker compose process state", psRes.stderr || psRes.stdout);
  }

  let rows = [];
  try {
    rows = parseComposePsRows(psRes.stdout);
  } catch (error) {
    fail("unable to parse docker compose process output", error.message);
  }

  const rowsByService = new Map();
  for (const row of rows) {
    const name = rowServiceName(row);
    if (!name) continue;
    rowsByService.set(name, row);
  }

  const notRunning = [];
  for (const service of REQUIRED_SERVICES) {
    const row = rowsByService.get(service);
    if (!row) {
      notRunning.push(`${service} (missing)`);
      continue;
    }
    const state = rowState(row);
    if (!state.includes("running")) {
      notRunning.push(`${service} (${state || "unknown"})`);
    }
  }

  if (notRunning.length > 0) {
    const snapshot = rows
      .map((row) => `${rowServiceName(row)}=${rowState(row) || "unknown"}`)
      .join(", ");
    fail(`required services not running: ${notRunning.join(", ")}`, snapshot);
  }

  log(`Checking scheduler health endpoint: ${HEALTH_URL}`);
  let healthResponse;
  try {
    healthResponse = await fetchJson(HEALTH_URL, HEALTH_TIMEOUT_MS);
  } catch (error) {
    fail(`scheduler health request failed: ${error.message}`);
  }

  if (!healthResponse.data || typeof healthResponse.data !== "object") {
    fail("scheduler health response is malformed");
  }
  if (healthResponse.status !== 200 || healthResponse.data.ok !== true) {
    fail(
      `scheduler health is not OK (status=${healthResponse.status}, ok=${healthResponse.data.ok})`,
      JSON.stringify(healthResponse.data, null, 2)
    );
  }
  log(`scheduler summary: ${healthResponse.data?.scheduler?.summary || "ok"}`);

  if (!SKIP_CANARY) {
    log(`Running canary command: ${CANARY_CMD}`);
    const canary = runCanary(CANARY_CMD);
    if (canary.status !== 0) {
      const detail = [
        String(canary.stdout || "").trim(),
        String(canary.stderr || "").trim(),
      ].filter(Boolean).join("\n");
      fail(`canary command failed (exit=${Number(canary.status || 1)})`, detail);
    }
  }

  log("OK");
}

main().catch((error) => {
  fail(error.message || String(error));
});
