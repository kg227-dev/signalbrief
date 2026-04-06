"use strict";
const assert = require("assert");
const {
  STAGES,
  normalizeLane,
  normalizeCanonicalUrl,
  normalizeDomain,
  normalizeReason,
  computeDropPct,
  computeConversionRate,
} = require("./admin-api-funnel-shared");

// STAGES order and shape
assert.strictEqual(STAGES[0].key, "fetch");
assert.strictEqual(STAGES[8].key, "enrichment");
assert.strictEqual(STAGES.length, 9);
assert.strictEqual(STAGES[0].type, "pass-through");
assert.strictEqual(STAGES[1].type, "drop-capable");
assert.ok(STAGES.every(s => s.key && s.label && s.type));

// Lane normalization
assert.strictEqual(normalizeLane("broker_publisher_feed"), "broker");
assert.strictEqual(normalizeLane("perplexity_discovery"), "discovery");
assert.strictEqual(normalizeLane("broad"), "discovery");
assert.strictEqual(normalizeLane("unknown_lane"), "broker"); // default to broker for unknown
assert.strictEqual(normalizeLane(""), "broker");

// URL normalization
assert.strictEqual(
  normalizeCanonicalUrl("https://Reuters.com/health/story?utm_source=rss&id=123"),
  "https://reuters.com/health/story?id=123"
);
assert.strictEqual(
  normalizeCanonicalUrl("https://example.com/path/?fbclid=abc&q=1"),
  "https://example.com/path?q=1"
);
assert.strictEqual(
  normalizeCanonicalUrl("https://example.com/path/"),
  "https://example.com/path"
);

// Domain normalization
assert.strictEqual(normalizeDomain("WWW.Reuters.com"), "reuters.com");
assert.strictEqual(normalizeDomain("finance.reuters.com"), "finance.reuters.com");
assert.strictEqual(normalizeDomain("EXAMPLE.COM"), "example.com");
assert.strictEqual(normalizeDomain("www.example.com"), "example.com");

// Reason normalization (aliases from codebase strings → spec enum)
assert.strictEqual(normalizeReason("selection_duplicate_url"), "duplicate_url");
assert.strictEqual(normalizeReason("selection_duplicate_headline"), "duplicate_headline");
assert.strictEqual(normalizeReason("stale_age_filter"), "too_old");
assert.strictEqual(normalizeReason("selection_source_cap"), "selection_source_cap"); // already canonical
assert.strictEqual(normalizeReason("selection_not_selected"), "selection_not_selected"); // already canonical
assert.strictEqual(normalizeReason("low_strategic_relevance"), "low_strategic_relevance"); // already canonical

// Metric helpers
assert.strictEqual(computeDropPct(9, 18), 50);
assert.strictEqual(computeDropPct(0, 34), 0);
assert.strictEqual(computeDropPct(5, 0), 0); // guard against div/0
assert.strictEqual(computeConversionRate(3, 34), Number((3/34).toFixed(4)));
assert.strictEqual(computeConversionRate(0, 0), 0);

console.log("admin-api-funnel-shared tests pass ✓");
