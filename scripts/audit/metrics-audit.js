#!/usr/bin/env node
/**
 * metrics-audit.js
 *
 * Standalone audit script — zero npm deps, stdlib only.
 * Reads raw data files and recomputes every admin dashboard metric,
 * comparing current logic vs corrected logic.
 *
 * Usage:
 *   node scripts/audit/metrics-audit.js
 *   node scripts/audit/metrics-audit.js | jq .
 */

"use strict";

const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, "../..");
const COST_LOG_PATH = path.join(ROOT, "data", "cost-log.json");
const ENGAGEMENT_LOG_PATH = path.join(ROOT, "data", "engagement-events.jsonl");
const DATA_DIR = path.join(ROOT, "data");

// ---------------------------------------------------------------------------
// ET timezone helpers
// ---------------------------------------------------------------------------

/**
 * Returns "YYYY-MM-DD" in America/New_York for a given Date (or now).
 */
function toEtDateKey(date) {
  return (date || new Date()).toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });
}

/**
 * Returns the current ET date parts as { year, month, day, hour, minute }.
 */
function getEtNowParts() {
  const now = new Date();
  const [year, month, day] = toEtDateKey(now).split("-").map(Number);
  const timeParts = now.toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
  const [hour, minute] = timeParts.split(":").map(Number);
  return { year, month, day, hour: Number.isFinite(hour) ? hour : 0, minute: Number.isFinite(minute) ? minute : 0 };
}

/**
 * Returns "YYYY-MM-DD" for today plus an offsetDays in ET.
 */
function etDateKeyOffset(nowParts, offsetDays) {
  const d = new Date(Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day + offsetDays));
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dy = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dy}`;
}

/**
 * Current ET month prefix "YYYY-MM".
 */
function currentEtMonthPrefix(nowParts) {
  return `${nowParts.year}-${String(nowParts.month).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Data loaders
// ---------------------------------------------------------------------------

function readJsonLines(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function loadCostLog() {
  return readJsonLines(COST_LOG_PATH);
}

function loadEngagementEvents() {
  return readJsonLines(ENGAGEMENT_LOG_PATH);
}

function loadUsers() {
  const files = fs.existsSync(DATA_DIR)
    ? fs.readdirSync(DATA_DIR).filter((f) => /^user-.+\.json$/.test(f))
    : [];
  const users = [];
  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(DATA_DIR, file), "utf8");
      users.push(JSON.parse(raw));
    } catch {
      // skip unparseable user files
    }
  }
  return users;
}

// ---------------------------------------------------------------------------
// Run normalization (mirrors admin-ops-io.js logic exactly)
// ---------------------------------------------------------------------------

function isScheduledRunRecord(run) {
  const row = run && typeof run === "object" ? run : {};
  const normalizedMode = String(row.mode || "").trim().toLowerCase();
  if (normalizedMode) return normalizedMode === "scheduled";
  return row.on_demand !== true;
}

function classifyRunVersion(run) {
  if (run.cost_version === 2) return "v2";
  if (!run.mode && run.on_demand !== undefined) return "v1";
  return "v1";
}

// ---------------------------------------------------------------------------
// Current-logic metrics
// ---------------------------------------------------------------------------

function computeAllTimeSummary(runs) {
  let cost = 0;
  let deliveries = 0;
  for (const run of runs) {
    cost += run.total_cost_usd || 0;
    deliveries += run.users_served || 0;
  }
  return {
    all_time_cost: parseFloat(cost.toFixed(5)),
    all_time_runs: runs.length,
    all_time_deliveries: deliveries,
  };
}

function computeMonthSummaryCurrent(runs, monthPrefix) {
  // Current logic: all run types (includes on-demand, admin re-runs, etc.)
  const monthRuns = runs.filter((r) => String(r.date || "").startsWith(monthPrefix));
  let cost = 0;
  let deliveries = 0;
  const uniqueUsers = new Set();
  for (const run of monthRuns) {
    cost += run.total_cost_usd || 0;
    deliveries += run.users_served || 0;
    for (const u of Array.isArray(run.per_user) ? run.per_user : []) {
      if (u && u.id) uniqueUsers.add(String(u.id));
    }
  }
  return {
    month_cost: parseFloat(cost.toFixed(5)),
    month_cost_note: "includes all run types",
    month_runs: monthRuns.length,
    month_deliveries: deliveries,
    month_unique_users: uniqueUsers.size,
  };
}

