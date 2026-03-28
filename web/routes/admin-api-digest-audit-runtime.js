"use strict";

const fs = require("fs");
const path = require("path");
const {
  aggregateSourceHealth,
  classifyLane,
  loadRecentAuditDocs,
} = require("./admin-api-source-health-runtime");

function pct(part, whole) {
  const numerator = Number(part || 0);
  const denominator = Number(whole || 0);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0;
  return Number(((numerator / denominator) * 100).toFixed(2));
}

function normalizeSelectedTier(rawTier) {
  const numeric = Number(rawTier);
  if (numeric === 1 || numeric === 2 || numeric === 3) return numeric;
  const normalized = String(rawTier || "").trim().toLowerCase();
  if (normalized === "premium") return 1;
  if (normalized === "strong") return 2;
  if (normalized === "standard") return 3;
  return null;
}

function resolveCandidateLane(candidate = {}) {
  return candidate?.lane || candidate?.retrieval_origin || candidate?.retrieval_lane || candidate?.retrieval_pass || "";
}

function buildSourceHealthSummary(sourceHealth = {}) {
  const sources = sourceHealth?.sources && typeof sourceHealth.sources === "object"
    ? Object.values(sourceHealth.sources)
    : [];
  const topicWarnings = Array.isArray(sourceHealth?.warnings) ? sourceHealth.warnings : [];
  const laneTotals = sourceHealth?.global_lane_totals && typeof sourceHealth.global_lane_totals === "object"
    ? sourceHealth.global_lane_totals
    : {};
  let attemptedDays = 0;
  let successDays = 0;
  for (const source of sources) {
    attemptedDays += Number(source?.attempted_days || 0);
    successDays += Number(source?.success_days || 0);
  }
  const rssCount = Number(laneTotals.rss || 0);
  const officialCount = Number(laneTotals.official || 0);
  const discoveryCount = Number(laneTotals.discovery || 0);
  const unknownCount = Number(laneTotals.unknown || 0);
  const totalLaneCount = rssCount + officialCount + discoveryCount + unknownCount;
  const sourceWarnings = sources
    .map((source) => {
      const attempted = Number(source?.attempted_days || 0);
      const failed = Number(source?.failure_days || 0);
      return {
        source_id: String(source?.id || "").trim() || "unknown",
        lane: String(source?.lane || "").trim() || "unknown",
        topic_tags: Array.isArray(source?.topic_tags) ? source.topic_tags : [],
        attempted_days: attempted,
        success_days: Number(source?.success_days || 0),
        failure_days: failed,
        retained_count: Number(source?.retained_count || 0),
        stale_count: Number(source?.stale_count || 0),
        validation_drop_count: Number(source?.validation_drop_count || 0),
        success_rate_pct: pct(source?.success_days || 0, attempted),
        last_error: source?.last_error ? String(source.last_error) : null,
      };
    })
    .filter((source) => source.failure_days >= 3 || (source.attempted_days >= 3 && source.success_days === 0))
    .sort((left, right) => {
      const rateDiff = Number(left.success_rate_pct || 0) - Number(right.success_rate_pct || 0);
      if (rateDiff !== 0) return rateDiff;
      const failDiff = Number(right.failure_days || 0) - Number(left.failure_days || 0);
      if (failDiff !== 0) return failDiff;
      return String(left.source_id || "").localeCompare(String(right.source_id || ""));
    });

  return {
    days_covered: Math.max(0, Number(sourceHealth?.days_covered || 0)),
    source_count: sources.length,
    broker_source_success_rate_pct: pct(successDays, attemptedDays),
    broker_candidate_share_pct: pct(rssCount + officialCount, totalLaneCount),
    discovery_candidate_share_pct: pct(discoveryCount, totalLaneCount),
    global_lane_totals: {
      rss: rssCount,
      official: officialCount,
      discovery: discoveryCount,
      unknown: unknownCount,
    },
    topic_warning_count: topicWarnings.length,
    source_warning_count: sourceWarnings.length,
    warnings: topicWarnings.slice(0, 6),
    top_source_warnings: sourceWarnings.slice(0, 6),
  };
}

