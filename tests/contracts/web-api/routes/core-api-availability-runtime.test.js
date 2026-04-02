"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../../test-support/module-contract-helper.js");

const TARGET_REL = "web/routes/core/core-api-availability-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
const { handleCheckAvailabilityRoute } = runtime;
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
  return {
    req: { method },
    res,
    pathname,
  };
}

function requireJsonBody(_req, res) {
  return new Promise((resolve) => {
    resolve(requireJsonBody._body);
  });
}

function buildDeps(users = []) {
  return {
    json,
    requireJsonBody,
    allUsers: () => users,
  };
}

function parseBody(res) {
  return JSON.parse(res.body);
}

// --------------- tests ---------------

// 1. Wrong pathname — returns false (not handled)
{
  const ctx = buildCtx("POST", "/api/other");
  const result = handleCheckAvailabilityRoute(ctx, buildDeps());
  assert.strictEqual(result, false, "should return false for non-matching route");
}

// 2. Wrong method — returns false
{
  const ctx = buildCtx("GET", "/api/check-availability");
  const result = handleCheckAvailabilityRoute(ctx, buildDeps());
  assert.strictEqual(result, false, "should return false for GET");
}

(async () => {
  // 3. Empty email — returns emailTaken false
  {
    requireJsonBody._body = { email: "" };
    const ctx = buildCtx("POST", "/api/check-availability");
    const deps = buildDeps([]);
    const result = await handleCheckAvailabilityRoute(ctx, deps);
    assert.strictEqual(result, true, "should handle the route");
    const body = parseBody(ctx.res);
    assert.strictEqual(body.emailTaken, false);
  }

  // 4. Email not taken — returns emailTaken: false
  {
    requireJsonBody._body = { email: "new@example.com" };
    const ctx = buildCtx("POST", "/api/check-availability");
    const deps = buildDeps([
      { email: "existing@example.com", telegram: "" },
    ]);
    const result = await handleCheckAvailabilityRoute(ctx, deps);
    assert.strictEqual(result, true);
    const body = parseBody(ctx.res);
    assert.strictEqual(body.emailTaken, false);
  }

  // 5. Email taken — returns emailTaken: true (case-insensitive)
  {
    requireJsonBody._body = { email: "Existing@Example.com" };
    const ctx = buildCtx("POST", "/api/check-availability");
    const deps = buildDeps([
      { email: "existing@example.com", telegram: "" },
    ]);
    const result = await handleCheckAvailabilityRoute(ctx, deps);
    assert.strictEqual(result, true);
    const body = parseBody(ctx.res);
    assert.strictEqual(body.emailTaken, true, "case-insensitive email match");
  }

  // 6. Telegram input is ignored in email-only MVP
  {
    requireJsonBody._body = { email: "new@example.com", telegram: "@MyHandle" };
    const ctx = buildCtx("POST", "/api/check-availability");
    const deps = buildDeps([
      { email: "other@example.com", telegram: "myhandle" },
    ]);
    const result = await handleCheckAvailabilityRoute(ctx, deps);
    assert.strictEqual(result, true);
    const body = parseBody(ctx.res);
    assert.strictEqual(body.emailTaken, false);
    assert.deepStrictEqual(Object.keys(body), ["emailTaken"]);
  }

  // 7. Only email availability is reported
  {
    requireJsonBody._body = { email: "taken@example.com", telegram: "takenHandle" };
    const ctx = buildCtx("POST", "/api/check-availability");
    const deps = buildDeps([
      { email: "taken@example.com", telegram: "takenhandle" },
    ]);
    const result = await handleCheckAvailabilityRoute(ctx, deps);
    assert.strictEqual(result, true);
    const body = parseBody(ctx.res);
    assert.strictEqual(body.emailTaken, true);
  }

  // 8. No telegram field — email only
  {
    requireJsonBody._body = { email: "new@example.com" };
    const ctx = buildCtx("POST", "/api/check-availability");
    const deps = buildDeps([
      { email: "other@example.com", telegram: "somehandle" },
    ]);
    const result = await handleCheckAvailabilityRoute(ctx, deps);
    assert.strictEqual(result, true);
    const body = parseBody(ctx.res);
    assert.strictEqual(body.emailTaken, false);
    assert.deepStrictEqual(Object.keys(body), ["emailTaken"]);
  }

  process.stdout.write("[availability-runtime] all assertions passed\n");
})();
