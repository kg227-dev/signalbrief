"use strict";
const assert = require("assert");
const { selectItemsByPolicy } = require("./selection-domain-runtime");

function makeItem(headline, url, tag = "TECHNOLOGY") {
  return { headline, url, tag, source_domain: "example.com" };
}

// Two near-duplicate headlines (Jaccard ~0.8) should deduplicate — only first survives.
{
  const items = [
    makeItem("Apple Reports Record Q1 Revenue This Year", "https://a.com/1"),
    makeItem("Apple Reports Record First Quarter Revenue This Year", "https://b.com/2"),
    makeItem("Fed Raises Interest Rates By Half Point", "https://c.com/3"),
  ];
  const selected = selectItemsByPolicy(items, {
    maxItems: 10,
    maxItemsPerTag: 10,
    customTags: [],
    maxCustomItems: 0,
    tagPriority: {},
    maxItemsPerSourceDomain: 5,
  });
  // The two Apple headlines are near-duplicates; only one should survive
  const appleItems = selected.filter((i) => i.headline.includes("Apple"));
  assert.strictEqual(appleItems.length, 1, `Expected 1 Apple item, got ${appleItems.length}`);
  // The Fed item should always survive
  const fedItems = selected.filter((i) => i.headline.includes("Fed"));
  assert.strictEqual(fedItems.length, 1, "Fed item should survive");
  console.log("dedupeCandidates fuzzy dedup ✓");
}

// Items with completely different headlines should NOT deduplicate.
{
  const items = [
    makeItem("Apple Reports Record Q1 Revenue", "https://a.com/1"),
    makeItem("Microsoft Azure Cloud Revenue Surges", "https://b.com/2"),
    makeItem("Google Search Advertising Revenue Grows", "https://c.com/3"),
  ];
  const selected = selectItemsByPolicy(items, {
    maxItems: 10,
    maxItemsPerTag: 10,
    customTags: [],
    maxCustomItems: 0,
    tagPriority: {},
    maxItemsPerSourceDomain: 5,
  });
  assert.strictEqual(selected.length, 3, `All 3 distinct headlines should survive, got ${selected.length}`);
  console.log("dedupeCandidates distinct headlines all survive ✓");
}

console.log("All selection-domain fuzzy dedup tests passed ✓");