function computeTrailing7dCurrent(runs, nowParts) {
  const endKey = etDateKeyOffset(nowParts, 0);
  const startKey = etDateKeyOffset(nowParts, -6);
  const windowRuns = runs.filter((r) => {
    const d = String(r.date || "").trim();
    return d >= startKey && d <= endKey && isScheduledRunRecord(r);
  });
  let cost = 0;
  let deliveries = 0;
  for (const run of windowRuns) {
    cost += run.total_cost_usd || 0;
    deliveries += run.users_served || 0;
  }
  return {
    trailing_7d_cost: parseFloat(cost.toFixed(5)),
    trailing_7d_scheduled_runs: windowRuns.length,
    trailing_7d_deliveries: deliveries,
    _window: { startKey, endKey },
  };
}

/**
 * Deduplicates engagement events by event_key.
 * Follows admin-stats-referrals.js buildUniqueEngagementKey logic.
 */
function buildEngagementKey(event) {
  const explicit = String(event?.event_key || "").trim();
  if (explicit) return explicit;
  const digestId = String(event?.digest_id || "").trim();
  const chatId = String(event?.user_chat_id || "").trim();
  const type = String(event?.event_type || "").trim();
  if (digestId || chatId || type) return `${type}:${digestId}:${chatId}`;
  const ts = String(event?.ts_utc || "").trim();
  return ts ? `${type}:${ts}` : null;
}

function deduplicateEvents(events) {
  const seen = new Set();
  const deduped = [];
  for (const ev of events) {
    const key = buildEngagementKey(ev);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(ev);
  }
  return deduped;
}

function computeOpenRateCurrent(events, nowParts) {
  // Current logic: counts email_opens in 7d / digest_sent(email) in 7d
  // Bug: these are independent windows — an open can count even if the send
  // was outside the window, and vice versa.
  const deduped = deduplicateEvents(events);
  const nowMs = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;

  function inWindow(event, days) {
    const ts = Date.parse(String(event?.ts_utc || ""));
    return Number.isFinite(ts) && ts >= nowMs - days * DAY_MS;
  }

  const openKeys7d = new Set();
  const openKeys30d = new Set();
  const sentKeys7d = new Set();
  const sentKeys30d = new Set();

  for (const ev of deduped) {
    const type = String(ev?.event_type || "");
    const key = buildEngagementKey(ev);
    if (!key) continue;

    if (type === "email_open") {
      if (inWindow(ev, 7)) openKeys7d.add(key);
      if (inWindow(ev, 30)) openKeys30d.add(key);
    }

    if (type === "digest_sent" && String(ev?.channel || "") === "email") {
      if (inWindow(ev, 7)) sentKeys7d.add(key);
      if (inWindow(ev, 30)) sentKeys30d.add(key);
    }
  }

  const openRate7d = sentKeys7d.size > 0
    ? parseFloat((openKeys7d.size / sentKeys7d.size).toFixed(4))
    : 0;
  const openRate30d = sentKeys30d.size > 0
    ? parseFloat((openKeys30d.size / sentKeys30d.size).toFixed(4))
    : 0;

  return {
    open_rate_7d: openRate7d,
    open_rate_30d: openRate30d,
    _raw: {
      opens_7d: openKeys7d.size,
      sent_email_7d: sentKeys7d.size,
      opens_30d: openKeys30d.size,
      sent_email_30d: sentKeys30d.size,
    },
  };
}

/**
 * Per-user cost rollup — mirrors admin-stats-costs.js buildPerUserCostRollup.
 * Splits run cost evenly across users_served (not per_user.length).
 */
function computePerUserCostRollup(runs) {
  const userMap = {};
  for (const run of runs) {
    const usersServed = run.users_served || 1;
    for (const userRow of Array.isArray(run.per_user) ? run.per_user : []) {
      if (!userRow || !userRow.id) continue;
      const id = String(userRow.id);
      if (!userMap[id]) userMap[id] = { id, runs: 0, total_cost: 0 };
      userMap[id].runs += 1;
      userMap[id].total_cost += (run.total_cost_usd || 0) / usersServed;
    }
  }
  return Object.values(userMap).map((row) => ({
    ...row,
    total_cost: parseFloat(row.total_cost.toFixed(5)),
  }));
}

