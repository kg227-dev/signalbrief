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
    }, {
      date: "2026-03-19",
      run_id: "scheduled:2026-03-19T11-01-00-000Z",
      run_at: "2026-03-19T11:01:00.000Z",
      run_at_et: "Mar 19, 7:01 AM",
      on_demand: false,
      per_user: [{
        id: "user@example.com",
        digest_id: "2026-03-19:chat-1",
        digest_quality_score: 75.5,
        digest_quality_band: "decent",
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
    loadDigestSnapshotByRunId: (_userId, dateEt) => (dateEt === "2026-03-20" ? {
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
    } : {
      sent_at: "2026-03-19T11:01:20.000Z",
      version: 1,
      items: [{ index: 1, headline: "Earlier item", url: "https://example.com/earlier", tag: "AI" }],
    }),
    loadLatestDigestSnapshot: () => null,
  });

  const payload = buildRecentDigestsExport({ days: 7, now });
  assert.strictEqual(payload.row_count, 2);
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

  const priorRow = payload.rows[1];
  assert.strictEqual(priorRow.date_et, "2026-03-19");
  assert.strictEqual(priorRow.historical_repeat_count, 0);
  assert.strictEqual(priorRow.repeat_evidence_count, 0);
})();

(() => {
  const now = new Date("2026-03-20T15:00:00.000Z");
  const buildRecentDigestsExport = createRecentDigestsExporter({
    loadCostRunsNewest: () => [{
      date: "2026-03-20",
      run_id: "scheduled:2026-03-20T11-01-00-000Z",
      run_at: "2026-03-20T11:01:00.000Z",
      run_at_et: "Mar 20, 7:01 AM",
      on_demand: false,
      per_user: [{
        id: "repeat@example.com",
        digest_id: "2026-03-20:chat-2",
        digest_quality_score: 70,
        digest_quality_band: "decent",
      }],
    }, {
      date: "2026-03-19",
      run_id: "scheduled:2026-03-19T11-01-00-000Z",
      run_at: "2026-03-19T11:01:00.000Z",
      run_at_et: "Mar 19, 7:01 AM",
      on_demand: false,
      per_user: [{
        id: "repeat@example.com",
        digest_id: "2026-03-19:chat-2",
        digest_quality_score: 72,
        digest_quality_band: "decent",
      }],
    }],
    allUsers: () => [{ chatId: "chat-2", email: "repeat@example.com" }],
    loadEngagementEvents: () => [],
    loadDigestSnapshotByRunId: (_userId, dateEt) => ({
      sent_at: `${dateEt}T11:01:20.000Z`,
      version: 1,
      items: [{ index: 1, headline: "Repeat story", url: "https://example.com/repeat", tag: "AI" }],
    }),
    loadLatestDigestSnapshot: () => null,
  });

  const payload = buildRecentDigestsExport({ days: 7, now });
  assert.strictEqual(payload.row_count, 2);
  const newerRow = payload.rows[0];
  assert.strictEqual(newerRow.date_et, "2026-03-20");
  assert.strictEqual(newerRow.historical_repeat_count, 1);
  assert.strictEqual(newerRow.repeat_evidence_count, 1);
  assert.strictEqual(newerRow.dominant_failure_mode, "repeat");
  assert.strictEqual(newerRow.repeat_details.length, 1);
})();

(() => {
  const now = new Date("2026-03-20T15:00:00.000Z");
  const buildRecentDigestsExport = createRecentDigestsExporter({
    loadCostRunsNewest: () => [{
      date: "2026-03-20",
      run_id: "scheduled:2026-03-20T11-01-00-000Z",
      run_at: "2026-03-20T11:01:00.000Z",
      run_at_et: "Mar 20, 7:01 AM",
      on_demand: false,
      per_user: [{
        id: "history@example.com",
        digest_id: "2026-03-20:chat-3",
      }],
    }, {
      date: "2025-11-01",
      run_id: "scheduled:2025-11-01T11-01-00-000Z",
      run_at: "2025-11-01T11:01:00.000Z",
      run_at_et: "Nov 1, 7:01 AM",
      on_demand: false,
      per_user: [{
        id: "history@example.com",
        digest_id: "2025-11-01:chat-3",
      }],
    }],
    allUsers: () => [{ chatId: "chat-3", email: "history@example.com" }],
    loadEngagementEvents: () => [],
    loadDigestSnapshotByRunId: (_userId, dateEt) => ({
      sent_at: `${dateEt}T11:01:20.000Z`,
      version: 1,
      items: [{ index: 1, headline: `Item ${dateEt}`, url: `https://example.com/${dateEt}`, tag: "AI" }],
    }),
    loadLatestDigestSnapshot: () => null,
  });

  const payload = buildRecentDigestsExport({ all_time: true, now });
  assert.strictEqual(payload.window.all_time, true);
  assert.strictEqual(payload.window.days, null);
  assert.strictEqual(payload.window.start_date_et, "2025-11-01");
  assert.strictEqual(payload.row_count, 2);
  assert.strictEqual(payload.rows[0].date_et, "2026-03-20");
  assert.strictEqual(payload.rows[1].date_et, "2025-11-01");
})();

process.stdout.write("[admin-recent-digests-export-runtime] all assertions passed\n");
