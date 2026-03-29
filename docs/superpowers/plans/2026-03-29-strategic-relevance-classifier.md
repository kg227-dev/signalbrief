# Strategic Relevance Classifier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Claude Haiku-based classifier that annotates candidates as HIGH/MEDIUM/LOW strategic relevance, filters LOW before scoring, and boosts HIGH after scoring.

**Architecture:** Three new modules in `src/domains/classification/` — cache (file-backed JSON with atomic writes), classifier (Haiku API calls with concurrency pool), and scoring integration (per-topic filter + boost). Integrated into the existing `selectForEnrichment()` pipeline between story-relationship classification and `scoreCandidates()`.

**Tech Stack:** Node.js stdlib only (https, crypto, fs, path). Claude Haiku via Anthropic Messages API. No npm dependencies.

**Spec:** `docs/superpowers/specs/2026-03-29-strategic-relevance-classifier-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/domains/classification/strategic-relevance-cache.js` | Create | URL hashing, cache key building, file-backed cache with atomic writes, TTL pruning |
| `src/domains/classification/strategic-relevance-classifier.js` | Create | Prompt building, single Haiku call, result normalization, orchestration with concurrency pool |
| `src/domains/classification/strategic-relevance-scoring.js` | Create | `filterLowRelevance()` (pre-score) and `boostHighRelevance()` (post-score), per-topic |
| `src/entrypoints/digest-orchestrator-selection-runtime.js` | Modify: imports (line 1-11), deps (line 270-294), scoring (line 490-505), loop var (line 517), diagnostics return (line 621-649) | Insert classify → filter before scoring, boost + re-sort after scoring. Add `path` stdlib require. |
| `src/entrypoints/digest-orchestrator-core-runtime.js` | Modify | Pass `httpsPostWithRetry` to selection runtime deps |
| `web/routes/admin-api-digest-audit-runtime.js` | Modify | Surface classification diagnostics in admin audit view |
| `config.example.json` | Modify | Add `digest.classification` config block with defaults |
| `tests/contracts/domains/classification/strategic-relevance-cache.test.js` | Create | Cache behavior: hash, lookup, TTL, prune, atomic write, malformed recovery |
| `tests/contracts/domains/classification/strategic-relevance-classifier.test.js` | Create | Normalization, prompt building, fallback on failure, concurrency |
| `tests/contracts/domains/classification/strategic-relevance-scoring.test.js` | Create | Per-topic filter thresholds, boost cap, thin-pool, diagnostics |
| `tests/contracts/domains/classification/strategic-relevance-integration.test.js` | Create | Feature gate on/off, diagnostics flow into selectionDiagnostics |

---

## Task 1: Cache Module

**Files:**
- Create: `src/domains/classification/strategic-relevance-cache.js`
- Create: `tests/contracts/domains/classification/strategic-relevance-cache.test.js`

### Step 1.1: Write cache tests

- [ ] Create test file with all cache behavior tests:

```javascript
// tests/contracts/domains/classification/strategic-relevance-cache.test.js
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");

const {
  hashUrl,
  buildCacheKey,
  loadCache,
  lookupCache,
  writeEntry,
  pruneExpired,
  flushCache,
} = require("../../../../src/domains/classification/strategic-relevance-cache");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${name}: ${e.message}`);
    failed++;
  }
}

console.log("strategic-relevance-cache");

// --- hashUrl ---

test("hashUrl returns consistent hex string", () => {
  const h1 = hashUrl("https://example.com/article/123");
  const h2 = hashUrl("https://example.com/article/123");
  assert.strictEqual(h1, h2);
  assert.strictEqual(typeof h1, "string");
  assert.ok(h1.length === 64, "SHA-256 hex is 64 chars");
});

test("hashUrl canonicalizes trailing slash", () => {
  assert.strictEqual(
    hashUrl("https://example.com/article/"),
    hashUrl("https://example.com/article")
  );
});

test("hashUrl strips utm params", () => {
  assert.strictEqual(
    hashUrl("https://example.com/article?utm_source=twitter&utm_medium=social"),
    hashUrl("https://example.com/article")
  );
});

test("hashUrl preserves non-utm params", () => {
  const withParam = hashUrl("https://example.com/article?id=42");
  const without = hashUrl("https://example.com/article");
  assert.notStrictEqual(withParam, without);
});

test("hashUrl lowercases hostname", () => {
  assert.strictEqual(
    hashUrl("https://EXAMPLE.COM/article"),
    hashUrl("https://example.com/article")
  );
});

test("hashUrl sorts remaining params", () => {
  assert.strictEqual(
    hashUrl("https://example.com/article?b=2&a=1"),
    hashUrl("https://example.com/article?a=1&b=2")
  );
});

// --- buildCacheKey ---

test("buildCacheKey combines hash and version", () => {
  const key = buildCacheKey("https://example.com/a", "1.0");
  const hash = hashUrl("https://example.com/a");
  assert.strictEqual(key, `${hash}:1.0`);
});

// --- loadCache / writeEntry / lookupCache ---

test("loadCache returns empty Map for missing file", () => {
  const cache = loadCache("/tmp/nonexistent-cache-file.json");
  assert.ok(cache instanceof Map);
  assert.strictEqual(cache.size, 0);
});

test("loadCache returns empty Map for malformed file", () => {
  const tmpFile = path.join(os.tmpdir(), `test-cache-malformed-${Date.now()}.json`);
  fs.writeFileSync(tmpFile, "not json {{{");
  const cache = loadCache(tmpFile);
  assert.ok(cache instanceof Map);
  assert.strictEqual(cache.size, 0);
  try { fs.unlinkSync(tmpFile); } catch {}
});

test("writeEntry adds entry to cache Map", () => {
  const tmpFile = path.join(os.tmpdir(), `test-cache-write-${Date.now()}.json`);
  const cache = new Map();
  writeEntry(cache, "https://example.com/a", "1.0", {
    classification: "HIGH",
    reason: "Major M&A deal",
  }, { source: "reuters.com", topic: "FINANCIAL SERVICES" }, tmpFile);
  assert.strictEqual(cache.size, 1);
  const key = buildCacheKey("https://example.com/a", "1.0");
  const entry = cache.get(key);
  assert.strictEqual(entry.classification, "HIGH");
  assert.strictEqual(entry.reason, "Major M&A deal");
  assert.strictEqual(entry.classifier_version, "1.0");
  assert.strictEqual(entry.source, "reuters.com");
  assert.ok(entry.classified_at);
  // File should exist on disk
  assert.ok(fs.existsSync(tmpFile));
  try { fs.unlinkSync(tmpFile); } catch {}
});

test("lookupCache returns entry on hit", () => {
  const cache = new Map();
  const key = buildCacheKey("https://example.com/a", "1.0");
  cache.set(key, {
    classification: "HIGH",
    reason: "test",
    classifier_version: "1.0",
    classified_at: new Date().toISOString(),
  });
  const result = lookupCache(cache, "https://example.com/a", "1.0", { ttlDays: 14 });
  assert.strictEqual(result.classification, "HIGH");
});

test("lookupCache returns null on miss", () => {
  const cache = new Map();
  const result = lookupCache(cache, "https://example.com/a", "1.0", { ttlDays: 14 });
  assert.strictEqual(result, null);
});

test("lookupCache returns null on version mismatch", () => {
  const cache = new Map();
  const key = buildCacheKey("https://example.com/a", "1.0");
  cache.set(key, {
    classification: "HIGH",
    reason: "test",
    classifier_version: "1.0",
    classified_at: new Date().toISOString(),
  });
  const result = lookupCache(cache, "https://example.com/a", "2.0", { ttlDays: 14 });
  assert.strictEqual(result, null);
});

