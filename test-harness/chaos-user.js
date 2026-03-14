#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const SERVER = path.join(ROOT, "web", "server.js");
const DEFAULT_PORT = 3996;

function parseArgs(argv) {
  const options = {
    port: DEFAULT_PORT,
    keepData: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || "").trim();
    if (token === "--keep-data") {
      options.keepData = true;
      continue;
    }
    if (token === "--port") {
      const next = Number(argv[i + 1]);
      if (!Number.isFinite(next) || next <= 0) {
        throw new Error("--port requires a positive number");
      }
      options.port = Math.floor(next);
      i += 1;
    }
  }

  return options;
}

function log(message) {
  process.stdout.write(`[chaos-user] ${message}\n`);
}

function fail(message) {
  throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, opts = {}) {
  const timeoutMs = Math.max(1000, Number(opts.timeoutMs || 20000));
  const pollMs = Math.max(50, Number(opts.pollMs || 200));
  const start = Date.now();
  let lastError = null;

  while ((Date.now() - start) < timeoutMs) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(pollMs);
  }

  if (lastError) throw lastError;
  throw new Error(`timed out after ${timeoutMs}ms`);
}

function tail(text, lineCount = 40) {
  return String(text || "")
    .trim()
    .split(/\r?\n/)
    .slice(-lineCount)
    .join("\n");
}

async function readResponse(response) {
  const text = await response.text();
  let data = null;
  try {
    data = JSON.parse(text || "{}");
  } catch {
    data = null;
  }
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    text,
    data,
  };
}

async function request(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: options.method || "GET",
    headers: options.headers || {},
    body: options.body,
    redirect: options.redirect || "follow",
  });
  return readResponse(response);
}

function expectStatus(response, expected, label) {
  const accepted = Array.isArray(expected) ? expected : [expected];
  if (!accepted.includes(response.status)) {
    fail(`${label}: expected status ${accepted.join(" or ")}, got ${response.status}; body=${response.text}`);
  }
}