// ---------------------------------------------------------------------------
// Corrected-logic metrics
// ---------------------------------------------------------------------------

function computeMonthSummaryCorrected(runs, monthPrefix) {
  // Corrected: scheduled runs only (excludes on-demand, admin re-runs, etc.)
  const monthRuns = runs.filter(
    (r) => String(r.date || "").startsWith(monthPrefix) && isScheduledRunRecord(r)
  );
  let cost = 0;
  let deliveries = 0;
  for (const run of monthRuns) {
    cost += run.total_cost_usd || 0;
    deliveries += run.users_served || 0;
  }
  return {
    month_cost_scheduled_only: parseFloat(cost.toFixed(5)),
    month_runs_scheduled_only: monthRuns.length,
    month_deliveries_scheduled_only: deliveries,
  };
}

/**
 * Corrected open rate: only count email_opens whose digest_id was in
 * a digest_sent(email) event within the same window.
 * This prevents stale opens from inflating the rate.
 */
function computeOpenRateCorrected(events, nowParts) {
  const deduped = deduplicateEvents(events);
  const nowMs = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;

  function tsMs(event) {
    return Date.parse(String(event?.ts_utc || ""));
  }

  function inWindow(event, days) {
    const ts = tsMs(event);
    return Number.isFinite(ts) && ts >= nowMs - days * DAY_MS;
  }

  // Build Set<digest_id> for email sends within each window
  const sentDigestIds7d = new Set();
  const sentDigestIds30d = new Set();

  for (const ev of deduped) {
    if (
      String(ev?.event_type || "") === "digest_sent" &&
      String(ev?.channel || "") === "email"
    ) {
      const digestId = String(ev?.digest_id || "").trim();
      if (!digestId) continue;
      if (inWindow(ev, 7)) sentDigestIds7d.add(digestId);
      if (inWindow(ev, 30)) sentDigestIds30d.add(digestId);
    }
  }

  // Count email_opens whose digest_id is in the sent set for that window
  const matchedOpens7d = new Set();
  const matchedOpens30d = new Set();
  const orphanOpens7d = [];
  const orphanOpens30d = [];

  for (const ev of deduped) {
    if (String(ev?.event_type || "") !== "email_open") continue;
    const digestId = String(ev?.digest_id || "").trim();
    const key = buildEngagementKey(ev);
    if (!key) continue;

    if (inWindow(ev, 7)) {
      if (sentDigestIds7d.has(digestId)) {
        matchedOpens7d.add(key);
      } else {
        orphanOpens7d.push({ digest_id: digestId, ts_utc: ev.ts_utc });
      }
    }
    if (inWindow(ev, 30)) {
      if (sentDigestIds30d.has(digestId)) {
        matchedOpens30d.add(key);
      } else {
        orphanOpens30d.push({ digest_id: digestId, ts_utc: ev.ts_utc });
      }
    }
  }

  const openRate7d = sentDigestIds7d.size > 0
    ? parseFloat((matchedOpens7d.size / sentDigestIds7d.size).toFixed(4))
    : 0;
  const openRate30d = sentDigestIds30d.size > 0
    ? parseFloat((matchedOpens30d.size / sentDigestIds30d.size).toFixed(4))
    : 0;

  return {
    open_rate_7d_corrected: openRate7d,
    open_rate_30d_corrected: openRate30d,
    _raw: {
      opens_matched_7d: matchedOpens7d.size,
      sent_email_digest_ids_7d: sentDigestIds7d.size,
      opens_matched_30d: matchedOpens30d.size,
      sent_email_digest_ids_30d: sentDigestIds30d.size,
      orphan_opens_in_7d_window: orphanOpens7d.length,
      orphan_opens_in_30d_window: orphanOpens30d.length,
    },
    _orphan_details: {
      orphan_opens_7d: orphanOpens7d,
      orphan_opens_30d: orphanOpens30d,
    },
  };
}

/**
 * Corrected projection: uses historical 30d scheduled runs instead of
 * fallback cost estimates based on topic counts.
 */
