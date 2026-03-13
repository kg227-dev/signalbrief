"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../../test-support/module-contract-helper.js");

const TARGET_REL = "web/routes/core-api-unsubscribe-actions-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
const {
  createUnsubscribeActions,
  resolveLegacyUnsubscribePolicyFromEnv,
  LEGACY_UNSUBSCRIBE_RETIRED_CODE,
} = runtime;
assertModuleExports(() => runtime, TARGET_REL);

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
  return { status, data };
}

function buildCtx(method, rawUrl) {
  const url = new URL(rawUrl, "http://localhost");
  return {
    req: { method },
    res: buildMockRes(),
    url,
    pathname: url.pathname,
  };
}

(async () => {
  const users = [
    { chatId: "chat-1", email: "user@example.com", token: "token-1", status: "active", preferences: {} },
  ];

  {
    const writes = [];
    const actions = createUnsubscribeActions({
      json,
      findUserByToken: (token) => users.find((user) => user.token === token) || null,
      signUnsubEmail: () => "legacy-sig",
      verifyUnsubEmailSignature: (email, sig) => email === "user@example.com" && sig === "valid-sig",
      allUsers: () => users,
      writeUser: (chatId, payload) => writes.push({ chatId, payload }),
      blankReengagementState: () => ({}),
      resolveLegacyUnsubscribePolicy: () => ({ enabled: true, reason: "test", retireAfterUtc: null }),
    });
    const ctx = buildCtx("GET", "/api/unsubscribe/legacy?email=user%40example.com&sig=valid-sig");
    const handled = await actions.handleUnsubscribeLegacy(ctx);
    assert.strictEqual(handled, true);
    assert.strictEqual(ctx.res.statusCode, 302);
    assert.ok(String(ctx.res.headers.Location || "").includes("/settings?token=token-1&unsubscribed=1"));
    assert.strictEqual(writes.length, 1, "legacy unsubscribe should persist unsubscribed status");
  }

  {
    const actions = createUnsubscribeActions({
      json,
      findUserByToken: () => users[0],
      signUnsubEmail: () => "legacy-sig",
      verifyUnsubEmailSignature: () => true,
      allUsers: () => users,
      writeUser: () => {},
      blankReengagementState: () => ({}),
      resolveLegacyUnsubscribePolicy: () => ({
        enabled: false,
        reason: "deadline_passed",
        retireAfterUtc: "2026-06-30T00:00:00Z",
      }),
    });
    const legacyCtx = buildCtx("GET", "/api/unsubscribe/legacy?email=user%40example.com&sig=valid-sig");
    await actions.handleUnsubscribeLegacy(legacyCtx);
    assert.strictEqual(legacyCtx.res.statusCode, 410);
    const legacyBody = JSON.parse(legacyCtx.res.body);
    assert.strictEqual(legacyBody.code, LEGACY_UNSUBSCRIBE_RETIRED_CODE);

    const compatEmailCtx = buildCtx("POST", "/api/unsubscribe?email=user%40example.com&sig=valid-sig");
    await actions.handleUnsubscribeCompat(compatEmailCtx);
    assert.strictEqual(compatEmailCtx.res.statusCode, 410, "legacy email+sig compat should retire with 410");

    const compatTokenCtx = buildCtx("POST", "/api/unsubscribe?token=token-1");
    await actions.handleUnsubscribeCompat(compatTokenCtx);
    assert.strictEqual(compatTokenCtx.res.statusCode, 200, "token compat path should continue to work");
  }

  {
    const originalRetireAfter = process.env.UNSUBSCRIBE_LEGACY_RETIRE_AFTER_UTC;
    const originalForceEnable = process.env.UNSUBSCRIBE_LEGACY_FORCE_ENABLE;
    const originalForceDisable = process.env.UNSUBSCRIBE_LEGACY_FORCE_DISABLE;
    try {
      process.env.UNSUBSCRIBE_LEGACY_RETIRE_AFTER_UTC = "2020-01-01T00:00:00Z";
      delete process.env.UNSUBSCRIBE_LEGACY_FORCE_ENABLE;
      delete process.env.UNSUBSCRIBE_LEGACY_FORCE_DISABLE;
      const retired = resolveLegacyUnsubscribePolicyFromEnv(Date.parse("2026-01-01T00:00:00Z"));
      assert.strictEqual(retired.enabled, false);

      process.env.UNSUBSCRIBE_LEGACY_FORCE_ENABLE = "1";
      const forced = resolveLegacyUnsubscribePolicyFromEnv(Date.parse("2026-01-01T00:00:00Z"));
      assert.strictEqual(forced.enabled, true);
    } finally {
      if (originalRetireAfter == null) delete process.env.UNSUBSCRIBE_LEGACY_RETIRE_AFTER_UTC;
      else process.env.UNSUBSCRIBE_LEGACY_RETIRE_AFTER_UTC = originalRetireAfter;
      if (originalForceEnable == null) delete process.env.UNSUBSCRIBE_LEGACY_FORCE_ENABLE;
      else process.env.UNSUBSCRIBE_LEGACY_FORCE_ENABLE = originalForceEnable;
      if (originalForceDisable == null) delete process.env.UNSUBSCRIBE_LEGACY_FORCE_DISABLE;
      else process.env.UNSUBSCRIBE_LEGACY_FORCE_DISABLE = originalForceDisable;
    }
  }
})().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