function buildTopicReadiness(auditDocs = [], sourceHealth = aggregateSourceHealth(auditDocs)) {
  const docs = Array.isArray(auditDocs) ? auditDocs : [];
  const topicStats = Object.create(null);

  function ensureTopic(tag) {
    if (!topicStats[tag]) {
      topicStats[tag] = {
        tag,
        days_observed: 0,
        full_5_days: 0,
        candidate_depth_ok_days: 0,
        total_candidates_sum: 0,
        selected_item_count: 0,
        trusted_selected_count: 0,
        missed_story_flag_count: 0,
        lane_totals: { rss: 0, official: 0, discovery: 0, unknown: 0 },
      };
    }
    return topicStats[tag];
  }

  for (const doc of docs) {
    const topics = doc?.topics && typeof doc.topics === "object" ? Object.entries(doc.topics) : [];
    for (const [rawTag, topic] of topics) {
      const tag = String(rawTag || "").trim().toUpperCase();
      if (!tag) continue;
      const stats = ensureTopic(tag);
      const candidates = Array.isArray(topic?.candidates) ? topic.candidates : [];
      stats.days_observed += 1;
      const totalCandidates = Math.max(0, Number(topic?.total_candidates || candidates.length || 0));
      const selectedCount = Math.max(0, Number(topic?.selected_count || 0));
      stats.total_candidates_sum += totalCandidates;
      if (selectedCount === 5) stats.full_5_days += 1;
      if (totalCandidates >= 15) stats.candidate_depth_ok_days += 1;
      stats.missed_story_flag_count += Math.max(0, Number(Array.isArray(topic?.missed_story_flags) ? topic.missed_story_flags.length : 0));
      for (const candidate of candidates) {
        const lane = classifyLane(resolveCandidateLane(candidate));
        stats.lane_totals[lane] = (stats.lane_totals[lane] || 0) + 1;
        if (candidate?.selected === true) {
          stats.selected_item_count += 1;
          const tier = normalizeSelectedTier(candidate?.source_tier);
          if (tier != null && tier <= 2) stats.trusted_selected_count += 1;
        }
      }
    }
  }

  const perTopicSourceStats = new Map();
  for (const source of Object.values(sourceHealth?.sources || {})) {
    const topicTags = Array.isArray(source?.topic_tags) ? source.topic_tags : [];
    for (const rawTag of topicTags) {
      const tag = String(rawTag || "").trim().toUpperCase();
      if (!tag) continue;
      if (!perTopicSourceStats.has(tag)) {
        perTopicSourceStats.set(tag, {
          attempted_days: 0,
          success_days: 0,
          source_count: 0,
        });
      }
      const stats = perTopicSourceStats.get(tag);
      stats.attempted_days += Number(source?.attempted_days || 0);
      stats.success_days += Number(source?.success_days || 0);
      stats.source_count += 1;
    }
  }

  const out = Object.create(null);
  const observedTags = new Set([
    ...Object.keys(topicStats),
    ...Object.keys(sourceHealth?.topics || {}),
  ]);
  for (const tag of observedTags) {
    const stats = ensureTopic(tag);
    const health = sourceHealth?.topics?.[tag] || {};
    const sourceStats = perTopicSourceStats.get(tag) || {
      attempted_days: 0,
      success_days: 0,
      source_count: 0,
    };
    const rssCount = Number(stats.lane_totals.rss || 0);
    const officialCount = Number(stats.lane_totals.official || 0);
    const discoveryCount = Number(stats.lane_totals.discovery || 0);
    const unknownCount = Number(stats.lane_totals.unknown || 0);
    const totalLaneCount = rssCount + officialCount + discoveryCount + unknownCount;
    const full5Rate = pct(stats.full_5_days, stats.days_observed);
    const depthRate = pct(stats.candidate_depth_ok_days, stats.days_observed);
    const trustedShare = pct(stats.trusted_selected_count, stats.selected_item_count);
    const brokerShare = pct(rssCount + officialCount, totalLaneCount);
    const discoveryShare = pct(discoveryCount, totalLaneCount);
    const sourceSuccessRate = pct(sourceStats.success_days, sourceStats.attempted_days);
    const avgCandidateCount = stats.days_observed > 0
      ? Number((stats.total_candidates_sum / stats.days_observed).toFixed(1))
      : 0;
    const noBrokerDays = Math.max(0, Number(health?.no_broker_days || 0));
    const providerLimitedDays = Math.max(0, Number(health?.provider_limited_days || 0));
    const concerns = [];
    if (full5Rate < 100) concerns.push(`full-5 rate ${full5Rate}%`);
    if (depthRate < 100) concerns.push(`candidate depth>=15 ${depthRate}%`);
    if (stats.selected_item_count > 0 && trustedShare < 80) concerns.push(`trusted Tier 1/2 share ${trustedShare}%`);
    if (totalLaneCount > 0 && brokerShare < 70) concerns.push(`broker/RSS share ${brokerShare}%`);
    if (sourceStats.attempted_days > 0 && sourceSuccessRate < 90) concerns.push(`source success ${sourceSuccessRate}%`);
    if (noBrokerDays > 0) concerns.push(`${noBrokerDays} no-broker day(s)`);
    if (providerLimitedDays > 0) concerns.push(`${providerLimitedDays} provider-limited day(s)`);
    if (stats.missed_story_flag_count > 0) concerns.push(`${stats.missed_story_flag_count} missed-story flag(s)`);
    out[tag] = {
      tag,
      days_observed: stats.days_observed,
      full_5_days: stats.full_5_days,
      full_5_rate_pct: full5Rate,
      candidate_depth_ok_days: stats.candidate_depth_ok_days,
      candidate_depth_rate_pct: depthRate,
      avg_candidate_count: avgCandidateCount,
      selected_item_count: stats.selected_item_count,
      trusted_selected_share_pct: trustedShare,
      broker_candidate_share_pct: brokerShare,
      discovery_candidate_share_pct: discoveryShare,
      source_success_rate_pct: sourceSuccessRate,
      active_source_count: sourceStats.source_count,
      source_domain_count: Array.isArray(health?.source_domains) ? health.source_domains.length : 0,
      no_broker_days: noBrokerDays,
      provider_limited_days: providerLimitedDays,
      missed_story_flag_count: stats.missed_story_flag_count,
      lane_totals: { ...stats.lane_totals },
      source_ids: Array.isArray(health?.source_ids) ? health.source_ids : [],
      source_domains: Array.isArray(health?.source_domains) ? health.source_domains : [],
      concerns,
      exit_ready: stats.days_observed > 0
        && full5Rate === 100
        && depthRate === 100
        && (stats.selected_item_count === 0 || trustedShare >= 80)
        && (totalLaneCount === 0 || brokerShare >= 70)
        && (sourceStats.attempted_days === 0 || sourceSuccessRate >= 90)
        && noBrokerDays === 0
        && providerLimitedDays === 0
        && stats.missed_story_flag_count === 0,
    };
  }
  return Object.fromEntries(Object.entries(out).sort((left, right) => left[0].localeCompare(right[0])));
}

