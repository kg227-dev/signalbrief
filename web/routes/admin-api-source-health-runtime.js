"use strict";

const fs = require("fs");
const path = require("path");

const LANE_CLASSIFICATIONS = {
  rss: "rss",
  publisher_feed: "rss",
  broker_publisher_feed: "rss",
  official: "official",
  broker_official: "official",
  regulatory: "official",
  sec: "official",
  fda: "official",
  discovery: "discovery",
  perplexity: "discovery",
  perplexity_discovery: "discovery",
  preferred: "discovery",
  broad: "discovery",
};

/**
 * Classify a raw lane string into one of: "rss", "official", "discovery", "unknown".
 */
function classifyLane(raw) {
  const key = String(raw || "").toLowerCase().trim();
  if (!key) return "unknown";
  if (LANE_CLASSIFICATIONS[key]) return LANE_CLASSIFICATIONS[key];
  if (key.includes("broker_publisher") || key.includes("rss") || key.includes("feed")) return "rss";
  if (key.includes("broker_official") || key.includes("official") || key.includes("regulatory")) return "official";
  if (key.includes("discovery") || key.includes("perplexity") || key === "preferred" || key === "broad") return "discovery";
  return "unknown";
}

function resolveCandidateLane(candidate = {}) {
  return candidate?.lane || candidate?.retrieval_origin || candidate?.retrieval_lane || candidate?.retrieval_pass || "";
}

