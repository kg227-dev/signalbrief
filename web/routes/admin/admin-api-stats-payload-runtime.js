const { sumRuns } = require("../../services/admin-stats-costs");

function mapAdminMessages({ readJsonLineLog, adminMessageLog, maskEmail }) {
  return readJsonLineLog(adminMessageLog, 30).map((message) => ({
    at: message.at || null,
    actor: message.actor || "unknown",
    action: message.action || "message_user",
    target_email: message.target_email || null,
    target_email_masked: maskEmail(message.target_email || ""),
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
  quality,
  feedbackTrend,
  trailing7dCost,
  projected7dCost,
}) {
  const trailing = trailing7dCost && typeof trailing7dCost === "object" ? trailing7dCost : {};
  const projected = projected7dCost && typeof projected7dCost === "object" ? projected7dCost : {};
  return {
    all_time_cost: parseFloat(sumRuns(runs, "total_cost_usd").toFixed(4)),
    all_time_runs: runs.length,
    all_time_deliveries: sumRuns(runs, "users_served"),
    month_cost: parseFloat(sumRuns(monthRuns, "total_cost_usd").toFixed(4)),
    month_runs: monthRuns.length,
    month_users_served: monthUsersServedFromRoster,
    month_unique_users: monthUsersServedFromRoster,
    month_unique_users_log: monthUniqueUsersLogSize,
    month_deliveries: monthDeliveries,
    total_users: roster.length,
    active_users: activeUsersCount,
    month_label: monthLabel,
    quality,
    feedback: feedbackTrend,
    trailing_7d_cost: parseFloat(Number(trailing.total_cost || 0).toFixed(4)),
    trailing_7d_scheduled_cost: parseFloat(Number(trailing.scheduled_cost || 0).toFixed(4)),
    trailing_7d_runs: Math.max(0, Number(trailing.runs?.length || 0)),
    trailing_7d_scheduled_runs: Math.max(0, Number(trailing.scheduled_runs || 0)),
    trailing_7d_deliveries: Math.max(0, Number(trailing.deliveries || 0)),
    projected_7d_cost: parseFloat(Number(projected.total_cost || 0).toFixed(4)),
    projected_7d_runs: Math.max(0, Number(projected.scheduled_runs || 0)),
    projected_7d_deliveries: Math.max(0, Number(projected.projected_deliveries || 0)),
    projected_7d_active_users: Math.max(0, Number(projected.active_users || 0)),
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
  deliveryOperations,
  schedulerWorker,
  digestRunner,
  runtimeState,
}) {
  const warnings = Array.isArray(deliveryWarnings) ? deliveryWarnings : [];
  const rel = deliveryReliability && typeof deliveryReliability === "object" ? deliveryReliability : {};
  const ops = deliveryOperations && typeof deliveryOperations === "object" ? deliveryOperations : {};
  const scheduler = schedulerWorker && typeof schedulerWorker === "object" ? schedulerWorker : null;

  const schedulerMissing = !scheduler || scheduler.available === false;
  const schedulerStale = !!scheduler && scheduler.available !== false && !scheduler.healthy;
  const schedulerBlocked = !!scheduler?.blocked || String(scheduler?.status || "").toLowerCase() === "blocked";
  const schedulerError = !!scheduler?.last_error;
  const lockUnhealthy = !!digestRunner?.unhealthy;
  const runnerBlocked = !!digestRunner?.running && Number(digestRunner?.age_seconds || 0) >= (20 * 60);
  const runtimeMismatch = runtimeState && runtimeState.ok === false;

  const reliability7dRaw = Number(rel.success_rate_7d);
  const reliability7d = Number.isFinite(reliability7dRaw) ? Number(reliability7dRaw.toFixed(1)) : null;
  const missed7d = Math.max(0, Number(rel.missed_current_7d || 0));
  const usersAtRisk = Math.max(0, Number(ops.active_recovery_queue || 0));
  const latestScheduledRunAt = ops.latest_scheduled_run_at || rel.last_successful_scheduled_run || null;
  const latestScheduledRunClean = ops.latest_scheduled_run_clean === true;
  const latestScheduledRunFailedUsers = Math.max(0, Number(ops.latest_scheduled_run_failed_users || 0));
  const backfillNeeded = !!ops.backfill_needed;
  const activeIncidentOpen = !!ops.active_incident_open;
  const activeIncidentSummary = String(ops.active_incident_summary || "").trim();
  const canDeliverNextRun = !(schedulerMissing || schedulerStale || schedulerBlocked || lockUnhealthy || runnerBlocked || runtimeMismatch);

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
  if (runnerBlocked) {
    status = "red";
    reasons.push(`digest runner active for ${Math.floor(Number(digestRunner?.age_seconds || 0) / 60)}m`);
  }
  if (runtimeMismatch) {
    status = "red";
    reasons.push(`runtime state mismatch (${(runtimeState?.roots?.divergent_components || []).join(", ") || "unknown"})`);
  }
  if (usersAtRisk > 0) {
    status = "red";
    reasons.push(`${usersAtRisk} failed user${usersAtRisk === 1 ? "" : "s"} remain from the latest scheduled run`);
  }
  if (backfillNeeded) {
    status = "red";
    reasons.push("scheduled delivery window was missed and needs backfill");
  }
  if (activeIncidentOpen) {
    status = "red";
    reasons.push(activeIncidentSummary ? `active incident: ${activeIncidentSummary}` : "active digest incident");
  }

  if (status !== "red") {
    if ((Number.isFinite(reliability7d) && reliability7d < 98) || warnings.length > 0 || missed7d > 0 || schedulerError) {
      status = "yellow";
      if (Number.isFinite(reliability7d) && reliability7d < 98) reasons.push(`7d delivery reliability ${reliability7d.toFixed(1)}%`);
      if (warnings.length > 0) reasons.push(`${warnings.length} user${warnings.length === 1 ? "" : "s"} missed 2+ delivery days recently`);
      if (missed7d > 0) reasons.push(`${missed7d} missed scheduled deliver${missed7d === 1 ? "y" : "ies"} in last 7d`);
      if (schedulerError) reasons.push("scheduler reported a recent error");
    }
  }

  if (reasons.length === 0) {
    reasons.push("next scheduled run is deliverable, latest scheduled run completed cleanly, and no recovery queue is active");
  }

  let actionNow = "No immediate recovery action required.";
  if (status === "red" && (schedulerMissing || schedulerStale || schedulerBlocked || lockUnhealthy)) {
    actionNow = "Recover scheduler worker first, confirm heartbeat turns healthy, then send a test digest.";
  } else if (status === "red" && runtimeMismatch) {
    actionNow = "Unify runtime state roots before relying on admin analytics or the next deploy verification.";
  } else if (status === "red" && runnerBlocked) {
    actionNow = "Inspect the stuck digest runner before the next scheduled window.";
  } else if (status === "red" && usersAtRisk > 0) {
    actionNow = "Review failed users from the latest scheduled run and clear the recovery queue.";
  } else if (status === "red" && backfillNeeded) {
    actionNow = "A scheduled window was missed. Run a full digest now to backfill affected users.";
  } else if (status === "red" && activeIncidentOpen) {
    actionNow = "Inspect the active incident and confirm provider health before the next scheduled run.";
  } else if (status === "yellow") {
    actionNow = "System ready for next scheduled run. 7d reliability is below target due to recent misses; no immediate recovery action required.";
  }

  const headline = status === "green"
    ? "System ready for next scheduled run."
    : status === "yellow"
      ? "System ready for next scheduled run. Historical reliability needs follow-up."
      : canDeliverNextRun
        ? "Recovery needed before confidence is fully restored."
        : "Action required: next scheduled run is at risk.";

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
  ];

  if (backfillNeeded) {
    commands.push({
      id: "run_full_digest",
      label: "Run full digest now",
      description: "Queue a recovery run for the missed scheduled window.",
    });
  }

  if (usersAtRisk > 0) {
    commands.push({
      id: "review_missed_users",
      label: "Review missed users",
      description: "Inspect failed recipients from the latest scheduled run and recover them.",
    });
  }

  if (schedulerMissing || schedulerStale || schedulerBlocked || lockUnhealthy || runnerBlocked) {
    commands.push({
      id: "restart_worker",
      label: "Restart scheduler worker",
      description: "Request a safe worker restart when heartbeat is stale or blocked.",
    });
  }

  return {
    status,
    headline,
    reason: reasons.join(" · "),
    action_now: actionNow,
    can_deliver_next_run: canDeliverNextRun,
    users_at_risk: usersAtRisk,
    active_recovery_queue: usersAtRisk,
    missed_deliveries_7d: missed7d,
    reliability_7d: Number.isFinite(reliability7d) ? reliability7d : null,
    last_successful_scheduled_run: rel.last_successful_scheduled_run || null,
    latest_scheduled_run_at: latestScheduledRunAt,
    latest_scheduled_run_clean: latestScheduledRunClean,
    latest_scheduled_run_failed_users: latestScheduledRunFailedUsers,
    next_expected_delivery_et: rel.next_expected_delivery_et || null,
    next_expected_countdown: rel.next_expected_countdown || null,
    backfill_needed: backfillNeeded,
    active_incident_open: activeIncidentOpen,
    active_incident_summary: activeIncidentSummary || null,
    commands,
  };
}

function buildHealthPayload({
  runs,
  deliveryWarnings,
  deliveryReliability,
  deliveryOperations,
  schedulerWorker,
  digestRun,
  ignoredBackfill,
  runtimeState,
}) {
  const digestRunner = buildDigestRunnerHealth(digestRun);
  const executiveSummary = buildExecutiveHealthSummary({
    deliveryWarnings,
    deliveryReliability,
    deliveryOperations,
    schedulerWorker,
    digestRunner,
    runtimeState,
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
    delivery_operations: deliveryOperations,
    scheduler_worker: schedulerWorker,
    digest_runner: digestRunner,
    runtime_state: runtimeState,
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
