"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../../test-support/module-contract-helper.js");

const TARGET_REL = "web/routes/core/core-api-health-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
const { handleHealthRoute } = runtime;
assertModuleExports(() => runtime, TARGET_REL);

// --------------- helpers ---------------

function buildMockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: "",
    headersSent: false,
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      this.headers = { ...headers };
      this.headersSent = true;
    },
    end(body = "") {
      this.body = String(body || "");
      return this.body;
    },
  };
}

function json(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function buildCtx(method, pathname) {
  const res = buildMockRes();
  return { req: { method }, res, pathname };
}

function parseBody(res) {
  return JSON.parse(res.body);
}

// --------------- tests ---------------

// 1. Wrong pathname — not handled
{
  const ctx = buildCtx("GET", "/api/other");
  const result = handleHealthRoute(ctx, { json });
  assert.strictEqual(result, false, "non-matching route returns false");
}

// 2. Wrong method — not handled
{
  const ctx = buildCtx("POST", "/api/health");
  const result = handleHealthRoute(ctx, { json });
  assert.strictEqual(result, false, "POST returns false");
}

// 3. Healthy state — scheduler healthy, lock clean
{
  const ctx = buildCtx("GET", "/api/health");
  const deps = {
    json,
    getCachedOrRefreshSchedulerHeartbeat: () => ({
      available: true,
      healthy: true,
      blocked: false,
      age_seconds: 120,
      status: "ok",
    }),
    digestRunStatus: () => ({
      running: false,
      state: "idle",
      lock: {},
    }),
  };
  const result = handleHealthRoute(ctx, deps);
  assert.strictEqual(result, true);
  assert.strictEqual(ctx.res.statusCode, 200, "healthy returns 200");
  const body = parseBody(ctx.res);
  assert.strictEqual(body.ok, true);
  assert.strictEqual(body.status, "healthy");
  assert.strictEqual(body.problems, undefined, "no problems when healthy");
  assert.strictEqual(body.subsystems.scheduler.healthy, true);
  assert.strictEqual(body.subsystems.digest_lock.healthy, true);
}

// 4. Scheduler unhealthy — returns 503
{
  const ctx = buildCtx("GET", "/api/health");
  const deps = {
    json,
    getCachedOrRefreshSchedulerHeartbeat: () => ({
      available: true,
      healthy: false,
      blocked: false,
      age_seconds: 900,
      status: "stale",
    }),
    digestRunStatus: () => ({ running: false, state: "idle", lock: {} }),
  };
  handleHealthRoute(ctx, deps);
  assert.strictEqual(ctx.res.statusCode, 503, "unhealthy scheduler returns 503");
  const body = parseBody(ctx.res);
  assert.strictEqual(body.ok, false);
  assert.strictEqual(body.status, "degraded");
  assert.ok(body.problems.includes("scheduler_unhealthy"), "reports scheduler_unhealthy");
}

// 5. Scheduler blocked — returns 503
{
  const ctx = buildCtx("GET", "/api/health");
  const deps = {
    json,
    getCachedOrRefreshSchedulerHeartbeat: () => ({
      available: true,
      healthy: true,
      blocked: true,
      status: "blocked",
    }),
    digestRunStatus: () => ({ running: false, state: "idle", lock: {} }),
  };
  handleHealthRoute(ctx, deps);
  assert.strictEqual(ctx.res.statusCode, 503);
  const body = parseBody(ctx.res);
  assert.ok(body.problems.includes("scheduler_blocked"));
}

// 6. Corrupt digest lock — returns 503
{
  const ctx = buildCtx("GET", "/api/health");
  const deps = {
    json,
    getCachedOrRefreshSchedulerHeartbeat: () => ({
      available: true,
      healthy: true,
      blocked: false,
    }),
    digestRunStatus: () => ({ running: false, state: "corrupt", lock: {} }),
  };
  handleHealthRoute(ctx, deps);
  assert.strictEqual(ctx.res.statusCode, 503);
  const body = parseBody(ctx.res);
  assert.ok(body.problems.includes("digest_lock_corrupt"));
  assert.strictEqual(body.subsystems.digest_lock.healthy, false);
}

// 7. Scheduler unavailable (null heartbeat) — returns 503
{
  const ctx = buildCtx("GET", "/api/health");
  const deps = {
    json,
    getCachedOrRefreshSchedulerHeartbeat: () => null,
    digestRunStatus: () => ({ running: false, state: "idle", lock: {} }),
  };
  handleHealthRoute(ctx, deps);
  assert.strictEqual(ctx.res.statusCode, 503);
  const body = parseBody(ctx.res);
  assert.ok(body.problems.includes("scheduler_unavailable"));
}

// 8. Missing deps — graceful degradation
{
  const ctx = buildCtx("GET", "/api/health");
  const deps = { json };
  handleHealthRoute(ctx, deps);
  assert.strictEqual(ctx.res.statusCode, 503, "missing deps degrades to 503");
  const body = parseBody(ctx.res);
  assert.strictEqual(body.ok, false);
}

process.stdout.write("[health-runtime] all assertions passed\n");
