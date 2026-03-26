"use strict";
const assert = require("assert");
const { computeItemAgeHours, splitByFreshnessTiers } = require("./digest-orchestrator-selection-runtime");

const NOW_MS = 1000 * 60 * 60 * 100; // arbitrary epoch offset: 100h from epoch 0

// computeItemAgeHours — canonical field is published_date
{
  const item = { published_date: new Date(NOW_MS - 10 * 60 * 60 * 1000).toISOString() }; // 10h ago
  const age = computeItemAgeHours(item, NOW_MS);
  assert.ok(age >= 9.9 && age <= 10.1, `expected ~10h, got ${age}`);
  console.log("computeItemAgeHours uses published_date ✓");
}

{
  // published_at (legacy fallback) still works when published_date absent
  const item = { published_at: new Date(NOW_MS - 5 * 60 * 60 * 1000).toISOString() };
  const age = computeItemAgeHours(item, NOW_MS);
  assert.ok(age >= 4.9 && age <= 5.1, `expected ~5h, got ${age}`);
  console.log("computeItemAgeHours falls back to published_at ✓");
}

{
  // missing date → Infinity
  const age = computeItemAgeHours({}, NOW_MS);
  assert.strictEqual(age, Infinity, "missing date → Infinity");
  console.log("computeItemAgeHours missing date → Infinity ✓");
}

// splitByFreshnessTiers — tier placement with published_date
{
  const t0 = new Date(NOW_MS).toISOString();
  const t12 = new Date(NOW_MS - 12 * 60 * 60 * 1000).toISOString();
  const t36 = new Date(NOW_MS - 36 * 60 * 60 * 1000).toISOString();
  const t60 = new Date(NOW_MS - 60 * 60 * 60 * 1000).toISOString();

  const items = [
    { published_date: t0 },    // 0h → tier1
    { published_date: t12 },   // 12h → tier1
    { published_date: t36 },   // 36h → tier2
    { published_date: t60 },   // 60h → tier3
  ];
  const { tier1, tier2, tier3 } = splitByFreshnessTiers(items, NOW_MS);
  assert.strictEqual(tier1.length, 2, "tier1 has 0–24h items");
  assert.strictEqual(tier2.length, 1, "tier2 has 24–48h items");
  assert.strictEqual(tier3.length, 1, "tier3 has 48h+ items");
  console.log("splitByFreshnessTiers tiers correctly with published_date ✓");
}

console.log("All splitByFreshnessTiers tests passed ✓");
