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

function createHttpsStub(steps, callsOut) {
  let idx = 0;
  return {
    request(options, onResponse) {
      callsOut.push(options);
      const req = new EventEmitter();
      req.write = () => {};
      req.setTimeout = (_ms, onTimeout) => {
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

testTransportJsonAndRetry().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