function computeProjectionCorrected(runs, nowParts) {
  const endKey = etDateKeyOffset(nowParts, 0);
  const startKey = etDateKeyOffset(nowParts, -29);

  const historical30d = runs.filter((r) => {
    const d = String(r.date || "").trim();
    return d >= startKey && d <= endKey && isScheduledRunRecord(r);
  });

  const sampleSize = historical30d.length;

  if (sampleSize === 0) {
    return {
      projected_7d_cost_historical: null,
      projected_7d_runs: null,
      historical_avg_cost_per_run: null,
      historical_avg_users_per_run: null,
      projection_sample_size: 0,
      projection_basis: "insufficient_data",
    };
  }

  const totalCost = historical30d.reduce((s, r) => s + (r.total_cost_usd || 0), 0);
  const totalUsers = historical30d.reduce((s, r) => s + (r.users_served || 0), 0);
  const avgCostPerRun = totalCost / sampleSize;
  const avgUsersPerRun = totalUsers / sampleSize;

  // Trailing 7d scheduled runs as proxy for projected run count
  const trailing7dEndKey = etDateKeyOffset(nowParts, 0);
  const trailing7dStartKey = etDateKeyOffset(nowParts, -6);
  const trailing7dScheduled = runs.filter((r) => {
    const d = String(r.date || "").trim();
    return d >= trailing7dStartKey && d <= trailing7dEndKey && isScheduledRunRecord(r);
  });
  const projectedRunCount = trailing7dScheduled.length;
  const projectedCost = projectedRunCount * avgCostPerRun;

  return {
    projected_7d_cost_historical: parseFloat(projectedCost.toFixed(5)),
    projected_7d_runs: projectedRunCount,
    historical_avg_cost_per_run: parseFloat(avgCostPerRun.toFixed(5)),
    historical_avg_users_per_run: parseFloat(avgUsersPerRun.toFixed(4)),
    projection_sample_size: sampleSize,
    projection_basis: "historical_30d",
  };
}

// ---------------------------------------------------------------------------
// Data quality flags
// ---------------------------------------------------------------------------

function buildDataQualityFlags(runs, events, nowParts) {
  const flags = [];

  // Flag v1 records without mode or run_value_state
  const v1Count = runs.filter((r) => classifyRunVersion(r) === "v1").length;
  if (v1Count > 0) {
    flags.push({
      type: "v1_legacy_records",
      severity: "info",
      count: v1Count,
      message: `${v1Count} v1 records lack mode/run_value_state; scheduled classification uses on_demand field heuristic`,
    });
  }

  // Flag runs where per_user.length !== users_served
  const mismatchedRuns = runs.filter((r) => {
    const perUserLen = Array.isArray(r.per_user) ? r.per_user.length : null;
    const usersServed = Number(r.users_served);
    return perUserLen !== null && Number.isFinite(usersServed) && perUserLen !== usersServed;
  });
  if (mismatchedRuns.length > 0) {
    flags.push({
      type: "per_user_count_mismatch",
      severity: "warning",
      count: mismatchedRuns.length,
      message: `${mismatchedRuns.length} runs where per_user.length !== users_served; cost conservation check may skew`,
      examples: mismatchedRuns.slice(0, 3).map((r) => ({
        date: r.date,
        run_at: r.run_at,
        users_served: r.users_served,
        per_user_length: Array.isArray(r.per_user) ? r.per_user.length : null,
      })),
    });
  }

  // Flag email_open events whose digest was sent outside the rate window
  const DAY_MS = 24 * 60 * 60 * 1000;
  const nowMs = Date.now();
  const deduped = deduplicateEvents(events);

  const sentDigestIds30d = new Set();
  for (const ev of deduped) {
    if (
      String(ev?.event_type || "") === "digest_sent" &&
      String(ev?.channel || "") === "email"
    ) {
      const ts = Date.parse(String(ev?.ts_utc || ""));
      if (Number.isFinite(ts) && ts >= nowMs - 30 * DAY_MS) {
        const digestId = String(ev?.digest_id || "").trim();
        if (digestId) sentDigestIds30d.add(digestId);
      }
    }
  }

  const orphanOpens = deduped.filter((ev) => {
    if (String(ev?.event_type || "") !== "email_open") return false;
    const ts = Date.parse(String(ev?.ts_utc || ""));
    if (!Number.isFinite(ts) || ts < nowMs - 30 * DAY_MS) return false;
    const digestId = String(ev?.digest_id || "").trim();
    return digestId && !sentDigestIds30d.has(digestId);
  });

  if (orphanOpens.length > 0) {
    flags.push({
      type: "orphan_email_opens",
      severity: "warning",
      count: orphanOpens.length,
      message: `${orphanOpens.length} email_open event(s) in the last 30d whose digest_id has no matching digest_sent(email) event in the same window`,
      examples: orphanOpens.slice(0, 5).map((ev) => ({
        digest_id: ev.digest_id,
        ts_utc: ev.ts_utc,
        event_key: ev.event_key,
      })),
    });
  }

  // Flag runs with zero total_cost_usd (could be free admin/test runs skewing averages)
  const zeroCostRuns = runs.filter((r) => (r.total_cost_usd || 0) === 0 && isScheduledRunRecord(r));
  if (zeroCostRuns.length > 0) {
    flags.push({
      type: "zero_cost_scheduled_runs",
      severity: "info",
      count: zeroCostRuns.length,
      message: `${zeroCostRuns.length} scheduled run(s) with total_cost_usd=0; may indicate test runs or missing cost data`,
    });
  }

  // Flag runs without per_user array (older v1 records)
  const missingPerUser = runs.filter((r) => !Array.isArray(r.per_user));
  if (missingPerUser.length > 0) {
    flags.push({
      type: "missing_per_user_array",
      severity: "info",
      count: missingPerUser.length,
      message: `${missingPerUser.length} run(s) lack per_user array; per-user cost rollup excludes these`,
    });
  }

  return flags;
}

