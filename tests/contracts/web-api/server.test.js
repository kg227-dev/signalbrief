"use strict";

const assert = require("assert");
const Module = require("module");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "web/server.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);

function loadServerEntrypointWithStubs(stubs = {}) {
  const originalLoad = Module._load;
  delete require.cache[TARGET_PATH];
  Module._load = function patchedLoad(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) {
      return stubs[request];
    }
    return originalLoad.apply(this, arguments);
  };
  try {
    return require(TARGET_PATH);
  } finally {
    Module._load = originalLoad;
    delete require.cache[TARGET_PATH];
  }
}

async function testEntrypointBootstrapsServerAndLogsStartup() {
  let delegatedCount = 0;
  const startupSteps = [];
  const logEvents = [];
  let boundRequestHandler = null;
  let listenPort = null;
  let listenCalls = 0;

  const fakeServer = {
    listen(port, callback) {
      listenCalls += 1;
      listenPort = port;
      startupSteps.push(`listen:${port}`);
      if (typeof callback === "function") callback();
    },
  };

  const entrypoint = loadServerEntrypointWithStubs({
    http: {
      createServer(handler) {
        assert.strictEqual(typeof handler, "function");
        boundRequestHandler = handler;
        return fakeServer;
      },
    },
    "./server-runtime": {
      ensureStoreInitialized() {
        startupSteps.push("ensureStoreInitialized");
      },
      installCrashProtection() {
        startupSteps.push("installCrashProtection");
      },
      getServerPort() {
        startupSteps.push("getServerPort");
        return 3922;
      },
      async handleWebRequest(req, res) {
        delegatedCount += 1;
        res.handled = `${req.method} ${req.url}`;
      },
    },
    "../src/runtime/structured-logger-runtime": {
      createStructuredLogger() {
        return {
          info(event, fields) {
            logEvents.push({ event, fields });
          },
        };
      },
    },
  });
  assertModuleExports(() => entrypoint, TARGET_REL);
  assert.strictEqual(typeof entrypoint.startServer, "function");
  assert.strictEqual(typeof entrypoint.server, "object");
  assert.strictEqual(typeof boundRequestHandler, "function");

  const req = { method: "GET", url: "/status" };
  const res = {};
  await boundRequestHandler(req, res);
  assert.strictEqual(delegatedCount, 1);
  assert.strictEqual(res.handled, "GET /status");

  const returnedServer = entrypoint.startServer();
  assert.strictEqual(returnedServer, fakeServer);
  assert.strictEqual(listenCalls, 1);
  assert.strictEqual(listenPort, 3922);
  assert.deepStrictEqual(startupSteps, [
    "ensureStoreInitialized",
    "installCrashProtection",
    "getServerPort",
    "listen:3922",
  ]);

  assert.strictEqual(logEvents.length, 1);
  assert.strictEqual(logEvents[0].event, "web.server.started");
  assert.strictEqual(logEvents[0].fields.outcome, "started");
  assert.strictEqual(logEvents[0].fields.port, 3922);
}

testEntrypointBootstrapsServerAndLogsStartup().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