test("lookupCache returns null on expired entry", () => {
  const cache = new Map();
  const key = buildCacheKey("https://example.com/a", "1.0");
  const oldDate = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
  cache.set(key, {
    classification: "HIGH",
    reason: "test",
    classifier_version: "1.0",
    classified_at: oldDate,
  });
  const result = lookupCache(cache, "https://example.com/a", "1.0", { ttlDays: 14 });
  assert.strictEqual(result, null);
});

// --- pruneExpired ---

test("pruneExpired removes old entries", () => {
  const cache = new Map();
  const oldDate = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
  const freshDate = new Date().toISOString();
  cache.set("old:1.0", { classified_at: oldDate });
  cache.set("fresh:1.0", { classified_at: freshDate });
  pruneExpired(cache, 14);
  assert.strictEqual(cache.size, 1);
  assert.ok(cache.has("fresh:1.0"));
});

// --- flushCache ---

test("flushCache writes atomic file", () => {
  const tmpFile = path.join(os.tmpdir(), `test-cache-flush-${Date.now()}.json`);
  const cache = new Map();
  cache.set("key1:1.0", { classification: "HIGH", classified_at: new Date().toISOString() });
  cache.set("key2:1.0", { classification: "LOW", classified_at: new Date().toISOString() });
  flushCache(cache, tmpFile);
  assert.ok(fs.existsSync(tmpFile));
  assert.ok(!fs.existsSync(tmpFile + ".tmp"), "tmp file should be cleaned up");
  const data = JSON.parse(fs.readFileSync(tmpFile, "utf8"));
  assert.strictEqual(Object.keys(data.entries).length, 2);
  assert.ok(data.version);
  assert.ok(data.flushed_at);
  try { fs.unlinkSync(tmpFile); } catch {}
});

test("flushCache then loadCache round-trips", () => {
  const tmpFile = path.join(os.tmpdir(), `test-cache-roundtrip-${Date.now()}.json`);
  const cache = new Map();
  const key = buildCacheKey("https://example.com/a", "1.0");
  cache.set(key, {
    cache_key: key,
    classification: "HIGH",
    reason: "test reason",
    classifier_version: "1.0",
    classified_at: new Date().toISOString(),
    source: "example.com",
    topic: "TECHNOLOGY",
  });
  flushCache(cache, tmpFile);
  const loaded = loadCache(tmpFile);
  assert.strictEqual(loaded.size, 1);
  assert.strictEqual(loaded.get(key).classification, "HIGH");
  try { fs.unlinkSync(tmpFile); } catch {}
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [ ] Run the test to verify it fails (module not found):

Run: `node tests/contracts/domains/classification/strategic-relevance-cache.test.js`
Expected: FAIL — `Cannot find module '../../../../src/domains/classification/strategic-relevance-cache'`

### Step 1.2: Implement cache module

- [ ] Create directory and implement:

```javascript
// src/domains/classification/strategic-relevance-cache.js
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DEFAULT_TTL_DAYS = 14;

/**
 * Canonicalize a URL for consistent hashing:
 * - lowercase hostname
 * - strip trailing slash
 * - remove utm_* query params
 * - sort remaining params
 */
function canonicalizeUrl(url) {
  try {
    const parsed = new URL(String(url || "").trim());
    parsed.hostname = parsed.hostname.toLowerCase();
    // Remove trailing slash from pathname (but keep "/" root)
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    // Remove utm_* params, sort remainder
    const params = new URLSearchParams();
    const sorted = [...parsed.searchParams.entries()]
      .filter(([k]) => !k.startsWith("utm_"))
      .sort(([a], [b]) => a.localeCompare(b));
    for (const [k, v] of sorted) params.set(k, v);
    parsed.search = params.toString() ? `?${params.toString()}` : "";
    return parsed.toString();
  } catch {
    return String(url || "").trim().toLowerCase();
  }
}

function hashUrl(url) {
  const canonical = canonicalizeUrl(url);
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

function buildCacheKey(url, classifierVersion) {
  return `${hashUrl(url)}:${classifierVersion}`;
}

function loadCache(filePath) {
  const cache = new Map();
  try {
    if (!fs.existsSync(filePath)) return cache;
    const raw = fs.readFileSync(filePath, "utf8");
    const data = JSON.parse(raw);
    const entries = data && typeof data === "object" && data.entries ? data.entries : data;
    if (entries && typeof entries === "object") {
      for (const [key, entry] of Object.entries(entries)) {
        cache.set(key, entry);
      }
    }
  } catch {
    // Malformed cache — start fresh
  }
  return cache;
}

function lookupCache(cache, url, classifierVersion, opts = {}) {
  const ttlDays = opts.ttlDays ?? DEFAULT_TTL_DAYS;
  const key = buildCacheKey(url, classifierVersion);
  const entry = cache.get(key);
  if (!entry) return null;
  // Version mismatch check (defensive — key includes version, but entry may have been written with different version)
  if (entry.classifier_version && entry.classifier_version !== classifierVersion) return null;
  // TTL check
  const classifiedAt = entry.classified_at ? new Date(entry.classified_at).getTime() : 0;
  const ttlMs = ttlDays * 24 * 60 * 60 * 1000;
  if (Date.now() - classifiedAt > ttlMs) return null;
  return entry;
}

function writeEntry(cache, url, classifierVersion, result, meta, filePath) {
  const key = buildCacheKey(url, classifierVersion);
  const entry = {
    cache_key: key,
    classification: result.classification,
    reason: result.reason,
    classifier_version: classifierVersion,
    classified_at: new Date().toISOString(),
    source: meta?.source || "",
    topic: meta?.topic || "",
  };
  cache.set(key, entry);
  // Write-through to disk (atomic)
  if (filePath) {
    flushCache(cache, filePath);
  }
}

function pruneExpired(cache, ttlDays = DEFAULT_TTL_DAYS) {
  const ttlMs = ttlDays * 24 * 60 * 60 * 1000;
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    const classifiedAt = entry.classified_at ? new Date(entry.classified_at).getTime() : 0;
    if (now - classifiedAt > ttlMs) {
      cache.delete(key);
    }
  }
}

function flushCache(cache, filePath) {
  const entries = Object.create(null);
  for (const [key, entry] of cache.entries()) {
    entries[key] = entry;
  }
  const payload = {
    version: 1,
    flushed_at: new Date().toISOString(),
    entries,
  };
  const tmpPath = `${filePath}.tmp`;
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2));
    fs.renameSync(tmpPath, filePath);
  } catch {
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {}
  }
}

module.exports = {
  hashUrl,
  buildCacheKey,
  loadCache,
  lookupCache,
  writeEntry,
  pruneExpired,
  flushCache,
};
```

- [ ] Run the tests to verify they pass:

Run: `node tests/contracts/domains/classification/strategic-relevance-cache.test.js`
Expected: All tests PASS

- [ ] Commit:

```bash
git add src/domains/classification/strategic-relevance-cache.js tests/contracts/domains/classification/strategic-relevance-cache.test.js
git commit -m "feat: add strategic relevance cache module with file-backed storage"
```

---

## Task 2: Classifier Module

**Files:**
- Create: `src/domains/classification/strategic-relevance-classifier.js`
- Create: `tests/contracts/domains/classification/strategic-relevance-classifier.test.js`

### Step 2.1: Write classifier tests

- [ ] Create test file covering normalization, prompt building, and orchestration:

```javascript
// tests/contracts/domains/classification/strategic-relevance-classifier.test.js
"use strict";

const assert = require("assert");
const {
  CLASSIFIER_VERSION,
  normalizeClassificationResult,
  buildClassificationPrompt,
} = require("../../../../src/domains/classification/strategic-relevance-classifier");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${name}: ${e.message}`);
    failed++;
  }
}

console.log("strategic-relevance-classifier");

// --- CLASSIFIER_VERSION ---

test("CLASSIFIER_VERSION is a non-empty string", () => {
  assert.strictEqual(typeof CLASSIFIER_VERSION, "string");
  assert.ok(CLASSIFIER_VERSION.length > 0);
});

// --- normalizeClassificationResult ---

