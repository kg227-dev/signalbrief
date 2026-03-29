"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const TARGET_REL = "src/domains/classification/strategic-relevance-cache.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);

const {
  hashUrl,
  buildCacheKey,
  loadCache,
  lookupCache,
  writeEntry,
  pruneExpired,
  flushCache,
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

// ─── hashUrl ─────────────────────────────────────────────────────────────────

test("hashUrl: returns a 64-char hex string", () => {
  const h = hashUrl("https://example.com/article");
  assert.strictEqual(typeof h, "string");
  assert.strictEqual(h.length, 64);
  assert.ok(/^[0-9a-f]{64}$/.test(h), "must be lowercase hex");
});

test("hashUrl: same URL gives same hash (idempotent)", () => {
  const url = "https://example.com/article";
  assert.strictEqual(hashUrl(url), hashUrl(url));
});

test("hashUrl: trailing slash is stripped (canonical)", () => {
  assert.strictEqual(
    hashUrl("https://example.com/article/"),
    hashUrl("https://example.com/article")
  );
});

test("hashUrl: root trailing slash is stripped", () => {
  assert.strictEqual(
    hashUrl("https://example.com/"),
    hashUrl("https://example.com")
  );
});

test("hashUrl: utm_* params are removed", () => {
  const clean = hashUrl("https://example.com/article");
  const dirty = hashUrl("https://example.com/article?utm_source=newsletter&utm_medium=email");
  assert.strictEqual(clean, dirty);
});

test("hashUrl: non-utm params are preserved", () => {
  const with_param = hashUrl("https://example.com/article?id=42");
  const without_param = hashUrl("https://example.com/article");
  assert.notStrictEqual(with_param, without_param);
});

test("hashUrl: utm params are stripped but other params kept", () => {
  const base = hashUrl("https://example.com/article?id=42");
  const with_utm = hashUrl("https://example.com/article?id=42&utm_source=email&utm_campaign=test");
  assert.strictEqual(base, with_utm);
});

test("hashUrl: hostname is lowercased", () => {
  assert.strictEqual(
    hashUrl("https://EXAMPLE.COM/article"),
    hashUrl("https://example.com/article")
  );
});

test("hashUrl: remaining params are sorted (order-independent)", () => {
  const a = hashUrl("https://example.com/article?b=2&a=1");
  const b = hashUrl("https://example.com/article?a=1&b=2");
  assert.strictEqual(a, b);
});

// ─── buildCacheKey ────────────────────────────────────────────────────────────

test("buildCacheKey: combines hash and classifier version", () => {
  const url = "https://example.com/article";
  const key = buildCacheKey(url, "v1");
  const expectedHash = hashUrl(url);
  assert.strictEqual(key, `${expectedHash}:v1`);
});

test("buildCacheKey: different versions produce different keys", () => {
  const url = "https://example.com/article";
  assert.notStrictEqual(buildCacheKey(url, "v1"), buildCacheKey(url, "v2"));
});

// ─── loadCache ────────────────────────────────────────────────────────────────

test("loadCache: returns empty Map for missing file", () => {
  const missingPath = path.join(os.tmpdir(), `sb-cache-missing-${Date.now()}.json`);
  const cache = loadCache(missingPath);
  assert.ok(cache instanceof Map);
  assert.strictEqual(cache.size, 0);
});

test("loadCache: returns empty Map for malformed JSON", () => {
  const tmpPath = path.join(os.tmpdir(), `sb-cache-malformed-${Date.now()}.json`);
  fs.writeFileSync(tmpPath, "not valid json{{{{", "utf8");
  try {
    const cache = loadCache(tmpPath);
    assert.ok(cache instanceof Map);
    assert.strictEqual(cache.size, 0);
  } finally {
    fs.unlinkSync(tmpPath);
  }
});

test("loadCache: returns empty Map for JSON with no entries", () => {
  const tmpPath = path.join(os.tmpdir(), `sb-cache-empty-${Date.now()}.json`);
  fs.writeFileSync(tmpPath, JSON.stringify({ version: 1, flushed_at: new Date().toISOString(), entries: {} }), "utf8");
  try {
    const cache = loadCache(tmpPath);
    assert.ok(cache instanceof Map);
    assert.strictEqual(cache.size, 0);
  } finally {
    fs.unlinkSync(tmpPath);
  }
});

// ─── writeEntry ───────────────────────────────────────────────────────────────

test("writeEntry: adds entry to the Map", () => {
  const cache = new Map();
  const url = "https://example.com/test-article";
  writeEntry(cache, url, "v1", "relevant", "Strong signal", null, {
    source: "reuters.com",
    topic: "TECHNOLOGY",
  });
  const key = buildCacheKey(url, "v1");
  assert.ok(cache.has(key), "entry should exist in map");
  const entry = cache.get(key);
  assert.strictEqual(entry.classification, "relevant");
  assert.strictEqual(entry.reason, "Strong signal");
  assert.strictEqual(entry.classifier_version, "v1");
  assert.ok(entry.classified_at, "classified_at should be set");
  assert.strictEqual(entry.source, "reuters.com");
  assert.strictEqual(entry.topic, "TECHNOLOGY");
  assert.strictEqual(entry.cache_key, key);
});

test("writeEntry: classified_at is a valid ISO string", () => {
  const cache = new Map();
  writeEntry(cache, "https://example.com/a", "v1", "not_relevant", "No signal", null, {});
  const key = buildCacheKey("https://example.com/a", "v1");
  const entry = cache.get(key);
  assert.ok(!isNaN(Date.parse(entry.classified_at)), "classified_at must be valid ISO");
});

test("writeEntry: writes file to disk when filePath provided", () => {
  const tmpPath = path.join(os.tmpdir(), `sb-cache-write-${Date.now()}.json`);
  try {
    const cache = new Map();
    writeEntry(cache, "https://example.com/written", "v1", "relevant", "Good signal", tmpPath, {
      source: "wsj.com",
      topic: "FINANCE",
    });
    assert.ok(fs.existsSync(tmpPath), "cache file should exist on disk");
    const raw = JSON.parse(fs.readFileSync(tmpPath, "utf8"));
    assert.strictEqual(raw.version, 1);
    assert.ok(raw.entries, "entries key should exist");
  } finally {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    const tmpFile = tmpPath + ".tmp";
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
});

test("writeEntry: no filePath does not crash", () => {
  const cache = new Map();
  // Should not throw
  writeEntry(cache, "https://example.com/no-file", "v1", "relevant", "reason", null, {});
  assert.strictEqual(cache.size, 1);
});

// ─── lookupCache ──────────────────────────────────────────────────────────────

test("lookupCache: returns entry on cache hit within TTL", () => {
  const cache = new Map();
  writeEntry(cache, "https://example.com/hit", "v1", "relevant", "reason", null, {});
  const result = lookupCache(cache, "https://example.com/hit", "v1", { ttlDays: 14 });
  assert.ok(result !== null, "should return entry on hit");
  assert.strictEqual(result.classification, "relevant");
});

test("lookupCache: returns null on cache miss (unknown URL)", () => {
  const cache = new Map();
  const result = lookupCache(cache, "https://example.com/miss", "v1", { ttlDays: 14 });
  assert.strictEqual(result, null);
});

test("lookupCache: returns null on classifier version mismatch", () => {
  const cache = new Map();
  writeEntry(cache, "https://example.com/version-test", "v1", "relevant", "reason", null, {});
  const result = lookupCache(cache, "https://example.com/version-test", "v2", { ttlDays: 14 });
  assert.strictEqual(result, null);
});

test("lookupCache: returns null for expired entry (beyond TTL)", () => {
  const cache = new Map();
  const url = "https://example.com/expired";
  const key = buildCacheKey(url, "v1");
  // Insert entry with classified_at 15 days ago
  const oldDate = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
  cache.set(key, {
    cache_key: key,
    classification: "relevant",
    reason: "old",
    classifier_version: "v1",
    classified_at: oldDate,
    source: null,
    topic: null,
  });
  const result = lookupCache(cache, url, "v1", { ttlDays: 14 });
  assert.strictEqual(result, null);
});

test("lookupCache: returns entry exactly at TTL boundary (not expired)", () => {
  const cache = new Map();
  const url = "https://example.com/boundary";
  const key = buildCacheKey(url, "v1");
  // 13 days ago — should still be valid with ttlDays=14
  const recentDate = new Date(Date.now() - 13 * 24 * 60 * 60 * 1000).toISOString();
  cache.set(key, {
    cache_key: key,
    classification: "relevant",
    reason: "fresh-ish",
    classifier_version: "v1",
    classified_at: recentDate,
    source: null,
    topic: null,
  });
  const result = lookupCache(cache, url, "v1", { ttlDays: 14 });
  assert.ok(result !== null, "13-day-old entry should not be expired with 14-day TTL");
});

// ─── pruneExpired ─────────────────────────────────────────────────────────────

test("pruneExpired: removes entries older than TTL", () => {
  const cache = new Map();
  const url1 = "https://example.com/old";
  const url2 = "https://example.com/fresh";
  const key1 = buildCacheKey(url1, "v1");
  const key2 = buildCacheKey(url2, "v1");

  cache.set(key1, {
    cache_key: key1,
    classification: "relevant",
    reason: "old",
    classifier_version: "v1",
    classified_at: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
    source: null,
    topic: null,
  });
  cache.set(key2, {
    cache_key: key2,
    classification: "not_relevant",
    reason: "fresh",
    classifier_version: "v1",
    classified_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    source: null,
    topic: null,
  });

  pruneExpired(cache, 14);
  assert.strictEqual(cache.has(key1), false, "old entry should be pruned");
  assert.strictEqual(cache.has(key2), true, "fresh entry should remain");
});

test("pruneExpired: keeps all entries if none are expired", () => {
  const cache = new Map();
  const url = "https://example.com/fresh2";
  writeEntry(cache, url, "v1", "relevant", "reason", null, {});
  const sizeBefore = cache.size;
  pruneExpired(cache, 14);
  assert.strictEqual(cache.size, sizeBefore);
});

test("pruneExpired: handles empty map without crashing", () => {
  const cache = new Map();
  pruneExpired(cache, 14);
  assert.strictEqual(cache.size, 0);
});

// ─── flushCache ───────────────────────────────────────────────────────────────

test("flushCache: writes file atomically (no leftover .tmp)", () => {
  const tmpPath = path.join(os.tmpdir(), `sb-cache-flush-${Date.now()}.json`);
  const tmpFile = tmpPath + ".tmp";
  try {
    const cache = new Map();
    writeEntry(cache, "https://example.com/flush-test", "v1", "relevant", "reason", null, {});
    flushCache(cache, tmpPath);
    assert.ok(fs.existsSync(tmpPath), "final file should exist");
    assert.ok(!fs.existsSync(tmpFile), "no leftover .tmp file");
  } finally {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
});

test("flushCache: written file has correct top-level structure", () => {
  const tmpPath = path.join(os.tmpdir(), `sb-cache-struct-${Date.now()}.json`);
  try {
    const cache = new Map();
    writeEntry(cache, "https://example.com/struct-test", "v1", "not_relevant", "No signal", null, {});
    flushCache(cache, tmpPath);
    const raw = JSON.parse(fs.readFileSync(tmpPath, "utf8"));
    assert.strictEqual(raw.version, 1);
    assert.ok(typeof raw.flushed_at === "string", "flushed_at must be a string");
    assert.ok(!isNaN(Date.parse(raw.flushed_at)), "flushed_at must be valid ISO");
    assert.ok(raw.entries && typeof raw.entries === "object", "entries must be an object");
  } finally {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  }
});

test("flushCache: round-trips with loadCache", () => {
  const tmpPath = path.join(os.tmpdir(), `sb-cache-roundtrip-${Date.now()}.json`);
  try {
    const cache = new Map();
    const url = "https://example.com/roundtrip";
    writeEntry(cache, url, "v1", "relevant", "Round-trip test", null, {
      source: "ft.com",
      topic: "FINANCE",
    });
    flushCache(cache, tmpPath);

    const loaded = loadCache(tmpPath);
    assert.ok(loaded instanceof Map);
    assert.strictEqual(loaded.size, 1);

    const key = buildCacheKey(url, "v1");
    assert.ok(loaded.has(key), "loaded cache should contain the written entry");
    const entry = loaded.get(key);
    assert.strictEqual(entry.classification, "relevant");
    assert.strictEqual(entry.reason, "Round-trip test");
    assert.strictEqual(entry.source, "ft.com");
    assert.strictEqual(entry.topic, "FINANCE");
  } finally {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  }
});

test("flushCache: multiple entries round-trip correctly", () => {
  const tmpPath = path.join(os.tmpdir(), `sb-cache-multi-${Date.now()}.json`);
  try {
    const cache = new Map();
    writeEntry(cache, "https://example.com/article-1", "v1", "relevant", "r1", null, { source: "wsj.com", topic: "FINANCE" });
    writeEntry(cache, "https://example.com/article-2", "v1", "not_relevant", "r2", null, { source: "buzzfeed.com", topic: "TECHNOLOGY" });
    writeEntry(cache, "https://example.com/article-3", "v2", "relevant", "r3", null, { source: "ft.com", topic: "HEALTHCARE" });
    flushCache(cache, tmpPath);

    const loaded = loadCache(tmpPath);
    assert.strictEqual(loaded.size, 3);
  } finally {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  }
});

// ─── Summary ──────────────────────────────────────────────────────────────────

process.stdout.write(`\n[strategic-relevance-cache] ${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  process.exitCode = 1;
}
