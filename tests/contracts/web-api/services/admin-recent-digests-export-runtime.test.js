"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../../test-support/module-contract-helper.js");

const TARGET_REL = "web/services/admin-recent-digests-export-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const {
  createRecentDigestsExporter,
  resolveWindow,
} = runtime;

(() => {
  const now = new Date("2026-03-20T15:00:00.000Z");
  const window = resolveWindow(7, now);
  assert.strictEqual(window.startDateEt, "2026-03-14");
  assert.strictEqual(window.endDateEt, "2026-03-20");

  const buildRecentDigestsExport = createRecentDigestsExporter({
    loadCostRunsNewest: () => [{
      date: "2026-03-20",
      run_id: "scheduled:2026-03-20T11-01-00-000Z",
      run_at: "2026-03-20T11:01:00.000Z",
      run_at_et: "Mar 20, 7:01 AM",
      on_demand: false,
      per_user: [{
        id: "user@example.com",
        digest_id: "2026-03-20:chat-1",
        digest_quality_score: 81.5,
        digest_quality_band: "strong",
        delivery_mode: "scheduled",
        delivery_version: 1,
      }],
    }],
    allUsers: () => [{
      chatId: "chat-1",
      email: "user@example.com",
    }],
    loadEngagementEvents: () => [
      {
        event_type: "digest_sent",
        date_et: "2026-03-20",
        digest_id: "2026-03-20:chat-1",
        run_id: "scheduled:2026-03-20T11-01-00-000Z",
        channel: "email",
        ts_utc: "2026-03-20T11:01:20.000Z",
        metadata: {
          quality_score: 81.5,
          quality_band: "strong",
          items: [{ index: 1, headline: "Fresh item", url: "https://example.com/fresh", tag: "AI", freshness_key: "ai|fresh" }],
        },
      },
      {
        event_type: "email_open",
        date_et: "2026-03-20",
        digest_id: "2026-03-20:chat-1",
      },
      {
        event_type: "item_clicked",
        date_et: "2026-03-20",
        digest_id: "2026-03-20:chat-1",
      },
      {
        event_type: "digest_feedback_submitted",
        date_et: "2026-03-20",
        digest_id: "2026-03-20:chat-1",
        feedback: { label: "great" },
      },
    ],
    loadDigestSnapshotByRunId: () => ({
      sent_at: "2026-03-20T11:01:20.000Z",
      version: 1,
      requested_count: 5,
      freshness_block_count: 2,
      semantic_repeat_block_count: 2,
      alternate_queries_used: 3,
      candidate_pool_before_dedup: 18,
      candidate_pool_after_dedup: 7,
      fallback_reason: "min_count_backfill",
      refill_count: 2,
      thin_pool: true,
      dominant_failure_mode: "repeat",
      items: [{ index: 1, headline: "Fresh item", url: "https://example.com/fresh", tag: "AI", freshness_key: "ai|fresh" }],
    }),
    loadLatestDigestSnapshot: () => null,
  });

  const payload = buildRecentDigestsExport({ days: 7, now });
  assert.strictEqual(payload.row_count, 1);
  const row = payload.rows[0];
  assert.strictEqual(row.recipient, "user@example.com");
  assert.strictEqual(row.user_id, "chat-1");
  assert.strictEqual(row.mode, "scheduled");
  assert.strictEqual(row.quality_score, 81.5);
  assert.strictEqual(row.sent_item_count, 1);
  assert.strictEqual(row.requested_count, 5);
  assert.strictEqual(row.freshness_block_count, 2);
  assert.strictEqual(row.alternate_queries_used, 3);
  assert.strictEqual(row.thin_pool, true);
  assert.strictEqual(row.dominant_failure_mode, "repeat");
  assert.strictEqual(row.sent_items[0].freshness_key, "ai|fresh");
  assert.deepStrictEqual(row.channels, ["email"]);
  assert.strictEqual(row.engagement.opens, 1);
  assert.strictEqual(row.engagement.clicks, 1);
  assert.strictEqual(row.engagement.feedback_submitted, 1);
  assert.deepStrictEqual(row.engagement.feedback_labels, ["great"]);
})();

process.stdout.write("[admin-recent-digests-export-runtime] all assertions passed\n");
