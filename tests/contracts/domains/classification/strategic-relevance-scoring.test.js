"use strict";

const assert = require("assert");
const path = require("path");

const TARGET_REL = "src/domains/classification/strategic-relevance-scoring.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);

const {
  filterLowRelevance,
  boostHighRelevance,
} = require(TARGET_PATH);

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

function makeCandidate(tag, relevance, score) {
  return {
    tag,
    strategic_relevance: relevance,
    strategic_relevance_applied: true,
    _score: score,
    headline: `Test ${relevance}`,
    url: `https://example.com/${tag}-${relevance}-${score}`,
  };
}

// ─── filterLowRelevance ───────────────────────────────────────────────────────

test("filterLowRelevance: drops all LOW when topic >= 20 candidates", () => {
  // 18 HIGH + 5 LOW = 23 total → 18 remain, 5 dropped
  const candidates = [
    ...Array.from({ length: 18 }, () => makeCandidate("TECH", "HIGH", 0.8)),
    ...Array.from({ length: 5 }, () => makeCandidate("TECH", "LOW", 0.3)),
  ];
  const { filtered, dropped, diagnostics } = filterLowRelevance(candidates);
  assert.strictEqual(filtered.length, 18, `expected 18 filtered, got ${filtered.length}`);
  assert.strictEqual(dropped.length, 5, `expected 5 dropped, got ${dropped.length}`);
  assert.strictEqual(diagnostics["TECH"].low_dropped, 5);
  assert.strictEqual(diagnostics["TECH"].thin_pool_mode, false);
});

test("filterLowRelevance: keeps LOW when topic < 15 (thin pool)", () => {
  // 10 MEDIUM + 3 LOW = 13 total → 13 remain, 0 dropped, thin_pool_mode=true
  const candidates = [
    ...Array.from({ length: 10 }, () => makeCandidate("ENERGY", "MEDIUM", 0.5)),
    ...Array.from({ length: 3 }, () => makeCandidate("ENERGY", "LOW", 0.2)),
  ];
  const { filtered, dropped, diagnostics } = filterLowRelevance(candidates);
  assert.strictEqual(filtered.length, 13, `expected 13 filtered, got ${filtered.length}`);
  assert.strictEqual(dropped.length, 0, `expected 0 dropped, got ${dropped.length}`);
  assert.strictEqual(diagnostics["ENERGY"].thin_pool_mode, true);
  assert.strictEqual(diagnostics["ENERGY"].low_dropped, 0);
});

test("filterLowRelevance: drops LOW in 15-19 range when safe", () => {
  // 14 HIGH + 3 LOW = 17 total → 14 remain, 3 dropped
  const candidates = [
    ...Array.from({ length: 14 }, () => makeCandidate("MACRO", "HIGH", 0.7)),
    ...Array.from({ length: 3 }, () => makeCandidate("MACRO", "LOW", 0.2)),
  ];
  const { filtered, dropped, diagnostics } = filterLowRelevance(candidates);
  assert.strictEqual(filtered.length, 14, `expected 14 filtered, got ${filtered.length}`);
  assert.strictEqual(dropped.length, 3, `expected 3 dropped, got ${dropped.length}`);
  assert.strictEqual(diagnostics["MACRO"].low_dropped, 3);
  assert.strictEqual(diagnostics["MACRO"].thin_pool_mode, false);
});

test("filterLowRelevance: keeps LOW in 15-19 range when dropping would leave < 5 non-LOW", () => {
  // 4 MEDIUM + 12 LOW = 16 total → 16 remain, 0 dropped
  // dropping 12 LOW would leave only 4 non-LOW, which is < 5
  const candidates = [
    ...Array.from({ length: 4 }, () => makeCandidate("FINANCE", "MEDIUM", 0.5)),
    ...Array.from({ length: 12 }, () => makeCandidate("FINANCE", "LOW", 0.2)),
  ];
  const { filtered, dropped, diagnostics } = filterLowRelevance(candidates);
  assert.strictEqual(filtered.length, 16, `expected 16 filtered, got ${filtered.length}`);
  assert.strictEqual(dropped.length, 0, `expected 0 dropped, got ${dropped.length}`);
  assert.strictEqual(diagnostics["FINANCE"].low_dropped, 0);
});

test("filterLowRelevance: per-topic independence (TECH drops, ENERGY keeps)", () => {
  // TECH: 18 HIGH + 4 LOW = 22 items → drops 4 LOW
  // ENERGY: 7 MEDIUM + 3 LOW = 10 items → keeps all (thin pool)
  const candidates = [
    ...Array.from({ length: 18 }, () => makeCandidate("TECH", "HIGH", 0.8)),
    ...Array.from({ length: 4 }, () => makeCandidate("TECH", "LOW", 0.3)),
    ...Array.from({ length: 7 }, () => makeCandidate("ENERGY", "MEDIUM", 0.5)),
    ...Array.from({ length: 3 }, () => makeCandidate("ENERGY", "LOW", 0.2)),
  ];
  const { filtered, dropped, diagnostics } = filterLowRelevance(candidates);
  assert.strictEqual(dropped.length, 4, `expected 4 total dropped, got ${dropped.length}`);
  assert.strictEqual(diagnostics["TECH"].low_dropped, 4);
  assert.strictEqual(diagnostics["ENERGY"].low_dropped, 0);
  assert.strictEqual(diagnostics["ENERGY"].thin_pool_mode, true);
  assert.strictEqual(diagnostics["TECH"].thin_pool_mode, false);
  // Total filtered: 18 TECH + 10 ENERGY = 28
  assert.strictEqual(filtered.length, 28, `expected 28 filtered, got ${filtered.length}`);
});

