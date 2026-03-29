"use strict";

/**
 * Strategic Relevance Cache — file-backed cache for classifier results.
 *
 * Cache entries are keyed by `hashUrl(url):classifierVersion`.
 * Disk format: { version: 1, flushed_at: ISO, entries: { [cache_key]: entry } }
 * Atomic writes: write to .tmp then fs.renameSync to final path.
 */

const crypto = require("crypto");
const fs = require("fs");
const url = require("url");

// ─── hashUrl ─────────────────────────────────────────────────────────────────

/**
 * Canonicalize a URL and return its SHA-256 hex digest.
 * Canonicalization:
 *   - Lowercase hostname
 *   - Strip trailing slash from pathname
 *   - Remove all utm_* query parameters
 *   - Sort remaining query parameters alphabetically
 */
function hashUrl(rawUrl) {
  let parsed;
  try {
    parsed = new url.URL(rawUrl);
  } catch (_) {
    // If parsing fails, hash the raw string as-is
    return crypto.createHash("sha256").update(rawUrl).digest("hex");
  }

  // Lowercase hostname
  parsed.hostname = parsed.hostname.toLowerCase();

  // Strip trailing slash from pathname (but keep "/" for root)
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }

  // Remove utm_* params
  const keysToDelete = [];
  for (const key of parsed.searchParams.keys()) {
    if (key.toLowerCase().startsWith("utm_")) {
      keysToDelete.push(key);
    }
  }
  for (const key of keysToDelete) {
    parsed.searchParams.delete(key);
  }

  // Sort remaining params
  parsed.searchParams.sort();

  const canonical = parsed.toString();
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

// ─── buildCacheKey ────────────────────────────────────────────────────────────

/**
 * Returns `"${hashUrl(url)}:${classifierVersion}"`.
 */
function buildCacheKey(rawUrl, classifierVersion) {
  return `${hashUrl(rawUrl)}:${classifierVersion}`;
}

// ─── loadCache ────────────────────────────────────────────────────────────────

/**
 * Read and parse the JSON cache file at filePath.
 * Returns a Map keyed by cache_key.
 * Returns an empty Map if the file is missing or malformed — never crashes.
 */
function loadCache(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    const cache = new Map();
    if (parsed && parsed.entries && typeof parsed.entries === "object") {
      for (const [key, entry] of Object.entries(parsed.entries)) {
        cache.set(key, entry);
      }
    }
    return cache;
  } catch (_) {
    return new Map();
  }
}

// ─── lookupCache ──────────────────────────────────────────────────────────────

/**
 * Returns the cache entry if the key matches and the entry is within TTL.
 * Returns null on miss, version mismatch, or expiry.
 *
 * @param {Map} cache
 * @param {string} rawUrl
 * @param {string} classifierVersion
 * @param {{ ttlDays: number }} options
 * @returns {object|null}
 */
function lookupCache(cache, rawUrl, classifierVersion, { ttlDays }) {
  const key = buildCacheKey(rawUrl, classifierVersion);
  if (!cache.has(key)) return null;

  const entry = cache.get(key);

  // Check TTL
  const classifiedAt = new Date(entry.classified_at).getTime();
  const ageMs = Date.now() - classifiedAt;
  const ttlMs = ttlDays * 24 * 60 * 60 * 1000;
  if (ageMs > ttlMs) return null;

  return entry;
}

// ─── writeEntry ───────────────────────────────────────────────────────────────

/**
 * Add or overwrite an entry in the cache Map.
 * If filePath is provided, flush the full cache to disk atomically.
 *
 * @param {Map} cache
 * @param {string} rawUrl
 * @param {string} classifierVersion
 * @param {string} classification  - e.g. "relevant" | "not_relevant"
 * @param {string} reason
 * @param {string|null} filePath   - optional path to flush to disk
 * @param {{ source?: string, topic?: string }} meta
 */
function writeEntry(cache, rawUrl, classifierVersion, classification, reason, filePath, meta) {
  const key = buildCacheKey(rawUrl, classifierVersion);
  const entry = {
    cache_key: key,
    classification,
    reason,
    classifier_version: classifierVersion,
    classified_at: new Date().toISOString(),
    source: (meta && meta.source != null) ? meta.source : null,
    topic: (meta && meta.topic != null) ? meta.topic : null,
  };
  cache.set(key, entry);

  if (filePath) {
    flushCache(cache, filePath);
  }
}

// ─── pruneExpired ─────────────────────────────────────────────────────────────

/**
 * Remove entries from the Map that are older than ttlDays.
 * Mutates the Map in-place.
 *
 * @param {Map} cache
 * @param {number} [ttlDays=14]
 */
function pruneExpired(cache, ttlDays = 14) {
  const ttlMs = ttlDays * 24 * 60 * 60 * 1000;
  const now = Date.now();
  for (const [key, entry] of cache) {
    const classifiedAt = new Date(entry.classified_at).getTime();
    if (now - classifiedAt > ttlMs) {
      cache.delete(key);
    }
  }
}

// ─── flushCache ───────────────────────────────────────────────────────────────

/**
 * Atomically write the full cache to disk.
 * Format: { version: 1, flushed_at: ISO, entries: { [cache_key]: entry } }
 * Write to filePath + ".tmp" then fs.renameSync to filePath.
 * Cleans up .tmp on error.
 *
 * @param {Map} cache
 * @param {string} filePath
 */
function flushCache(cache, filePath) {
  const tmpPath = filePath + ".tmp";
  const entries = {};
  for (const [key, entry] of cache) {
    entries[key] = entry;
  }
  const payload = JSON.stringify({
    version: 1,
    flushed_at: new Date().toISOString(),
    entries,
  }, null, 2);

  try {
    fs.writeFileSync(tmpPath, payload, "utf8");
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch (_) { /* ignore */ }
    throw err;
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
