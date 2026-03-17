"use strict";

/**
 * Consolidated health endpoint — GET /api/health
 *
 * Aggregates scheduler heartbeat and digest lock state into a single
 * response suitable for external uptime monitors (UptimeRobot, Pingdom,
 * etc.).  Returns 200 when all subsystems are healthy, 503 otherwise.
 *
 * No authentication required — this is a public readiness probe.
 */
function handleHealthRoute(ctx, deps) {
  const { req, res, pathname } = ctx;
  if (pathname !== "/api/health" || req.method !== "GET") return false;

  const {
    json,
    getCachedOrRefreshSchedulerHeartbeat,
    digestRunStatus,
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

  // --- aggregate ---
  const healthy = schedulerHealthy && !lockUnhealthy && !schedulerBlocked;
  const statusCode = healthy ? 200 : 503;

  const problems = [];
  if (!schedulerAvailable) problems.push("scheduler_unavailable");
  if (!schedulerHealthy && schedulerAvailable) problems.push("scheduler_unhealthy");
  if (schedulerBlocked) problems.push("scheduler_blocked");
  if (lockUnhealthy) problems.push(`digest_lock_${lockState}`);

  json(res, {
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
    },
  }, statusCode);
  return true;
}

module.exports = { handleHealthRoute };