function buildRollingMvpReadiness(auditDocs = [], sourceHealth = aggregateSourceHealth(auditDocs)) {
  const docs = Array.isArray(auditDocs) ? auditDocs : [];
  let topicDaysObserved = 0;
  let topicDaysFull5 = 0;
  let topicDaysDepthOk = 0;
  let selectedItemCount = 0;
  let trustedSelectedItemCount = 0;
  let missedStoryFlagCount = 0;
  let underfilledTopicDays = 0;
  let fullDigestDays = 0;
  let candidateLaneEvidenceCount = 0;
  const laneTotals = { rss: 0, official: 0, discovery: 0, unknown: 0 };
  let fallbackBrokerCandidateCount = 0;
  let fallbackDiscoveryCandidateCount = 0;

  const fullDays = [];
  for (const doc of docs) {
    fallbackBrokerCandidateCount += Number(doc?.fetch?.broker_candidate_count || 0);
    fallbackDiscoveryCandidateCount += Number(doc?.fetch?.discovery_candidate_count || 0);
    const topics = doc?.topics && typeof doc.topics === "object" ? Object.entries(doc.topics) : [];
    let dayIsFull = topics.length > 0;
    for (const [, topic] of topics) {
      topicDaysObserved += 1;
      const selectedCount = Number(topic?.selected_count || 0);
      if (selectedCount === 5) topicDaysFull5 += 1;
      else {
        underfilledTopicDays += 1;
        dayIsFull = false;
      }
      if (Number(topic?.total_candidates || 0) >= 15) topicDaysDepthOk += 1;
      missedStoryFlagCount += Math.max(0, Number(Array.isArray(topic?.missed_story_flags) ? topic.missed_story_flags.length : 0));
      for (const candidate of (Array.isArray(topic?.candidates) ? topic.candidates : [])) {
        const lane = classifyLane(resolveCandidateLane(candidate));
        laneTotals[lane] = (laneTotals[lane] || 0) + 1;
        candidateLaneEvidenceCount += 1;
        if (candidate?.selected !== true) continue;
        selectedItemCount += 1;
        const tier = normalizeSelectedTier(candidate?.source_tier);
        if (tier != null && tier <= 2) trustedSelectedItemCount += 1;
      }
    }
    if (dayIsFull) {
      fullDigestDays += 1;
      if (doc?.date_et) fullDays.push(String(doc.date_et));
    }
  }

  let sourceAttemptedDays = 0;
  let sourceSuccessDays = 0;
  let noBrokerTopicDays = 0;
  let providerLimitedTopicDays = 0;
  for (const source of Object.values(sourceHealth.sources || {})) {
    sourceAttemptedDays += Number(source?.attempted_days || 0);
    sourceSuccessDays += Number(source?.success_days || 0);
  }
  for (const topic of Object.values(sourceHealth.topics || {})) {
    noBrokerTopicDays += Number(topic?.no_broker_days || 0);
    providerLimitedTopicDays += Number(topic?.provider_limited_days || 0);
  }

  const laneTotalCount = Number(laneTotals.rss || 0)
    + Number(laneTotals.official || 0)
    + Number(laneTotals.discovery || 0)
    + Number(laneTotals.unknown || 0);
  const brokerCandidateCount = candidateLaneEvidenceCount > 0
    ? Number(laneTotals.rss || 0) + Number(laneTotals.official || 0)
    : fallbackBrokerCandidateCount;
  const discoveryCandidateCount = candidateLaneEvidenceCount > 0
    ? Number(laneTotals.discovery || 0)
    : fallbackDiscoveryCandidateCount;
  const trustedSelectedSharePct = pct(trustedSelectedItemCount, selectedItemCount);
  const brokerCandidateSharePct = candidateLaneEvidenceCount > 0
    ? pct(Number(laneTotals.rss || 0) + Number(laneTotals.official || 0), laneTotalCount)
    : pct(brokerCandidateCount, brokerCandidateCount + discoveryCandidateCount);
  const discoveryCandidateSharePct = candidateLaneEvidenceCount > 0
    ? pct(Number(laneTotals.discovery || 0), laneTotalCount)
    : pct(discoveryCandidateCount, brokerCandidateCount + discoveryCandidateCount);
  const sourceSuccessRatePct = pct(sourceSuccessDays, sourceAttemptedDays);
  const topicDayFull5RatePct = pct(topicDaysFull5, topicDaysObserved);
  const candidateDepthRatePct = pct(topicDaysDepthOk, topicDaysObserved);
  const consecutiveFullDayStreak = (() => {
    const sorted = docs
      .map((doc) => String(doc?.date_et || "").trim())
      .filter(Boolean)
      .sort();
    let streak = 0;
    for (let index = sorted.length - 1; index >= 0; index -= 1) {
      if (!fullDays.includes(sorted[index])) break;
      streak += 1;
    }
    return streak;
  })();

  const concerns = [];
  if (docs.length < 7) concerns.push(`Only ${docs.length} audit day(s) available; Phase 1 exit requires 7 consecutive days.`);
  if (topicDaysObserved > 0 && topicDayFull5RatePct < 100) concerns.push(`${underfilledTopicDays} topic-day(s) still failed the exact 5-item contract.`);
  if (topicDaysObserved > 0 && candidateDepthRatePct < 100) concerns.push(`Candidate depth was <15 on ${Math.max(0, topicDaysObserved - topicDaysDepthOk)} topic-day(s).`);
  if (selectedItemCount > 0 && trustedSelectedSharePct < 80) concerns.push(`Trusted Tier 1/2 share is ${trustedSelectedSharePct}%, below the MVP target of 80%.`);
  if (brokerCandidateCount + discoveryCandidateCount > 0 && brokerCandidateSharePct < 70) concerns.push(`Broker/RSS-direct share is ${brokerCandidateSharePct}%, below the MVP backbone target of 70%+.`);
  if (sourceAttemptedDays > 0 && sourceSuccessRatePct < 90) concerns.push(`Observed broker source success rate is ${sourceSuccessRatePct}%, below the 90% reliability target.`);
  if (noBrokerTopicDays > 0) concerns.push(`${noBrokerTopicDays} topic-day(s) had zero broker candidates.`);
  if (providerLimitedTopicDays > 0) concerns.push(`${providerLimitedTopicDays} topic-day(s) were provider-limited.`);
  if (missedStoryFlagCount > 0) concerns.push(`${missedStoryFlagCount} missed-story warning(s) were flagged across the rolling window.`);

  return {
    days_covered: docs.length,
    available_dates: docs.map((doc) => String(doc?.date_et || "").trim()).filter(Boolean),
    topic_days_observed: topicDaysObserved,
    topic_days_full_5: topicDaysFull5,
    topic_day_full_5_rate_pct: topicDayFull5RatePct,
    full_digest_days: fullDigestDays,
    consecutive_full_day_streak: consecutiveFullDayStreak,
    topic_days_candidate_depth_ok: topicDaysDepthOk,
    candidate_depth_rate_pct: candidateDepthRatePct,
    selected_item_count: selectedItemCount,
    trusted_selected_share_pct: trustedSelectedSharePct,
    broker_candidate_share_pct: brokerCandidateSharePct,
    discovery_candidate_share_pct: discoveryCandidateSharePct,
    source_success_rate_pct: sourceSuccessRatePct,
    no_broker_topic_days: noBrokerTopicDays,
    provider_limited_topic_days: providerLimitedTopicDays,
    missed_story_flag_count: missedStoryFlagCount,
    concerns,
    exit_ready: docs.length >= 7
      && topicDaysObserved > 0
      && topicDayFull5RatePct === 100
      && candidateDepthRatePct === 100
      && trustedSelectedSharePct >= 80
      && brokerCandidateSharePct >= 70
      && sourceSuccessRatePct >= 90,
  };
}

