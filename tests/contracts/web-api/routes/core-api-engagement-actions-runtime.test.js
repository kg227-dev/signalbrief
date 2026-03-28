"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../../test-support/module-contract-helper.js");

const TARGET_REL = "web/routes/core-api-engagement-actions-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
const { handleTrackingPixelRoute, handleClickRedirectRoute } = runtime;
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
      this.headers = { ...this.headers, ...headers };
      this.headersSent = true;
    },
    end(body = "") {
      this.body = String(body || "");
    },
  };
}

function json(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function buildBaseDeps(overrides = {}) {
  return {
    json,
    decodeDigestIdParam: (encoded) => Buffer.from(encoded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
    buildDigestId: (date, chatId) => `${date}:${chatId}`,
    toEtDateKey: () => "2026-03-16",
    appendEngagementEventChecked: overrides.appendEngagementEventChecked || (() => {}),
    sendTransparentGif: overrides.sendTransparentGif || ((res) => { res.writeHead(200, { "Content-Type": "image/gif" }); res.end(); }),
    findUserByToken: overrides.findUserByToken || (() => null),
    normalizeEngagementUrl: overrides.normalizeEngagementUrl || ((u) => String(u || "").toLowerCase()),
    writeUser: overrides.writeUser || (() => {}),
    ...overrides,
  };
}

// --------------- handleTrackingPixelRoute ---------------

// wrong pathname — not handled
{
  const res = buildMockRes();
  const ctx = { req: { method: "GET" }, res, pathname: "/api/other" };
  const result = handleTrackingPixelRoute({ ctx, deps: buildBaseDeps() });
  assert.strictEqual(result, false, "non-matching pathname should return false");
}

// valid tracking pixel — serves gif even without user
{
  let gifSent = false;
  const res = buildMockRes();
  const digestId = Buffer.from("2026-03-16:123").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  const token = "a".repeat(64);
  const ctx = { req: { method: "GET" }, res, pathname: `/t/${digestId}/${token}/o.gif` };
  const deps = buildBaseDeps({
    sendTransparentGif: (r) => { gifSent = true; r.end(); },
  });
  const result = handleTrackingPixelRoute({ ctx, deps });
  assert.strictEqual(result, true, "should handle tracking pixel route");
  assert.strictEqual(gifSent, true, "should serve transparent gif");
}

// valid tracking pixel with known user — records engagement
{
  const events = [];
  let writtenUser = null;
  const res = buildMockRes();
  const digestId = Buffer.from("2026-03-16:456").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  const token = "b".repeat(64);
  const ctx = { req: { method: "GET" }, res, pathname: `/t/${digestId}/${token}/o.gif` };
  const deps = buildBaseDeps({
    findUserByToken: () => ({ chatId: "456", email: "test@x.com", email_opens_total: 5 }),
    appendEngagementEventChecked: (evt) => events.push(evt),
    writeUser: (_id, u) => { writtenUser = u; },
    sendTransparentGif: (r) => { r.end(); },
  });
  handleTrackingPixelRoute({ ctx, deps });
  assert.strictEqual(events.length, 1, "should emit email_open event");
  assert.strictEqual(events[0].event_type, "email_open");
  assert.ok(writtenUser, "should write updated user");
  assert.strictEqual(writtenUser.email_opens_total, 6, "should increment opens count");
}

// --------------- handleClickRedirectRoute ---------------

// wrong pathname — not handled
{
  const res = buildMockRes();
  const ctx = { req: { method: "GET" }, res, pathname: "/api/other", url: new URL("http://localhost/api/other") };
  const result = handleClickRedirectRoute({ ctx, deps: buildBaseDeps() });
  assert.strictEqual(result, false, "non-matching pathname should return false");
}

// missing url param — returns 400
{
  const res = buildMockRes();
  const ctx = { req: { method: "GET" }, res, pathname: "/api/click", url: new URL("http://localhost/api/click") };
  handleClickRedirectRoute({ ctx, deps: buildBaseDeps() });
  assert.strictEqual(res.statusCode, 400, "missing url should return 400");
  const body = JSON.parse(res.body);
  assert.strictEqual(body.error, "url required");
}

// invalid url — returns 400
{
  const res = buildMockRes();
  const ctx = { req: { method: "GET" }, res, pathname: "/api/click", url: new URL("http://localhost/api/click?url=not-a-url") };
  handleClickRedirectRoute({ ctx, deps: buildBaseDeps() });
  assert.strictEqual(res.statusCode, 400, "invalid url should return 400");
}

// valid url — redirects with 302
{
  const events = [];
  const res = buildMockRes();
  const target = "https://example.com/article";
  const ctx = {
    req: { method: "GET" },
    res,
    pathname: "/api/click",
    url: new URL(`http://localhost/api/click?url=${encodeURIComponent(target)}&token=${"c".repeat(64)}`),
  };
  const deps = buildBaseDeps({
    findUserByToken: () => ({ chatId: "789", email: "u@x.com" }),
    appendEngagementEventChecked: (evt) => events.push(evt),
  });
  handleClickRedirectRoute({ ctx, deps });
  assert.strictEqual(res.statusCode, 302, "should redirect with 302");
  assert.strictEqual(res.headers.Location, target, "should redirect to target URL");
  assert.strictEqual(events.length, 1, "should emit click event");
  assert.strictEqual(events[0].event_type, "item_clicked");
}

// valid url without token — redirects without engagement event
{
  const events = [];
  const res = buildMockRes();
  const target = "https://example.com/article";
  const ctx = {
    req: { method: "GET" },
    res,
    pathname: "/api/click",
    url: new URL(`http://localhost/api/click?url=${encodeURIComponent(target)}`),
  };
  const deps = buildBaseDeps({
    appendEngagementEventChecked: (evt) => events.push(evt),
  });
  handleClickRedirectRoute({ ctx, deps });
  assert.strictEqual(res.statusCode, 302, "should still redirect");
  assert.strictEqual(events.length, 0, "no token means no engagement event");
}

process.stdout.write("[engagement-actions-runtime] all assertions passed\n");