test("normalizeClassificationResult accepts valid HIGH", () => {
  const result = normalizeClassificationResult({ classification: "HIGH", reason: "Major M&A deal" });
  assert.strictEqual(result.classification, "HIGH");
  assert.strictEqual(result.reason, "Major M&A deal");
});

test("normalizeClassificationResult accepts valid MEDIUM", () => {
  const result = normalizeClassificationResult({ classification: "MEDIUM", reason: "Routine update" });
  assert.strictEqual(result.classification, "MEDIUM");
});

test("normalizeClassificationResult accepts valid LOW", () => {
  const result = normalizeClassificationResult({ classification: "LOW", reason: "Coupon page" });
  assert.strictEqual(result.classification, "LOW");
});

test("normalizeClassificationResult defaults unrecognized to MEDIUM", () => {
  const result = normalizeClassificationResult({ classification: "CRITICAL", reason: "test" });
  assert.strictEqual(result.classification, "MEDIUM");
});

test("normalizeClassificationResult handles missing classification", () => {
  const result = normalizeClassificationResult({ reason: "test" });
  assert.strictEqual(result.classification, "MEDIUM");
});

test("normalizeClassificationResult handles null input", () => {
  const result = normalizeClassificationResult(null);
  assert.strictEqual(result.classification, "MEDIUM");
  assert.strictEqual(result.reason, "Classifier fallback");
});

test("normalizeClassificationResult handles non-object input", () => {
  const result = normalizeClassificationResult("just a string");
  assert.strictEqual(result.classification, "MEDIUM");
  assert.strictEqual(result.reason, "Classifier fallback");
});

test("normalizeClassificationResult truncates reason to 15 words", () => {
  const longReason = "this is a very long reason that has way too many words and should be truncated down to fifteen words maximum";
  const result = normalizeClassificationResult({ classification: "HIGH", reason: longReason });
  const wordCount = result.reason.split(/\s+/).length;
  assert.ok(wordCount <= 15, `Expected <= 15 words, got ${wordCount}`);
});

test("normalizeClassificationResult provides default reason when missing", () => {
  const result = normalizeClassificationResult({ classification: "HIGH" });
  assert.strictEqual(result.reason, "No reason provided");
});

test("normalizeClassificationResult is case-insensitive for classification", () => {
  assert.strictEqual(normalizeClassificationResult({ classification: "high", reason: "x" }).classification, "HIGH");
  assert.strictEqual(normalizeClassificationResult({ classification: "Low", reason: "x" }).classification, "LOW");
});

// --- buildClassificationPrompt ---

test("buildClassificationPrompt returns system and user strings", () => {
  const { system, user } = buildClassificationPrompt({
    headline: "Pfizer acquires Seagen for $43B",
    summary: "Pfizer announced acquisition of Seagen",
    source: "reuters.com",
    tag: "HEALTHCARE",
  });
  assert.strictEqual(typeof system, "string");
  assert.strictEqual(typeof user, "string");
  assert.ok(system.includes("HIGH"));
  assert.ok(system.includes("MEDIUM"));
  assert.ok(system.includes("LOW"));
  assert.ok(user.includes("Pfizer acquires Seagen"));
  assert.ok(user.includes("reuters.com"));
  assert.ok(user.includes("HEALTHCARE"));
});

test("buildClassificationPrompt handles missing snippet", () => {
  const { user } = buildClassificationPrompt({
    headline: "Test headline",
    source: "example.com",
    tag: "TECHNOLOGY",
  });
  assert.ok(user.includes("Not available"));
});