function normalizeDomain(raw) {
  const value = String(raw || "").trim().toLowerCase();
  if (!value) return "";
  try {
    return String(new URL(value).hostname || "").trim().toLowerCase();
  } catch (_) {
    return value.replace(/^https?:\/\//i, "").split("/")[0].trim().toLowerCase();
  }
}

function sanitizeCountMap(rawCounts) {
  const out = Object.create(null);
  const entries = rawCounts && typeof rawCounts === "object" ? Object.entries(rawCounts) : [];
  for (const [key, value] of entries) {
    const normalizedKey = String(key || "").trim();
    const normalizedValue = Number(value);
    if (!normalizedKey || !Number.isFinite(normalizedValue) || normalizedValue <= 0) continue;
    out[normalizedKey] = normalizedValue;
  }
  return out;
}

function ensureTopicStats(topicStats, tag) {
  if (!topicStats[tag]) {
    topicStats[tag] = {
      lane_totals: { rss: 0, official: 0, discovery: 0, unknown: 0 },
      miss_days: 0,
      no_broker_days: 0,
      provider_limited_days: 0,
      thin_days: 0,
      broker_error_days: 0,
      source_domain_set: new Set(),
      source_id_set: new Set(),
    };
  }
  return topicStats[tag];
}

function ensureSourceStats(sourceStats, key, meta = {}) {
  if (!sourceStats[key]) {
    sourceStats[key] = {
      id: String(meta.id || key).trim() || key,
      lane: String(meta.lane || "").trim() || null,
      endpoint: String(meta.endpoint || "").trim() || null,
      domain: String(meta.domain || "").trim() || null,
      topic_tags: new Set(Array.isArray(meta.topic_tags) ? meta.topic_tags.map((tag) => String(tag || "").trim()).filter(Boolean) : []),
      attempted_days: 0,
      success_days: 0,
      failure_days: 0,
      parsed_count: 0,
      retained_count: 0,
      stale_count: 0,
      non_article_count: 0,
      validation_drop_count: 0,
      status_counts: Object.create(null),
      error_days: 0,
      last_error: null,
    };
  }
  return sourceStats[key];
}

function mergeTopicCandidateFallback(topicStats, globalTotals, tag, candidates = []) {
  const stats = ensureTopicStats(topicStats, tag);
  if (candidates.length === 0) {
    stats.miss_days += 1;
    stats.no_broker_days += 1;
    return;
  }
  let dayBrokerCount = 0;
  for (const candidate of candidates) {
    const lane = classifyLane(resolveCandidateLane(candidate));
    stats.lane_totals[lane] = (stats.lane_totals[lane] || 0) + 1;
    globalTotals[lane] = (globalTotals[lane] || 0) + 1;
    const domain = normalizeDomain(candidate?.source);
    if (domain) stats.source_domain_set.add(domain);
    if (lane === "rss" || lane === "official") dayBrokerCount += 1;
  }
  if (dayBrokerCount === 0) stats.no_broker_days += 1;
}

/**
 * Aggregate source health metrics across an array of audit documents.
 * Each auditDoc has the shape written by writeDigestAuditLog:
 *   {
 *     date_et,
 *     topics: { [TAG]: { candidates: [{ lane, source, selected }] } },
 *     fetch?: {
 *       topic_diagnostics?: [...],
 *       standard_topic_broker?: { source_diagnostics?: [...], topic_diagnostics?: [...] }
 *     }
 *   }
 *
 * Returns:
 *   {
 *     days_covered: number,
 *     topics: {
 *       [TAG]: {
 *         lane_totals: { rss, official, discovery, unknown },
 *         miss_days: number,
 *         no_broker_days: number,
 *         provider_limited_days: number,
 *         source_domains: string[],
 *         source_ids: string[],
 *       }
 *     },
 *     sources: {
 *       [sourceId]: {
 *         attempted_days, success_days, failure_days, retained_count, stale_count, ...
 *       }
 *     },
 *     global_lane_totals: { rss, official, discovery, unknown },
 *     warnings: [{ topic, message }],
 *     source_warnings: [{ source_id, message }],
 *   }
 */
function aggregateSourceHealth(auditDocs) {
  const docs = Array.isArray(auditDocs) ? auditDocs : [];
  const topicStats = Object.create(null);
  const sourceStats = Object.create(null);
  const globalTotals = { rss: 0, official: 0, discovery: 0, unknown: 0 };
  const brokerSummary = {
    source_fetch_count: 0,
    source_success_count: 0,
    source_failure_count: 0,
  };

  for (const doc of docs) {
    const fetch = doc && typeof doc.fetch === "object" ? doc.fetch : null;
    const broker = fetch && typeof fetch.standard_topic_broker === "object" ? fetch.standard_topic_broker : null;
    const fetchTopicDiagnostics = Array.isArray(fetch?.topic_diagnostics) ? fetch.topic_diagnostics : [];
    const fetchTopicByTag = new Map();
    for (const topic of fetchTopicDiagnostics) {
      const tag = String(topic?.tag || "").trim().toUpperCase();
      if (!tag) continue;
      fetchTopicByTag.set(tag, topic);
    }

    if (broker && broker.enabled === true) {
      brokerSummary.source_fetch_count += Number(broker.source_fetch_count || 0);
      brokerSummary.source_success_count += Number(broker.source_success_count || 0);
      brokerSummary.source_failure_count += Number(broker.source_failure_count || 0);

      const domainBySourceId = new Map();
      for (const source of (Array.isArray(broker.source_diagnostics) ? broker.source_diagnostics : [])) {
        const sourceId = String(source?.id || "").trim() || normalizeDomain(source?.endpoint) || `source_${Object.keys(sourceStats).length + 1}`;
        const domain = normalizeDomain(source?.endpoint);
        if (domain) domainBySourceId.set(sourceId, domain);
        const stats = ensureSourceStats(sourceStats, sourceId, {
          id: sourceId,
          lane: source?.lane,
          endpoint: source?.endpoint,
          domain,
          topic_tags: source?.topic_tags,
        });
        stats.attempted_days += 1;
        if (source?.ok === true) stats.success_days += 1;
        else stats.failure_days += 1;
        stats.parsed_count += Number(source?.parsed_count || 0);
        stats.retained_count += Number(source?.retained_count || 0);
        stats.stale_count += Number(source?.stale_count || 0);
        stats.non_article_count += Number(source?.non_article_count || 0);
        stats.validation_drop_count += Number(source?.validation_drop_count || 0);
        const statusCode = Number(source?.status || 0);
        if (statusCode > 0) {
          const statusKey = String(statusCode);
          stats.status_counts[statusKey] = (stats.status_counts[statusKey] || 0) + 1;
        }
        for (const tag of (Array.isArray(source?.topic_tags) ? source.topic_tags : [])) {
          const normalizedTag = String(tag || "").trim().toUpperCase();
          if (normalizedTag) stats.topic_tags.add(normalizedTag);
        }
        if (source?.error) {
          stats.error_days += 1;
          stats.last_error = String(source.error);
        }
      }

      for (const topic of (Array.isArray(broker.topic_diagnostics) ? broker.topic_diagnostics : [])) {
        const tag = String(topic?.tag || "").trim().toUpperCase() || "__untagged__";
        const stats = ensureTopicStats(topicStats, tag);
        const laneCounts = sanitizeCountMap(topic?.lane_counts);
        let dayBrokerCount = 0;
        for (const [lane, count] of Object.entries(laneCounts)) {
          const classifiedLane = classifyLane(lane);
          stats.lane_totals[classifiedLane] = (stats.lane_totals[classifiedLane] || 0) + count;
          globalTotals[classifiedLane] = (globalTotals[classifiedLane] || 0) + count;
          if (classifiedLane === "rss" || classifiedLane === "official") dayBrokerCount += count;
        }
        if (dayBrokerCount === 0) stats.no_broker_days += 1;
        if (Number(topic?.item_count || 0) <= 0) stats.miss_days += 1;
        const errors = Array.isArray(topic?.errors) ? topic.errors : [];
        if (errors.length > 0) stats.broker_error_days += 1;
        for (const sourceId of (Array.isArray(topic?.source_ids) ? topic.source_ids : [])) {
          const normalizedId = String(sourceId || "").trim();
          if (!normalizedId) continue;
          stats.source_id_set.add(normalizedId);
          const domain = domainBySourceId.get(normalizedId);
          if (domain) stats.source_domain_set.add(domain);
        }
        const fetchTopic = fetchTopicByTag.get(tag);
        const coverageStatus = String(fetchTopic?.coverage_status || "").trim().toLowerCase();
        if (coverageStatus.startsWith("provider_limited")) stats.provider_limited_days += 1;
        if (coverageStatus.includes("thin")) stats.thin_days += 1;
      }
      continue;
    }

    const topics = (doc && typeof doc.topics === "object" && doc.topics) ? doc.topics : {};
    for (const [tag, topicData] of Object.entries(topics)) {
      mergeTopicCandidateFallback(topicStats, globalTotals, tag, Array.isArray(topicData?.candidates) ? topicData.candidates : []);
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
    if (stats.provider_limited_days >= 2) {
      warnings.push({
        topic: tag,
        provider_limited_days: stats.provider_limited_days,
        days_covered: docs.length,
        message: `Topic ${tag} was provider-limited on ${stats.provider_limited_days}/${docs.length} days — fetch coverage may be unstable`,
      });
    }
  }

  const sourceWarnings = [];
  for (const [sourceId, stats] of Object.entries(sourceStats)) {
    if (stats.failure_days >= 3 || (stats.attempted_days >= 3 && stats.success_days === 0)) {
      sourceWarnings.push({
        source_id: sourceId,
        failure_days: stats.failure_days,
        attempted_days: stats.attempted_days,
        message: `Source ${sourceId} failed on ${stats.failure_days}/${stats.attempted_days} observed days`,
      });
    }
  }

  // Serialize (convert Sets to arrays for JSON output).
  const topics = Object.create(null);
  for (const [tag, stats] of Object.entries(topicStats)) {
    topics[tag] = {
      lane_totals: { ...stats.lane_totals },
      miss_days: stats.miss_days,
      no_broker_days: stats.no_broker_days,
      provider_limited_days: stats.provider_limited_days,
      thin_days: stats.thin_days,
      broker_error_days: stats.broker_error_days,
      source_domains: Array.from(stats.source_domain_set).sort(),
      source_ids: Array.from(stats.source_id_set).sort(),
    };
  }

  const sources = Object.create(null);
  for (const [sourceId, stats] of Object.entries(sourceStats)) {
    sources[sourceId] = {
      id: stats.id,
      lane: stats.lane,
      endpoint: stats.endpoint,
      domain: stats.domain,
      topic_tags: Array.from(stats.topic_tags).sort(),
      attempted_days: stats.attempted_days,
      success_days: stats.success_days,
      failure_days: stats.failure_days,
      parsed_count: stats.parsed_count,
      retained_count: stats.retained_count,
      stale_count: stats.stale_count,
      non_article_count: stats.non_article_count,
      validation_drop_count: stats.validation_drop_count,
      status_counts: sanitizeCountMap(stats.status_counts),
      error_days: stats.error_days,
      last_error: stats.last_error,
    };
  }

  return {
    days_covered: docs.length,
    topics,
    sources,
    global_lane_totals: globalTotals,
    broker_summary: brokerSummary,
    warnings,
    source_warnings: sourceWarnings,
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
