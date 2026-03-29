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
 * Prunes expired entries before returning.
 * Returns an empty Map if the file is missing or malformed — never crashes.
 * Logs a warning (via log or console.warn) if the file is malformed (but not if missing).
 *
 * @param {string} filePath
 * @param {number} [ttlDays=14]
 * @param {Function|null} [log]   - optional warning logger; falls back to console.warn
 */
function loadCache(filePath, ttlDays = 14, log = null) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    // File not found — silent empty cache
    return new Map();
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const warn = typeof log === "function" ? log : console.warn;
    warn(`[strategic-relevance-cache] malformed cache file at ${filePath}: ${err.message}`);
    return new Map();
  }

  const cache = new Map();
  if (parsed && parsed.entries && typeof parsed.entries === "object") {
    for (const [key, entry] of Object.entries(parsed.entries)) {
      cache.set(key, entry);
    }
  }
  pruneExpired(cache, ttlDays);
  return cache;
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
 * @param {{ classification: string, reason: string }} result
 * @param {{ source?: string, topic?: string }} meta
 * @param {string|null} filePath   - optional path to flush to disk
 */
function writeEntry(cache, rawUrl, classifierVersion, result, meta, filePath) {
  const key = buildCacheKey(rawUrl, classifierVersion);
  const entry = {
    cache_key: key,
    classification: result && result.classification != null ? result.classification : null,
    reason: result && result.reason != null ? result.reason : null,
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
 * Cleans up .tmp on error. Never throws — logs a warning instead.
 *
 * @param {Map} cache
 * @param {string} filePath
 * @param {Function|null} [log]   - optional warning logger; falls back to console.warn
 */
function flushCache(cache, filePath, log = null) {
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
    const warn = typeof log === "function" ? log : console.warn;
    warn(`[strategic-relevance-cache] failed to flush cache to ${filePath}: ${err.message}`);
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