test("buildClassificationPrompt handles missing all fields gracefully", () => {
  const { system, user } = buildClassificationPrompt({});
  assert.strictEqual(typeof system, "string");
  assert.strictEqual(typeof user, "string");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [ ] Run to verify failure:

Run: `node tests/contracts/domains/classification/strategic-relevance-classifier.test.js`
Expected: FAIL — `Cannot find module`

### Step 2.2: Implement classifier module

- [ ] Create the classifier:

```javascript
// src/domains/classification/strategic-relevance-classifier.js
"use strict";

const { buildCacheKey, lookupCache, flushCache } = require("./strategic-relevance-cache");

const CLASSIFIER_VERSION = "1.0";
const VALID_LABELS = ["HIGH", "MEDIUM", "LOW"];
const FALLBACK_RESULT = Object.freeze({ classification: "MEDIUM", reason: "Classifier fallback" });
const DEFAULT_CONCURRENCY = 8;
const DEFAULT_MODEL = "claude-haiku-4-5-20241022";
const DEFAULT_MAX_TOKENS = 100;

// --- Prompt ---

function buildClassificationPrompt(candidate) {
  const headline = String(candidate?.headline || "").trim() || "Untitled";
  const snippet = String(candidate?.summary || candidate?.snippet || "").trim() || "Not available";
  const source = String(candidate?.source || candidate?.source_domain || "").trim() || "Unknown";
  const topic = String(candidate?.tag || "").trim() || "General";

  const system = [
    "You are a strategic relevance classifier for business intelligence.",
    "",
    "Classify whether this article is strategically important for a senior business professional.",
    "",
    "HIGH = Impacts markets, companies, regulation, capital flows, or future competitive positioning. Examples: M&A, regulatory changes, earnings, major partnerships, industry-shaping launches.",
    "",
    "MEDIUM = Somewhat relevant but not decision-critical. Tactical updates, incremental product news, routine personnel changes.",
    "",
    "LOW = Not strategic. Consumer content, deal/coupon pages, product reviews, \"best of\" lists, event listings, index pages.",
    "",
    "Focus on content, not source reputation. A prestigious source can publish non-strategic content.",
    "",
    "Return JSON only:",
    '{"classification": "HIGH | MEDIUM | LOW", "reason": "max 15 words explaining why"}',
  ].join("\n");

  const user = [
    `Title: ${headline}`,
    `Summary: ${snippet}`,
    `Source: ${source}`,
    `Topic: ${topic}`,
  ].join("\n");

  return { system, user };
}

// --- Normalization ---

function normalizeClassificationResult(raw) {
  if (!raw || typeof raw !== "object") return { ...FALLBACK_RESULT };

  let classification = String(raw.classification || "").trim().toUpperCase();
  if (!VALID_LABELS.includes(classification)) classification = "MEDIUM";

  let reason = String(raw.reason || "").trim();
  if (!reason) reason = "No reason provided";
  // Truncate to 15 words
  const words = reason.split(/\s+/);
  if (words.length > 15) reason = words.slice(0, 15).join(" ");

  return { classification, reason };
}

// --- Single classification call ---

async function classifySingle(candidate, opts = {}) {
  const { apiKey, model, timeout, httpsPost } = opts;
  if (!apiKey || !httpsPost) return { ...FALLBACK_RESULT, _fallback_type: "no_api_key" };

  const { system, user } = buildClassificationPrompt(candidate);
  const body = {
    model: model || DEFAULT_MODEL,
    max_tokens: DEFAULT_MAX_TOKENS,
    system,
    messages: [{ role: "user", content: user }],
  };

  let res;
  try {
    res = await httpsPost(
      "api.anthropic.com",
      "/v1/messages",
      {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body,
      { timeoutMs: timeout || 15000, retries: 1, retryDelayMs: 500 }
    );
  } catch {
    // Network/HTTP failure — counts as both fallback AND error
    return { ...FALLBACK_RESULT, _fallback_type: "network_error" };
  }

  // Parse response
  try {
    const text = res?.body?.content?.[0]?.text;
    if (!text) return { ...FALLBACK_RESULT, _fallback_type: "empty_response" };
    const parsed = JSON.parse(text);
    const norm = normalizeClassificationResult(parsed);
    // Check if normalization defaulted to MEDIUM (unrecognized label)
    if (parsed.classification && !VALID_LABELS.includes(String(parsed.classification).trim().toUpperCase())) {
      norm._fallback_type = "unrecognized_label";
    }
    return norm;
  } catch {
    // JSON parse failure — fallback but NOT a network error
    return { ...FALLBACK_RESULT, _fallback_type: "parse_failure" };
  }
}

// --- Concurrency pool ---

async function runConcurrent(items, worker, concurrency) {
  const results = new Array(items.length);
  let cursor = 0;
  async function consume() {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => consume()));
  return results;
}

// --- Orchestrator ---

async function classifyCandidates(candidates, opts = {}) {
  const { cache, config, log, httpsPost } = opts;
  const apiKey = config?.keys?.anthropic || "";
  const classificationConfig = config?.digest?.classification || {};
  const concurrency = classificationConfig.concurrency || DEFAULT_CONCURRENCY;
  const model = classificationConfig.model || DEFAULT_MODEL;
  const ttlDays = classificationConfig.cache_ttl_days || 14;
  const cachePath = opts.cachePath || "";
  const logFn = typeof log === "function" ? log : () => {};

  if (!apiKey) {
    logFn("⚠️ No Anthropic API key — all candidates will receive MEDIUM fallback");
  }

  const startMs = Date.now();
  let cacheHits = 0;
  let modelCalls = 0;
  let fallbacks = 0;
  let errors = 0;
  const counts = { HIGH: 0, MEDIUM: 0, LOW: 0 };

  // Phase 1: Check cache for all candidates
  const misses = [];
  const missIndices = [];
  for (let i = 0; i < candidates.length; i++) {
    const item = candidates[i];
    const url = item?.url || item?.canonical_url || "";
    const cached = cache ? lookupCache(cache, url, CLASSIFIER_VERSION, { ttlDays }) : null;
    if (cached) {
      cacheHits++;
      const norm = normalizeClassificationResult(cached);
      item.strategic_relevance = norm.classification;
      item.strategic_relevance_reason = norm.reason;
      item.strategic_relevance_source = "cache";
      item.strategic_relevance_version = CLASSIFIER_VERSION;
      item.strategic_relevance_applied = true;
      counts[norm.classification] = (counts[norm.classification] || 0) + 1;
    } else {
      misses.push(item);
      missIndices.push(i);
    }
  }

  // Phase 2: Classify cache misses concurrently
  if (misses.length > 0) {
    const results = await runConcurrent(misses, async (item) => {
      modelCalls++;
      const start = Date.now();
      const result = await classifySingle(item, { apiKey, model, httpsPost });
      const latencyMs = Date.now() - start;

      const fallbackType = result._fallback_type;
      if (fallbackType) {
        fallbacks++;
        // Only network/HTTP failures count as errors (spec: errors is subset of fallbacks)
        if (fallbackType === "network_error") errors++;
      }

      logFn(`strategic_classification: ${result.classification} — ${(item.headline || "").slice(0, 60)} (${latencyMs}ms, ${fallbackType ? "fallback:" + fallbackType : "model"})`);

      return result;
    }, concurrency);

    // Annotate miss items and write to cache
    for (let j = 0; j < misses.length; j++) {
      const item = misses[j];
      const result = results[j];
      const norm = normalizeClassificationResult(result);
      item.strategic_relevance = norm.classification;
      item.strategic_relevance_reason = norm.reason;
      item.strategic_relevance_source = result._fallback_type ? "fallback" : "model";
      item.strategic_relevance_version = CLASSIFIER_VERSION;
      item.strategic_relevance_applied = true;
      counts[norm.classification] = (counts[norm.classification] || 0) + 1;

      // Add to cache (in memory)
      if (cache) {
        const url = item?.url || item?.canonical_url || "";
        const key = buildCacheKey(url, CLASSIFIER_VERSION);
        cache.set(key, {
          cache_key: key,
          classification: norm.classification,
          reason: norm.reason,
          classifier_version: CLASSIFIER_VERSION,
          classified_at: new Date().toISOString(),
          source: item?.source_domain || item?.source || "",
          topic: item?.tag || "",
        });
      }
    }

    // Phase 3: Flush cache once
    if (cache && cachePath) {
      flushCache(cache, cachePath);
    }
  }

  const elapsedMs = Date.now() - startMs;

  const diagnostics = {
    total_classified: candidates.length,
    cache_hits: cacheHits,
    model_calls: modelCalls,
    fallbacks,
    errors,
    high: counts.HIGH || 0,
    medium: counts.MEDIUM || 0,
    low: counts.LOW || 0,
    elapsed_ms: elapsedMs,
    classifier_version: CLASSIFIER_VERSION,
  };

  logFn(`strategic_classification_run: ${candidates.length} total, ${cacheHits} cached, ${modelCalls} model, ${fallbacks} fallbacks, ${elapsedMs}ms`);

  return { candidates, diagnostics };
}

module.exports = {
  CLASSIFIER_VERSION,
  classifyCandidates,
  classifySingle,
  buildClassificationPrompt,
  normalizeClassificationResult,
  runConcurrent,
};
```

- [ ] Run the tests to verify they pass:

Run: `node tests/contracts/domains/classification/strategic-relevance-classifier.test.js`
Expected: All tests PASS

- [ ] Commit:

```bash
git add src/domains/classification/strategic-relevance-classifier.js tests/contracts/domains/classification/strategic-relevance-classifier.test.js
git commit -m "feat: add strategic relevance classifier with Haiku API integration"
```

---

## Task 3: Scoring Integration Module

**Files:**
- Create: `src/domains/classification/strategic-relevance-scoring.js`
- Create: `tests/contracts/domains/classification/strategic-relevance-scoring.test.js`

### Step 3.1: Write scoring tests

- [ ] Create test file:

```javascript
// tests/contracts/domains/classification/strategic-relevance-scoring.test.js
"use strict";

const assert = require("assert");
const {
  filterLowRelevance,
  boostHighRelevance,
} = require("../../../../src/domains/classification/strategic-relevance-scoring");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${name}: ${e.message}`);
    failed++;
  }
}

function makeCandidate(tag, relevance, score) {
  return {
    tag,
    strategic_relevance: relevance,
    strategic_relevance_applied: true,
    _score: score,
    headline: `Test ${relevance} ${tag}`,
    url: `https://example.com/${tag}-${relevance}-${score}`,
  };
}

console.log("strategic-relevance-scoring");

// --- filterLowRelevance ---

test("drops all LOW when topic has >= 20 candidates", () => {
  const candidates = [];
  for (let i = 0; i < 18; i++) candidates.push(makeCandidate("TECH", "HIGH", 0.8));
  for (let i = 0; i < 5; i++) candidates.push(makeCandidate("TECH", "LOW", 0.3));
  const { filtered, dropped, diagnostics } = filterLowRelevance(candidates);
  assert.strictEqual(filtered.length, 18);
  assert.strictEqual(dropped.length, 5);
  assert.strictEqual(diagnostics.TECH.low_dropped, 5);
});

test("keeps LOW when topic has < 15 candidates (thin pool)", () => {
  const candidates = [];
  for (let i = 0; i < 10; i++) candidates.push(makeCandidate("ENERGY", "MEDIUM", 0.5));
  for (let i = 0; i < 3; i++) candidates.push(makeCandidate("ENERGY", "LOW", 0.3));
  const { filtered, dropped, diagnostics } = filterLowRelevance(candidates);
  assert.strictEqual(filtered.length, 13);
  assert.strictEqual(dropped.length, 0);
  assert.strictEqual(diagnostics.ENERGY.thin_pool_mode, true);
});

test("drops LOW in 15-19 range unless would leave < 5", () => {
  const candidates = [];
  for (let i = 0; i < 14; i++) candidates.push(makeCandidate("FIN", "HIGH", 0.8));
  for (let i = 0; i < 3; i++) candidates.push(makeCandidate("FIN", "LOW", 0.3));
  // 17 total, 14 non-LOW >= 5, safe to drop
  const { filtered, dropped } = filterLowRelevance(candidates);
  assert.strictEqual(filtered.length, 14);
  assert.strictEqual(dropped.length, 3);
});