/**
 * GET /api/admin/digest-audit
 *
 * Returns the selection audit log for a given date.
 * Query params:
 *   date  — YYYY-MM-DD (defaults to today ET)
 *
 * Response shape:
 *   { ok: true, date_et, run_id, mode, generated_at, summary, topics }
 *   topics[TAG].candidates[] has { headline, url, source, source_tier, lane, _score, selected }
 *
 * This gives the operator the full candidate funnel — all scored items,
 * what was selected, what was missed, and lane breakdown — in one call.
 */
async function handleAdminDigestAuditRoutes(ctx, deps) {
  const { req, res, pathname, url } = ctx;
  const { json, isAdminAuthed, digestAuditDir, formatEtDateKey } = deps;

  if (!pathname.startsWith("/api/admin/digest-audit")) return false;
  if (req.method !== "GET") return false;
  if (!isAdminAuthed(req)) {
    json(res, { ok: false, error: "unauthorized" }, 401);
    return true;
  }

  const requestedDate = String(url.searchParams.get("date") || "").trim();
  const todayEt = typeof formatEtDateKey === "function"
    ? formatEtDateKey(new Date())
    : new Date().toISOString().slice(0, 10);
  const dateKey = requestedDate.match(/^\d{4}-\d{2}-\d{2}$/) ? requestedDate : todayEt;

  const auditDir = String(digestAuditDir || "");
  if (!auditDir) {
    json(res, { ok: false, error: "audit_dir_not_configured" }, 500);
    return true;
  }

  const filePath = path.join(auditDir, `${dateKey}.json`);
  let auditDoc;
  try {
    auditDoc = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") {
      // List available audit dates so the caller can pick one.
      let available = [];
      try {
        available = fs.readdirSync(auditDir)
          .filter((f) => f.endsWith(".json"))
          .map((f) => f.replace(/\.json$/, ""))
          .sort()
          .reverse()
          .slice(0, 30);
      } catch (_) { /* dir may not exist yet */ }
      json(res, {
        ok: false,
        error: "not_found",
        date_requested: dateKey,
        available_dates: available,
      }, 404);
      return true;
    }
    json(res, { ok: false, error: "read_error", detail: String(err?.message || err).slice(0, 120) }, 500);
    return true;
  }

  const recentAuditDocs = loadRecentAuditDocs(auditDir, 7);
  const sourceHealth = aggregateSourceHealth(recentAuditDocs);
  json(res, {
    ok: true,
    ...auditDoc,
    rolling_readiness: buildRollingMvpReadiness(recentAuditDocs, sourceHealth),
    topic_readiness: buildTopicReadiness(recentAuditDocs, sourceHealth),
    source_health: buildSourceHealthSummary(sourceHealth),
  });
  return true;
}

module.exports = {
  buildSourceHealthSummary,
  buildTopicReadiness,
  handleAdminDigestAuditRoutes,
  buildRollingMvpReadiness,
};
