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

function buildExecutiveHealthSummary({
  deliveryWarnings,
  deliveryReliability,
  schedulerWorker,
  digestRunner,
}) {
  const warnings = Array.isArray(deliveryWarnings) ? deliveryWarnings : [];
  const rel = deliveryReliability && typeof deliveryReliability === "object" ? deliveryReliability : {};
  const scheduler = schedulerWorker && typeof schedulerWorker === "object" ? schedulerWorker : null;

  const schedulerMissing = !scheduler || scheduler.available === false;
  const schedulerStale = !!scheduler && scheduler.available !== false && !scheduler.healthy;
  const schedulerBlocked = !!scheduler?.blocked || String(scheduler?.status || "").toLowerCase() === "blocked";
  const schedulerError = !!scheduler?.last_error;
  const lockUnhealthy = !!digestRunner?.unhealthy;
  const runnerLongRunning = !!digestRunner?.running && Number(digestRunner?.age_seconds || 0) >= (20 * 60);

  const reliability7dRaw = Number(rel.success_rate_7d);
  const reliability7d = Number.isFinite(reliability7dRaw) ? Number(reliability7dRaw.toFixed(1)) : null;
  const missed7d = Math.max(0, Number(rel.missed_current_7d || 0));
  const usersAtRisk = warnings.length;
  const canDeliverNextRun = !(schedulerMissing || schedulerStale || schedulerBlocked || lockUnhealthy);

  let status = "green";
  const reasons = [];

  if (schedulerMissing) {
    status = "red";
    reasons.push("scheduler heartbeat file missing");
  }
  if (schedulerStale) {
    status = "red";
    reasons.push(`scheduler heartbeat stale (${Number(scheduler?.age_seconds || 0)}s old)`);
  }
  if (schedulerBlocked) {
    status = "red";
    reasons.push("scheduler reports blocked state");
  }
  if (lockUnhealthy) {
    status = "red";
    reasons.push(`digest lock unhealthy (${digestRunner?.state || "unknown"})`);
  }
  if (Number.isFinite(reliability7d) && reliability7d < 90) {
    status = "red";
    reasons.push(`7d delivery reliability ${reliability7d.toFixed(1)}%`);
  }

  if (status !== "red") {
    if ((Number.isFinite(reliability7d) && reliability7d < 98) || usersAtRisk > 0 || missed7d > 0 || schedulerError || runnerLongRunning) {
      status = "yellow";
      if (Number.isFinite(reliability7d) && reliability7d < 98) reasons.push(`7d delivery reliability ${reliability7d.toFixed(1)}%`);
      if (usersAtRisk > 0) reasons.push(`${usersAtRisk} user${usersAtRisk === 1 ? "" : "s"} missed 2+ delivery days`);
      if (missed7d > 0) reasons.push(`${missed7d} missed scheduled deliver${missed7d === 1 ? "y" : "ies"} in last 7d`);
      if (schedulerError) reasons.push("scheduler reported a recent error");
      if (runnerLongRunning) reasons.push(`digest run active for ${Math.floor(Number(digestRunner.age_seconds || 0) / 60)}m`);
    }
  }

  if (reasons.length === 0) {
    reasons.push("scheduler heartbeat healthy and delivery reliability stable");
  }

  let actionNow = "No immediate action. Send a test digest after major deploys or scheduler restarts.";
  if (status === "red" && (schedulerMissing || schedulerStale || schedulerBlocked || lockUnhealthy)) {
    actionNow = "Recover scheduler worker first, confirm heartbeat turns healthy, then send a test digest.";
  } else if (status === "red") {
    actionNow = "Run a full digest now and inspect failed deliveries before the next scheduled window.";
  } else if (status === "yellow") {
    actionNow = "Run a scheduler check and send a test digest to confirm end-to-end delivery before next send.";
  }

  const headline = status === "green"
    ? "System healthy: scheduled digests are on track."
    : status === "yellow"
      ? "Watchlist: delivery risk is elevated."
      : "Action required: delivery pipeline is at risk.";

  const commands = [
    {
      id: "refresh_health",
      label: "Refresh health data",
      description: "Reload dashboard stats and health signals.",
    },
    {
      id: "check_scheduler",
      label: "Check scheduler now",
      description: "Validate scheduler heartbeat freshness and lock state.",
    },
    {
      id: "send_test_digest",
      label: "Send test digest",
      description: "Verify end-to-end delivery for a known target user.",
    },
    {
      id: "run_full_digest",
      label: "Run full digest now",
      description: "Queue a full delivery run for all eligible users.",
    },
  ];

  if (usersAtRisk > 0 || missed7d > 0) {
    commands.push({
      id: "review_missed_users",
      label: "Review missed users",
      description: "Inspect missed/failed recipients and recover critical accounts.",
    });
  }

  return {
    status,
    headline,
    reason: reasons.join(" · "),
    action_now: actionNow,
    can_deliver_next_run: canDeliverNextRun,
    users_at_risk: usersAtRisk,
    missed_deliveries_7d: missed7d,
    reliability_7d: Number.isFinite(reliability7d) ? reliability7d : null,
    last_successful_scheduled_run: rel.last_successful_scheduled_run || null,
    next_expected_delivery_et: rel.next_expected_delivery_et || null,
    next_expected_countdown: rel.next_expected_countdown || null,
    commands,
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
  const digestRunner = buildDigestRunnerHealth(digestRun);
  const executiveSummary = buildExecutiveHealthSummary({
    deliveryWarnings,
    deliveryReliability,
    schedulerWorker,
    digestRunner,
  });
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
    digest_runner: digestRunner,
    executive_summary: executiveSummary,
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
  buildExecutiveHealthSummary,
};