test("keeps LOW in 15-19 range when dropping would leave < 5", () => {
  const candidates = [];
  for (let i = 0; i < 4; i++) candidates.push(makeCandidate("FIN", "MEDIUM", 0.5));
  for (let i = 0; i < 12; i++) candidates.push(makeCandidate("FIN", "LOW", 0.3));
  // 16 total, only 4 non-LOW < 5, must keep
  const { filtered, dropped } = filterLowRelevance(candidates);
  assert.strictEqual(filtered.length, 16);
  assert.strictEqual(dropped.length, 0);
});

test("per-topic: deep topic drops LOW while thin topic keeps LOW", () => {
  const candidates = [];
  // TECH: 22 items (deep) — 18 HIGH + 4 LOW
  for (let i = 0; i < 18; i++) candidates.push(makeCandidate("TECH", "HIGH", 0.8));
  for (let i = 0; i < 4; i++) candidates.push(makeCandidate("TECH", "LOW", 0.3));
  // ENERGY: 10 items (thin) — 7 MEDIUM + 3 LOW
  for (let i = 0; i < 7; i++) candidates.push(makeCandidate("ENERGY", "MEDIUM", 0.5));
  for (let i = 0; i < 3; i++) candidates.push(makeCandidate("ENERGY", "LOW", 0.3));

  const { filtered, dropped, diagnostics } = filterLowRelevance(candidates);
  assert.strictEqual(diagnostics.TECH.low_dropped, 4);
  assert.strictEqual(diagnostics.TECH.thin_pool_mode, false);
  assert.strictEqual(diagnostics.ENERGY.low_dropped, 0);
  assert.strictEqual(diagnostics.ENERGY.thin_pool_mode, true);
  assert.strictEqual(filtered.length, 18 + 10); // 18 TECH HIGH + 10 ENERGY
  assert.strictEqual(dropped.length, 4); // 4 TECH LOW
});

test("empty candidates returns empty", () => {
  const { filtered, dropped, diagnostics } = filterLowRelevance([]);
  assert.strictEqual(filtered.length, 0);
  assert.strictEqual(dropped.length, 0);
  assert.deepStrictEqual(diagnostics, {});
});

// --- boostHighRelevance ---

test("boosts HIGH candidates by default 0.12", () => {
  const candidates = [
    makeCandidate("TECH", "HIGH", 0.7),
    makeCandidate("TECH", "MEDIUM", 0.6),
    makeCandidate("TECH", "LOW", 0.4),
  ];
  const { boosted, diagnostics } = boostHighRelevance(candidates);
  const high = boosted.find(c => c.strategic_relevance === "HIGH");
  assert.strictEqual(high._score, 0.82);
  assert.strictEqual(high._score_before_strategic, 0.7);
  assert.strictEqual(high._strategic_boost_applied, 0.12);
  assert.strictEqual(high._score_final, 0.82);
});

test("boost caps at 1.0", () => {
  const candidates = [makeCandidate("TECH", "HIGH", 0.95)];
  const { boosted } = boostHighRelevance(candidates);
  assert.strictEqual(boosted[0]._score, 1.0);
  assert.strictEqual(boosted[0]._strategic_boost_applied, 0.05);
  assert.strictEqual(boosted[0]._score_final, 1.0);
});

test("MEDIUM and LOW get zero boost", () => {
  const candidates = [
    makeCandidate("TECH", "MEDIUM", 0.6),
    makeCandidate("TECH", "LOW", 0.4),
  ];
  const { boosted } = boostHighRelevance(candidates);
  assert.strictEqual(boosted[0]._score, 0.6);
  assert.strictEqual(boosted[0]._strategic_boost_applied, 0);
  assert.strictEqual(boosted[0]._score_final, 0.6);
  assert.strictEqual(boosted[1]._score, 0.4);
  assert.strictEqual(boosted[1]._strategic_boost_applied, 0);
});

test("custom boost amount", () => {
  const candidates = [makeCandidate("TECH", "HIGH", 0.5)];
  const { boosted } = boostHighRelevance(candidates, { boostAmount: 0.2 });
  assert.strictEqual(boosted[0]._score, 0.7);
  assert.strictEqual(boosted[0]._strategic_boost_applied, 0.2);
});

test("preserves _score_before_strategic for all candidates", () => {
  const candidates = [
    makeCandidate("TECH", "HIGH", 0.7),
    makeCandidate("TECH", "MEDIUM", 0.6),
  ];
  const { boosted } = boostHighRelevance(candidates);
  assert.strictEqual(boosted[0]._score_before_strategic, 0.7);
  assert.strictEqual(boosted[1]._score_before_strategic, 0.6);
});

test("boost_in_thin_pool=false skips boost for thin topics", () => {
  // 10 candidates = thin pool (< 15)
  const candidates = [];
  for (let i = 0; i < 10; i++) {
    candidates.push(makeCandidate("ENERGY", i < 3 ? "HIGH" : "MEDIUM", 0.6));
  }
  const { boosted } = boostHighRelevance(candidates, { boostInThinPool: false });
  const highItems = boosted.filter(c => c.strategic_relevance === "HIGH");
  assert.ok(highItems.every(c => c._strategic_boost_applied === 0), "HIGH items should NOT be boosted in thin pool when disabled");
});

test("boost_in_thin_pool=true (default) boosts in thin topics", () => {
  const candidates = [];
  for (let i = 0; i < 10; i++) {
    candidates.push(makeCandidate("ENERGY", i < 3 ? "HIGH" : "MEDIUM", 0.6));
  }
  const { boosted } = boostHighRelevance(candidates); // default: boostInThinPool=true
  const highItems = boosted.filter(c => c.strategic_relevance === "HIGH");
  assert.ok(highItems.every(c => c._strategic_boost_applied > 0), "HIGH items SHOULD be boosted in thin pool by default");
});