// ---------------------------------------------------------------------------
// Discrepancy analysis
// ---------------------------------------------------------------------------

function pctDelta(current, corrected) {
  if (current === null || corrected === null) return "n/a";
  if (current === 0 && corrected === 0) return "0.00%";
  if (current === 0) return "+∞";
  const delta = ((corrected - current) / Math.abs(current)) * 100;
  const sign = delta >= 0 ? "+" : "";
  return `${sign}${delta.toFixed(2)}%`;
}

function buildDiscrepancies(currentLogic, correctedLogic) {
  const discrepancies = [];

  const monthCostDelta = correctedLogic.month_cost_scheduled_only - currentLogic.month_cost;
  if (Math.abs(monthCostDelta) > 0.000001) {
    discrepancies.push({
      metric: "month_cost",
      current_value: currentLogic.month_cost,
      corrected_value: correctedLogic.month_cost_scheduled_only,
      delta_pct: pctDelta(currentLogic.month_cost, correctedLogic.month_cost_scheduled_only),
      root_cause: "Current logic includes all run types (on-demand, admin re-runs); corrected logic counts scheduled runs only",
      trust_level: currentLogic.month_cost > correctedLogic.month_cost_scheduled_only ? "do_not_trust" : "conditional",
    });
  }

  const openRate7dDelta = correctedLogic.open_rate_7d_corrected - currentLogic.open_rate_7d;
  if (Math.abs(openRate7dDelta) > 0.0001) {
    discrepancies.push({
      metric: "open_rate_7d",
      current_value: currentLogic.open_rate_7d,
      corrected_value: correctedLogic.open_rate_7d_corrected,
      delta_pct: pctDelta(currentLogic.open_rate_7d, correctedLogic.open_rate_7d_corrected),
      root_cause: "Current logic counts opens and sends in independent 7d windows; opens from older digests inflate the rate. Corrected logic only counts opens whose digest_id was sent within the same window.",
      trust_level: "do_not_trust",
    });
  }

  const openRate30dDelta = correctedLogic.open_rate_30d_corrected - currentLogic.open_rate_30d;
  if (Math.abs(openRate30dDelta) > 0.0001) {
    discrepancies.push({
      metric: "open_rate_30d",
      current_value: currentLogic.open_rate_30d,
      corrected_value: correctedLogic.open_rate_30d_corrected,
      delta_pct: pctDelta(currentLogic.open_rate_30d, correctedLogic.open_rate_30d_corrected),
      root_cause: "Same independent-window issue as open_rate_7d but over a 30d span.",
      trust_level: "do_not_trust",
    });
  }

  return discrepancies;
}

