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

async function testCooldownResponseAndTriggerOptions() {
  const sent = [];
  const triggerCalls = [];
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
    queueDigestTrigger: async (opts) => {
      triggerCalls.push(opts);
      return {
        ok: false,
        cooldown: true,
        cooldownRemainingMs: 2 * 60 * 1000,
      };
    },
  });

  await handler.handleDigest("123");
  assert.strictEqual(triggerCalls.length, 1);
  assert.strictEqual(triggerCalls[0].enforceOnDemandCooldown, true, "/digest should enforce persistent cooldown");
  assert.ok(sent[0].includes("Pulling your digest now"), "handler should acknowledge requested digest");
  assert.ok(sent[sent.length - 1].includes("Try again in 2 mins"), "cooldown response should include remaining minutes");
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
    queueDigestTrigger: async () => {
      triggerCalls += 1;
      return { ok: true };
    },
  });

  await handler.handleDigest("123");
  assert.strictEqual(triggerCalls, 0, "inflight guard should prevent duplicate trigger");
  assert.ok(sent[0].includes("already in progress"));

  state.digestInflight.clear();
  await handler.handleDigest("123");
  assert.strictEqual(triggerCalls, 1, "successful path should trigger digest runner");
  assert.strictEqual(state.digestInflight.size, 0, "inflight state should be cleared on success");
}

(async () => {
  await testCooldownResponseAndTriggerOptions();
  await testInFlightGuardAndSuccessPath();
})().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
