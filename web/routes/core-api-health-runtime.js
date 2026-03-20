"use strict";

/**
 * Consolidated health endpoint — GET /api/health
 *
 * Aggregates scheduler heartbeat and digest lock state into a single
 * response suitable for external uptime monitors (UptimeRobot, Pingdom,
 * etc.).  Returns 200 when all subsystems are healthy, 503 otherwise.
 *
 * No authentication required — this is a public readiness probe.
 *
 * Auto-restart escalation:
 * - After 3 consecutive unhealthy scheduler checks → writes scheduler-control.json restart request
 * - After 6 consecutive unhealthy checks → forks a new scheduler-worker process
 */

let consecutiveUnhealthyChecks = 0;
let lastAutoRestartAttemptAt = 0;
const AUTO_RESTART_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes between fork attempts

function handleHealthRoute(ctx, deps) {
  const { req, res, pathname } = ctx;
  if (pathname !== "/api/health" || req.method !== "GET") return false;

  const {
    json,
    getCachedOrRefreshSchedulerHeartbeat,
    digestRunStatus,
    requestSchedulerWorkerRestart,
    forkSchedulerWorker,
    getRuntimeStateHealth,
  } = deps;

  const now = Date.now();

  // --- scheduler ---
  const heartbeat = typeof getCachedOrRefreshSchedulerHeartbeat === "function"
    ? getCachedOrRefreshSchedulerHeartbeat(now)
    : null;

  const schedulerAvailable = !!heartbeat?.available;
  const schedulerHealthy = !!heartbeat?.healthy;
  const schedulerBlocked = !!heartbeat?.blocked || String(heartbeat?.status || "").toLowerCase() === "blocked";

  // --- digest lock ---
  const digestRun = typeof digestRunStatus === "function"
    ? digestRunStatus()
    : { running: false, state: "absent", lock: {} };

  const lockState = String(digestRun?.state || "absent");
  const lockUnhealthy = lockState === "corrupt" || lockState === "io_error" || lockState === "stale_uncleared";
  const runtimeState = typeof getRuntimeStateHealth === "function"
    ? getRuntimeStateHealth()
    : { ok: true, status: "ok" };

  // --- aggregate ---
  const healthy = schedulerHealthy && !lockUnhealthy && !schedulerBlocked && runtimeState.ok !== false;
  const statusCode = healthy ? 200 : 503;

  // --- auto-restart escalation ---
  let autoRestartAction = null;
  if (!schedulerHealthy || schedulerBlocked) {
    consecutiveUnhealthyChecks += 1;

    // Stage 1: after 3 unhealthy checks, write a control-file restart request
    if (consecutiveUnhealthyChecks === 3 && typeof requestSchedulerWorkerRestart === "function") {
      try {
        requestSchedulerWorkerRestart({
          reason: "health_check_auto_restart",
          source: "health_endpoint",
          requestedBy: "auto",
        });
        autoRestartAction = "control_file_restart_requested";
      } catch (_) { /* best-effort */ }
    }

    // Stage 2: after 6 unhealthy checks, fork a new scheduler worker process
    if (consecutiveUnhealthyChecks >= 6
      && typeof forkSchedulerWorker === "function"
      && (now - lastAutoRestartAttemptAt) > AUTO_RESTART_COOLDOWN_MS
    ) {
      try {
        forkSchedulerWorker();
        lastAutoRestartAttemptAt = now;
        autoRestartAction = "scheduler_process_forked";
      } catch (_) { /* best-effort */ }
    }
  } else {
    consecutiveUnhealthyChecks = 0;
  }

  const problems = [];
  if (!schedulerAvailable) problems.push("scheduler_unavailable");
  if (!schedulerHealthy && schedulerAvailable) problems.push("scheduler_unhealthy");
  if (schedulerBlocked) problems.push("scheduler_blocked");
  if (lockUnhealthy) problems.push(`digest_lock_${lockState}`);
  if (runtimeState.ok === false) problems.push("runtime_state_mismatch");

  const responseBody = {
    ok: healthy,
    status: healthy ? "healthy" : "degraded",
    checked_at: new Date(now).toISOString(),
    problems: problems.length > 0 ? problems : undefined,
    subsystems: {
      scheduler: {
        available: schedulerAvailable,
        healthy: schedulerHealthy,
        blocked: schedulerBlocked,
        age_seconds: heartbeat?.age_seconds ?? null,
      },
      digest_lock: {
        running: !!digestRun?.running,
        state: lockState,
        healthy: !lockUnhealthy,
      },
      runtime_state: runtimeState,
    },
  };
  if (autoRestartAction) {
    responseBody.auto_restart = {
      action: autoRestartAction,
      consecutive_unhealthy_checks: consecutiveUnhealthyChecks,
    };
  }

  json(res, responseBody, statusCode);
  return true;
}

function resetHealthCheckState() {
  consecutiveUnhealthyChecks = 0;
  lastAutoRestartAttemptAt = 0;
}

module.exports = { handleHealthRoute, resetHealthCheckState };
