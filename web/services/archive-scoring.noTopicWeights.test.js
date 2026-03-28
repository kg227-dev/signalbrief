"use strict";

const assert = require("assert");
const { archiveRelevanceScore } = require("./archive-scoring");

const item = {
  tag: "TECHNOLOGY",
  headline: "Technology outlook brightens",
  summary: "AI and cloud budgets are rising.",
  baseScore: 6,
};

const topics = ["TECHNOLOGY"];
const baseline = archiveRelevanceScore(item, topics);
const boosted = archiveRelevanceScore(item, topics, { TECHNOLOGY: 5 });
const penalized = archiveRelevanceScore(item, topics, { TECHNOLOGY: -5 });

assert.strictEqual(baseline, 7.6, "archive score should still reflect base score plus topic match");
assert.strictEqual(boosted, baseline, "deprecated topic weights must not boost archive ranking");
assert.strictEqual(penalized, baseline, "deprecated topic weights must not penalize archive ranking");

console.log("archive scoring ignores deprecated topic weights ✓");
