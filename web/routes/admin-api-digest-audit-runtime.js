"use strict";

const fs = require("fs");
const path = require("path");
const {
  aggregateSourceHealth,
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
  return null;
}

function buildRollingMvpReadiness(auditDocs = []) {
  const docs = Array.isArray(auditDocs) ? auditDocs : [];
  const sourceHealth = aggregateSourceHealth(docs);
  let topicDaysObserved = 0;
  let topicDaysFull5 = 0;
  let topicDaysDepthOk = 0;
  let selectedItemCount = 0;
  let trustedSelectedItemCount = 0;
  let missedStoryFlagCount = 0;
  let underfilledTopicDays = 0;
  let fullDigestDays = 0;

  const fullDays = [];
  for (const doc of docs) {
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

  const brokerCandidateCount = docs.reduce((sum, doc) => sum + Number(doc?.fetch?.broker_candidate_count || 0), 0);
  const discoveryCandidateCount = docs.reduce((sum, doc) => sum + Number(doc?.fetch?.discovery_candidate_count || 0), 0);
  const trustedSelectedSharePct = pct(trustedSelectedItemCount, selectedItemCount);
  const brokerCandidateSharePct = pct(brokerCandidateCount, brokerCandidateCount + discoveryCandidateCount);
  const discoveryCandidateSharePct = pct(discoveryCandidateCount, brokerCandidateCount + discoveryCandidateCount);
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
  json(res, {
    ok: true,
    ...auditDoc,
    rolling_readiness: buildRollingMvpReadiness(recentAuditDocs),
  });
  return true;
}

module.exports = {
  handleAdminDigestAuditRoutes,
  buildRollingMvpReadiness,
};
