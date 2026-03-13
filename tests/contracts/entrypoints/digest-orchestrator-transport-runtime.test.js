"use strict";

const assert = require("assert");
const { EventEmitter } = require("events");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/entrypoints/digest-orchestrator-transport-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
const { createDigestOrchestratorTransportRuntime } = runtime;
assertModuleExports(() => runtime, TARGET_REL);

function createHttpsStub(steps, callsOut, timeoutCallsOut = []) {
  let idx = 0;
  return {
    request(options, onResponse) {
      callsOut.push(options);
      const req = new EventEmitter();
      req.write = () => {};
      req.setTimeout = (_ms, onTimeout) => {
        timeoutCallsOut.push(_ms);
        req._onTimeout = onTimeout;
      };
      req.destroy = (error) => {
        setImmediate(() => req.emit("error", error || new Error("destroyed")));
      };
      req.end = () => {
        const step = steps[idx++] || { type: "success", statusCode: 200, body: "{}" };
        if (step.type === "error") {
          setImmediate(() => req.emit("error", new Error(step.message || "socket hang up")));
          return;
        }
        if (step.type === "timeout") {
          setImmediate(() => {
            if (typeof req._onTimeout === "function") req._onTimeout();
          });
          return;
        }
        const res = new EventEmitter();
        res.statusCode = step.statusCode || 200;
        setImmediate(() => {
          onResponse(res);
          if (step.body != null) res.emit("data", step.body);
          res.emit("end");
        });
      };
      return req;
    },
  };
}

async function testTransportJsonAndRetry() {
  const calls = [];
  const https = createHttpsStub([
    { type: "success", statusCode: 200, body: "{\"ok\":true}" },
    { type: "error", message: "socket hang up" },
    { type: "success", statusCode: 200, body: "{\"retry_ok\":true}" },
  ], calls);
  const transport = createDigestOrchestratorTransportRuntime({
    https,
    defaultTimeoutMs: 1000,
  });

  const first = await transport.httpsPost(
    "api.example.com",
    "/first",
    { "Content-Type": "application/json" },
    { hello: "world" }
  );
  assert.strictEqual(first.status, 200);
  assert.deepStrictEqual(first.body, { ok: true });

  const second = await transport.httpsPostWithRetry(
    "api.example.com",
    "/retry",
    { "Content-Type": "application/json" },
    { retry: true },
    { retries: 1, retryDelayMs: 1 }
  );
  assert.strictEqual(second.status, 200);
  assert.deepStrictEqual(second.body, { retry_ok: true });
  assert.strictEqual(calls.length, 3, "retry path should issue a second request");
}

async function testTransportStatusRetryAndTimeoutOverride() {
  const calls = [];
  const timeoutCalls = [];
  const https = createHttpsStub([
    { type: "success", statusCode: 429, body: "{\"error\":\"rate limited\"}" },
    { type: "success", statusCode: 503, body: "{\"error\":\"unavailable\"}" },
    { type: "success", statusCode: 200, body: "{\"ok\":true}" },
  ], calls, timeoutCalls);
  const transport = createDigestOrchestratorTransportRuntime({
    https,
    defaultTimeoutMs: 1000,
  });

  const response = await transport.httpsPostWithRetry(
    "api.example.com",
    "/status-retry",
    { "Content-Type": "application/json" },
    { hello: "status-retry" },
    {
      retries: 2,
      retryDelayMs: 1,
      timeoutMs: 4321,
      retryStatusCodes: [429, 503],
    }
  );
  assert.strictEqual(response.status, 200);
  assert.strictEqual(calls.length, 3, "status retry should reattempt while retries remain");
  assert.ok(timeoutCalls.every((value) => value === 4321), "timeout override should apply to each attempt");
}

async function testTransportStatusRetryStopsWhenNotConfigured() {
  const calls = [];
  const https = createHttpsStub([
    { type: "success", statusCode: 503, body: "{\"error\":\"unavailable\"}" },
    { type: "success", statusCode: 200, body: "{\"ok\":true}" },
  ], calls);
  const transport = createDigestOrchestratorTransportRuntime({
    https,
    defaultTimeoutMs: 1000,
  });

  const response = await transport.httpsPostWithRetry(
    "api.example.com",
    "/status-no-retry",
    { "Content-Type": "application/json" },
    { hello: "status-no-retry" },
    { retries: 2, retryDelayMs: 1, retryStatusCodes: [429] }
  );
  assert.strictEqual(response.status, 503);
  assert.strictEqual(calls.length, 1, "non-configured status should not trigger retry");
}

(async () => {
  await testTransportJsonAndRetry();
  await testTransportStatusRetryAndTimeoutOverride();
  await testTransportStatusRetryStopsWhenNotConfigured();
})().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
