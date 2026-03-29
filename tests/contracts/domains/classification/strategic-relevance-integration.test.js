"use strict";

const assert = require("assert");
const path = require("path");

const CLASSIFIER_PATH = path.join(process.cwd(), "src/domains/classification/strategic-relevance-classifier.js");
const SCORING_PATH = path.join(process.cwd(), "src/domains/classification/strategic-relevance-scoring.js");
const CACHE_PATH = path.join(process.cwd(), "src/domains/classification/strategic-relevance-cache.js");

const {
  CLASSIFIER_VERSION,
  classifyCandidates,
  runConcurrent,
} = require(CLASSIFIER_PATH);

const {
  filterLowRelevance,
  boostHighRelevance,
} = require(SCORING_PATH);

const {
  hashUrl,
  buildCacheKey,
  lookupCache,
  writeEntry,
} = require(CACHE_PATH);

let passed = 0;
let failed = 0;

function test(label, fn) {
  try {
    fn();
    passed++;
    process.stdout.write(`  PASS  ${label}\n`);
  } catch (err) {
    failed++;
    process.stderr.write(`  FAIL  ${label}\n    ${err.message}\n`);
  }
}

function makeCandidate(tag, headline, score, url) {
  return {
    tag,
    headline,
    snippet: `Summary of ${headline}`,
    url: url || `https://example.com/${tag.toLowerCase()}/${encodeURIComponent(headline)}`,
    source_domain: "example.com",
    _score: score,
  };
}

// ─── Feature gate off: no classification fields ─────────────────────────────

test("Feature gate off: candidates have no classification fields", () => {
  const candidates = [
    makeCandidate("TECH", "Apple releases new chip", 0.7),
    makeCandidate("MARKETS", "Fed holds rates", 0.8),
  ];
  for (const c of candidates) {
    assert.strictEqual(c.strategic_relevance, undefined, "should not have strategic_relevance before classification");
    assert.strictEqual(c.strategic_relevance_applied, undefined, "should not have strategic_relevance_applied");
  }
});

// ─── Re-sort after boost: HIGH at lower original score ends up above MEDIUM ─

test("Re-sort after boost: HIGH at lower score overtakes MEDIUM after boost", () => {
  const candidates = [
    { ...makeCandidate("TECH", "Medium story", 0.75, "https://example.com/m"), strategic_relevance: "MEDIUM", strategic_relevance_applied: true, _score: 0.75 },
    { ...makeCandidate("TECH", "High story", 0.68, "https://example.com/h"), strategic_relevance: "HIGH", strategic_relevance_applied: true, _score: 0.68 },
  ];

  const { boosted } = boostHighRelevance(candidates, { boostAmount: 0.12 });

  // HIGH item: 0.68 + 0.12 = 0.80 -> should now be above MEDIUM at 0.75
  boosted.sort((a, b) => (b._score || 0) - (a._score || 0));

  assert.strictEqual(boosted[0].strategic_relevance, "HIGH", "HIGH item should be first after boost + re-sort");
  assert.ok(boosted[0]._score > boosted[1]._score, "boosted HIGH score should exceed MEDIUM score");
});

// ─── Cache key consistency across modules ───────────────────────────────────

test("Cache key consistency: hashUrl + buildCacheKey produce stable keys", () => {
  const url = "https://Example.com/article/123?utm_source=test&foo=bar";

  const hash1 = hashUrl(url);
  const hash2 = hashUrl(url);
  assert.strictEqual(hash1, hash2, "hashUrl should be deterministic");

  const key1 = buildCacheKey(url, CLASSIFIER_VERSION);
  const key2 = buildCacheKey(url, CLASSIFIER_VERSION);
  assert.strictEqual(key1, key2, "buildCacheKey should be deterministic");
  assert.ok(key1.endsWith(`:${CLASSIFIER_VERSION}`), "key should end with classifier version");

  const keyDiffVersion = buildCacheKey(url, "2.0");
  assert.notStrictEqual(key1, keyDiffVersion, "different version should produce different key");

  // UTM params should be stripped
  const urlNoUtm = "https://Example.com/article/123?foo=bar";
  const hashNoUtm = hashUrl(urlNoUtm);
  assert.strictEqual(hash1, hashNoUtm, "UTM params should not affect hash");
});

// ─── Cache write + lookup roundtrip ─────────────────────────────────────────

test("Cache write + lookup roundtrip works across modules", () => {
  const cache = new Map();
  const url = "https://example.com/test-article";

  writeEntry(cache, url, CLASSIFIER_VERSION, { classification: "HIGH", reason: "major event" }, { source: "example.com", topic: "TECH" }, null);

  const entry = lookupCache(cache, url, CLASSIFIER_VERSION, { ttlDays: 14 });
  assert.ok(entry, "should find cache entry");
  assert.strictEqual(entry.classification, "HIGH");
  assert.strictEqual(entry.reason, "major event");

  const miss = lookupCache(cache, url, "99.0", { ttlDays: 14 });
  assert.strictEqual(miss, null, "different version should miss");
});

// ─── Async integration tests ────────────────────────────────────────────────

