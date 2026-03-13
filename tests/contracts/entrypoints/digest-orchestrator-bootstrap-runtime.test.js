"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/entrypoints/digest-orchestrator-bootstrap-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
const { createDigestOrchestratorBootstrapRuntime } = runtime;
assertModuleExports(() => runtime, TARGET_REL);

function testBootstrapRegistersOnceAndReleasesLockOnSignals() {
  const handlers = {};
  const exitCalls = [];
  const processRef = {
    on(event, handler) {
      if (!handlers[event]) handlers[event] = [];
      handlers[event].push(handler);
    },
    exit(code) {
      exitCalls.push(code);
    },
  };
  let initCalls = 0;
  let releaseCalls = 0;
  const bootstrap = createDigestOrchestratorBootstrapRuntime({
    initStore: () => { initCalls += 1; },
    releaseDigestLock: () => { releaseCalls += 1; },
    processRef,
  });

  bootstrap.ensureRuntimeBootstrap();
  bootstrap.ensureRuntimeBootstrap();

  assert.strictEqual(initCalls, 1, "bootstrap should init store only once");
  assert.strictEqual((handlers.exit || []).length, 1);
  assert.strictEqual((handlers.SIGINT || []).length, 1);
  assert.strictEqual((handlers.SIGTERM || []).length, 1);

  handlers.exit[0]();
  assert.strictEqual(releaseCalls, 1, "exit handler should release lock");

  handlers.SIGINT[0]();
  assert.strictEqual(releaseCalls, 2, "SIGINT handler should release lock");
  assert.deepStrictEqual(exitCalls, [1], "SIGINT handler should exit process with code 1");
}

testBootstrapRegistersOnceAndReleasesLockOnSignals();
