const { sumRuns } = require("../services/admin-stats-costs");

function mapAdminMessages({ readJsonLineLog, adminMessageLog, maskEmail }) {
  return readJsonLineLog(adminMessageLog, 30).map((message) => ({
    at: message.at || null,
    actor: message.actor || "unknown",
    action: message.action || "message_user",
    target_email: message.target_email || null,
    target_email_masked: maskEmail(message.target_email || ""),
    target_chat_id: message.target_chat_id || null,
    requested_channels: Array.isArray(message.requested_channels) ? message.requested_channels : [],
    sent_channels: Array.isArray(message.sent_channels) ? message.sent_channels : [],
    success: !!message.success,
    errors: Array.isArray(message.errors) ? message.errors : [],
    message_preview: message.message_preview || "",
    payload_hash: message.payload_hash || null,
  }));
}

function buildSummaryPayload({
  runs,
  monthRuns,
  monthDeliveries,
  monthLabel,
  monthUsersServedFromRoster,
  monthUniqueUsersLogSize,
  roster,
  activeUsersCount,
  activeTelegramUsersCount,
  quality,
  feedbackTrend,
}) {
  return {
    all_time_cost: parseFloat(sumRuns(runs, "total_cost_usd").toFixed(4)),
    all_time_runs: runs.length,
    all_time_deliveries: sumRuns(runs, "users_served"),
    month_cost: parseFloat(sumRuns(monthRuns, "total_cost_usd").toFixed(4)),
    month_runs: monthRuns.length,
    month_on_demand: monthRuns.filter((run) => run.on_demand).length,
    month_users_served: monthUsersServedFromRoster,
    month_unique_users: monthUsersServedFromRoster,
    month_unique_users_log: monthUniqueUsersLogSize,
    month_deliveries: monthDeliveries,
    total_users: roster.length,
    active_users: activeUsersCount,
    active_tg_users: activeTelegramUsersCount,
    month_label: monthLabel,
    quality,
    feedback: feedbackTrend,
  };
}

function buildDigestRunnerHealth(digestRun) {
  if (!digestRun.running) return { running: false, state: digestRun.state || "absent", unhealthy: false };
  return {
    running: true,
    state: digestRun.state || "valid",
    unhealthy: digestRun.state === "corrupt" || digestRun.state === "io_error" || digestRun.state === "stale_uncleared",
    mode: digestRun.lock.mode || "scheduled",
    started_at: digestRun.lock.startedAtIso || digestRun.lock.startedAt || null,
    age_seconds: Math.max(0, Math.round((digestRun.lock.ageMs || 0) / 1000)),
    pid: digestRun.lock.pid || null,
    error: digestRun.lock.error || null,
  };
}

function buildHealthPayload({
  runs,
  deliveryWarnings,
  deliveryReliability,
  schedulerWorker,
  digestRun,
  ignoredBackfill,
}) {
  const lastRun = runs[0] || null;
  const serverUptimeSecs = Math.floor(process.uptime());
  const uptimeHours = Math.floor(serverUptimeSecs / 3600);
  const uptimeMins = Math.floor((serverUptimeSecs % 3600) / 60);
  const uptimeStr = uptimeHours > 0 ? `${uptimeHours}h ${uptimeMins}m` : `${uptimeMins}m`;

  return {
    server_uptime: uptimeStr,
    last_run_at: lastRun ? lastRun.run_at_et || lastRun.run_at : null,
    last_run_users: lastRun ? lastRun.users_served : null,
    last_run_cost: lastRun ? `$${(lastRun.total_cost_usd || 0).toFixed(4)}` : null,
    cron_schedule: "5-minute worker loop (always-on VM)",
    users_delivery_warning: deliveryWarnings,
    delivery_reliability: deliveryReliability,
    scheduler_worker: schedulerWorker,
    digest_runner: buildDigestRunnerHealth(digestRun),
    engagement_events: {
      ignored_backfill_emitted: ignoredBackfill.emitted || 0,
      ignored_backfill_considered: ignoredBackfill.considered || 0,
    },
  };
}

module.exports = {
  mapAdminMessages,
  buildSummaryPayload,
  buildHealthPayload,
};
