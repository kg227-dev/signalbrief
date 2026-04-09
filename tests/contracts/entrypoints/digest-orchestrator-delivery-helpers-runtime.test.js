"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/entrypoints/digest-orchestrator-delivery-helpers-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
const {
  buildDeliveryDiagnosticsFields,
  buildDeliverySelection,
  buildDigestSnapshotItems,
  buildQuickScanText,
  buildStrictDeliverySelection,
  buildUserQuickScanRows,
  computeRemainingWindowMinutes,
  deliveryModeAttemptCount,
  filterItemsForSubscribedTopics,
  filterTopicBucketsForSubscribedTopics,
  flattenTopicBuckets,
  getRequestedItemCount,
  getSubscribedStandardTopics,
  groupFlatItemsByTopic,
  listIncompleteTopics,
} = runtime;
assertModuleExports(() => runtime, TARGET_REL);

(async () => {
  assert.strictEqual(deliveryModeAttemptCount({}), 1);
  assert.strictEqual(deliveryModeAttemptCount({ __digest_retry: { attempt_count: 2 } }), 3);

  assert.strictEqual(
    computeRemainingWindowMinutes(60, { delivery_time: "07:00" }, new Date("2026-03-14T11:12:00.000Z")),
    48
  );

  assert.deepStrictEqual(
    getSubscribedStandardTopics({ topics: ["TECHNOLOGY", " custom_watch ", "custom_ai", ""] }),
    ["TECHNOLOGY"]
  );
  assert.strictEqual(getRequestedItemCount(["TECHNOLOGY", "ENERGY"], 5), 10);

  const subscribedItems = filterItemsForSubscribedTopics([
    { tag: "TECHNOLOGY", url: "https://example.com/tech" },
    { tag: "ENERGY", url: "https://example.com/energy" },
  ], ["ENERGY"]);
  assert.deepStrictEqual(subscribedItems.map((item) => item.url), ["https://example.com/energy"]);

  const filteredBuckets = filterTopicBucketsForSubscribedTopics({
    TECHNOLOGY: [{ url: "https://example.com/tech" }],
    ENERGY: [{ url: "https://example.com/energy" }],
  }, ["ENERGY", "HEALTHCARE"]);
  assert.deepStrictEqual(Object.keys(filteredBuckets), ["ENERGY", "HEALTHCARE"]);
  assert.strictEqual(filteredBuckets.ENERGY.length, 1);
  assert.strictEqual(filteredBuckets.HEALTHCARE.length, 0);

  const grouped = groupFlatItemsByTopic([
    { tag: "technology", url: "https://example.com/tech" },
    { tag: "ENERGY", url: "https://example.com/energy" },
  ]);
  assert.deepStrictEqual(Object.keys(grouped), ["TECHNOLOGY", "ENERGY"]);
  assert.deepStrictEqual(
    flattenTopicBuckets(grouped, ["ENERGY", "TECHNOLOGY"]).map((item) => item.url),
    ["https://example.com/energy", "https://example.com/tech"]
  );

  const deliverySelection = buildDeliverySelection(
    [{ url: "https://example.com/1" }],
    { TECHNOLOGY: [{ url: "https://example.com/1" }] },
    5,
    ["TECHNOLOGY"]
  );
  assert.strictEqual(deliverySelection.delivery_eligible, false);
  assert.strictEqual(deliverySelection.available_count, 1);

  const strictSelection = buildStrictDeliverySelection({
    items: [{ url: "https://example.com/strict" }],
    topic_buckets: { TECHNOLOGY: [{ url: "https://example.com/strict" }] },
    delivery_eligible: true,
    blocked_topics: [{ tag: "ENERGY", reason: "thin" }],
    surviving_topic_bucket_count: 1,
    total_exceptions_used: 2,
    extreme_underfill: true,
    extreme_underfill_target_rate_pct: 2,
  });
  assert.strictEqual(strictSelection.delivery_eligible, true);
  assert.strictEqual(strictSelection.strict_quality_exception_count, 2);
  assert.strictEqual(strictSelection.blocked_topics.length, 1);

  assert.deepStrictEqual(
    listIncompleteTopics(
      { TECHNOLOGY: [{ url: "https://example.com/1" }], ENERGY: [] },
      ["TECHNOLOGY", "ENERGY"],
      { minPerTopic: 2, allowUnderfillTopicTags: ["TECHNOLOGY"] }
    ),
    ["ENERGY"]
  );

  const quickScan = buildQuickScanText([
    { headline: "Alpha <b>One</b>" },
    { headline: "Beta & Co." },
  ], (value) => String(value || "").replace(/<[^>]+>/g, ""));
  assert.ok(quickScan.includes("Alpha One"));
  assert.ok(quickScan.includes("Beta & Co."));

  const snapshotItems = buildDigestSnapshotItems([{
    headline: "Snapshot item",
    url: "https://example.com/item",
    why_shown: ["reason"],
    entity_keys: ["entity"],
    score_breakdown: { freshness: 0.8 },
    strict_quality: { pass: true },
  }], () => "fallback.example.com");
  assert.strictEqual(snapshotItems[0].source_domain, "fallback.example.com");
  assert.notStrictEqual(snapshotItems[0].why_shown, undefined);
  assert.deepStrictEqual(snapshotItems[0].score_breakdown, { freshness: 0.8 });

  const diagnosticsFields = buildDeliveryDiagnosticsFields({
    requested_count: 5,
    blocked_topic_list: [{ tag: "ENERGY", reason: "thin" }],
    writeup_allow_underfill_topic_tags: ["TECHNOLOGY"],
    strict_quality_exception_count: 1,
    extreme_underfill_target_rate_pct: 2,
  });
  assert.deepStrictEqual(diagnosticsFields.blocked_topic_list, [{ tag: "ENERGY", reason: "thin" }]);
  assert.deepStrictEqual(diagnosticsFields.writeup_allow_underfill_topic_tags, ["TECHNOLOGY"]);
  assert.strictEqual(diagnosticsFields.strict_quality_exception_count, 1);

  const quickScanRows = buildUserQuickScanRows([{
    tag: "<TECH>",
    headline: "Alpha <b>One</b>",
  }], {
    stripInlineHtml: (value) => String(value || "").replace(/<[^>]+>/g, ""),
    topicVisual: () => ({ icon: "*", chipText: "#123", chipBg: "#fff" }),
    escapeHtml: (value) => String(value || "").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
  });
  assert.ok(quickScanRows.includes("&lt;TECH&gt;"));
  assert.ok(quickScanRows.includes("Alpha One"));
})();
