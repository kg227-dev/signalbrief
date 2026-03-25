"use strict";

/**
 * Editorial overrides runtime — loads, saves, and queries operator overrides
 * stored in data/editorial-overrides.json.
 *
 * Overrides:
 *   pins              — force a URL into selection for a topic
 *   excludes          — remove a URL from candidate pool
 *   source_suppressions — suppress all items from a domain
 *
 * "date" field is the last active date (inclusive). Entries older than
 * PRUNE_DAYS_OLD days are auto-pruned on write.
 */

const PRUNE_DAYS_OLD = 7;

function emptyOverrides() {
  return { pins: [], excludes: [], source_suppressions: [] };
}

/**
 * Load editorial-overrides.json. Returns empty structure if missing or invalid.
 */
function loadEditorialOverrides(overridesPath, fs) {
  let raw;
  try {
    raw = fs.readFileSync(String(overridesPath || ""), "utf8");
  } catch (_) {
    return emptyOverrides();
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_) {
    return emptyOverrides();
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return emptyOverrides();
  return {
    pins: Array.isArray(parsed.pins) ? parsed.pins : [],
    excludes: Array.isArray(parsed.excludes) ? parsed.excludes : [],
    source_suppressions: Array.isArray(parsed.source_suppressions) ? parsed.source_suppressions : [],
  };
}

/**
 * Compute the cutoff date string for pruning (PRUNE_DAYS_OLD days before today).
 * Entries with a date strictly before this cutoff are stale.
 *
 * @param {string} todayStr  YYYY-MM-DD
 * @returns {string} cutoff YYYY-MM-DD
 */
function computePruneCutoff(todayStr) {
  const d = new Date(todayStr);
  if (isNaN(d.getTime())) return "1970-01-01";
  d.setDate(d.getDate() - PRUNE_DAYS_OLD);
  return d.toISOString().slice(0, 10);
}

/**
 * Remove entries whose date is more than PRUNE_DAYS_OLD days before today.
 * Future entries (date > today) are kept so pre-planned overrides survive.
 *
 * @param {Array<{ date: string }>} entries
 * @param {string} todayStr  YYYY-MM-DD
 * @returns {Array}
 */
function pruneStaleEntries(entries, todayStr) {
  const cutoff = computePruneCutoff(todayStr);
  return (Array.isArray(entries) ? entries : []).filter((e) => {
    const d = String(e?.date || "").trim();
    if (!d) return false; // malformed → prune
    return d >= cutoff; // keep if within the window (or future)
  });
}

/**
 * Save overrides to disk, pruning stale entries first.
 *
 * @param {string} overridesPath
 * @param {{ pins, excludes, source_suppressions }} overrides
 * @param {string} todayStr  YYYY-MM-DD
 * @param {typeof import('fs')} fs
 * @param {typeof import('path')} path
 */
function saveEditorialOverrides(overridesPath, overrides, todayStr, fs, path) {
  const safe = {
    pins: pruneStaleEntries(overrides.pins, todayStr),
    excludes: pruneStaleEntries(overrides.excludes, todayStr),
    source_suppressions: pruneStaleEntries(overrides.source_suppressions, todayStr),
  };
  const dir = path.dirname(String(overridesPath || ""));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(String(overridesPath), JSON.stringify(safe, null, 2), "utf8");
}

/**
 * Returns true if the URL is actively excluded on todayStr.
 * An entry is active if its date >= today's prune cutoff and <= today.
 */
function isUrlExcluded(url, excludes, todayStr) {
  const normalizedUrl = String(url || "").trim();
  if (!normalizedUrl) return false;
  const cutoff = computePruneCutoff(todayStr);
  return (Array.isArray(excludes) ? excludes : []).some((e) => {
    const d = String(e?.date || "").trim();
    if (!d || d < cutoff || d > todayStr) return false;
    return String(e?.url || "").trim() === normalizedUrl;
  });
}

/**
 * Returns true if the domain is actively suppressed on todayStr.
 */
function isDomainSuppressed(domain, source_suppressions, todayStr) {
  const normalizedDomain = String(domain || "").trim().toLowerCase();
  if (!normalizedDomain) return false;
  const cutoff = computePruneCutoff(todayStr);
  return (Array.isArray(source_suppressions) ? source_suppressions : []).some((e) => {
    const d = String(e?.date || "").trim();
    if (!d || d < cutoff || d > todayStr) return false;
    return String(e?.domain || "").trim().toLowerCase() === normalizedDomain;
  });
}

/**
 * Returns pins whose date is within [cutoff, today] — i.e., active now.
 * Future pins (date > today) are excluded from this result.
 */
function getPinsForDate(pins, todayStr) {
  if (!Array.isArray(pins)) return [];
  const cutoff = computePruneCutoff(todayStr);
  return pins.filter((p) => {
    const d = String(p?.date || "").trim();
    return d && d >= cutoff && d <= todayStr;
  });
}

module.exports = {
  loadEditorialOverrides,
  saveEditorialOverrides,
  isUrlExcluded,
  isDomainSuppressed,
  getPinsForDate,
  pruneStaleEntries,
  emptyOverrides,
};
