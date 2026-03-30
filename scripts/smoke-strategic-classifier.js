"use strict";

/**
 * Smoke test: Strategic Relevance Classifier — live Anthropic API
 *
 * Tests:
 *   1. classifySingle with real Haiku for diverse headline types
 *   2. classifyCandidates orchestrator (cache miss → model, then cache hit)
 *   3. filterLowRelevance with real classifications
 *   4. boostHighRelevance with real classifications
 *   5. Full pipeline: classify → filter → boost → re-sort
 *   6. Edge cases: empty headline, non-English, very long headline
 *   7. Concurrency: batch of 10 simultaneous calls
 *
 * Usage: node scripts/smoke-strategic-classifier.js
 */

const path = require("path");
const fs = require("fs");
const os = require("os");

// Load config for API key
const configPath = path.resolve(process.cwd(), "config.json");
const CONFIG = JSON.parse(fs.readFileSync(configPath, "utf8"));
const apiKey = CONFIG.keys?.anthropic;
if (!apiKey) {
  console.error("❌ No Anthropic API key in config.json keys.anthropic");
  process.exit(1);
}

// Load transport runtime for real httpsPostWithRetry
const { createDigestOrchestratorTransportRuntime } = require("../src/entrypoints/digest-orchestrator-transport-runtime.js");
const https = require("https");
const { httpsPostWithRetry } = createDigestOrchestratorTransportRuntime({ https, defaultTimeoutMs: 15000 });

// Load classifier modules
const {
  CLASSIFIER_VERSION,
  classifySingle,
  classifyCandidates,
  buildClassificationPrompt,
  normalizeClassificationResult,
  runConcurrent,
} = require("../src/domains/classification/strategic-relevance-classifier.js");

const {
  filterLowRelevance,
  boostHighRelevance,
} = require("../src/domains/classification/strategic-relevance-scoring.js");

const {
  hashUrl,
  buildCacheKey,
  loadCache,
  lookupCache,
  writeEntry,
  pruneExpired,
  flushCache,
} = require("../src/domains/classification/strategic-relevance-cache.js");

// ─── Test fixtures ──────────────────────────────────────────────────────────

const TEST_CANDIDATES = [
  // Should be HIGH — M&A, regulation, major strategic moves
  {
    headline: "Microsoft to Acquire Activision Blizzard in $69 Billion Deal",
    summary: "Microsoft announced plans to acquire Activision Blizzard in one of the largest gaming industry deals ever, pending regulatory approval.",
    source_domain: "reuters.com",
    tag: "TECHNOLOGY",
    url: "https://reuters.com/technology/microsoft-activision-deal-2026",
    _score: 0.8,
    expected: "HIGH",
    reason: "Major M&A deal",
  },
  {
    headline: "FDA Approves First Gene Therapy for Sickle Cell Disease",
    summary: "The FDA granted approval for the first CRISPR-based gene therapy to treat sickle cell disease, marking a milestone for gene editing medicine.",
    source_domain: "statnews.com",
    tag: "LIFE SCIENCES",
    url: "https://statnews.com/fda-gene-therapy-sickle-cell-2026",
    _score: 0.75,
    expected: "HIGH",
    reason: "FDA approval of novel therapy",
  },
  {
    headline: "Federal Reserve Raises Interest Rates by 50 Basis Points",
    summary: "The Federal Reserve announced a 50 basis point rate hike, signaling continued tightening amid persistent inflation concerns.",
    source_domain: "ft.com",
    tag: "FINANCIAL SERVICES",
    url: "https://ft.com/fed-rate-hike-march-2026",
    _score: 0.85,
    expected: "HIGH",
    reason: "Central bank policy move",
  },

  // Should be MEDIUM — incremental news, personnel changes
  {
    headline: "Google Updates Chrome Browser with New Tab Management Features",
    summary: "Google released Chrome version 128 with improved tab grouping and a new side panel for managing bookmarks.",
    source_domain: "theverge.com",
    tag: "TECHNOLOGY",
    url: "https://theverge.com/google-chrome-128-tabs-2026",
    _score: 0.5,
    expected: "MEDIUM",
    reason: "Routine product update",
  },
  {
    headline: "Pfizer Names New Chief Medical Officer",
    summary: "Pfizer appointed Dr. Sarah Johnson as its new Chief Medical Officer, replacing the outgoing CMO who served for three years.",
    source_domain: "fiercepharma.com",
    tag: "LIFE SCIENCES",
    url: "https://fiercepharma.com/pfizer-new-cmo-2026",
    _score: 0.45,
    expected: "MEDIUM",
    reason: "Routine personnel change",
  },

  // Should be LOW — consumer content, listicles, deal pages
  {
    headline: "Best Wireless Earbuds Under $50: Our Top 10 Picks for 2026",
    summary: "We tested dozens of budget earbuds to find the best options under $50. Here are our top recommendations.",
    source_domain: "techradar.com",
    tag: "TECHNOLOGY",
    url: "https://techradar.com/best-earbuds-under-50-2026",
    _score: 0.3,
    expected: "LOW",
    reason: "Consumer listicle",
  },
  {
    headline: "Amazon Prime Day 2026: The Best Deals on Kitchen Appliances",
    summary: "Shop the best Prime Day deals on Instant Pots, air fryers, and more kitchen essentials. Updated hourly.",
    source_domain: "cnet.com",
    tag: "CONSUMER & RETAIL",
    url: "https://cnet.com/prime-day-kitchen-deals-2026",
    _score: 0.2,
    expected: "LOW",
    reason: "Deal/coupon page",
  },
  {
    headline: "5 Easy Meal Prep Ideas for Busy Weeknights",
    summary: "Save time and money with these five simple meal prep recipes that you can make in under 30 minutes.",
    source_domain: "buzzfeed.com",
    tag: "CONSUMER & RETAIL",
    url: "https://buzzfeed.com/meal-prep-ideas-2026",
    _score: 0.15,
    expected: "LOW",
    reason: "Consumer lifestyle content",
  },
];

