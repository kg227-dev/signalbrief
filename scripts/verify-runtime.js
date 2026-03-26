#!/usr/bin/env node
"use strict";

const { execSync, spawnSync } = require("child_process");
const http = require("http");
const https = require("https");

const REQUIRED_SERVICES = ["web", "worker"];
const HEALTH_URL = process.env.SCHEDULER_HEALTH_URL || "http://127.0.0.1:3003/api/health/scheduler";
const HEALTH_TIMEOUT_MS = Math.max(1000, Number(process.env.SCHEDULER_HEALTH_TIMEOUT_MS || 5000));
const HEALTH_RETRIES = Math.max(1, Number(process.env.SCHEDULER_HEALTH_RETRIES || 10));
const HEALTH_RETRY_DELAY_MS = Math.max(250, Number(process.env.SCHEDULER_HEALTH_RETRY_DELAY_MS || 2500));
const FAIL_LOG_TAIL_LINES = Math.max(20, Number(process.env.VERIFY_FAIL_LOG_TAIL_LINES || 120));
const CANARY_CMD = process.env.DIGEST_CANARY_CMD || "node src/entrypoints/digest.js --dry-run";
const SKIP_CANARY = process.argv.includes("--skip-canary");
const EXPECTED_STORE_BACKEND = resolveCliOption("--expected-store-backend")
  || process.env.EXPECTED_STORE_BACKEND
  || "";
const EXPECTED_SQLITE_PATH = resolveCliOption("--expected-sqlite-path")
  || process.env.EXPECTED_SQLITE_PATH
  || "";

function resolveCliOption(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return "";
  const next = String(process.argv[index + 1] || "").trim();
  return next && !next.startsWith("--") ? next : "";
}

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function serviceStateSnapshot(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return "no compose services returned";
  return rows
    .map((row) => `${rowServiceName(row) || "unknown"}=${rowState(row) || "unknown"}`)
    .join(", ");
}

function collectFailureDiagnostics() {
  const blocks = [];
  const psRes = runCommand("docker compose ps");
  if (psRes.ok) {
    blocks.push("--- docker compose ps ---");
    blocks.push(String(psRes.stdout || "").trim());
  } else {
    blocks.push("--- docker compose ps (failed) ---");
    blocks.push(String(psRes.stderr || psRes.stdout || "").trim());
  }

  const logsRes = runCommand(`docker compose logs --no-color --tail=${FAIL_LOG_TAIL_LINES} web worker`);
  if (logsRes.ok) {
    blocks.push(`--- docker compose logs --tail=${FAIL_LOG_TAIL_LINES} (web worker) ---`);
    blocks.push(String(logsRes.stdout || "").trim());
  } else {
    blocks.push("--- docker compose logs (failed) ---");
    blocks.push(String(logsRes.stderr || logsRes.stdout || "").trim());
  }

  return blocks.filter(Boolean).join("\n");
}

async function probeSchedulerHealth({ url, timeoutMs, retries, retryDelayMs }) {
  let lastError = null;
  let lastResponse = null;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    log(`Checking scheduler health endpoint (${attempt}/${retries}): ${url}`);
    try {
      const response = await fetchJson(url, timeoutMs);
      lastResponse = response;
      if (response.status === 200 && response?.data?.ok === true) {
        return { ok: true, response };
      }
      log(`scheduler health probe not ready (status=${response.status}, ok=${response?.data?.ok})`);
    } catch (error) {
      lastError = error;
      log(`scheduler health probe error: ${error.message}`);
    }

    if (attempt < retries) {
      await sleep(retryDelayMs);
    }
  }

  return {
    ok: false,
    lastResponse,
    lastError,
  };
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
    const detail = [
      `snapshot: ${serviceStateSnapshot(rows)}`,
      collectFailureDiagnostics(),
    ].join("\n");
    fail(`required services not running: ${notRunning.join(", ")}`, detail);
  }

  const healthProbe = await probeSchedulerHealth({
    url: HEALTH_URL,
    timeoutMs: HEALTH_TIMEOUT_MS,
    retries: HEALTH_RETRIES,
    retryDelayMs: HEALTH_RETRY_DELAY_MS,
  });
  if (!healthProbe.ok) {
    const response = healthProbe.lastResponse;
    const responseBody = response && response.data && typeof response.data === "object"
      ? JSON.stringify(response.data, null, 2)
      : "<no JSON response>";
    const detail = [
      `snapshot: ${serviceStateSnapshot(rows)}`,
      healthProbe.lastError ? `health request error: ${healthProbe.lastError.message}` : "",
      `last health response status: ${Number(response?.status || 0)}`,
      `last health response body: ${responseBody}`,
      collectFailureDiagnostics(),
    ].filter(Boolean).join("\n");
    fail("scheduler health did not become healthy within retry window", detail);
  }

  const healthResponse = healthProbe.response;
  if (!healthResponse.data || typeof healthResponse.data !== "object") {
    const detail = [
      `snapshot: ${serviceStateSnapshot(rows)}`,
      collectFailureDiagnostics(),
    ].join("\n");
    fail("scheduler health response is malformed", detail);
  }
  if (healthResponse.status !== 200 || healthResponse.data.ok !== true) {
    fail(
      `scheduler health is not OK (status=${healthResponse.status}, ok=${healthResponse.data.ok})`,
      [
        JSON.stringify(healthResponse.data, null, 2),
        collectFailureDiagnostics(),
      ].join("\n")
    );
  }
  if (EXPECTED_STORE_BACKEND) {
    const actualStoreBackend = String(healthResponse.data?.runtime_state?.store_backend || "").trim();
    if (actualStoreBackend !== EXPECTED_STORE_BACKEND) {
      fail(
        `expected store backend ${EXPECTED_STORE_BACKEND}, got ${actualStoreBackend || "missing"}`,
        [
          JSON.stringify(healthResponse.data, null, 2),
          collectFailureDiagnostics(),
        ].join("\n")
      );
    }
  }
  if (EXPECTED_SQLITE_PATH && ["sqlite", "canary"].includes(String(EXPECTED_STORE_BACKEND || "").trim().toLowerCase())) {
    const actualSqlitePath = String(healthResponse.data?.runtime_state?.store_sqlite_path || "").trim();
    if (actualSqlitePath !== EXPECTED_SQLITE_PATH) {
      fail(
        `expected sqlite path ${EXPECTED_SQLITE_PATH}, got ${actualSqlitePath || "missing"}`,
        [
          JSON.stringify(healthResponse.data, null, 2),
          collectFailureDiagnostics(),
        ].join("\n")
      );
    }
  }
  log(`scheduler summary: ${healthResponse.data?.scheduler?.summary || "ok"}`);

  if (!SKIP_CANARY) {
    log(`Running canary command: ${CANARY_CMD}`);
    const canary = runCanary(CANARY_CMD);
    if (canary.status !== 0) {
      const detail = [
        String(canary.stdout || "").trim(),
        String(canary.stderr || "").trim(),
        collectFailureDiagnostics(),
      ].filter(Boolean).join("\n");
      fail(`canary command failed (exit=${Number(canary.status || 1)})`, detail);
    }
  }

  log("OK");
}

main().catch((error) => {
  fail(error.message || String(error));
});
