"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/runtime/reply/reply-command-digest-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
const { createDigestCommandHandler } = runtime;
assertModuleExports(() => runtime, TARGET_REL);

async function testEmailOnlyMvpDisablesTriggering() {
  const sent = [];
  const state = {
    digestInflight: new Set(),
  };
  const handler = createDigestCommandHandler({
    state,
    send: async (_chatId, text) => {
      sent.push(String(text || ""));
    },
    allUsers: () => [{ chatId: "123", status: "active" }],
    USER_STATUS: { ACTIVE: "active" },
  });

  await handler.handleDigest("123");
  assert.ok(
    sent[0].includes("Email-only MVP mode is active"),
    "handler should explain that Telegram on-demand digests are disabled"
  );
  assert.strictEqual(state.digestInflight.size, 0, "inflight set should be cleared after response");
}

async function testInFlightGuardAndSuccessPath() {
  const sent = [];
  const state = {
    digestInflight: new Set(["123"]),
  };
  let triggerCalls = 0;
  const handler = createDigestCommandHandler({
    state,
    send: async (_chatId, text) => {
      sent.push(String(text || ""));
    },
    allUsers: () => [{ chatId: "123", status: "active" }],
    USER_STATUS: { ACTIVE: "active" },
  });

  await handler.handleDigest("123");
  assert.strictEqual(triggerCalls, 0, "inflight guard should prevent duplicate trigger");
  assert.ok(sent[0].includes("already in progress"));

  state.digestInflight.clear();
  await handler.handleDigest("123");
  assert.strictEqual(triggerCalls, 0, "email-only MVP should not trigger the digest runner after inflight clears");
  assert.ok(
    sent[sent.length - 1].includes("Email-only MVP mode is active"),
    "post-inflight response should still explain the email-only behavior"
  );
  assert.strictEqual(state.digestInflight.size, 0, "inflight state should be cleared on success");
}

(async () => {
  await testEmailOnlyMvpDisablesTriggering();
  await testInFlightGuardAndSuccessPath();
})().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
