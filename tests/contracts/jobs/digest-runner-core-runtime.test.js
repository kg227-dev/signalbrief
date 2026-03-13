"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/jobs/digest-runner-core-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const {
  DIGEST_TRIGGER_STATUS,
  normalizeDigestTriggerResult,
  toDigestTriggerOutcome,
  reserveOnDemandCooldownLease,
  releaseOnDemandCooldownLease,
  readOnDemandCooldownLeases,
} = runtime;

async function testCooldownLeaseLifecycle() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-digest-cooldown-"));
  const cooldownFilePath = path.join(tmpDir, "on-demand-cooldown.json");
  const baseNow = Date.parse("2026-03-13T15:00:00.000Z");

  try {
    const first = await reserveOnDemandCooldownLease({
      chatId: "chat-1",
      cooldownMs: 60_000,
      nowMs: baseNow,
      cooldownFilePath,
      lockWaitMs: 100,
      lockPollMs: 1,
    });
    assert.strictEqual(first.ok, true, "first reservation should pass");
    assert.strictEqual(first.reserved, true, "first reservation should persist lease");

    const second = await reserveOnDemandCooldownLease({
      chatId: "chat-1",
      cooldownMs: 60_000,
      nowMs: baseNow,
      cooldownFilePath,
      lockWaitMs: 100,
      lockPollMs: 1,
    });
    assert.strictEqual(second.ok, false, "second reservation should be blocked during active cooldown");
    assert.strictEqual(second.code, "cooldown");
    assert.ok(second.remainingMs >= 59_000, "blocked reservation should expose remaining cooldown");

    const leases = readOnDemandCooldownLeases({ cooldownFilePath });
    assert.ok(leases["chat-1"], "lease file should include persisted chat key");

    const release = await releaseOnDemandCooldownLease({
      chatId: "chat-1",
      nowMs: baseNow,
      cooldownFilePath,
      lockWaitMs: 100,
      lockPollMs: 1,
    });
    assert.strictEqual(release.ok, true);
    assert.strictEqual(release.cleared, true);

    const third = await reserveOnDemandCooldownLease({
      chatId: "chat-1",
      cooldownMs: 60_000,
      nowMs: baseNow,
      cooldownFilePath,
      lockWaitMs: 100,
      lockPollMs: 1,
    });
    assert.strictEqual(third.ok, true, "reservation should succeed after explicit release");

    const fourth = await reserveOnDemandCooldownLease({
      chatId: "chat-1",
      cooldownMs: 60_000,
      nowMs: baseNow + 65_000,
      cooldownFilePath,
      lockWaitMs: 100,
      lockPollMs: 1,
    });
    assert.strictEqual(fourth.ok, true, "reservation should succeed once lease naturally expires");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function testCooldownOutcomeNormalization() {
  const normalized = normalizeDigestTriggerResult({
    ok: false,
    code: "cooldown",
    cooldown_remaining_ms: 120_000,
    cooldown_expires_at_ms: 999,
  });
  assert.strictEqual(normalized.status, DIGEST_TRIGGER_STATUS.COOLDOWN);
  assert.strictEqual(normalized.cooldown_remaining_ms, 120_000);

  const outcome = toDigestTriggerOutcome({
    ok: false,
    code: "cooldown",
    cooldown_remaining_ms: 90_000,
    cooldown_expires_at_ms: 123,
  });
  assert.strictEqual(outcome.cooldown, true);
  assert.strictEqual(outcome.cooldownRemainingMs, 90_000);
  assert.strictEqual(outcome.cooldownExpiresAtMs, 123);
}

(async () => {
  await testCooldownLeaseLifecycle();
  testCooldownOutcomeNormalization();
})().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