function buildTrustSummary(currentLogic, correctedLogic, discrepancies) {
  const doNotTrust = discrepancies
    .filter((d) => d.trust_level === "do_not_trust")
    .map((d) => d.metric);

  const conditional = discrepancies
    .filter((d) => d.trust_level === "conditional")
    .map((d) => d.metric);

  const allTracked = new Set([
    "all_time_cost", "all_time_runs", "all_time_deliveries",
    "month_cost", "month_runs", "month_deliveries", "month_unique_users",
    "trailing_7d_cost", "trailing_7d_scheduled_runs", "trailing_7d_deliveries",
    "open_rate_7d", "open_rate_30d",
  ]);

  const untrustedSet = new Set([...doNotTrust, ...conditional]);
  const safe = [...allTracked].filter((m) => !untrustedSet.has(m));

  return { safe, conditional, do_not_trust: doNotTrust };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const nowParts = getEtNowParts();
  const monthPrefix = currentEtMonthPrefix(nowParts);

  // Load raw data
  const rawRuns = loadCostLog();
  const rawEvents = loadEngagementEvents();
  const users = loadUsers();

  const dataSnapshot = {
    cost_log_lines: rawRuns.length,
    engagement_events: rawEvents.length,
    users: users.length,
    month_prefix: monthPrefix,
    trailing_7d_window: {
      start: etDateKeyOffset(nowParts, -6),
      end: etDateKeyOffset(nowParts, 0),
    },
    trailing_30d_window: {
      start: etDateKeyOffset(nowParts, -29),
      end: etDateKeyOffset(nowParts, 0),
    },
  };

  // Current-logic metrics
  const allTime = computeAllTimeSummary(rawRuns);
  const monthCurrent = computeMonthSummaryCurrent(rawRuns, monthPrefix);
  const trailing7d = computeTrailing7dCurrent(rawRuns, nowParts);
  const openRateCurrent = computeOpenRateCurrent(rawEvents, nowParts);
  const perUserRollup = computePerUserCostRollup(rawRuns);

  const sumPerUser = perUserRollup.reduce((s, u) => s + u.total_cost, 0);
  const conservationDelta = parseFloat((sumPerUser - allTime.all_time_cost).toFixed(5));

  const currentLogic = {
    all_time_cost: allTime.all_time_cost,
    all_time_runs: allTime.all_time_runs,
    all_time_deliveries: allTime.all_time_deliveries,
    ...monthCurrent,
    trailing_7d_cost: trailing7d.trailing_7d_cost,
    trailing_7d_scheduled_runs: trailing7d.trailing_7d_scheduled_runs,
    trailing_7d_deliveries: trailing7d.trailing_7d_deliveries,
    open_rate_7d: openRateCurrent.open_rate_7d,
    open_rate_30d: openRateCurrent.open_rate_30d,
    _open_rate_raw: openRateCurrent._raw,
    per_user_cost_conservation_check: {
      sum_per_user: parseFloat(sumPerUser.toFixed(5)),
      all_time_cost: allTime.all_time_cost,
      delta: conservationDelta,
    },
  };

  // Corrected-logic metrics
  const monthCorrected = computeMonthSummaryCorrected(rawRuns, monthPrefix);
  const openRateCorrected = computeOpenRateCorrected(rawEvents, nowParts);
  const projectionCorrected = computeProjectionCorrected(rawRuns, nowParts);

  const correctedLogic = {
    ...monthCorrected,
    ...openRateCorrected,
    ...projectionCorrected,
  };

  // Discrepancies and trust summary
  const discrepancies = buildDiscrepancies(currentLogic, correctedLogic);
  const trustSummary = buildTrustSummary(currentLogic, correctedLogic, discrepancies);
  const dataQualityFlags = buildDataQualityFlags(rawRuns, rawEvents, nowParts);

  const report = {
    audit_timestamp: new Date().toISOString(),
    data_snapshot: dataSnapshot,
    current_logic: currentLogic,
    corrected_logic: correctedLogic,
    discrepancies,
    trust_summary: trustSummary,
    data_quality_flags: dataQualityFlags,
  };

  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}

main();
