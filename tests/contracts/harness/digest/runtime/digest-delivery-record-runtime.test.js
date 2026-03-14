"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/digest/runtime/digest-delivery-record-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const { createDigestDeliveryRecordRuntime } = runtime;
assert.strictEqual(typeof createDigestDeliveryRecordRuntime, "function");

(async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-digest-records-"));
  try {
    const deliveryRecords = createDigestDeliveryRecordRuntime({
      APP_ROOT: rootDir,
      fs,
      path,
      log: () => {},
    });

    const scheduled = deliveryRecords.beginDigestDeliveryRecord({
      digest_id: "2026-03-13:user-1",
      user_id: "user-1",
      date_et: "2026-03-13",
      mode: "scheduled",
      run_id: "scheduled:run-1",
      source: "scheduled-job",
    });
    assert.strictEqual(scheduled.ok, true);
    assert.strictEqual(scheduled.skipped, false);
    assert.strictEqual(scheduled.version, 1);

    const selectedUpdate = deliveryRecords.updateDigestDeliveryRecord({
      digest_id: "2026-03-13:user-1",
      user_id: "user-1",
      date_et: "2026-03-13",
      mode: "scheduled",
      version: 1,
      status: "sent",
      sent_at: "2026-03-13T11:05:00.000Z",
      date_str: "Friday, March 13, 2026",
      quick_scan: "Pfizer pivots",
      items: [{ index: 1, headline: "Pfizer pivots", entity_keys: ["pfizer"], storyline_key: "pfizer|pipeline" }],
    });
    assert.strictEqual(selectedUpdate.ok, true);

    const skipped = deliveryRecords.beginDigestDeliveryRecord({
      digest_id: "2026-03-13:user-1",
      user_id: "user-1",
      date_et: "2026-03-13",
      mode: "scheduled",
      run_id: "scheduled:run-2",
      source: "scheduled-job",
    });
    assert.strictEqual(skipped.ok, true);
    assert.strictEqual(skipped.skipped, true);
    assert.strictEqual(skipped.reason, "scheduled_already_sent");

    const manualFirst = deliveryRecords.beginDigestDeliveryRecord({
      digest_id: "2026-03-13:user-1",
      user_id: "user-1",
      date_et: "2026-03-13",
      mode: "manual",
      run_id: "manual:run-1",
      source: "manual-rerun",
    });
    assert.strictEqual(manualFirst.version, 1);
    deliveryRecords.updateDigestDeliveryRecord({
      digest_id: "2026-03-13:user-1",
      user_id: "user-1",
      date_et: "2026-03-13",
      mode: "manual",
      version: 1,
      status: "sent",
      sent_at: "2026-03-13T12:00:00.000Z",
      items: [{ index: 1, headline: "Manual digest v1" }],
    });

    const manualSecond = deliveryRecords.beginDigestDeliveryRecord({
      digest_id: "2026-03-13:user-1",
      user_id: "user-1",
      date_et: "2026-03-13",
      mode: "manual",
      run_id: "manual:run-2",
      source: "manual-rerun",
    });
    assert.strictEqual(manualSecond.version, 2);
    deliveryRecords.updateDigestDeliveryRecord({
      digest_id: "2026-03-13:user-1",
      user_id: "user-1",
      date_et: "2026-03-13",
      mode: "manual",
      version: 2,
      status: "sent",
      sent_at: "2026-03-13T12:30:00.000Z",
      items: [{ index: 1, headline: "Manual digest v2" }],
    });

    const latestSnapshot = deliveryRecords.loadLatestDigestSnapshot("user-1", "2026-03-13");
    assert.ok(latestSnapshot);
    assert.strictEqual(latestSnapshot.mode, "manual");
    assert.strictEqual(latestSnapshot.status, "sent");
    assert.strictEqual(Array.isArray(latestSnapshot.items), true);
    assert.strictEqual(latestSnapshot.items[0].headline, "Manual digest v2");

    const scheduledByRun = deliveryRecords.loadDigestSnapshotByRunId(
      "user-1",
      "2026-03-13",
      "scheduled:run-1"
    );
    assert.ok(scheduledByRun);
    assert.strictEqual(scheduledByRun.mode, "scheduled");
    assert.strictEqual(scheduledByRun.items[0].headline, "Pfizer pivots");

    const manualByRun = deliveryRecords.loadDigestSnapshotByRunId(
      "user-1",
      "2026-03-13",
      "manual:run-1"
    );
    assert.ok(manualByRun);
    assert.strictEqual(manualByRun.items[0].headline, "Manual digest v1");

    const recent = deliveryRecords.loadRecentSentDigests("user-1", { limit: 3 });
    assert.strictEqual(recent.length, 1, "recent sent digests should collapse to one record per ET date");
    assert.strictEqual(recent[0].date_et, "2026-03-13");
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
})().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
