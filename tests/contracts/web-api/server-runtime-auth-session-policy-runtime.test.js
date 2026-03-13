"use strict";

const assert = require("assert");
const crypto = require("crypto");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../test-support/module-contract-helper.js");
const adminAuthRuntime = require(path.join(process.cwd(), "web/admin-auth.js"));

const TARGET_REL = "web/server-runtime-auth-session-policy-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
const { createAdminAuthSessionPolicy } = runtime;
assertModuleExports(() => runtime, TARGET_REL);

function buildReq({ method = "GET", url = "/admin", cookie = "", remoteAddress = "127.0.0.1" } = {}) {
  return {
    method,
    url,
    headers: cookie ? { cookie } : {},
    socket: { remoteAddress },
  };
}

function withEnv(overrides, fn) {
  const keys = Object.keys(overrides || {});
  const previous = {};
  for (const key of keys) {
    previous[key] = process.env[key];
    const value = overrides[key];
    if (value == null) {
      delete process.env[key];
    } else {
      process.env[key] = String(value);
    }
  }
  try {
    return fn();
  } finally {
    for (const key of keys) {
      const value = previous[key];
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const policy = createAdminAuthSessionPolicy();
assert.ok(policy && typeof policy === "object");

{
  const salt = "admin-salt";
  const passwordHash = crypto.scryptSync("secret-pass", salt, 64).toString("hex");
  assert.strictEqual(policy.verifyAdminPassword("secret-pass", { salt, passwordHash }), true);
  assert.strictEqual(policy.verifyAdminPassword("wrong-pass", { salt, passwordHash }), false);
}

{
  adminAuthRuntime.resetAdminAuthState();
  const token = policy.createAdminSession("founder@getsignalbrief.com");
  const req = buildReq({ cookie: `sb_admin=${token}` });
  assert.strictEqual(policy.isAdminAuthed(req), true);
  assert.strictEqual(policy.getAdminActor(req), "founder@getsignalbrief.com");
  assert.strictEqual(policy.clearAdminSessionByRequest(req), true);
  assert.strictEqual(policy.isAdminAuthed(req), false);
}

withEnv({
  ADMIN_LOCAL_BYPASS: "1",
  NODE_ENV: "test",
  SIGNALBRIEF_ENV: null,
  DEPLOY_ENV: null,
  APP_ENV: null,
}, () => {
  adminAuthRuntime.resetAdminAuthState();
  const readReq = buildReq({ url: "/api/admin/stats", method: "GET" });
  const writeReq = buildReq({ url: "/api/admin/stats", method: "POST" });
  const remoteReq = buildReq({ url: "/api/admin/stats", method: "GET", remoteAddress: "10.0.0.9" });
  assert.strictEqual(policy.isAdminAuthed(readReq), true, "local bypass should allow read-only local admin route");
  assert.strictEqual(policy.getAdminActor(readReq), "local-bypass");
  assert.strictEqual(policy.isAdminAuthed(writeReq), false, "local bypass should not allow write method");
  assert.strictEqual(policy.isAdminAuthed(remoteReq), false, "local bypass should reject non-local source IP");
});

withEnv({
  ADMIN_LOCAL_BYPASS: "1",
  NODE_ENV: "production",
  SIGNALBRIEF_ENV: null,
  DEPLOY_ENV: null,
  APP_ENV: null,
}, () => {
  adminAuthRuntime.resetAdminAuthState();
  const req = buildReq({ url: "/api/admin/stats", method: "GET" });
  assert.strictEqual(policy.isAdminAuthed(req), false, "bypass should be disabled in production runtime");
});

{
  adminAuthRuntime.resetAdminAuthState();
  const ip = "203.0.113.42";
  for (let i = 0; i < 5; i += 1) {
    assert.strictEqual(policy.checkLoginRate(ip), false);
  }
  assert.strictEqual(policy.checkLoginRate(ip), true, "6th attempt in window should be rate limited");
  assert.strictEqual(policy.checkLoginRate("203.0.113.99"), false, "separate IP should have independent window");
}
