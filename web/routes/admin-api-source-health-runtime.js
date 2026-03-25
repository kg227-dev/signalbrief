"use strict";

const fs = require("fs");
const path = require("path");

const LANE_CLASSIFICATIONS = {
  rss: "rss",
  publisher_feed: "rss",
  official: "official",
  regulatory: "official",
  sec: "official",
  fda: "official",
  discovery: "discovery",
  perplexity: "discovery",
  perplexity_discovery: "discovery",
};

/**
 * Classify a raw lane string into one of: "rss", "official", "discovery", "unknown".
 */
function classifyLane(raw) {
  const key = String(raw || "").toLowerCase().trim();
  if (!key) return "unknown";
  if (LANE_CLASSIFICATIONS[key]) return LANE_CLASSIFICATIONS[key];
  if (key.includes("rss") || key.includes("feed")) return "rss";
  if (key.includes("official") || key.includes("regulatory")) return "official";
  if (key.includes("discovery") || key.includes("perplexity")) return "discovery";
  return "unknown";
}

/**
 * Aggregate source health metrics across an array of audit documents.
 * Each auditDoc has the shape written by writeDigestAuditLog:
 *   { date_et, topics: { [TAG]: { candidates: [{ lane, source, selected }] } } }
 *
 * Returns:
 *   {
 *     days_covered: number,
 *     topics: {
 *       [TAG]: {
 *         lane_totals: { rss, official, discovery, unknown },
 *         miss_days: number,  // days with zero candidates
 *         source_domains: string[],
 *       }
 *     },
 *     global_lane_totals: { rss, official, discovery, unknown },
 *     warnings: [{ topic, message }],
 *   }
 */
function aggregateSourceHealth(auditDocs) {
  const docs = Array.isArray(auditDocs) ? auditDocs : [];
  const topicStats = Object.create(null);
  const globalTotals = { rss: 0, official: 0, discovery: 0, unknown: 0 };

  for (const doc of docs) {
    const topics = (doc && typeof doc.topics === "object" && doc.topics) ? doc.topics : {};
    for (const [tag, topicData] of Object.entries(topics)) {
      if (!topicStats[tag]) {
        topicStats[tag] = {
          lane_totals: { rss: 0, official: 0, discovery: 0, unknown: 0 },
          miss_days: 0,
          no_broker_days: 0,
          source_domain_set: new Set(),
        };
      }
      const candidates = Array.isArray(topicData?.candidates) ? topicData.candidates : [];
      if (candidates.length === 0) {
        topicStats[tag].miss_days += 1;
        topicStats[tag].no_broker_days += 1;
        continue;
      }
      let dayBrokerCount = 0;
      for (const c of candidates) {
        const lane = classifyLane(c?.lane);
        topicStats[tag].lane_totals[lane] = (topicStats[tag].lane_totals[lane] || 0) + 1;
        globalTotals[lane] = (globalTotals[lane] || 0) + 1;
        if (c?.source) {
          let domain = String(c.source).toLowerCase();
          // Strip scheme and path if it looks like a URL
          try { domain = new URL(domain).hostname; } catch (_) { /* not a URL, use as-is */ }
          topicStats[tag].source_domain_set.add(domain);
        }
        if (lane === "rss" || lane === "official") dayBrokerCount += 1;
      }
      if (dayBrokerCount === 0) topicStats[tag].no_broker_days += 1;
    }
  }

  // Build warnings: topic had zero rss+official items on >= 3 of the covered days.
  const MISS_WARNING_THRESHOLD = 3;
  const warnings = [];
  for (const [tag, stats] of Object.entries(topicStats)) {
    if (stats.no_broker_days >= MISS_WARNING_THRESHOLD) {
      warnings.push({
        topic: tag,
        no_broker_days: stats.no_broker_days,
        miss_days: stats.miss_days,
        days_covered: docs.length,
        message: `Topic ${tag} had zero rss/official items on ${stats.no_broker_days}/${docs.length} days — possible source miss`,
      });
    }
  }

  // Serialize (convert Sets to arrays for JSON output).
  const topics = Object.create(null);
  for (const [tag, stats] of Object.entries(topicStats)) {
    topics[tag] = {
      lane_totals: { ...stats.lane_totals },
      miss_days: stats.miss_days,
      source_domains: Array.from(stats.source_domain_set).sort(),
    };
  }

  return {
    days_covered: docs.length,
    topics,
    global_lane_totals: globalTotals,
    warnings,
  };
}

/**
 * Read up to `maxDays` audit files from `auditDir` (most recent first).
 * Silently skips unreadable / unparseable files.
 */
function loadRecentAuditDocs(auditDir, maxDays = 7) {
  try {
    const files = fs.readdirSync(auditDir)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .sort()
      .reverse()
      .slice(0, maxDays);
    const docs = [];
    for (const f of files) {
      try {
        const raw = fs.readFileSync(path.join(auditDir, f), "utf8");
        docs.push(JSON.parse(raw));
      } catch (_) { /* skip malformed file */ }
    }
    return docs;
  } catch (_) {
    return [];
  }
}

/**
 * GET /api/admin/source-health?days=7
 *
 * Query params:
 *   days — how many recent audit days to include (default: 7, max: 30)
 */
async function handleAdminSourceHealthRoutes(ctx, deps) {
  const { req, res, pathname, url } = ctx;
  const { json, isAdminAuthed, digestAuditDir } = deps;

  if (!pathname.startsWith("/api/admin/source-health")) return false;
  if (req.method !== "GET") return false;
  if (!isAdminAuthed(req)) {
    json(res, { ok: false, error: "unauthorized" }, 401);
    return true;
  }

  const rawDays = Number(url.searchParams.get("days") || "7");
  const maxDays = Number.isFinite(rawDays) && rawDays > 0 ? Math.min(rawDays, 30) : 7;

  const auditDir = String(digestAuditDir || "");
  if (!auditDir) {
    json(res, { ok: false, error: "audit_dir_not_configured" }, 500);
    return true;
  }

  const auditDocs = loadRecentAuditDocs(auditDir, maxDays);
  const health = aggregateSourceHealth(auditDocs);

  json(res, { ok: true, ...health });
  return true;
}

module.exports = {
  handleAdminSourceHealthRoutes,
  aggregateSourceHealth,
  classifyLane,
  loadRecentAuditDocs,
};