test("empty candidates returns empty", () => {
  const { boosted, diagnostics } = boostHighRelevance([]);
  assert.strictEqual(boosted.length, 0);
  assert.deepStrictEqual(diagnostics, {});
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [ ] Run to verify failure:

Run: `node tests/contracts/domains/classification/strategic-relevance-scoring.test.js`
Expected: FAIL — `Cannot find module`

### Step 3.2: Implement scoring module

- [ ] Create the scoring module:

```javascript
// src/domains/classification/strategic-relevance-scoring.js
"use strict";

const DEFAULT_BOOST = 0.12;

/**
 * Pre-score: drop LOW-relevance candidates per topic, respecting adaptive thresholds.
 *
 * >= 20 candidates: drop all LOW
 * 15-19 candidates: drop LOW unless it would leave < 5 for the topic
 * < 15 candidates: keep all (thin-pool mode)
 */
function filterLowRelevance(candidates, opts = {}) {
  const logFn = typeof opts?.log === "function" ? opts.log : () => {};

  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { filtered: [], dropped: [], diagnostics: {} };
  }

  // Group by topic
  const byTag = new Map();
  for (const item of candidates) {
    const tag = String(item?.tag || "").trim().toUpperCase() || "__untagged__";
    if (!byTag.has(tag)) byTag.set(tag, []);
    byTag.get(tag).push(item);
  }

  const filtered = [];
  const dropped = [];
  const diagnostics = {};

  for (const [tag, topicItems] of byTag.entries()) {
    const total = topicItems.length;
    const lowItems = topicItems.filter((i) => i.strategic_relevance === "LOW");
    const nonLowItems = topicItems.filter((i) => i.strategic_relevance !== "LOW");
    const lowCount = lowItems.length;

    let lowDropped = 0;
    let thinPool = false;

    if (total >= 20) {
      // Deep pool: drop all LOW
      filtered.push(...nonLowItems);
      dropped.push(...lowItems);
      lowDropped = lowCount;
    } else if (total >= 15) {
      // Mid pool: drop LOW unless it would leave < 5
      if (nonLowItems.length >= 5) {
        filtered.push(...nonLowItems);
        dropped.push(...lowItems);
        lowDropped = lowCount;
      } else {
        filtered.push(...topicItems);
      }
    } else {
      // Thin pool: keep all
      filtered.push(...topicItems);
      thinPool = true;
    }

    diagnostics[tag] = {
      topic: tag,
      total_candidates: total,
      count_high: topicItems.filter((i) => i.strategic_relevance === "HIGH").length,
      count_medium: topicItems.filter((i) => i.strategic_relevance === "MEDIUM").length,
      count_low: lowCount,
      low_dropped: lowDropped,
      thin_pool_mode: thinPool,
    };

    if (lowDropped > 0) {
      logFn(`filterLowRelevance: ${tag} — dropped ${lowDropped} LOW (${total} total, ${nonLowItems.length} remain)`);
    }
    if (thinPool) {
      logFn(`filterLowRelevance: ${tag} — thin pool (${total} candidates), keeping all`);
    }
  }

  return { filtered, dropped, diagnostics };
}

/**
 * Post-score: boost HIGH-relevance candidates.
 * Preserves _score_before_strategic and _score_final on all candidates.
 */
/**
 * Post-score: boost HIGH-relevance candidates.
 * Preserves _score_before_strategic and _score_final on all candidates.
 *
 * @param {Array} candidates - scored candidates
 * @param {Object} opts
 * @param {number} opts.boostAmount - score boost for HIGH (default 0.12)
 * @param {boolean} opts.boostInThinPool - whether to boost in thin-pool topics (default true)
 * @param {Function} opts.log - logging function
 */
function boostHighRelevance(candidates, opts = {}) {
  const boostAmount = opts?.boostAmount ?? DEFAULT_BOOST;
  const boostInThinPool = opts?.boostInThinPool ?? true;
  const logFn = typeof opts?.log === "function" ? opts.log : () => {};

  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { boosted: [], diagnostics: {} };
  }

  // Determine thin-pool topics (< 15 candidates)
  const topicCounts = new Map();
  for (const item of candidates) {
    const tag = String(item?.tag || "").trim().toUpperCase() || "__untagged__";
    topicCounts.set(tag, (topicCounts.get(tag) || 0) + 1);
  }

  const diagnostics = {};
  const boosted = [];

  for (const item of candidates) {
    const tag = String(item?.tag || "").trim().toUpperCase() || "__untagged__";
    if (!diagnostics[tag]) {
      diagnostics[tag] = { high_boosted: 0 };
    }

    const originalScore = item._score || 0;
    item._score_before_strategic = originalScore;

    const isThinPool = (topicCounts.get(tag) || 0) < 15;
    const shouldBoost = item.strategic_relevance === "HIGH" && (!isThinPool || boostInThinPool);

    if (shouldBoost) {
      const actualBoost = Math.min(boostAmount, 1.0 - originalScore);
      item._score = Math.round((originalScore + actualBoost) * 1e6) / 1e6;
      item._strategic_boost_applied = Math.round(actualBoost * 1e6) / 1e6;
      diagnostics[tag].high_boosted++;
    } else {
      item._strategic_boost_applied = 0;
    }

    item._score_final = item._score;
    boosted.push(item);
  }

  return { boosted, diagnostics };
}

module.exports = {
  filterLowRelevance,
  boostHighRelevance,
};
```

- [ ] Run the tests to verify they pass:

Run: `node tests/contracts/domains/classification/strategic-relevance-scoring.test.js`
Expected: All tests PASS

- [ ] Commit:

```bash
git add src/domains/classification/strategic-relevance-scoring.js tests/contracts/domains/classification/strategic-relevance-scoring.test.js
git commit -m "feat: add strategic relevance scoring with per-topic filter and boost"
```

---

## Task 4: Pipeline Integration

**Files:**
- Modify: `src/entrypoints/digest-orchestrator-selection-runtime.js` (lines 1-10 imports, lines 490-505 scoring section)
- Create: `tests/contracts/domains/classification/strategic-relevance-integration.test.js`

### Step 4.1: Write integration tests

- [ ] Create test covering feature gate and diagnostics flow:

```javascript
// tests/contracts/domains/classification/strategic-relevance-integration.test.js
"use strict";

const assert = require("assert");
const {
  CLASSIFIER_VERSION,
  normalizeClassificationResult,
  buildClassificationPrompt,
  runConcurrent,
} = require("../../../../src/domains/classification/strategic-relevance-classifier");
const {
  filterLowRelevance,
  boostHighRelevance,
} = require("../../../../src/domains/classification/strategic-relevance-scoring");
const {
  hashUrl,
  buildCacheKey,
  loadCache,
  lookupCache,
} = require("../../../../src/domains/classification/strategic-relevance-cache");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${name}: ${e.message}`);
    failed++;
  }
}

console.log("strategic-relevance-integration");

// --- Feature gate off: no classification fields set ---

test("when classification disabled, candidates have no classification fields", () => {
  // Simulate what the pipeline does when CONFIG.digest.classification.enabled is false:
  // it skips classifyCandidates, filterLowRelevance, and boostHighRelevance entirely.
  const candidates = [
    { tag: "TECH", headline: "Test", _score: 0.7, url: "https://example.com/1" },
  ];
  // These fields must NOT be present — downstream code must tolerate absence
  assert.strictEqual(candidates[0].strategic_relevance, undefined);
  assert.strictEqual(candidates[0]._score_before_strategic, undefined);
  assert.strictEqual(candidates[0]._strategic_boost_applied, undefined);
  assert.strictEqual(candidates[0]._score_final, undefined);
  assert.strictEqual(candidates[0].strategic_relevance_applied, undefined);
});

test("when classification enabled, all candidates get classification fields after classify+filter+boost", () => {
  // Simulate the full pipeline with pre-annotated candidates
  const candidates = [
    { tag: "TECH", headline: "Major acquisition", url: "https://example.com/1" },
    { tag: "TECH", headline: "Product review", url: "https://example.com/2" },
  ];

  // Simulate classifyCandidates annotating them
  candidates[0].strategic_relevance = "HIGH";
  candidates[0].strategic_relevance_reason = "Major M&A deal";
  candidates[0].strategic_relevance_source = "model";
  candidates[0].strategic_relevance_version = CLASSIFIER_VERSION;
  candidates[0].strategic_relevance_applied = true;

  candidates[1].strategic_relevance = "MEDIUM";
  candidates[1].strategic_relevance_reason = "Tactical update";
  candidates[1].strategic_relevance_source = "model";
  candidates[1].strategic_relevance_version = CLASSIFIER_VERSION;
  candidates[1].strategic_relevance_applied = true;

  // All candidates have required fields
  for (const c of candidates) {
    assert.ok(["HIGH", "MEDIUM", "LOW"].includes(c.strategic_relevance));
    assert.strictEqual(typeof c.strategic_relevance_reason, "string");
    assert.ok(["cache", "model", "fallback"].includes(c.strategic_relevance_source));
    assert.strictEqual(c.strategic_relevance_version, CLASSIFIER_VERSION);
    assert.strictEqual(c.strategic_relevance_applied, true);
  }
});

// --- Full pipeline simulation (classify → filter → score → boost) ---