test("filterLowRelevance: empty candidates → empty results", () => {
  const { filtered, dropped, diagnostics } = filterLowRelevance([]);
  assert.strictEqual(filtered.length, 0);
  assert.strictEqual(dropped.length, 0);
  assert.deepStrictEqual(diagnostics, {});
});

test("filterLowRelevance: diagnostics has correct per-topic counts", () => {
  // 3 HIGH + 2 MEDIUM + 4 LOW = 9 total for one topic (thin pool < 15)
  const candidates = [
    ...Array.from({ length: 3 }, () => makeCandidate("GEO", "HIGH", 0.9)),
    ...Array.from({ length: 2 }, () => makeCandidate("GEO", "MEDIUM", 0.6)),
    ...Array.from({ length: 4 }, () => makeCandidate("GEO", "LOW", 0.2)),
  ];
  const { diagnostics } = filterLowRelevance(candidates);
  const d = diagnostics["GEO"];
  assert.ok(d, "expected diagnostics for GEO topic");
  assert.strictEqual(d.topic, "GEO");
  assert.strictEqual(d.total_candidates, 9);
  assert.strictEqual(d.count_high, 3);
  assert.strictEqual(d.count_medium, 2);
  assert.strictEqual(d.count_low, 4);
  assert.strictEqual(d.low_dropped, 0, "thin pool: no dropping");
  assert.strictEqual(d.thin_pool_mode, true);
});

// ─── boostHighRelevance ───────────────────────────────────────────────────────

test("boostHighRelevance: boosts HIGH by default 0.12", () => {
  const candidates = [makeCandidate("TECH", "HIGH", 0.7)];
  const { boosted } = boostHighRelevance(candidates);
  const c = boosted[0];
  assert.strictEqual(c._score_before_strategic, 0.7);
  assert.strictEqual(c._strategic_boost_applied, 0.12);
  assert.strictEqual(c._score_final, 0.82);
});

test("boostHighRelevance: caps score at 1.0", () => {
  // 0.95 + 0.12 = 1.07 → capped at 1.0, boost applied = 0.05
  const candidates = [makeCandidate("TECH", "HIGH", 0.95)];
  const { boosted } = boostHighRelevance(candidates);
  const c = boosted[0];
  assert.strictEqual(c._score_final, 1.0);
  assert.strictEqual(c._strategic_boost_applied, 0.05);
});

test("boostHighRelevance: MEDIUM and LOW get zero boost", () => {
  const candidates = [
    makeCandidate("TECH", "MEDIUM", 0.6),
    makeCandidate("TECH", "LOW", 0.3),
  ];
  const { boosted } = boostHighRelevance(candidates);
  for (const c of boosted) {
    assert.strictEqual(c._strategic_boost_applied, 0, `expected 0 boost for ${c.strategic_relevance}`);
    assert.strictEqual(c._score_final, c._score_before_strategic, "score should be unchanged");
  }
});

test("boostHighRelevance: custom boostAmount", () => {
  // 0.5 + 0.2 = 0.7
  const candidates = [makeCandidate("FINANCE", "HIGH", 0.5)];
  const { boosted } = boostHighRelevance(candidates, { boostAmount: 0.2 });
  const c = boosted[0];
  assert.strictEqual(c._score_final, 0.7);
  assert.strictEqual(c._strategic_boost_applied, 0.2);
});

test("boostHighRelevance: preserves _score_before_strategic for all candidates", () => {
  const candidates = [
    makeCandidate("MACRO", "HIGH", 0.8),
    makeCandidate("MACRO", "MEDIUM", 0.5),
    makeCandidate("MACRO", "LOW", 0.2),
  ];
  const { boosted } = boostHighRelevance(candidates);
  assert.strictEqual(boosted[0]._score_before_strategic, 0.8);
  assert.strictEqual(boosted[1]._score_before_strategic, 0.5);
  assert.strictEqual(boosted[2]._score_before_strategic, 0.2);
});

test("boostHighRelevance: boostInThinPool=false skips boost for thin topics (<15 candidates)", () => {
  // 10 candidates total for ENERGY → thin pool
  const candidates = Array.from({ length: 10 }, (_, i) =>
    makeCandidate("ENERGY", i < 5 ? "HIGH" : "MEDIUM", 0.6)
  );
  const { boosted } = boostHighRelevance(candidates, { boostInThinPool: false });
  for (const c of boosted) {
    assert.strictEqual(c._strategic_boost_applied, 0, "thin pool with boostInThinPool=false: no boost");
    assert.strictEqual(c._score_final, c._score_before_strategic);
  }
});

test("boostHighRelevance: boostInThinPool=true (default) boosts in thin topics", () => {
  // 10 candidates total for ENERGY → thin pool, but boost still applied (default behavior)
  const candidates = [makeCandidate("ENERGY", "HIGH", 0.7)];
  // Only 1 candidate = thin pool
  const { boosted } = boostHighRelevance(candidates, { boostInThinPool: true });
  const c = boosted[0];
  assert.strictEqual(c._strategic_boost_applied, 0.12, "thin pool with boostInThinPool=true: boost applied");
  assert.strictEqual(c._score_final, 0.82);
});

test("boostHighRelevance: empty candidates → empty results", () => {
  const { boosted, diagnostics } = boostHighRelevance([]);
  assert.strictEqual(boosted.length, 0);
  assert.deepStrictEqual(diagnostics, {});
});

// ─── Summary ──────────────────────────────────────────────────────────────────

process.stdout.write(`\n[strategic-relevance-scoring] ${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  process.exitCode = 1;
}
