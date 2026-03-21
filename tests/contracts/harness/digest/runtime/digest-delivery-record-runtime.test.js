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
      requested_count: 5,
      freshness_block_count: 2,
      semantic_repeat_block_count: 2,
      alternate_queries_used: 3,
      preferred_domains_count: 4,
      preferred_candidate_count: 3,
      non_preferred_candidate_count: 2,
      derivative_suppressed_count: 1,
      search_budget_soft_calls: 24,
      search_budget_hard_calls: 36,
      search_budget_calls_used: 18,
      search_budget_exhausted: true,
      broad_fallback_topics_used: 4,
      zero_yield_retry_count: 2,
      budget_stop_reason: "soft_cap_reached",
      candidate_pool_before_dedup: 18,
      candidate_pool_after_dedup: 7,
      fallback_reason: "min_count_backfill",
      refill_count: 2,
      thin_pool: true,
      dominant_failure_mode: "repeat",
      items: [{ index: 1, headline: "Pfizer pivots", entity_keys: ["pfizer"], storyline_key: "pfizer|pipeline", freshness_key: "pfizer|pipeline" }],
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
    assert.strictEqual(scheduledByRun.items[0].freshness_key, "pfizer|pipeline");
    assert.strictEqual(scheduledByRun.requested_count, 5);
    assert.strictEqual(scheduledByRun.freshness_block_count, 2);
    assert.strictEqual(scheduledByRun.preferred_domains_count, 4);
    assert.strictEqual(scheduledByRun.derivative_suppressed_count, 1);
    assert.strictEqual(scheduledByRun.search_budget_soft_calls, 24);
    assert.strictEqual(scheduledByRun.search_budget_hard_calls, 36);
    assert.strictEqual(scheduledByRun.search_budget_calls_used, 18);
    assert.strictEqual(scheduledByRun.search_budget_exhausted, true);
    assert.strictEqual(scheduledByRun.broad_fallback_topics_used, 4);
    assert.strictEqual(scheduledByRun.zero_yield_retry_count, 2);
    assert.strictEqual(scheduledByRun.budget_stop_reason, "soft_cap_reached");
    assert.strictEqual(scheduledByRun.dominant_failure_mode, "repeat");
    assert.strictEqual(deliveryRecords.hasSentDigestRecord("user-1", "2026-03-13", "scheduled"), true);
    assert.strictEqual(deliveryRecords.hasSentDigestRecord("user-1", "2026-03-14", "scheduled"), false);

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

    const currentRecords = deliveryRecords.loadAllCurrentRecords({ status: "sent" });
    assert.strictEqual(currentRecords.length, 2, "loadAllCurrentRecords should surface sent scheduled + manual records");

    const recordsSummary = deliveryRecords.summarizeRecordsState();
    assert.strictEqual(recordsSummary.file_count, 2);
    assert.strictEqual(recordsSummary.current_record_count, 2);
    assert.strictEqual(recordsSummary.latest_timestamp, "2026-03-13T12:30:00.000Z");
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
})().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