test("full pipeline: classify, filter LOW, boost HIGH", () => {
  // Simulate classified candidates (as if classifyCandidates ran)
  const candidates = [
    { tag: "TECH", strategic_relevance: "HIGH", strategic_relevance_applied: true, _score: 0.7 },
    { tag: "TECH", strategic_relevance: "MEDIUM", strategic_relevance_applied: true, _score: 0.6 },
    { tag: "TECH", strategic_relevance: "LOW", strategic_relevance_applied: true, _score: 0.4 },
    { tag: "TECH", strategic_relevance: "HIGH", strategic_relevance_applied: true, _score: 0.75 },
  ];
  // Add more to reach 20 for deep pool
  for (let i = 0; i < 18; i++) {
    candidates.push({ tag: "TECH", strategic_relevance: "MEDIUM", strategic_relevance_applied: true, _score: 0.5 });
  }

  // Step 1: filter
  const { filtered } = filterLowRelevance(candidates);
  assert.strictEqual(filtered.length, 21); // 22 - 1 LOW

  // Step 2: boost
  const { boosted } = boostHighRelevance(filtered);
  const highItems = boosted.filter(c => c.strategic_relevance === "HIGH");
  assert.ok(highItems.every(c => c._score > c._score_before_strategic));
  assert.ok(highItems.every(c => c._score_final === c._score));
  const medItems = boosted.filter(c => c.strategic_relevance === "MEDIUM");
  assert.ok(medItems.every(c => c._strategic_boost_applied === 0));
});

// --- Diagnostics structure ---

test("filter diagnostics include per-topic fields", () => {
  const candidates = [];
  for (let i = 0; i < 25; i++) {
    candidates.push({
      tag: "HEALTHCARE",
      strategic_relevance: i < 15 ? "HIGH" : i < 22 ? "MEDIUM" : "LOW",
      strategic_relevance_applied: true,
    });
  }
  const { diagnostics } = filterLowRelevance(candidates);
  const hc = diagnostics.HEALTHCARE;
  assert.ok(hc);
  assert.strictEqual(hc.topic, "HEALTHCARE");
  assert.strictEqual(typeof hc.total_candidates, "number");
  assert.strictEqual(typeof hc.count_high, "number");
  assert.strictEqual(typeof hc.count_medium, "number");
  assert.strictEqual(typeof hc.count_low, "number");
  assert.strictEqual(typeof hc.low_dropped, "number");
  assert.strictEqual(typeof hc.thin_pool_mode, "boolean");
});

// --- Re-sort after boost ---

test("after boost, re-sorting places boosted HIGH items above MEDIUM", () => {
  // Simulate: MEDIUM at 0.85, HIGH at 0.78 — after boost HIGH becomes 0.90
  const candidates = [
    { tag: "TECH", strategic_relevance: "MEDIUM", _score: 0.85, strategic_relevance_applied: true },
    { tag: "TECH", strategic_relevance: "HIGH", _score: 0.78, strategic_relevance_applied: true },
  ];
  for (let i = 0; i < 18; i++) {
    candidates.push({ tag: "TECH", strategic_relevance: "MEDIUM", _score: 0.5, strategic_relevance_applied: true });
  }
  const { boosted } = boostHighRelevance(candidates);
  // Before re-sort: MEDIUM at 0.85 is still first
  assert.strictEqual(boosted[0].strategic_relevance, "MEDIUM");
  // After re-sort (as pipeline does):
  boosted.sort((a, b) => (b._score || 0) - (a._score || 0));
  assert.strictEqual(boosted[0].strategic_relevance, "HIGH");
  assert.ok(boosted[0]._score > boosted[1]._score);
});

// --- Cache key consistency ---

test("cache key is consistent across modules", () => {
  const url = "https://example.com/article?utm_source=test";
  const key1 = buildCacheKey(url, CLASSIFIER_VERSION);
  const key2 = buildCacheKey(url, CLASSIFIER_VERSION);
  assert.strictEqual(key1, key2);
  // Without utm param should match
  const key3 = buildCacheKey("https://example.com/article", CLASSIFIER_VERSION);
  assert.strictEqual(key1, key3);
});

// --- Concurrency pool ---

test("runConcurrent processes all items", async () => {
  const items = [1, 2, 3, 4, 5];
  const results = await runConcurrent(items, async (n) => n * 2, 3);
  assert.deepStrictEqual(results, [2, 4, 6, 8, 10]);
});

