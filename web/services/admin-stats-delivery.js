const {
  buildWindow,
  expectedScheduledCount,
  deliveredScheduledCount,
  getLastSuccessfulScheduledRun,
  getNextExpectedActiveDelivery,
  minutesUntilEtKey,
  formatCountdown,
  formatMissedTrendLabel,
} = require("./admin-stats-delivery-runtime");

function normalizeRecipientKey(value) {
  return String(value || "").trim().toLowerCase();
}

function buildTodayDateKey(nowEt) {
  const year = Number(nowEt?.year || 0);
  const month = Number(nowEt?.month || 0);
  const day = Number(nowEt?.day || 0);
  if (!year || !month || !day) return "";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseRunTsMs(run) {
  const direct = Date.parse(String(run?.run_at || ""));
  if (Number.isFinite(direct)) return direct;
  const dateKey = String(run?.date || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    const fallback = Date.parse(`${dateKey}T00:00:00.000Z`);
    if (Number.isFinite(fallback)) return fallback;
  }
  return 0;
}

function getAllowedDays(user) {
  const raw = Array.isArray(user?.days_of_week) && user.days_of_week.length
    ? user.days_of_week
    : [1, 2, 3, 4, 5];
  return raw.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
}

function getDeliveryMinutes(user) {
  const parts = String(user?.delivery_time || "07:00").split(":").map(Number);
  const hour = Number.isFinite(parts[0]) ? parts[0] : 7;
  const minute = Number.isFinite(parts[1]) ? parts[1] : 0;
  return (hour * 60) + minute;
}

function findLatestScheduledRun(runs) {
  return (Array.isArray(runs) ? runs : [])
    .slice()
    .sort((a, b) => parseRunTsMs(b) - parseRunTsMs(a))[0] || null;
}

function extractFailedScheduledRecipients(run) {
  return (Array.isArray(run?.per_user_failed) ? run.per_user_failed : [])
    .map((entry) => ({
      id: String(entry?.id || "").trim(),
      error: String(entry?.error || "Delivery failed"),
      delivery_outcome: String(entry?.delivery_outcome || "").trim(),
    }))
    .filter((entry) => entry.id);
}

function classifyScheduledRunFailure(run) {
  const blockedReason = String(run?.blocked_reason || "").trim();
  const failedRecipients = Array.isArray(run?.per_user_failed) ? run.per_user_failed : [];
  const runValueState = String(run?.run_value_state || "").trim();

  if (blockedReason === "circuit_breaker_open") {
    return {
      failure_stage: "admission_gate",
      failure_label: "Admission gate blocked",
      failure_reason: "circuit_breaker_open",
    };
  }
  if (blockedReason) {
    return {
      failure_stage: "admission_gate",
      failure_label: "Admission gate blocked",
      failure_reason: blockedReason,
    };
  }
  if (failedRecipients.length > 0) {
    const failedSend = failedRecipients.every((entry) => {
      const outcome = String(entry?.delivery_outcome || "").trim().toLowerCase();
      const error = String(entry?.error || "").trim().toLowerCase();
      return outcome.startsWith("delivery_failed") || error.includes("no channels succeeded");
    });
    if (failedSend) {
      return {
        failure_stage: "send",
        failure_label: "Send failed",
        failure_reason: "delivery_failed",
      };
    }
    return {
      failure_stage: "generation",
      failure_label: "Generation failed",
      failure_reason: runValueState || "run_failed",
    };
  }
  if (runValueState === "zero_value") {
    return {
      failure_stage: "generation",
      failure_label: "Generation completed but nothing delivered",
      failure_reason: "zero_value",
    };
  }
  return {
    failure_stage: null,
    failure_label: null,
    failure_reason: null,
  };
}

function countPastDueActiveUsersForToday(roster, nowEt) {
  const users = Array.isArray(roster) ? roster : [];
  const todayDow = new Date(Date.UTC(
    Number(nowEt?.year || 0),
    Math.max(0, Number(nowEt?.month || 1) - 1),
    Number(nowEt?.day || 1)
  )).getUTCDay();
  const nowMinutes = (Number(nowEt?.hour || 0) * 60) + Number(nowEt?.minute || 0);

  return users.filter((user) => {
    if (String(user?.status || "") !== "active") return false;
    if (!getAllowedDays(user).includes(todayDow)) return false;
    return getDeliveryMinutes(user) <= nowMinutes;
  }).length;
}

function buildRecentIncidentSummary({ readJsonLineLog, digestIncidentLog, nowMs }) {
  if (typeof readJsonLineLog !== "function" || !digestIncidentLog) {
    return {
      active_incident_open: false,
      active_incident_count: 0,
      active_incident_summary: null,
      active_incident_at: null,
    };
  }

  const maxAgeMs = 6 * 60 * 60 * 1000;
  const recent = readJsonLineLog(digestIncidentLog, 30)
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => {
      const tsMs = Date.parse(String(entry.ts_utc || ""));
      const mode = String(entry?.metadata?.mode || "").toLowerCase();
      return {
        entry,
        tsMs,
        mode,
      };
    })
    .filter(({ tsMs, mode }) => Number.isFinite(tsMs) && (nowMs - tsMs) <= maxAgeMs && (!mode || mode === "scheduled"))
    .sort((a, b) => b.tsMs - a.tsMs);

  const latest = recent[0]?.entry || null;
  return {
    active_incident_open: !!latest,
    active_incident_count: recent.length,
    active_incident_summary: latest ? String(latest.summary || latest.type || "Digest incident") : null,
    active_incident_at: latest ? (latest.ts_utc || null) : null,
  };
}

