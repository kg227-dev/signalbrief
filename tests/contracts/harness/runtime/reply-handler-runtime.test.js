"use strict";

const assert = require("assert");
const path = require("path");
const { assertNodeSyntaxFile, assertModuleExports } = require("../../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/runtime/reply/reply-handler-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);
assert.strictEqual(typeof runtime.createReplyHandlerRuntime, "function", "reply-handler should export runtime factory");
assert.strictEqual(typeof runtime.resetReplyRuntimeState, "function", "reply-handler runtime should expose explicit runtime reset");

const state = runtime.createReplyState();
assert.ok(state.awaitingEmail instanceof Map, "awaitingEmail should be a Map");
assert.ok(state.digestInflight instanceof Set, "digestInflight should be a Set");
assert.ok(state.pendingLinkVerifications instanceof Map, "pendingLinkVerifications should be a Map");

state.awaitingEmail.set("chat-1", "user@example.com");
state.digestInflight.add("chat-1");
state.pendingLinkVerifications.set("user@example.com", { code: "123456" });

const fresh = runtime.createReplyState();
assert.strictEqual(fresh.awaitingEmail.size, 0, "createReplyState should return isolated state");
assert.strictEqual(fresh.digestInflight.size, 0, "createReplyState should return isolated state");
assert.strictEqual(fresh.pendingLinkVerifications.size, 0, "createReplyState should return isolated state");

const resetA = runtime.resetReplyState();
resetA.awaitingEmail.set("chat-2", "person@example.com");
resetA.digestInflight.add("chat-2");
const resetB = runtime.resetReplyState();
assert.notStrictEqual(resetA, resetB, "resetReplyState should replace runtime state object");
assert.strictEqual(resetB.awaitingEmail.size, 0, "resetReplyState should clear awaitingEmail");
assert.strictEqual(resetB.digestInflight.size, 0, "resetReplyState should clear digestInflight");

const resetRuntime = runtime.resetReplyRuntimeState();
assert.ok(resetRuntime.awaitingEmail instanceof Map, "resetReplyRuntimeState should return reply state");
assert.strictEqual(resetRuntime.awaitingEmail.size, 0, "resetReplyRuntimeState should clear awaitingEmail");

const isolatedRuntime = runtime.createReplyHandlerRuntime();
assert.strictEqual(typeof runtime.handleIncomingMessage, "function", "reply-handler should export specific inbound message handler name");
assert.strictEqual(typeof runtime.handleCallbackQuery, "function", "reply-handler should export specific callback handler name");
assert.strictEqual(typeof isolatedRuntime.handleIncomingMessage, "function", "runtime factory should produce isolated message handler");
assert.strictEqual(typeof isolatedRuntime.handleCallbackQuery, "function", "runtime factory should produce isolated callback handler");
const isolatedState = isolatedRuntime.resetReplyState();
assert.ok(isolatedState.awaitingEmail instanceof Map, "factory runtime should expose reset state API");
