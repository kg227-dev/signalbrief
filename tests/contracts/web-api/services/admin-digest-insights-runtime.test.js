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
  ], { days: 7 });

  assert.strictEqual(insights.users.length, 1);
  assert.strictEqual(insights.users[0].recipient, "repeat@example.com");
  assert.strictEqual(insights.users[0].digests, 2);
  assert.strictEqual(insights.users[0].repeat_blocks, 3);
  assert.strictEqual(insights.users[0].refill_count, 2);
})();

process.stdout.write("[admin-digest-insights-runtime] all assertions passed\n");
