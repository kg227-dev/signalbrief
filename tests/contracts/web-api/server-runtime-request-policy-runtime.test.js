"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "web/server-runtime-request-policy-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
const {
  applyResponseCorsPolicy,
  applyCanonicalHostPolicy,
  handleCorsPreflightPolicy,
  handleRequestErrorPolicy,
} = runtime;
assertModuleExports(() => runtime, TARGET_REL);

function buildMockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: "",
    headersSent: false,
    setHeader(name, value) {
      this.headers[String(name)] = value;
    },
    getHeader(name) {
      return this.headers[String(name)];
    },
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

{
  const res = buildMockRes();
  const handled = applyCanonicalHostPolicy({
    req: { headers: { host: "www.getsignalbrief.com" } },
    res,
    url: new URL("http://localhost:3003/admin?x=1"),
    pathname: "/admin",
    getRequestHost: () => "www.getsignalbrief.com",
    getRequestScheme: () => "https",
    canonicalHost: "getsignalbrief.com",
    publicHosts: new Set(["www.getsignalbrief.com", "getsignalbrief.com"]),
  });
  assert.strictEqual(handled, true);
  assert.strictEqual(res.statusCode, 301);
  assert.strictEqual(res.headers.Location, "https://getsignalbrief.com/admin?x=1");
}

{
  const res = buildMockRes();
  const handled = applyCanonicalHostPolicy({
    req: { headers: { host: "internal.example" } },
    res,
    url: new URL("http://localhost:3003/api/topics"),
    pathname: "/api/topics",
    getRequestHost: () => "internal.example",
    getRequestScheme: () => "http",
    canonicalHost: "getsignalbrief.com",
    publicHosts: new Set(["www.getsignalbrief.com", "getsignalbrief.com"]),
  });
  assert.strictEqual(handled, false);
  assert.strictEqual(res.headersSent, false);
}

{
  const res = buildMockRes();
  const handled = handleCorsPreflightPolicy({
    req: {
      method: "OPTIONS",
      headers: {
        origin: "https://getsignalbrief.com",
        "access-control-request-headers": "Content-Type, Authorization",
      },
    },
    res,
    trustedCorsOrigins: new Set(["https://getsignalbrief.com"]),
  });
  assert.strictEqual(handled, true);
  assert.strictEqual(res.statusCode, 204);
  assert.strictEqual(res.headers["Access-Control-Allow-Origin"], "https://getsignalbrief.com");
  assert.strictEqual(res.headers["Access-Control-Allow-Headers"], "Content-Type, Authorization");
}

{
  const res = buildMockRes();
  const handled = handleCorsPreflightPolicy({
    req: {
      method: "OPTIONS",
      headers: { origin: "https://evil.example" },
    },
    res,
    trustedCorsOrigins: new Set(["https://getsignalbrief.com"]),
  });
  assert.strictEqual(handled, true);
  assert.strictEqual(res.statusCode, 403);
  assert.strictEqual(JSON.parse(res.body).error, "origin not allowed");
}

{
  const res = buildMockRes();
  const handled = handleCorsPreflightPolicy({ req: { method: "GET" }, res });
  assert.strictEqual(handled, false);
  assert.strictEqual(res.headersSent, false);
}

{
  const req = {
    method: "GET",
    headers: { origin: "https://getsignalbrief.com" },
  };
  const res = buildMockRes();
  const allowed = applyResponseCorsPolicy({
    req,
    res,
    trustedCorsOrigins: new Set(["https://getsignalbrief.com"]),
  });
  assert.strictEqual(allowed, "https://getsignalbrief.com");
  assert.strictEqual(res.__corsOrigin, "https://getsignalbrief.com");
}

{
  const res = buildMockRes();
  const logs = [];
  handleRequestErrorPolicy({
    req: { method: "GET", url: "/x" },
    res,
    error: new Error("boom"),
    logger: (...parts) => logs.push(parts.join(" ")),
  });
  assert.strictEqual(res.statusCode, 500);
  assert.strictEqual(res.body, "Internal server error");
  assert.ok(logs[0].includes("[server error] GET /x -> boom"));
}