function buildDeliveryReliabilitySnapshot({ runs, roster, parseEtNowParts }) {
  const activeRoster = roster.filter((user) => user.status === "active");
  const activeEmailSet = new Set(
    activeRoster
      .map((user) => String(user.email || "").toLowerCase().trim())
      .filter(Boolean)
  );
  const nowEt = parseEtNowParts();
  const currentWindow = buildWindow(nowEt, -7, -1);
  const previousWindow = buildWindow(nowEt, -14, -8);

  const expectedCurrent7d = expectedScheduledCount(currentWindow, activeRoster);
  const deliveredCurrent7d = deliveredScheduledCount(currentWindow, runs, activeEmailSet);
  const expectedPrevious7d = expectedScheduledCount(previousWindow, activeRoster);
  const deliveredPrevious7d = deliveredScheduledCount(previousWindow, runs, activeEmailSet);
  const missedCurrent7d = Math.max(0, expectedCurrent7d - deliveredCurrent7d);
  const missedPrevious7d = Math.max(0, expectedPrevious7d - deliveredPrevious7d);
  const missedDelta7d = missedCurrent7d - missedPrevious7d;
  const successRate7d = expectedCurrent7d > 0
    ? Number(((deliveredCurrent7d / expectedCurrent7d) * 100).toFixed(1))
    : 100;
  const missedTrendLabel = formatMissedTrendLabel(missedDelta7d);
  const lastSuccessfulScheduledRun = getLastSuccessfulScheduledRun(runs);
  const nextExpectedActiveDelivery = getNextExpectedActiveDelivery(activeRoster);

  const nextExpectedCountdownMinutes = nextExpectedActiveDelivery
    ? minutesUntilEtKey(nextExpectedActiveDelivery.next_delivery_key, nowEt)
    : null;

  return {
    success_rate_7d: successRate7d,
    delivered_7d: deliveredCurrent7d,
    expected_7d: expectedCurrent7d,
    missed_current_7d: missedCurrent7d,
    missed_previous_7d: missedPrevious7d,
    missed_delta_7d: missedDelta7d,
    missed_trend_label: missedTrendLabel,
    last_successful_scheduled_run: lastSuccessfulScheduledRun
      ? (lastSuccessfulScheduledRun.run_at_et || lastSuccessfulScheduledRun.run_at || null)
      : null,
    next_expected_delivery_et: nextExpectedActiveDelivery?.next_delivery_et || null,
    next_expected_countdown: formatCountdown(nextExpectedCountdownMinutes),
    next_expected_countdown_minutes: nextExpectedCountdownMinutes,
  };
}

function buildDeliveryOperationsSnapshot({
  runs,
  roster,
  parseEtNowParts,
  readJsonLineLog,
  digestIncidentLog,
}) {
  const nowEt = typeof parseEtNowParts === "function" ? parseEtNowParts() : {};
  const nowMs = Date.now();
  const latestScheduledRun = findLatestScheduledRun(runs);
  const failedRecipients = extractFailedScheduledRecipients(latestScheduledRun);
  const deliveredUsers = Array.isArray(latestScheduledRun?.per_user)
    ? latestScheduledRun.per_user.length
    : Number(latestScheduledRun?.users_served || 0);
  const failedUsers = failedRecipients.length || Math.max(0, Number(latestScheduledRun?.users_failed || 0));
  const dueUsers = Number(latestScheduledRun?.users_due);
  const latestDue = Number.isFinite(dueUsers)
    ? dueUsers
    : Math.max(0, deliveredUsers + failedUsers);
  const latestRunAt = latestScheduledRun?.run_at_et || latestScheduledRun?.run_at || null;
  const latestRunDate = String(latestScheduledRun?.date || "").trim();
  const latestRunClean = !!latestScheduledRun && failedUsers === 0 && deliveredUsers > 0;
  const todayDateKey = buildTodayDateKey(nowEt);
  const pastDueUsersToday = countPastDueActiveUsersForToday(roster, nowEt);
  const backfillNeeded = pastDueUsersToday > 0 && latestRunDate !== todayDateKey;
  const incidentSummary = buildRecentIncidentSummary({
    readJsonLineLog,
    digestIncidentLog,
    nowMs,
  });
  const latestFailure = classifyScheduledRunFailure(latestScheduledRun);
  const latestRunValueState = String(latestScheduledRun?.run_value_state || "").trim();

  return {
    latest_scheduled_run_at: latestRunAt,
    latest_scheduled_run_date: latestRunDate || null,
    latest_scheduled_run_clean: latestRunClean,
    latest_scheduled_run_users_served: deliveredUsers,
    latest_scheduled_run_users_due: latestDue,
    latest_scheduled_run_failed_users: failedUsers,
    latest_scheduled_run_failed_recipient_ids: failedRecipients.map((entry) => normalizeRecipientKey(entry.id)).filter(Boolean),
    latest_scheduled_run_value_state: latestRunValueState || null,
    latest_scheduled_run_blocked_reason: String(latestScheduledRun?.blocked_reason || "").trim() || null,
    latest_scheduled_run_failure_stage: latestFailure.failure_stage,
    latest_scheduled_run_failure_label: latestFailure.failure_label,
    latest_scheduled_run_failure_reason: latestFailure.failure_reason,
    active_recovery_queue: failedUsers,
    due_today_past_window: pastDueUsersToday,
    backfill_needed: backfillNeeded,
    ...incidentSummary,
  };
}

module.exports = {
  buildDeliveryReliabilitySnapshot,
  buildDeliveryOperationsSnapshot,
};
