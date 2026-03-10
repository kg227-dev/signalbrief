"use strict";

const assert = require("assert");
const path = require("path");
const { assertNodeSyntaxFile, assertModuleExports } = require("../../../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/runtime/reply/reply-session-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const { createReplyState, createReplySessionController } = runtime;

const state = createReplyState();
assert.ok(state.awaitingEmail instanceof Map);
assert.ok(state.digestCooldown instanceof Map);
assert.ok(state.digestInflight instanceof Set);
assert.ok(state.pendingLinkVerifications instanceof Map);

let initCalls = 0;
const session = createReplySessionController({
  store: {
    initStore: () => {
      initCalls += 1;
      return { ok: true };
    },
  },
});

assert.strictEqual(session.isStoreReady(), false);
session.ensureStoreReady();
session.ensureStoreReady();
assert.strictEqual(initCalls, 1, "store init should only occur once per runtime lifecycle");
assert.strictEqual(session.isStoreReady(), true);

const mutable = session.getState();
mutable.awaitingEmail.set("chat-1", "user@example.com");
assert.strictEqual(session.getState().awaitingEmail.size, 1);

const resetOnly = session.resetReplyState();
assert.strictEqual(resetOnly.awaitingEmail.size, 0, "resetReplyState should clear reply state");
assert.strictEqual(session.isStoreReady(), true, "resetReplyState should not reset store bootstrap state");

const resetRuntime = session.resetRuntimeState();
assert.strictEqual(resetRuntime.awaitingEmail.size, 0);
assert.strictEqual(session.isStoreReady(), false, "resetRuntimeState should reset store bootstrap state");

