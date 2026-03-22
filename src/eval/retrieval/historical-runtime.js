"use strict";

const { buildDigestInsights } = require("../../../web/services/admin-digest-insights-runtime");

function summarizeHistoricalRows(rows = []) {
  const failures = {};
  const qualityScores = [];
  const domains = {};
  for (const row of (Array.isArray(rows) ? rows : [])) {
    const mode = String(row?.dominant_failure_mode || "").trim() || "unknown";
    failures[mode] = (failures[mode] || 0) + 1;
    const score = Number(row?.quality_score);
    if (Number.isFinite(score)) qualityScores.push(score);
    const sentItems = Array.isArray(row?.sent_items)
      ? row.sent_items
      : Array.isArray(row?.items)
        ? row.items
        : [];
    for (const item of sentItems) {
      const domain = String(item?.source_domain || "").trim().toLowerCase();
      if (!domain) continue;
      domains[domain] = (domains[domain] || 0) + 1;
    }
  }
  const averageQuality = qualityScores.length
    ? qualityScores.reduce((sum, value) => sum + value, 0) / qualityScores.length
    : null;
  const topDomains = Object.entries(domains)
    .map(([domain, count]) => ({ domain, count }))
    .sort((left, right) => right.count - left.count || left.domain.localeCompare(right.domain))
    .slice(0, 10);
  return {
    sample_count: rows.length,
    average_quality_score: averageQuality == null ? null : Number(averageQuality.toFixed(2)),
    failure_modes: failures,
    top_domains: topDomains,
  };
}

function buildHistoricalComparison({ digestDeliveryRecordRuntime, days = 14 } = {}) {
  const now = new Date();
  const cutoff = new Date(now.getTime() - (Math.max(1, Number(days || 14)) * 24 * 60 * 60 * 1000))
    .toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const rows = digestDeliveryRecordRuntime && typeof digestDeliveryRecordRuntime.loadAllCurrentRecords === "function"
    ? digestDeliveryRecordRuntime.loadAllCurrentRecords({ sinceDateEt: cutoff, status: "sent" })
    : [];
  const insights = buildDigestInsights(rows.slice(), { days });
  return {
    window_days: days,
    rows: rows.length,
    summary: summarizeHistoricalRows(rows),
    digest_insights: insights,
  };
}

module.exports = {
  buildHistoricalComparison,
  summarizeHistoricalRows,
};
