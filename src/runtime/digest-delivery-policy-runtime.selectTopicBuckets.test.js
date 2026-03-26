"use strict";
const assert = require("assert");
const { selectTopicBuckets } = require("./digest-delivery-policy-runtime");

function item(tag, score, url) {
  return { tag, relevanceScore: score, url };
}

// Test 1: 2 topics × 5 items each, pool has 8 per topic
{
  const items = [
    ...Array.from({length: 8}, (_, i) => item("TECHNOLOGY", 9 - i, `https://tech.com/${i}`)),
    ...Array.from({length: 8}, (_, i) => item("HEALTHCARE", 9 - i, `https://health.com/${i}`)),
  ];
  const result = selectTopicBuckets(items, ["TECHNOLOGY", "HEALTHCARE"], 5);
  assert.deepStrictEqual(Object.keys(result).sort(), ["HEALTHCARE", "TECHNOLOGY"]);
  assert.strictEqual(result.TECHNOLOGY.length, 5, "5 tech items");
  assert.strictEqual(result.HEALTHCARE.length, 5, "5 health items");
  const techScores = result.TECHNOLOGY.map(i => i.relevanceScore);
  assert.deepStrictEqual(techScores, [...techScores].sort((a,b) => b-a), "sorted descending by score");
  console.log("✓ 2 topics × 5 each");
}

// Test 2: sparse topic returns all items
{
  const result = selectTopicBuckets([item("ENERGY", 8, "e1"), item("ENERGY", 7, "e2")], ["ENERGY"], 5);
  assert.strictEqual(result.ENERGY.length, 2, "sparse: 2 items returned");
  console.log("✓ sparse topic");
}

// Test 3: non-subscribed topics excluded
{
  const result = selectTopicBuckets([item("TECHNOLOGY", 9, "t1"), item("INDUSTRIALS", 9, "i1")], ["TECHNOLOGY"], 5);
  assert.ok(!result.INDUSTRIALS, "non-subscribed excluded");
  console.log("✓ non-subscribed excluded");
}

// Test 4: missing relevanceScore does not crash
{
  const result = selectTopicBuckets([{ tag: "ENERGY", url: "e1" }, { tag: "ENERGY", url: "e2" }], ["ENERGY"], 5);
  assert.strictEqual(result.ENERGY.length, 2, "missing relevanceScore does not crash");
  console.log("✓ missing relevanceScore safe");
}

console.log("All selectTopicBuckets tests passed ✓");