// Edge case candidates
const EDGE_CASES = [
  {
    headline: "",
    summary: "",
    source_domain: "unknown.com",
    tag: "TECHNOLOGY",
    url: "https://unknown.com/empty",
    _score: 0.5,
    label: "empty headline+summary",
  },
  {
    headline: "トヨタが電気自動車の新工場建設を発表、投資額は5000億円",
    summary: "トヨタ自動車は、愛知県に新たな電気自動車専用工場を建設すると発表した。",
    source_domain: "nikkei.com",
    tag: "INDUSTRIALS",
    url: "https://nikkei.com/toyota-ev-factory-2026",
    _score: 0.7,
    label: "non-English (Japanese)",
  },
  {
    headline: "The Comprehensive Analysis of Global Supply Chain Disruptions Affecting Manufacturing Operations Across Multiple Continents Including North America Europe and Asia Pacific Regions During the First Quarter of 2026 and Their Long-Term Strategic Implications for Industrial Competitiveness",
    summary: "A very long headline that tests truncation and token handling.",
    source_domain: "longform.com",
    tag: "INDUSTRIALS",
    url: "https://longform.com/supply-chain-analysis-2026",
    _score: 0.6,
    label: "very long headline",
  },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

let totalInputTokens = 0;
let totalOutputTokens = 0;
let totalCalls = 0;

const origHttpsPost = httpsPostWithRetry;
async function trackingHttpsPost(hostname, path_, headers, body, opts) {
  const res = await origHttpsPost(hostname, path_, headers, body, opts);
  totalCalls++;
  if (res.body?.usage) {
    totalInputTokens += res.body.usage.input_tokens || 0;
    totalOutputTokens += res.body.usage.output_tokens || 0;
  }
  return res;
}

function pass(msg) { console.log(`  ✅ ${msg}`); }
function fail(msg) { console.log(`  ❌ ${msg}`); }
function info(msg) { console.log(`  ℹ️  ${msg}`); }

let passed = 0;
let failed = 0;

function check(condition, passMsg, failMsg) {
  if (condition) {
    pass(passMsg);
    passed++;
  } else {
    fail(failMsg);
    failed++;
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

async function main() {
  const startTime = Date.now();
  console.log("\n🔬 Strategic Relevance Classifier — Live Smoke Test\n");
  console.log(`Classifier version: ${CLASSIFIER_VERSION}`);
  console.log(`API key: ${apiKey.slice(0, 12)}...${apiKey.slice(-4)}`);
  console.log(`Model: claude-3-haiku-20240307\n`);

  // ── Test 1: classifySingle — individual calls ──────────────────────────
  console.log("─── Test 1: classifySingle — individual headline classifications ───\n");

  const singleResults = [];
  for (const candidate of TEST_CANDIDATES) {
    const result = await classifySingle(candidate, {
      apiKey,
      model: "claude-3-haiku-20240307",
      timeout: 15000,
      httpsPost: trackingHttpsPost,
    });

    singleResults.push({ candidate, result });
    const match = result.classification === candidate.expected;
    const icon = match ? "✅" : "⚠️";
    console.log(`  ${icon} "${candidate.headline.slice(0, 60)}..."`);
    console.log(`     Expected: ${candidate.expected} | Got: ${result.classification} | Reason: ${result.reason}`);
    if (result._fallback_type) console.log(`     ⚠️  Fallback: ${result._fallback_type}`);
    console.log();
  }

  const correctCount = singleResults.filter(r => r.result.classification === r.candidate.expected).length;
  check(
    correctCount >= Math.floor(TEST_CANDIDATES.length * 0.7),
    `Classification accuracy: ${correctCount}/${TEST_CANDIDATES.length} match expected (≥70% threshold)`,
    `Classification accuracy too low: ${correctCount}/${TEST_CANDIDATES.length} (need ≥70%)`
  );

  // Verify no fallbacks occurred
  const fallbackCount = singleResults.filter(r => r.result._fallback_type).length;
  check(
    fallbackCount === 0,
    `Zero fallbacks — all ${TEST_CANDIDATES.length} calls returned valid classifications`,
    `${fallbackCount} fallback(s) occurred — API calls may be failing`
  );

  // Verify all results have valid labels
  const validLabels = singleResults.every(r => ["HIGH", "MEDIUM", "LOW"].includes(r.result.classification));
  check(validLabels, "All results have valid labels (HIGH/MEDIUM/LOW)", "Some results have invalid labels");

  // Verify all reasons are ≤ 15 words
  const reasonsOk = singleResults.every(r => r.result.reason.split(/\s+/).length <= 15);
  check(reasonsOk, "All reasons are ≤ 15 words", "Some reasons exceed 15 words");

  // ── Test 2: Edge cases ─────────────────────────────────────────────────
  console.log("\n─── Test 2: Edge cases — empty, non-English, very long ───\n");

  for (const edgeCase of EDGE_CASES) {
    const result = await classifySingle(edgeCase, {
      apiKey,
      model: "claude-3-haiku-20240307",
      timeout: 15000,
      httpsPost: trackingHttpsPost,
    });

    const hasValidLabel = ["HIGH", "MEDIUM", "LOW"].includes(result.classification);
    console.log(`  ${hasValidLabel ? "✅" : "❌"} [${edgeCase.label}] → ${result.classification}: ${result.reason}`);
    if (result._fallback_type) console.log(`     ⚠️  Fallback: ${result._fallback_type}`);

    check(
      hasValidLabel && !result._fallback_type,
      `Edge case "${edgeCase.label}" returned valid classification without fallback`,
      `Edge case "${edgeCase.label}" failed: label=${result.classification}, fallback=${result._fallback_type}`
    );
  }

  // ── Test 3: classifyCandidates orchestrator ────────────────────────────
  console.log("\n─── Test 3: classifyCandidates orchestrator (cache miss → model → cache hit) ───\n");

  const tmpCachePath = path.join(os.tmpdir(), `sb-smoke-cache-${Date.now()}.json`);
  const cache = new Map();

  // First run: all cache misses → model calls
  const { candidates: classified1, diagnostics: diag1 } = await classifyCandidates(
    TEST_CANDIDATES.map(c => ({ ...c })),
    {
      cache,
      config: CONFIG,
      log: (msg) => info(`[run1] ${msg}`),
      httpsPost: trackingHttpsPost,
      cachePath: tmpCachePath,
    }
  );

  check(
    diag1.cache_hits === 0,
    `Run 1: 0 cache hits (all misses as expected)`,
    `Run 1: Expected 0 cache hits, got ${diag1.cache_hits}`
  );
  check(
    diag1.model_calls === TEST_CANDIDATES.length,
    `Run 1: ${diag1.model_calls} model calls (one per candidate)`,
    `Run 1: Expected ${TEST_CANDIDATES.length} model calls, got ${diag1.model_calls}`
  );
  check(
    diag1.fallbacks === 0,
    `Run 1: 0 fallbacks`,
    `Run 1: ${diag1.fallbacks} fallback(s) — some API calls failed`
  );

  // Verify all candidates got annotated
  const allAnnotated = classified1.every(c =>
    c.strategic_relevance && c.strategic_relevance_reason && c.strategic_relevance_source && c.strategic_relevance_version
  );
  check(allAnnotated, "Run 1: All candidates annotated with strategic_relevance fields", "Run 1: Some candidates missing annotations");

  console.log(`\n  Run 1 diagnostics: HIGH=${diag1.counts?.HIGH || 0}, MEDIUM=${diag1.counts?.MEDIUM || 0}, LOW=${diag1.counts?.LOW || 0}`);
  console.log(`  Cache entries: ${cache.size}`);

  // Second run: all cache hits → 0 model calls
  const { candidates: classified2, diagnostics: diag2 } = await classifyCandidates(
    TEST_CANDIDATES.map(c => ({ ...c })),
    {
      cache,
      config: CONFIG,
      log: (msg) => info(`[run2] ${msg}`),
      httpsPost: trackingHttpsPost,
      cachePath: tmpCachePath,
    }
  );

  check(
    diag2.cache_hits === TEST_CANDIDATES.length,
    `Run 2: ${diag2.cache_hits} cache hits (all from cache)`,
    `Run 2: Expected ${TEST_CANDIDATES.length} cache hits, got ${diag2.cache_hits}`
  );
  check(
    diag2.model_calls === 0,
    `Run 2: 0 model calls (fully cached)`,
    `Run 2: ${diag2.model_calls} model call(s) — cache not working`
  );

  // Clean up temp cache
  try { fs.unlinkSync(tmpCachePath); } catch (_) {}

  // ── Test 4: filterLowRelevance with real classifications ───────────────
  console.log("\n─── Test 4: filterLowRelevance with real classifications ───\n");

  const { filtered, dropped, diagnostics: filterDiag } = filterLowRelevance(classified1);
  const lowCount = classified1.filter(c => c.strategic_relevance === "LOW").length;

  console.log(`  Input: ${classified1.length} candidates`);
  console.log(`  LOW candidates: ${lowCount}`);
  console.log(`  Filtered: ${filtered.length} remain, ${dropped.length} dropped`);

  for (const [tag, diag] of Object.entries(filterDiag)) {
    console.log(`  [${tag}] total=${diag.total}, low=${diag.low_count}, dropped=${diag.low_dropped}, thin_pool=${diag.thin_pool_mode}`);
  }

  check(
    filtered.length + dropped.length === classified1.length,
    "Filter: filtered + dropped = total input",
    `Filter: ${filtered.length} + ${dropped.length} ≠ ${classified1.length}`
  );

  // All dropped should be LOW
  const allDroppedAreLow = dropped.every(c => c.strategic_relevance === "LOW");
  check(
    allDroppedAreLow,
    "Filter: all dropped candidates are LOW",
    "Filter: some non-LOW candidates were dropped!"
  );

  // ── Test 5: boostHighRelevance with real classifications ───────────────
  console.log("\n─── Test 5: boostHighRelevance with real classifications ───\n");

  const { boosted, diagnostics: boostDiag } = boostHighRelevance(filtered);
  const highBoosted = boosted.filter(c => c.strategic_relevance === "HIGH" && c._strategic_boost_applied > 0);

  console.log(`  Boosted candidates: ${highBoosted.length}`);
  for (const item of highBoosted) {
    console.log(`    "${item.headline.slice(0, 50)}..." ${item._score_before_strategic} → ${item._score_final} (+${item._strategic_boost_applied})`);
  }

  check(
    boosted.every(c => c._score_before_strategic != null && c._score_final != null),
    "Boost: all candidates have _score_before_strategic and _score_final",
    "Boost: some candidates missing score metadata"
  );

  // HIGH should have boost > 0, others should have 0
  const boostCorrect = boosted.every(c =>
    c.strategic_relevance === "HIGH" ? c._strategic_boost_applied > 0 : c._strategic_boost_applied === 0
  );
  check(
    boostCorrect,
    "Boost: only HIGH candidates received boost, MEDIUM/LOW got 0",
    "Boost: incorrect boost application"
  );

  // No score exceeds 1.0
  const cappedOk = boosted.every(c => c._score_final <= 1.0);
  check(cappedOk, "Boost: no score exceeds 1.0 cap", "Boost: some scores exceed 1.0!");

  // ── Test 6: Full pipeline — classify → filter → boost → re-sort ───────
  console.log("\n─── Test 6: Full pipeline simulation ───\n");

  const pipelineCandidates = TEST_CANDIDATES.map((c, i) => ({
    ...c,
    _score: 0.9 - (i * 0.08), // descending scores
  }));

  const pipelineCache = new Map();
  const { candidates: pClassified } = await classifyCandidates(
    pipelineCandidates,
    {
      cache: pipelineCache,
      config: CONFIG,
      log: () => {},
      httpsPost: trackingHttpsPost,
      cachePath: null,
    }
  );

  const { filtered: pFiltered } = filterLowRelevance(pClassified);
  const { boosted: pBoosted } = boostHighRelevance(pFiltered);

  // Re-sort by _score descending (matching pipeline behavior)
  pBoosted.sort((a, b) => (b._score || 0) - (a._score || 0));

  console.log("  Final ranked order:");
  for (let i = 0; i < pBoosted.length; i++) {
    const c = pBoosted[i];
    console.log(`    ${i + 1}. [${c.strategic_relevance}] ${c._score_final.toFixed(3)} "${c.headline.slice(0, 50)}..."`);
  }

  // Verify sorted descending
  let sorted = true;
  for (let i = 1; i < pBoosted.length; i++) {
    if (pBoosted[i]._score > pBoosted[i - 1]._score) { sorted = false; break; }
  }
  check(sorted, "Pipeline: final output sorted by _score descending", "Pipeline: output NOT sorted correctly");

  // ── Test 7: Concurrency — batch of 10 simultaneous calls ──────────────
  console.log("\n─── Test 7: Concurrency — 10 simultaneous classifications ───\n");

  const concurrencyCandidates = Array.from({ length: 10 }, (_, i) => ({
    headline: `Concurrency test headline ${i + 1}: Major industry event ${i + 1}`,
    summary: `Test summary for concurrent classification call number ${i + 1}`,
    source_domain: "test.com",
    tag: "TECHNOLOGY",
    url: `https://test.com/concurrent-${i + 1}`,
    _score: 0.5,
  }));

  const concStart = Date.now();
  const concResults = [];
  await runConcurrent(
    concurrencyCandidates,
    async (candidate) => {
      const result = await classifySingle(candidate, {
        apiKey,
        model: "claude-3-haiku-20240307",
        timeout: 15000,
        httpsPost: trackingHttpsPost,
      });
      concResults.push(result);
    },
    8 // concurrency of 8
  );
  const concMs = Date.now() - concStart;

  const concValid = concResults.length === 10 && concResults.every(r => ["HIGH", "MEDIUM", "LOW"].includes(r.classification));
  check(concValid, `Concurrency: all 10 calls returned valid labels (${concMs}ms total)`, `Concurrency: only ${concResults.length} results or some invalid`);

  const concFallbacks = concResults.filter(r => r._fallback_type).length;
  check(concFallbacks === 0, `Concurrency: 0 fallbacks in batch`, `Concurrency: ${concFallbacks} fallback(s)`);

  info(`Throughput: 10 calls in ${concMs}ms = ${(10000 / concMs).toFixed(1)} calls/sec`);

  // ── Test 8: Cache persistence — write, reload, verify ──────────────────
  console.log("\n─── Test 8: Cache persistence — flush and reload ───\n");

  const persistCachePath = path.join(os.tmpdir(), `sb-smoke-persist-${Date.now()}.json`);
  const persistCache = new Map();

  // Write some entries
  for (const c of TEST_CANDIDATES.slice(0, 3)) {
    writeEntry(persistCache, c.url, CLASSIFIER_VERSION, { classification: "HIGH", reason: "test" }, {}, persistCachePath);
  }

  // Flush to disk
  flushCache(persistCache, persistCachePath);
  check(fs.existsSync(persistCachePath), "Cache: file written to disk", "Cache: file NOT written");

  // Reload and verify
  const reloadedCache = loadCache(persistCachePath);
  check(reloadedCache.size === 3, `Cache: reloaded ${reloadedCache.size} entries (expected 3)`, `Cache: wrong entry count ${reloadedCache.size}`);

  // Lookup should work
  const looked = lookupCache(reloadedCache, TEST_CANDIDATES[0].url, CLASSIFIER_VERSION, { ttlDays: 14 });
  check(looked != null && looked.classification === "HIGH", "Cache: lookup after reload returns correct value", "Cache: lookup failed after reload");

  // Clean up
  try { fs.unlinkSync(persistCachePath); } catch (_) {}

  // ── Summary ────────────────────────────────────────────────────────────
  const totalMs = Date.now() - startTime;
  const inputCostUsd = (totalInputTokens / 1_000_000) * 0.80;
  const outputCostUsd = (totalOutputTokens / 1_000_000) * 4.00;
  const totalCostUsd = inputCostUsd + outputCostUsd;

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  SMOKE TEST SUMMARY");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log(`  Duration: ${(totalMs / 1000).toFixed(1)}s`);
  console.log(`  API calls: ${totalCalls}`);
  console.log(`  Tokens: ${totalInputTokens} input + ${totalOutputTokens} output = ${totalInputTokens + totalOutputTokens} total`);
  console.log(`  Cost: $${inputCostUsd.toFixed(4)} input + $${outputCostUsd.toFixed(4)} output = $${totalCostUsd.toFixed(4)} total`);
  console.log("═══════════════════════════════════════════════════════════════\n");

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("💥 Smoke test crashed:", err);
  process.exit(1);
});
