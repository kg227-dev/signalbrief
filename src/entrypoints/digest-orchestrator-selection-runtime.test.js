"use strict";
const assert = require("assert");

// Pure unit test of the freshness-tier splitting helpers that will be exported.
let splitByFreshnessTiers;
try {
  ({ splitByFreshnessTiers } = require("./digest-orchestrator-selection-runtime"));
} catch (_) {
  // will fail at export assertion below
}

assert(typeof splitByFreshnessTiers === "function",
  "splitByFreshnessTiers must be exported from digest-orchestrator-selection-runtime");

const NOW = Date.now();
const h = (hours) => NOW - hours * 60 * 60 * 1000;

function makeItem(tag, headline, ageHours) {
  return { tag, headline, url: `https://x.com/${headline}`, published_at: h(ageHours) };
}

// Tier splitting: items at 0h, 20h, 30h, 50h
{
  const items = [
    makeItem("TECHNOLOGY", "headline-0h", 0),
    makeItem("TECHNOLOGY", "headline-20h", 20),
    makeItem("TECHNOLOGY", "headline-30h", 30),
    makeItem("TECHNOLOGY", "headline-50h", 50),
  ];
  const { tier1, tier2, tier3 } = splitByFreshnessTiers(items, NOW);
  assert.strictEqual(tier1.length, 2, "tier1 (0-24h): 2 items");
  assert.strictEqual(tier2.length, 1, "tier2 (24-48h): 1 item");
  assert.strictEqual(tier3.length, 1, "tier3 (48h+): 1 item");
  console.log("splitByFreshnessTiers ✓");
}

// Items with no timestamp go to tier3
{
  const items = [makeItem("TECHNOLOGY", "no-ts", 0)];
  items[0].published_at = undefined;
  const { tier1, tier2, tier3 } = splitByFreshnessTiers(items, NOW);
  assert.strictEqual(tier1.length, 0);
  assert.strictEqual(tier2.length, 0);
  assert.strictEqual(tier3.length, 1, "missing timestamp → tier3");
  console.log("missing timestamp → tier3 ✓");
}

console.log("All selection guarantee tests passed ✓");
