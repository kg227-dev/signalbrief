const { handleCoreArchiveRoutes } = require("./core-api-archive-runtime");
const { handleCoreUnsubscribeRoutes } = require("./core-api-unsubscribe-runtime");
const { handleCoreEngagementRoutes } = require("./core-api-engagement-runtime");
const { handleCoreBookmarksRoute } = require("./core-api-bookmarks-runtime");
const { handleCoreRequestLinkRoute } = require("./core-api-link-runtime");

function createCoreApiRouteHandler(deps) {
  const {
    json,
    DEFAULT_TOPICS,
    INDUSTRY_TOPICS,
    CAPABILITY_TOPICS,
    digestRunStatus,
    getCachedOrRefreshSchedulerHeartbeat,
    findUserByToken,
    handleSignup,
    handleSettings,
    ARCHIVE_LEGACY_DEPRECATION_DEADLINE_UTC,
    getArchiveLegacyDeprecationDeadlineUtc,
  } = deps;

  const resolveArchiveLegacyDeprecationDeadlineUtc = typeof getArchiveLegacyDeprecationDeadlineUtc === "function"
    ? getArchiveLegacyDeprecationDeadlineUtc
    : () => ARCHIVE_LEGACY_DEPRECATION_DEADLINE_UTC;

  return async function handleCoreApiRoutes(ctx) {
    const { req, res, url, pathname } = ctx;

    if (pathname === "/api/health/scheduler" && req.method === "GET") {
      const now = Date.now();
      const heartbeat = typeof getCachedOrRefreshSchedulerHeartbeat === "function"
        ? getCachedOrRefreshSchedulerHeartbeat(now)
        : null;
      const digestRun = typeof digestRunStatus === "function"
        ? digestRunStatus()
        : { running: false, state: "absent", lock: {} };

      const lockState = String(digestRun?.state || "absent");
      const lockUnhealthy = lockState === "corrupt" || lockState === "io_error" || lockState === "stale_uncleared";
      const heartbeatHealthy = !!heartbeat?.healthy;
      const workerBlocked = !!heartbeat?.blocked || String(heartbeat?.status || "").toLowerCase() === "blocked";
      const healthy = heartbeatHealthy && !lockUnhealthy && !workerBlocked;
      const statusCode = healthy ? 200 : 503;

      json(res, {
        ok: healthy,
        checked_at: new Date(now).toISOString(),
        scheduler: {
          available: !!heartbeat?.available,
          healthy: heartbeatHealthy,
          worker: heartbeat?.worker || "scheduler-worker",
          status: heartbeat?.status || null,
          blocked: workerBlocked,
          summary: heartbeat?.summary || "Scheduler heartbeat unavailable",
          updated_at: heartbeat?.updated_at || null,
          age_seconds: heartbeat?.age_seconds ?? null,
          poll_ms: heartbeat?.poll_ms ?? null,
          in_flight: heartbeat?.in_flight ?? null,
          last_error: heartbeat?.last_error || null,
          lock_state: heartbeat?.lock_state || null,
          lock_error: heartbeat?.lock_error || null,
          blocked_state: heartbeat?.blocked_state || null,
          consecutive_lock_unhealthy: heartbeat?.consecutive_lock_unhealthy ?? null,
        },
        digest_lock: {
          running: !!digestRun?.running,
          state: lockState,
          unhealthy: lockUnhealthy,
          mode: digestRun?.lock?.mode || null,
          started_at: digestRun?.lock?.startedAtIso || digestRun?.lock?.startedAt || null,
          age_seconds: digestRun?.lock?.ageMs != null ? Math.round(Math.max(0, digestRun.lock.ageMs) / 1000) : null,
          error: digestRun?.lock?.error || null,
        },
      }, statusCode);
      return true;
    }

    if (pathname === "/api/topics" && req.method === "GET") {
      json(res, { topics: DEFAULT_TOPICS, industries: INDUSTRY_TOPICS, capabilities: CAPABILITY_TOPICS });
      return true;
    }

    if (pathname === "/api/user" && req.method === "GET") {
      const token = url.searchParams.get("token");
      if (!token) {
        json(res, { error: "token required" }, 400);
        return true;
      }
      const user = findUserByToken(token);
      if (!user) {
        json(res, { error: "not found" }, 404);
        return true;
      }
      json(res, user);
      return true;
    }

    if (pathname === "/api/signup" && req.method === "POST") {
      await handleSignup(ctx);
      return true;
    }

    if (pathname === "/api/settings" && req.method === "POST") {
      await handleSettings(ctx);
      return true;
    }

    if (await handleCoreUnsubscribeRoutes(ctx, deps)) return true;

    const archiveRouteResult = await handleCoreArchiveRoutes(ctx, {
      ...deps,
      ARCHIVE_LEGACY_DEPRECATION_DEADLINE_UTC: resolveArchiveLegacyDeprecationDeadlineUtc(),
    });
    if (archiveRouteResult !== false) return archiveRouteResult;

    if (await handleCoreEngagementRoutes(ctx, deps)) return true;
    if (await handleCoreBookmarksRoute(ctx, deps)) return true;
    if (await handleCoreRequestLinkRoute(ctx, deps)) return true;

    return false;
  };
}

async function handleCoreApiRoutes(ctx, deps) {
  const routeHandler = createCoreApiRouteHandler(deps);
  return routeHandler(ctx);
}

module.exports = {
  createCoreApiRouteHandler,
  handleCoreApiRoutes,
};