function expect(condition, label) {
  if (!condition) fail(label);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "signalbrief-chaos-"));
  const dataDir = path.join(tempRoot, "data");
  const heartbeatFile = path.join(tempRoot, "scheduler-heartbeat.json");
  const baseUrl = `http://127.0.0.1:${options.port}`;
  const results = [];

  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(heartbeatFile, JSON.stringify({
    worker: "scheduler-worker",
    updated_at: new Date().toISOString(),
    poll_ms: 300000,
    in_flight: false,
    status: "chaos_seed",
    blocked: false,
  }, null, 2));

  const child = spawn(process.execPath, [SERVER], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(options.port),
      BASE_URL: baseUrl,
      NODE_ENV: "test",
      ADMIN_LOCAL_BYPASS: "1",
      ALLOW_EXAMPLE_SIGNUPS: "1",
      SIGNALBRIEF_DATA_DIR: dataDir,
      SCHEDULER_HEARTBEAT_FILE: heartbeatFile,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  let childExit = null;
  child.stdout.on("data", (chunk) => { stdout += String(chunk); });
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  child.on("exit", (code, signal) => {
    childExit = { code, signal };
  });

  async function cleanup() {
    if (!childExit) {
      child.kill("SIGTERM");
      await waitFor(() => childExit, { timeoutMs: 2000, pollMs: 100 }).catch(() => null);
    }
    if (!options.keepData) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }

  async function runCase(name, fn) {
    try {
      await fn();
      results.push({ name, ok: true });
      log(`PASS ${name}`);
    } catch (error) {
      results.push({ name, ok: false, error: error.message });
      log(`FAIL ${name}: ${error.message}`);
    }
  }

  try {
    await waitFor(async () => {
      if (childExit) {
        fail(`web server exited early code=${childExit.code} signal=${childExit.signal}`);
      }
      const response = await request(baseUrl, "/api/topics");
      return response.status === 200 ? response : null;
    }, { timeoutMs: 20000, pollMs: 250 });

    const uniqueSeed = `${Date.now()}-${process.pid}`;
    const primarySignup = {
      name: "Chaos User",
      email: `chaos+${uniqueSeed}@example.com`,
      telegram: `chaos_${uniqueSeed}`.slice(0, 30),
      topics: ["AI×TECH", "HEALTHCARE"],
      delivery_time: "07:00",
      frequency: "daily_weekday",
      items_per_digest: 5,
    };
    const secondarySignup = {
      name: "Conflict User",
      email: `conflict+${uniqueSeed}@example.com`,
      telegram: `conflict_${uniqueSeed}`.slice(0, 30),
      topics: ["AI×TECH", "STRATEGY"],
      delivery_time: "08:00",
      frequency: "daily_weekday",
      items_per_digest: 5,
    };

    let primaryToken = "";
    let secondaryToken = "";

    await runCase("reject invalid JSON", async () => {
      const response = await request(baseUrl, "/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{bad-json",
      });
      expectStatus(response, 400, "invalid JSON");
      expect(response.data && response.data.code === "invalid_json", "invalid JSON should return code=invalid_json");
    });

    await runCase("reject oversized payload", async () => {
      const response = await request(baseUrl, "/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "x".repeat((1024 * 1024) + 1),
      });
      expectStatus(response, 413, "oversized payload");
      expect(response.data && response.data.code === "payload_too_large", "oversized payload should return code=payload_too_large");
    });

    await runCase("reject missing user token", async () => {
      const response = await request(baseUrl, "/api/user");
      expectStatus(response, 400, "missing user token");
    });

    await runCase("reject unknown user token", async () => {
      const response = await request(baseUrl, `/api/user?token=${"a".repeat(64)}`);
      expectStatus(response, 404, "unknown user token");
    });

    await runCase("create primary example user", async () => {
      const response = await request(baseUrl, "/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(primarySignup),
      });
      expectStatus(response, [200, 202], "primary signup");
      expect(response.data && response.data.account_created === true, "primary signup should create account");
      expect(typeof response.data.token === "string" && response.data.token.length > 20, "primary signup should return token");
      primaryToken = response.data.token;
    });

    await runCase("load settings page for primary user", async () => {
      const response = await request(baseUrl, `/settings?token=${encodeURIComponent(primaryToken)}`);
      expectStatus(response, 200, "settings page");
      expect(response.text.includes("SignalBrief"), "settings page should render app shell");
    });

    await runCase("load archive page for primary user", async () => {
      const response = await request(baseUrl, `/archive?token=${encodeURIComponent(primaryToken)}`);
      expectStatus(response, 200, "archive page");
      expect(response.text.includes("archive"), "archive page should render");
    });

    await runCase("read primary user state", async () => {
      const response = await request(baseUrl, `/api/user?token=${encodeURIComponent(primaryToken)}`);
      expectStatus(response, 200, "read primary user");
      expect(response.data && response.data.email === primarySignup.email.toLowerCase(), "primary user email should round-trip");
    });

    await runCase("reject duplicate signup", async () => {
      const response = await request(baseUrl, "/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(primarySignup),
      });
      expectStatus(response, 429, "duplicate signup cooldown");
    });

    await runCase("reject invalid email signup", async () => {
      const response = await request(baseUrl, "/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...primarySignup,
          email: "not-an-email",
        }),
      });
      expectStatus(response, 400, "invalid email signup");
    });

    await runCase("reject one-topic signup", async () => {
      const response = await request(baseUrl, "/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...primarySignup,
          email: `short-topic+${uniqueSeed}@example.com`,
          telegram: `short_${uniqueSeed}`.slice(0, 30),
          topics: ["AI×TECH"],
        }),
      });
      expectStatus(response, 400, "one-topic signup");
    });

    await runCase("reject non-array topics signup", async () => {
      const response = await request(baseUrl, "/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...primarySignup,
          email: `bad-topics+${uniqueSeed}@example.com`,
          telegram: `bad_topics_${uniqueSeed}`.slice(0, 30),
          topics: "AI×TECH",
        }),
      });
      expectStatus(response, 400, "non-array topics signup");
    });

    await runCase("create second user for conflict checks", async () => {
      const response = await request(baseUrl, "/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(secondarySignup),
      });
      expectStatus(response, [200, 202], "secondary signup");
      expect(response.data && typeof response.data.token === "string", "secondary signup should return token");
      secondaryToken = response.data.token;
    });

    await runCase("reject missing settings token", async () => {
      const response = await request(baseUrl, "/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "missing@example.com" }),
      });
      expectStatus(response, 400, "missing settings token");
    });

    await runCase("reject invalid settings token", async () => {
      const response = await request(baseUrl, "/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "bad-token", email: "wrong@example.com" }),
      });
      expectStatus(response, 401, "invalid settings token");
    });

    await runCase("reject invalid settings preference key", async () => {
      const response = await request(baseUrl, "/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: primaryToken,
          preferences: { made_up_flag: true },
        }),
      });
      expectStatus(response, 400, "invalid settings preference key");
    });

    await runCase("reject email conflict in settings", async () => {
      const response = await request(baseUrl, "/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: primaryToken,
          email: secondarySignup.email,
        }),
      });
      expectStatus(response, 409, "email conflict");
    });

    await runCase("reject telegram conflict in settings", async () => {
      const response = await request(baseUrl, "/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: primaryToken,
          telegram: secondarySignup.telegram,
        }),
      });
      expectStatus(response, 409, "telegram conflict");
    });

    await runCase("apply valid settings patch", async () => {
      const response = await request(baseUrl, "/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: primaryToken,
          topics: ["AI×TECH", "STRATEGY", "Markets"],
          preferences: {
            days_of_week: [1, 3, 5],
            items_per_digest: 9,
            timezone: "America/New_York",
            depth: "headline_plus_why",
          },
        }),
      });
      expectStatus(response, 200, "valid settings patch");

      const userResponse = await request(baseUrl, `/api/user?token=${encodeURIComponent(primaryToken)}`);
      expectStatus(userResponse, 200, "read updated user");
      const preferences = userResponse.data && userResponse.data.preferences;
      expect(
        Array.isArray(userResponse.data && userResponse.data.topics)
          && userResponse.data.topics.includes("custom_markets"),
        "updated topics should persist in canonical form"
      );
      expect(preferences && preferences.items_per_digest === 10, "items_per_digest should normalize to 10");
      expect(preferences && preferences.frequency === "custom", "days_of_week patch should set frequency=custom");
    });

    await runCase("reject invalid archive token", async () => {
      const response = await request(baseUrl, "/api/archive?token=bad-token");
      expectStatus(response, 401, "invalid archive token");
    });

    await runCase("serve empty archive for new user", async () => {
      const response = await request(baseUrl, `/api/archive?token=${encodeURIComponent(primaryToken)}`);
      expectStatus(response, 200, "empty archive");
      expect(response.data && Array.isArray(response.data.digests), "archive response should include digests array");
    });

    await runCase("reject missing unsubscribe token", async () => {
      const response = await request(baseUrl, "/api/unsubscribe/one-click", {
        method: "POST",
      });
      expectStatus(response, 400, "missing unsubscribe token");
    });

    await runCase("reject invalid unsubscribe token", async () => {
      const response = await request(baseUrl, "/api/unsubscribe/one-click?token=bad-token", {
        method: "POST",
      });
      expectStatus(response, 401, "invalid unsubscribe token");
    });

    await runCase("pause primary user", async () => {
      const response = await request(baseUrl, `/api/pause?token=${encodeURIComponent(primaryToken)}`, {
        redirect: "manual",
      });
      expectStatus(response, 302, "pause primary user");
      expect(String(response.headers.location || "").includes("paused=1"), "pause should redirect with paused=1");

      const userResponse = await request(baseUrl, `/api/user?token=${encodeURIComponent(primaryToken)}`);
      expectStatus(userResponse, 200, "read paused user");
      expect(userResponse.data && userResponse.data.status === "paused", "paused user should persist");
      expect(userResponse.data && userResponse.data.preferences && userResponse.data.preferences.email_enabled === false, "paused user should disable email");
    });

    await runCase("reactivate primary user", async () => {
      const response = await request(baseUrl, `/api/reactivate?token=${encodeURIComponent(primaryToken)}`, {
        redirect: "manual",
      });
      expectStatus(response, 302, "reactivate primary user");
      expect(String(response.headers.location || "").includes("reactivated=1"), "reactivate should redirect with reactivated=1");

      const userResponse = await request(baseUrl, `/api/user?token=${encodeURIComponent(primaryToken)}`);
      expectStatus(userResponse, 200, "read reactivated user");
      expect(userResponse.data && userResponse.data.status === "active", "reactivated user should be active");
      expect(userResponse.data && userResponse.data.preferences && userResponse.data.preferences.email_enabled === true, "reactivated user should enable email");
    });

    await runCase("unsubscribe primary user", async () => {
      const response = await request(baseUrl, `/api/unsubscribe/one-click?token=${encodeURIComponent(primaryToken)}`, {
        method: "POST",
      });
      expectStatus(response, 200, "unsubscribe primary user");

      const userResponse = await request(baseUrl, `/api/user?token=${encodeURIComponent(primaryToken)}`);
      expectStatus(userResponse, 200, "read unsubscribed user");
      expect(userResponse.data && userResponse.data.status === "unsubscribed", "unsubscribe should persist");
    });

    const failures = results.filter((entry) => !entry.ok);
    const passes = results.length - failures.length;
    log(`summary: ${passes}/${results.length} passed`);
    log(`primary token: ${primaryToken}`);
    if (options.keepData) {
      log(`kept temp data at ${tempRoot}`);
    }

    if (failures.length > 0) {
      const detail = failures.map((entry) => `- ${entry.name}: ${entry.error}`).join("\n");
      fail(`chaos run finished with failures\n${detail}`);
    }
  } catch (error) {
    const detail = [
      error.message,
      stderr.trim() ? `--- server stderr ---\n${tail(stderr)}` : "",
      stdout.trim() ? `--- server stdout ---\n${tail(stdout)}` : "",
    ].filter(Boolean).join("\n");
    process.stderr.write(`${detail}\n`);
    process.exitCode = 1;
  } finally {
    await cleanup();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
