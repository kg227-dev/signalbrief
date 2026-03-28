"use strict";

const assert = require("assert");
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
} = runtime;

function testLegacyQueueCooldownSurfaceRemoved() {
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(runtime, "queueDigestTrigger"),
    false,
    "email-only MVP runtime should not export queued on-demand digest helpers"
  );
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(runtime, "readOnDemandCooldownLeases"),
    false,
    "email-only MVP runtime should not export cooldown lease helpers"
  );
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(runtime, "DIGEST_ON_DEMAND_COOLDOWN_FILE"),
    false,
    "email-only MVP runtime should not expose the removed cooldown file path"
  );
}

function testQueuedOutcomeNormalization() {
  const normalized = normalizeDigestTriggerResult({ ok: true, code: "queued" });
  assert.strictEqual(normalized.status, DIGEST_TRIGGER_STATUS.QUEUED);
  assert.strictEqual(normalized.code, "queued");
}

function testBusyOutcomeNormalization() {
  const normalized = normalizeDigestTriggerResult({
    ok: false,
    code: "busy",
    admission: {
      lockState: "valid",
      lock: { error: null },
    },
  });
  assert.strictEqual(normalized.status, DIGEST_TRIGGER_STATUS.BUSY);
  const outcome = toDigestTriggerOutcome({
    ok: false,
    code: "busy",
    admission: {
      lockState: "valid",
      lock: { error: null },
    },
  });
  assert.strictEqual(outcome.busy, true);
  assert.strictEqual(outcome.lockUnhealthy, false);
}

testLegacyQueueCooldownSurfaceRemoved();
testQueuedOutcomeNormalization();
testBusyOutcomeNormalization();
