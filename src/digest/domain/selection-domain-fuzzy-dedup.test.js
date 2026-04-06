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

// Verify dedupeCandidatesDetailed emits correct reason for fuzzy duplicates.
const { selectItemsByPolicyDetailed } = require("./selection-domain-runtime");
{
  const items = [
    makeItem("Apple Reports Record Q1 Revenue This Year", "https://a.com/1"),
    makeItem("Apple Reports Record First Quarter Revenue This Year", "https://b.com/2"),
  ];
  const result = selectItemsByPolicyDetailed(items, {
    maxItems: 10,
    maxItemsPerTag: 10,
    customTags: [],
    maxCustomItems: 0,
    tagPriority: {},
    maxItemsPerSourceDomain: 5,
  });
  const dupRejection = result.rejected.find((r) => r.reason === "selection_duplicate_headline");
  assert(dupRejection, "dedupeCandidatesDetailed should emit selection_duplicate_headline for fuzzy dup");
  // The fuzzy dup rejection should have duplicate_of set
  assert.ok(dupRejection.duplicate_of != null, "fuzzy dup should have duplicate_of field set");
  console.log("dedupeCandidatesDetailed rejection reason ✓");
  console.log("dedupeCandidatesDetailed fuzzy headline duplicate_of ✓");
}

// Test: duplicate_of survivor linkage for URL dedup
const { dedupeCandidatesDetailed: dedup2 } = require("./selection-domain-runtime");
{
  const exactDups = [
    { url: "https://example.com/story", headline: "Story A" },
    { url: "https://example.com/story", headline: "Story A duplicate" },
  ];
  const exact = dedup2(exactDups);
  const exactDupRej = exact.rejected.find((r) => r.reason === "selection_duplicate_url");
  assert.ok(exactDupRej, "should reject exact duplicate URL");
  assert.ok(exactDupRej.duplicate_of, "exact URL dup should have duplicate_of");
  assert.strictEqual(exactDupRej.duplicate_of, "https://example.com/story");
  console.log("dedupeCandidatesDetailed exact URL duplicate_of ✓");
}

console.log("All selection-domain fuzzy dedup tests passed ✓");
