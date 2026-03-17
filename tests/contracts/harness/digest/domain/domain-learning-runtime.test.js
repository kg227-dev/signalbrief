"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/digest/domain/domain-learning-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const {
  accumulateDomainStats,
  computeLearnedAuthorityAdjustments,
} = runtime;

assert.strictEqual(typeof accumulateDomainStats, "function");
assert.strictEqual(typeof computeLearnedAuthorityAdjustments, "function");

// ── Accumulate stats from delivered items ──
{
  const items = [
    { source_domain: "reuters.com", strategic_value: 0.85, source_authority: 0.95 },
    { source_domain: "reuters.com", strategic_value: 0.90, source_authority: 0.95 },
    { source_domain: "obscure-blog.com", strategic_value: 0.30, source_authority: 0.30 },
  ];

  const stats = accumulateDomainStats(items, {});
  assert.strictEqual(stats["reuters.com"].appearances, 2);
  assert.ok(stats["reuters.com"].avg_strategic_value > 0.8, "reuters avg strategic value should be high");
  assert.strictEqual(stats["obscure-blog.com"].appearances, 1);
}

// ── Accumulate preserves existing stats with decay ──
{
  const existing = {
    "existing.com": {
      appearances: 5,
      avg_strategic_value: 0.70,
      avg_authority: 0.60,
      quality_score: 0.60,
      first_seen: "2026-03-01T00:00:00Z",
      last_seen: "2026-03-15T00:00:00Z",
    },
  };
  const items = [
    { source_domain: "existing.com", strategic_value: 0.80, source_authority: 0.65 },
  ];

  const stats = accumulateDomainStats(items, existing);
  assert.strictEqual(stats["existing.com"].appearances, 6);
  assert.ok(stats["existing.com"].last_seen !== "2026-03-15T00:00:00Z", "last_seen should be updated");
}

// ── Learned adjustments: high-quality domain gets promoted ──
{
  const stats = {
    "good-unknown.com": {
      appearances: 8,
      avg_strategic_value: 0.72,
      avg_authority: 0.50,
      quality_score: 0.58,
    },
    "bad-unknown.com": {
      appearances: 6,
      avg_strategic_value: 0.15,
      avg_authority: 0.20,
      quality_score: 0.18,
    },
    "too-few.com": {
      appearances: 2,
      avg_strategic_value: 0.90,
      avg_authority: 0.90,
      quality_score: 0.90,
    },
  };

  const adjustments = computeLearnedAuthorityAdjustments(stats);
  assert.ok(adjustments.has("good-unknown.com"), "high-quality domain should have an adjustment");
  assert.ok(adjustments.get("good-unknown.com") >= 0.45, `promoted authority should be >= 0.45, got ${adjustments.get("good-unknown.com")}`);
  assert.ok(adjustments.get("good-unknown.com") <= 0.55, "promoted authority should be capped at 0.55");
  assert.ok(adjustments.has("bad-unknown.com"), "low-quality domain should have an adjustment");
  assert.ok(adjustments.get("bad-unknown.com") <= 0.20, `demoted authority should be <= 0.20, got ${adjustments.get("bad-unknown.com")}`);
  assert.ok(!adjustments.has("too-few.com"), "domain with < 3 appearances should not have adjustments");
}

// ── Empty inputs handled gracefully ──
{
  const stats1 = accumulateDomainStats([], {});
  assert.deepStrictEqual(stats1, {});

  const adj1 = computeLearnedAuthorityAdjustments({});
  assert.strictEqual(adj1.size, 0);

  const adj2 = computeLearnedAuthorityAdjustments(null);
  assert.strictEqual(adj2.size, 0);
}
