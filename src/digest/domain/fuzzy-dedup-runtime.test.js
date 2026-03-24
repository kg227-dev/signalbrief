"use strict";
const assert = require("assert");

// Will fail until fuzzy-dedup-runtime.js is implemented.
const {
  tokenizeHeadline,
  jaccardSimilarity,
  isFuzzyDuplicateHeadline,
} = require("./fuzzy-dedup-runtime");

// tokenizeHeadline
{
  const tokens = tokenizeHeadline("Apple Reports Record Q1 Revenue");
  assert(tokens instanceof Set, "tokenizeHeadline returns a Set");
  assert(tokens.has("apple"), "lowercased");
  assert(tokens.has("reports"), "word included");
  assert(!tokens.has("q1"), "short tokens (< 3 chars) excluded");
  console.log("tokenizeHeadline basic ✓");
}

// jaccardSimilarity
{
  const a = new Set(["apple", "reports", "record", "revenue"]);
  const b = new Set(["apple", "reports", "record", "first", "quarter", "revenue"]);
  const j = jaccardSimilarity(a, b);
  // intersection=4 (apple,reports,record,revenue), union=6 → 4/6 ≈ 0.667
  assert(j > 0.6 && j < 0.7, `jaccard expected ~0.667, got ${j}`);

  const identical = new Set(["foo", "bar"]);
  assert(jaccardSimilarity(identical, identical) === 1, "identical sets → 1");

  const disjoint = new Set(["foo"]);
  assert(jaccardSimilarity(disjoint, new Set(["bar"])) === 0, "disjoint → 0");

  const emptyA = new Set();
  assert(jaccardSimilarity(emptyA, new Set(["bar"])) === 0, "empty vs non-empty → 0");
  console.log("jaccardSimilarity ✓");
}

// isFuzzyDuplicateHeadline
{
  const seen = [new Set(["apple", "reports", "record", "quarter", "revenue"])];
  // Very similar: should be dup
  const dup = new Set(["apple", "reports", "record", "first", "quarter", "revenue"]);
  assert(isFuzzyDuplicateHeadline(dup, seen, 0.7), "similar headline is dup at 0.7");
  // Completely different: not a dup
  const diff = new Set(["fed", "raises", "interest", "rates", "again"]);
  assert(!isFuzzyDuplicateHeadline(diff, seen, 0.7), "different headline is not dup");
  // Empty seen list: never a dup
  assert(!isFuzzyDuplicateHeadline(dup, [], 0.7), "empty seen → not dup");
  console.log("isFuzzyDuplicateHeadline ✓");
}

console.log("All fuzzy-dedup-runtime tests passed ✓");
