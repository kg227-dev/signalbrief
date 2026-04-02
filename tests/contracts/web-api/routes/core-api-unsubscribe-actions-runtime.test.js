"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../../test-support/module-contract-helper.js");

const TARGET_REL = "web/routes/core/core-api-unsubscribe-actions-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
const {
  createUnsubscribeActions,
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
      writeUser: (chatId, payload) => writes.push({ chatId, payload }),
    });
    const ctx = buildCtx("GET", "/api/unsubscribe/confirm?token=token-1");
    const handled = await actions.handleUnsubscribeConfirm(ctx);
    assert.strictEqual(handled, true);
    assert.strictEqual(ctx.res.statusCode, 302);
    assert.ok(String(ctx.res.headers.Location || "").includes("/settings?token=token-1&unsubscribed=1"));
    assert.strictEqual(writes.length, 1, "confirm unsubscribe should persist unsubscribed status");
  }

  {
    const actions = createUnsubscribeActions({
      json,
      findUserByToken: () => null,
      writeUser: () => {},
    });
    const missingToken = buildCtx("POST", "/api/unsubscribe/one-click");
    await actions.handleUnsubscribeOneClick(missingToken);
    assert.strictEqual(missingToken.res.statusCode, 400);

    const invalidToken = buildCtx("POST", "/api/unsubscribe/one-click?token=bad-token");
    await actions.handleUnsubscribeOneClick(invalidToken);
    assert.strictEqual(invalidToken.res.statusCode, 401);
  }

  {
    const writes = [];
    const actions = createUnsubscribeActions({
      json,
      findUserByToken: (token) => users.find((user) => user.token === token) || null,
      writeUser: (chatId, payload) => writes.push({ chatId, payload }),
    });

    const pauseCtx = buildCtx("GET", "/api/pause?token=token-1");
    await actions.handlePause(pauseCtx);
    assert.strictEqual(pauseCtx.res.statusCode, 302);
    assert.ok(String(pauseCtx.res.headers.Location || "").includes("&paused=1"));
    assert.strictEqual(writes[0].payload.status, "paused");
    assert.strictEqual(writes[0].payload.preferences.email_enabled, false);

    const reactivateCtx = buildCtx("GET", "/api/reactivate?token=token-1");
    await actions.handleReactivate(reactivateCtx);
    assert.strictEqual(reactivateCtx.res.statusCode, 302);
    assert.ok(String(reactivateCtx.res.headers.Location || "").includes("&reactivated=1"));
    assert.strictEqual(writes[1].payload.status, "active");
    assert.strictEqual(writes[1].payload.preferences.email_enabled, true);
  }
})().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
