"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createBrokerCandidateInventoryRuntime } = require("./broker-candidate-inventory-runtime");

function item(overrides = {}) {
  return {
    tag: "FINANCIAL SERVICES",
    headline: "Bank launches new payments rail",
    summary: "Summary",
    url: "https://example.com/bank-payments-rail",
    canonical_url: "https://example.com/bank-payments-rail",
    published_date: "2026-03-30T09:00:00.000Z",
    source_domain: "example.com",
    retrieved_at: "2026-03-30T09:05:00.000Z",
    retrieval_origin: "broker_publisher_feed",
    retrieval_lane: "publisher_feed",
    source_tier: 2,
    content_kind: "article",
    broker_source_id: "financial_example",
    ...overrides,
  };
}

async function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-broker-inventory-"));
  const inventoryPath = path.join(tmpDir, "broker-candidate-inventory.json");
  const runtime = createBrokerCandidateInventoryRuntime({
    fs,
    path,
    inventoryPath,
  });

  runtime.persistBrokerTopicItems({
    "FINANCIAL SERVICES": [
      item(),
      item({
        url: "https://example.com/old-story",
        canonical_url: "https://example.com/old-story",
        headline: "Old story",
        published_date: "2026-03-27T07:00:00.000Z",
        retrieved_at: "2026-03-27T07:05:00.000Z",
      }),
      item({
        headline: "Bank launches new payments rail updated",
        summary: "Updated summary",
        retrieved_at: "2026-03-30T09:10:00.000Z",
      }),
    ],
  }, {
    nowMs: Date.parse("2026-03-30T12:00:00.000Z"),
    retentionHours: 72,
  });

  const recent = runtime.loadRecentTopicItems("FINANCIAL SERVICES", {
    nowMs: Date.parse("2026-03-30T12:00:00.000Z"),
    maxAgeHours: 48,
  });

  assert.strictEqual(recent.length, 1, "inventory should retain only fresh deduped broker items");
  assert.strictEqual(recent[0].headline, "Bank launches new payments rail updated", "latest duplicate should win");

  const snapshot = runtime.inspectInventory();
  assert.ok(snapshot.topics["FINANCIAL SERVICES"], "inventory should persist topic buckets");
  assert.strictEqual(snapshot.topics["FINANCIAL SERVICES"].items.length, 1, "stale entries should be trimmed on persist");

  console.log("broker candidate inventory retains recent deduped broker items ✓");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
