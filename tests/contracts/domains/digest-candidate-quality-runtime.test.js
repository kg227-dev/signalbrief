"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/domains/digest/candidate-quality-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);

assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const {
  computeItemAgeHours,
  countTrustedSourceTier,
  isTrustedSourceTier,
  normalizeSourceTier,
  splitByFreshnessTiers,
} = runtime;

const NOW_MS = Date.parse("2026-04-08T12:00:00.000Z");

assert.strictEqual(normalizeSourceTier("premium"), 1);
assert.strictEqual(normalizeSourceTier({ source_tier: "strong" }), 2);
assert.strictEqual(normalizeSourceTier(3), 3);
assert.strictEqual(normalizeSourceTier("unknown"), null);

assert.strictEqual(isTrustedSourceTier({ source_tier: "premium" }), true);
assert.strictEqual(isTrustedSourceTier({ source_tier: 2 }), true);
assert.strictEqual(isTrustedSourceTier({ source_tier: "standard" }), false);
assert.strictEqual(countTrustedSourceTier([
  { source_tier: "premium" },
  { source_tier: "strong" },
  { source_tier: "standard" },
  { source_tier: null },
]), 2);

assert.strictEqual(
  computeItemAgeHours({ published_date: "2026-04-08T06:00:00.000Z" }, NOW_MS),
  6
);
assert.strictEqual(
  computeItemAgeHours({ published_at: "2026-04-07T12:00:00.000Z" }, NOW_MS),
  24
);
assert.strictEqual(computeItemAgeHours({}, NOW_MS), Infinity);

const tiers = splitByFreshnessTiers([
  { id: "tier1", published_date: "2026-04-08T08:00:00.000Z" },
  { id: "tier2", published_date: "2026-04-07T10:00:00.000Z" },
  { id: "tier3", published_date: "2026-04-05T10:00:00.000Z" },
], NOW_MS);
assert.deepStrictEqual(tiers.tier1.map((item) => item.id), ["tier1"]);
assert.deepStrictEqual(tiers.tier2.map((item) => item.id), ["tier2"]);
assert.deepStrictEqual(tiers.tier3.map((item) => item.id), ["tier3"]);

process.stdout.write("[digest-candidate-quality-runtime] all assertions passed\n");
