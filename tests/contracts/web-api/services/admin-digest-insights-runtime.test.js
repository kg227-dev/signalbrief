"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../../test-support/module-contract-helper.js");

const TARGET_REL = "web/services/admin-digest-insights-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const {
  annotateHistoricalRepeatEvidence,
  buildDigestInsights,
  resolveRowFailureMode,
} = runtime;

(() => {
  assert.strictEqual(resolveRowFailureMode({
    requested_count: 5,
    sent_item_count: 3,
    thin_pool: true,
  }), "thin_pool");

  assert.strictEqual(resolveRowFailureMode({
    freshness_block_count: 2,
    sent_item_count: 5,
    sent_items: [{ topic_match: 8 }],
  }), "repeat");

  assert.strictEqual(resolveRowFailureMode({
    sent_item_count: 5,
    sent_items: [
      { source_authority: 0.3, source_tier: "weak", topic_match: 8 },
      { source_authority: 0.4, source_tier: "corporate", topic_match: 7 },
      { source_authority: 0.9, source_tier: "premium", topic_match: 8 },
    ],
  }), "weak_source");

  const repeatRows = annotateHistoricalRepeatEvidence([
    {
      recipient: "repeat@example.com",
      user_email: "repeat@example.com",
      date_et: "2026-03-19",
      run_at_utc: "2026-03-19T11:01:00.000Z",
      sent_item_count: 1,
      sent_items: [{ url: "https://example.com/repeat-story", storyline_key: "repeat|story" }],
    },
    {
      recipient: "repeat@example.com",
      user_email: "repeat@example.com",
      date_et: "2026-03-20",
      run_at_utc: "2026-03-20T11:01:00.000Z",
      sent_item_count: 1,
      sent_items: [{ url: "https://example.com/repeat-story", storyline_key: "repeat|story" }],
    },
  ]);
  assert.strictEqual(repeatRows[1].historical_repeat_count, 1);
  assert.strictEqual(repeatRows[1].repeat_evidence_count, 1);
  assert.strictEqual(resolveRowFailureMode(repeatRows[1]), "repeat");
  assert.strictEqual(repeatRows[1].repeat_details.length, 1);
  assert.deepStrictEqual(repeatRows[1].repeat_details[0].prior_dates_display, ["2026-03-19"]);

  const insights = buildDigestInsights([
    {
      recipient: "repeat@example.com",
      user_email: "repeat@example.com",
      run_at_utc: "2026-03-20T11:01:00.000Z",
      quality_score: 62,
      sent_item_count: 5,
      freshness_block_count: 3,
      dominant_failure_mode: "repeat",
    },
    {
      recipient: "repeat@example.com",
      user_email: "repeat@example.com",
      run_at_utc: "2026-03-19T11:01:00.000Z",
      quality_score: 68,
      sent_item_count: 4,
      thin_pool: true,
      refill_count: 2,
      dominant_failure_mode: "thin_pool",
    },
    {
      recipient: "repeat@example.com",
      user_email: "repeat@example.com",
      date_et: "2026-03-18",
      run_at_utc: "2026-03-18T11:01:00.000Z",
      quality_score: 66,
      sent_item_count: 1,
      sent_items: [{ url: "https://example.com/repeat-story", storyline_key: "repeat|story" }],
    },
    {
      recipient: "repeat@example.com",
      user_email: "repeat@example.com",
      date_et: "2026-03-20",
      run_at_utc: "2026-03-20T11:01:00.001Z",
      quality_score: 64,
      sent_item_count: 1,
      sent_items: [{ url: "https://example.com/repeat-story", storyline_key: "repeat|story" }],
    },
  ], { days: 7 });

  assert.strictEqual(insights.users.length, 1);
  assert.strictEqual(insights.users[0].recipient, "repeat@example.com");
  assert.strictEqual(insights.users[0].digests, 4);
  assert.strictEqual(insights.users[0].repeat_blocks, 3);
  assert.strictEqual(insights.users[0].repeat_sent_count, 1);
  assert.strictEqual(insights.users[0].repeat_evidence_count, 4);
  assert.strictEqual(insights.users[0].refill_count, 2);
  assert.strictEqual(insights.users[0].repeat_details.length, 1);
  assert.deepStrictEqual(insights.users[0].repeat_details[0].dates_display, ["2026-03-18", "2026-03-20"]);
})();

process.stdout.write("[admin-digest-insights-runtime] all assertions passed\n");
