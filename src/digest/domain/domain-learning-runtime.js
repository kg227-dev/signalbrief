"use strict";

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(process.cwd(), "data");
const STATS_FILE = path.join(DATA_DIR, "domain-stats.json");
const MAX_DOMAINS = 500;
const MIN_APPEARANCES = 3;
const DECAY_FACTOR = 0.92; // per-digest decay so old data fades

function loadDomainStats() {
  try {
    const raw = fs.readFileSync(STATS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (_err) {
    return {};
  }
}

function saveDomainStats(stats) {
  try {
    if (!fs.existsSync(DATA_DIR)) return;
    // Prune to MAX_DOMAINS by keeping highest-appearance domains
    const entries = Object.entries(stats);
    if (entries.length > MAX_DOMAINS) {
      entries.sort((a, b) => (b[1].appearances || 0) - (a[1].appearances || 0));
      stats = Object.fromEntries(entries.slice(0, MAX_DOMAINS));
    }
    fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2), "utf8");
  } catch (_err) {
    // Non-critical — fail silently
  }
}

/**
 * Accumulate stats from a batch of delivered digest items.
 * Call this after each digest run with all items that were actually delivered.
 */
function accumulateDomainStats(deliveredItems, existingStats) {
  const stats = existingStats && typeof existingStats === "object" ? { ...existingStats } : {};

  // Apply decay to existing entries first
  for (const domain of Object.keys(stats)) {
    const entry = stats[domain];
    if (!entry) continue;
    entry.avg_strategic_value = (entry.avg_strategic_value || 0) * DECAY_FACTOR;
    entry.avg_authority = (entry.avg_authority || 0) * DECAY_FACTOR;
    entry.quality_score = (entry.quality_score || 0) * DECAY_FACTOR;
  }

  const items = Array.isArray(deliveredItems) ? deliveredItems : [];
  for (const item of items) {
    const domain = String(item?.source_domain || "").trim().toLowerCase().replace(/^www\./, "");
    if (!domain || domain === "unknown") continue;

    if (!stats[domain]) {
      stats[domain] = {
        appearances: 0,
        avg_strategic_value: 0,
        avg_authority: 0,
        quality_score: 0,
        first_seen: new Date().toISOString(),
        last_seen: null,
      };
    }

    const entry = stats[domain];
    const n = entry.appearances;
    const sv = Number(item?.strategic_value || 0);
    const auth = Number(item?.source_authority || 0.3);

    // Running weighted average (newer items weighted more)
    entry.avg_strategic_value = (entry.avg_strategic_value * n + sv) / (n + 1);
    entry.avg_authority = (entry.avg_authority * n + auth) / (n + 1);
    entry.appearances = n + 1;
    entry.last_seen = new Date().toISOString();

    // Quality score: combination of strategic value + authority + consistency
    entry.quality_score = (
      0.50 * entry.avg_strategic_value
      + 0.30 * entry.avg_authority
      + 0.20 * Math.min(1, entry.appearances / 10) // consistency bonus
    );
  }

  return stats;
}

/**
 * Compute a learned authority adjustment for domains that are currently "unknown" tier.
 * Returns a Map<domain, adjustedAuthority> for domains that have enough history.
 */
function computeLearnedAuthorityAdjustments(stats) {
  const adjustments = new Map();
  if (!stats || typeof stats !== "object") return adjustments;

  for (const [domain, entry] of Object.entries(stats)) {
    if (!entry || (entry.appearances || 0) < MIN_APPEARANCES) continue;

    const qualityScore = entry.quality_score || 0;

    // Only adjust domains that would otherwise be unknown/suspect
    // High-quality unknowns get promoted toward standard tier (0.45-0.55)
    // Low-quality unknowns get demoted toward suspect tier (0.15-0.25)
    if (qualityScore >= 0.55) {
      // Promote: cap at 0.55 (below standard tier 0.60 — never auto-promote past standard)
      adjustments.set(domain, Math.min(0.55, 0.30 + qualityScore * 0.40));
    } else if (qualityScore < 0.25 && entry.appearances >= 5) {
      // Demote: domain consistently appears with low quality
      adjustments.set(domain, Math.max(0.12, qualityScore * 0.60));
    }
  }

  return adjustments;
}

module.exports = {
  loadDomainStats,
  saveDomainStats,
  accumulateDomainStats,
  computeLearnedAuthorityAdjustments,
};
