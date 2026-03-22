"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/eval/retrieval/scoring-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const {
  buildSourceLevelSummary,
  computeSetQuality,
  freshnessScore,
  itemSourceScore,
} = runtime;

const originalNow = Date.now;
Date.now = () => Date.parse("2026-03-21T12:00:00.000Z");

try {
  assert.strictEqual(freshnessScore({ published_date: "2026-03-21T06:00:00.000Z" }), 100);
  assert.strictEqual(freshnessScore({ published_date: "2026-03-20T11:00:00.000Z" }), 75);
  assert.strictEqual(freshnessScore({ published_date: "2026-03-19T11:00:00.000Z" }), 40);
  assert.strictEqual(freshnessScore({ published_date: "2026-03-18T11:00:00.000Z" }), 0);
  assert.strictEqual(freshnessScore({}), 50);

  const strongPreferred = {
    source_authority: 0.8,
    topicMatch: 8,
    published_date: "2026-03-21T06:00:00.000Z",
    preferred_source_match: "topic_reported",
    source_domain: "reuters.com",
  };
  assert.strictEqual(itemSourceScore(strongPreferred), 87);

  const weakItem = {
    source_authority: 0.18,
    topicMatch: 8,
    published_date: "2026-03-20T11:00:00.000Z",
    preferred_source_match: "none",
    source_domain: "noise.example",
    source_policy: "limited",
  };
  assert.strictEqual(Number(itemSourceScore(weakItem).toFixed(2)), 29.05);

  const quality = computeSetQuality([strongPreferred, weakItem]);
  assert.strictEqual(quality.preferred_hit_rate, 50);
  assert.strictEqual(quality.weak_source_rate, 50);
  assert.strictEqual(quality.unique_domain_count, 2);
  assert.strictEqual(quality.top_domain_share, 50);
  assert.ok(quality.score > 0 && quality.score < 100);

  const summary = buildSourceLevelSummary([
    strongPreferred,
    { ...strongPreferred, url: "https://www.reuters.com/world", headline: "Second item" },
    weakItem,
  ]);
  assert.deepStrictEqual(summary[0], {
    domain: "reuters.com",
    count: 2,
    top_domain_share: 66.67,
  });
} finally {
  Date.now = originalNow;
}

process.stdout.write("[retrieval-scoring-runtime] all assertions passed\n");