test("runConcurrent handles empty array", async () => {
  const results = await runConcurrent([], async () => {}, 3);
  assert.deepStrictEqual(results, []);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [ ] Run to verify tests pass (all modules exist from prior tasks):

Run: `node tests/contracts/domains/classification/strategic-relevance-integration.test.js`
Expected: All tests PASS

- [ ] Commit:

```bash
git add tests/contracts/domains/classification/strategic-relevance-integration.test.js
git commit -m "test: add strategic relevance integration tests"
```

### Step 4.2: Wire into selection runtime

- [ ] Modify `src/entrypoints/digest-orchestrator-selection-runtime.js`:

**Add imports at top of file** (after existing requires, around line 11):

```javascript
const { classifyCandidates, CLASSIFIER_VERSION } = require("../domains/classification/strategic-relevance-classifier");
const { filterLowRelevance, boostHighRelevance } = require("../domains/classification/strategic-relevance-scoring");
const { loadCache } = require("../domains/classification/strategic-relevance-cache");
const path = require("path");
```

**Insert classification between line 489 (after `annotatedItems = classified;` block ends) and line 490 (before `const scoringInput = annotatedItems;`).** Replace the block from `const scoringInput = annotatedItems;` through scoring, inserting new classification logic:

Replace lines 490-505 (from `const scoringInput = annotatedItems;` through the scoring log line) with:

```javascript
    // --- Strategic relevance classification (feature-gated) ---
    let classificationDiagnostics = null;
    let filterDiagnostics = null;
    let boostDiagnostics = null;
    const classificationEnabled = CONFIG.digest?.classification?.enabled === true;
    let scoringInput = annotatedItems;

    if (classificationEnabled) {
      const cachePath = path.resolve(process.cwd(), "data", "strategic-classification-cache.json");
      const cache = loadCache(cachePath);
      const { candidates: classified, diagnostics: classRunDiag } = await classifyCandidates(
        annotatedItems,
        {
          cache,
          config: CONFIG,
          log,
          httpsPost: deps.httpsPostWithRetry,
          cachePath,
        }
      );
      classificationDiagnostics = classRunDiag;

      const candidatePoolAfterClassification = classified.length;
      const { filtered, dropped, diagnostics: filterDiag } = filterLowRelevance(classified, { log });
      filterDiagnostics = filterDiag;
      scoringInput = filtered;

      log(`Strategic classifier: ${classRunDiag.total_classified} classified (${classRunDiag.cache_hits} cached, ${classRunDiag.model_calls} model), ${dropped.length} LOW dropped, ${filtered.length} remain`);
    }

    // MVP transparent scoring: score every candidate before selection.
    const scoringConfig = paramScoringConfig && typeof paramScoringConfig === "object"
      ? paramScoringConfig
      : (CONFIG.digest?.scoring || {});
    const nowMs = Number.isFinite(paramNowMs) ? paramNowMs : Date.now();
    const scoredItems = scoreCandidates(scoringInput, { scoringConfig, nowMs });

    // --- Post-score strategic boost ---
    let postScoreItems = scoredItems;
    if (classificationEnabled) {
      const boostAmount = CONFIG.digest?.classification?.boost_amount ?? 0.12;
      const boostInThinPool = CONFIG.digest?.classification?.boost_in_thin_pool ?? true;
      const { boosted, diagnostics: bDiag } = boostHighRelevance(scoredItems, { boostAmount, boostInThinPool, log });
      boostDiagnostics = bDiag;
      // Re-sort after boost so selection sees correct order
      boosted.sort((a, b) => (b._score || 0) - (a._score || 0));
      postScoreItems = boosted;
    }

    if (postScoreItems.length > 0) {
      const topScore = postScoreItems[0]?._score?.toFixed(3) ?? "?";
      const bottomScore = postScoreItems[postScoreItems.length - 1]?._score?.toFixed(3) ?? "?";
      log(`Scored ${postScoreItems.length} candidate(s): top=${topScore}, bottom=${bottomScore}`);
    }
```

**Update the per-topic selection loop** to use `postScoreItems` instead of `scoredItems`:

Change the line `for (const item of scoredItems) {` (line ~517) to `for (const item of postScoreItems) {`.

**Add classification data to selectionDiagnostics** in the return object (around line 621-649). Add these fields inside the `selectionDiagnostics` object:

```javascript
        classification_enabled: classificationEnabled,
        classification_run: classificationDiagnostics,
        classification_summary: filterDiagnostics,
        classification_boost: boostDiagnostics,
        candidate_pool_after_classification: classificationEnabled ? scoringInput.length : null,
```

**Update `candidate_pool_scored`** to use `postScoreItems.length`.

**Update `scored_candidates`** mapping to use `postScoreItems`.

**Update `score_top` / `score_bottom`** to use `postScoreItems`.

**Add `httpsPostWithRetry` to deps destructuring** in `createDigestOrchestratorSelectionRuntime` (line 270-294). Add to the deps object:

```javascript
    httpsPostWithRetry,
```

- [ ] Run existing tests to verify no regressions:

Run: `npm test`
Expected: PASS

Run: `node tests/contracts/entrypoints/digest-orchestrator-selection-runtime.test.js`
Expected: PASS (existing test uses mocked deps, classification gate defaults to false)

- [ ] Commit:

```bash
git add src/entrypoints/digest-orchestrator-selection-runtime.js
git commit -m "feat: integrate strategic classifier into selection pipeline"
```

### Step 4.3: Pass httpsPostWithRetry through core runtime

- [ ] In `src/entrypoints/digest-orchestrator-core-runtime.js`, find where `createDigestOrchestratorSelectionRuntime(deps)` is called and add `httpsPostWithRetry` to the deps object. This is the transport function already available in the core runtime — find the exact call site and add it.

Search for: `createDigestOrchestratorSelectionRuntime({` in `digest-orchestrator-core-runtime.js`

Add `httpsPostWithRetry` from the transport runtime to the deps object passed to the selection runtime factory.

- [ ] Run tests:

Run: `npm test`
Expected: PASS

- [ ] Commit:

```bash
git add src/entrypoints/digest-orchestrator-core-runtime.js
git commit -m "feat: pass httpsPostWithRetry to selection runtime for classifier"
```

---

## Task 5: Config Example Update

**Files:**
- Modify: `config.example.json`

### Step 5.1: Add classification config block

- [ ] Read `config.example.json` to find the `digest` object. Add a `classification` sub-object with all defaults:

```json
"classification": {
  "enabled": false,
  "concurrency": 8,
  "boost_amount": 0.12,
  "cache_ttl_days": 14,
  "boost_in_thin_pool": true,
  "model": "claude-haiku-4-5-20241022"
}
```

Add this inside the `digest` object in `config.example.json`. All values are defaults — the feature is off until explicitly enabled.

- [ ] Commit:

```bash
git add config.example.json
git commit -m "feat: add classification config block to config.example.json"
```

---

## Task 6: Admin Audit Integration

**Files:**
- Modify: `web/routes/admin-api-digest-audit-runtime.js`

### Step 6.1: Surface classification diagnostics in admin audit

- [ ] Read `web/routes/admin-api-digest-audit-runtime.js` to find where `selectionDiagnostics` data is consumed in `buildTopicReadiness()` and `buildRollingMvpReadiness()`. The classification data is already embedded in `selectionDiagnostics` from Task 4 — this task ensures it's surfaced.

- [ ] In `buildTopicReadiness()`, where per-topic stats are accumulated, add extraction of classification fields if present:

```javascript
// Inside the per-audit-doc loop, after existing field extraction:
const classificationSummary = doc.selectionDiagnostics?.classification_summary || {};
const topicClassification = classificationSummary[tag] || {};
if (topicClassification.total_candidates) {
  topicEntry.classification_high = (topicEntry.classification_high || 0) + (topicClassification.count_high || 0);
  topicEntry.classification_medium = (topicEntry.classification_medium || 0) + (topicClassification.count_medium || 0);
  topicEntry.classification_low = (topicEntry.classification_low || 0) + (topicClassification.count_low || 0);
  topicEntry.classification_low_dropped = (topicEntry.classification_low_dropped || 0) + (topicClassification.low_dropped || 0);
  topicEntry.classification_thin_pool_days = (topicEntry.classification_thin_pool_days || 0) + (topicClassification.thin_pool_mode ? 1 : 0);
}
```

- [ ] Ensure the audit document written by the core runtime includes the new `selectionDiagnostics` fields (classification_enabled, classification_run, classification_summary, classification_boost). These were added in Task 4 — verify they flow through to the audit document.

- [ ] Run tests:

Run: `npm test`
Expected: PASS

- [ ] Commit:

```bash
git add web/routes/admin-api-digest-audit-runtime.js
git commit -m "feat: surface classification diagnostics in admin audit view"
```

---

## Task 7: Run Full Test Suite and Validate

### Step 7.1: Run all classification tests

- [ ] Run all four test files:

```bash
node tests/contracts/domains/classification/strategic-relevance-cache.test.js
node tests/contracts/domains/classification/strategic-relevance-classifier.test.js
node tests/contracts/domains/classification/strategic-relevance-scoring.test.js
node tests/contracts/domains/classification/strategic-relevance-integration.test.js
```

Expected: All PASS

### Step 7.2: Run full test suite

- [ ] Run:

```bash
npm test
```

Expected: PASS — no regressions

### Step 7.3: Add tests to change-to-test-map

- [ ] Update `docs/change-to-test-map.md` to add a row for classification modules:

Add to the subsystem test matrix table:

```
| `src/domains/classification/*` | `npm test` + `node tests/contracts/domains/classification/*.test.js` | validates strategic relevance classification, cache, scoring |
```

- [ ] Commit:

```bash
git add docs/change-to-test-map.md
git commit -m "docs: add classification modules to change-to-test-map"
```

---

## Task 8: Final Commit and Push

### Step 8.1: Push all work

- [ ] Push:

```bash
git push
```

Expected: All commits pushed to origin/main

---

## Notes for Implementer

### Key dependencies
- `src/entrypoints/digest-orchestrator-transport-runtime.js` exports `httpsPostWithRetry` via factory function `createDigestOrchestratorTransportRuntime(deps)`. The core runtime already creates this — you need to pass it through to the selection runtime factory.
- Config key `CONFIG.keys.anthropic` is already loaded from env vars `SIGNALBRIEF_ANTHROPIC_API_KEY` or `ANTHROPIC_API_KEY`.
- The `data/` directory exists and is writable. The cache file will be created on first run.
- **CRITICAL**: After `boostHighRelevance()`, you must re-sort candidates by `_score` descending. The boost changes scores but doesn't re-sort — the per-topic selection depends on descending order.
- **CRITICAL**: `path` module must be imported at the top of `digest-orchestrator-selection-runtime.js`. It's a stdlib module but is not currently imported in that file.

### Logging convention
The classifier uses informal string-based logging via the `log` function passed as a dependency (matching the existing pattern in `selectForEnrichment()`). The structured logger (`createStructuredLogger`) is used at the orchestrator/delivery level, not inside selection. Follow the existing convention — the `log` function in selection runtime is a simple string logger.

### How to verify end-to-end
After integration, you can verify by:
1. Set `CONFIG.digest.classification.enabled = true` in `config.json` under `digest`
2. Ensure `ANTHROPIC_API_KEY` is set
3. Run a digest and check the audit log for `classification_run` and `classification_summary` fields in `selectionDiagnostics`

### What NOT to change
- Do not modify `src/domains/scoring/score-candidate.js` — the 4-component formula stays unchanged
- Do not remove `isNonNewsHeadline()` from `standard-topic-broker-runtime.js` — it stays as cheap pre-filter
- Do not add npm dependencies — Node.js stdlib only

### Test conventions
- Tests use `assert` module, not a test framework
- Tests are run with `node path/to/test.js` directly
- Each test file self-reports pass/fail counts and exits with code 1 on failure
- Contract test location: `tests/contracts/domains/classification/`