(async () => {
  async function asyncTest(label, fn) {
    try {
      await fn();
      passed++;
      process.stdout.write(`  PASS  ${label}\n`);
    } catch (err) {
      failed++;
      process.stderr.write(`  FAIL  ${label}\n    ${err.message}\n`);
    }
  }

  // ─── Full pipeline: classify -> filter -> boost -> verify fields ──────────

  await asyncTest("Full pipeline: classify -> filter -> boost -> verify fields", async () => {
    const candidates = [];
    for (let i = 0; i < 10; i++) {
      candidates.push(makeCandidate("TECH", `High story ${i}`, 0.7, `https://example.com/tech/high-${i}`));
    }
    for (let i = 0; i < 8; i++) {
      candidates.push(makeCandidate("TECH", `Medium story ${i}`, 0.5, `https://example.com/tech/medium-${i}`));
    }
    for (let i = 0; i < 5; i++) {
      candidates.push(makeCandidate("TECH", `Low story ${i}`, 0.3, `https://example.com/tech/low-${i}`));
    }

    let callIdx = 0;
    const labels = [
      ...Array(10).fill("HIGH"),
      ...Array(8).fill("MEDIUM"),
      ...Array(5).fill("LOW"),
    ];
    const mockHttpsPost = async function () {
      const label = labels[callIdx] || "MEDIUM";
      callIdx++;
      return {
        status: 200,
        body: { content: [{ text: JSON.stringify({ classification: label, reason: "test reason" }) }] },
      };
    };

    // Phase 1: Classify
    const { candidates: classified, diagnostics } = await classifyCandidates(candidates, {
      cache: new Map(),
      config: { ANTHROPIC_API_KEY: "test-key" },
      httpsPost: mockHttpsPost,
    });

    assert.strictEqual(diagnostics.total_classified, 23, "should classify all 23");
    assert.strictEqual(diagnostics.model_calls, 23, "should make 23 model calls");
    assert.strictEqual(diagnostics.high, 10);
    assert.strictEqual(diagnostics.medium, 8);
    assert.strictEqual(diagnostics.low, 5);

    for (const c of classified) {
      assert.ok(c.strategic_relevance_applied === true, "strategic_relevance_applied should be true");
      assert.ok(["HIGH", "MEDIUM", "LOW"].includes(c.strategic_relevance), "must have valid label");
    }

    // Phase 2: Filter LOW (>= 20 pool => all LOW dropped)
    const { filtered, dropped } = filterLowRelevance(classified);
    assert.strictEqual(dropped.length, 5, "should drop 5 LOW items");
    assert.strictEqual(filtered.length, 18, "should keep 18 non-LOW items");

    // Phase 3: Boost HIGH
    const { boosted, diagnostics: boostDiag } = boostHighRelevance(filtered, { boostAmount: 0.12 });
    assert.strictEqual(boosted.length, 18, "boosted should have same count as filtered");

    const highBoosted = boosted.filter((c) => c.strategic_relevance === "HIGH");
    for (const c of highBoosted) {
      assert.ok(c._strategic_boost_applied > 0, "HIGH items should have boost applied");
      assert.ok(c._score_before_strategic !== undefined, "should record original score");
    }

    const mediumItems = boosted.filter((c) => c.strategic_relevance === "MEDIUM");
    for (const c of mediumItems) {
      assert.strictEqual(c._strategic_boost_applied, 0, "MEDIUM items should not be boosted");
    }
  });

  // ─── runConcurrent processes all items ────────────────────────────────────

  await asyncTest("runConcurrent: processes all items", async () => {
    const items = Array.from({ length: 20 }, (_, i) => ({ id: i, processed: false }));
    await runConcurrent(items, async (item) => {
      item.processed = true;
    }, 4);

    for (const item of items) {
      assert.strictEqual(item.processed, true, `item ${item.id} should be processed`);
    }
  });

  // ─── classifyCandidates uses cache hits ───────────────────────────────────

  await asyncTest("classifyCandidates: uses cache hits and skips model call", async () => {
    const cache = new Map();
    const url = "https://example.com/cached-article";

    writeEntry(cache, url, CLASSIFIER_VERSION, { classification: "HIGH", reason: "cached" }, {}, null);

    const candidates = [{ url, headline: "Cached article", tag: "TECH", source_domain: "example.com" }];

    let modelCalled = false;
    const mockHttpsPost = async () => {
      modelCalled = true;
      return { status: 200, body: { content: [{ text: '{"classification":"LOW","reason":"model"}' }] } };
    };

    const { candidates: result, diagnostics } = await classifyCandidates(candidates, {
      cache,
      config: { ANTHROPIC_API_KEY: "test-key" },
      httpsPost: mockHttpsPost,
    });

    assert.strictEqual(diagnostics.cache_hits, 1, "should have 1 cache hit");
    assert.strictEqual(diagnostics.model_calls, 0, "should have 0 model calls");
    assert.strictEqual(result[0].strategic_relevance, "HIGH", "should use cached classification");
    assert.strictEqual(result[0].strategic_relevance_source, "cache");
    assert.strictEqual(modelCalled, false, "model should not be called for cached items");
  });

  // ─── Summary ──────────────────────────────────────────────────────────────

  process.stdout.write(`\n  ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
})().catch((err) => {
  process.stderr.write(`Uncaught async error: ${err.message}\n`);
  process.exit(1);
});
