const { handleCoreArchiveRoutes } = require("./core-api-archive-runtime");
const { handleCoreUnsubscribeRoutes } = require("./core-api-unsubscribe-runtime");
const { handleCoreEngagementRoutes } = require("./core-api-engagement-runtime");
const { handleCoreFeedbackRoute } = require("./core-api-feedback-actions-runtime");
const { handleCoreRequestLinkRoute } = require("./core-api-link-runtime");
const { handleCheckAvailabilityRoute } = require("./core-api-availability-runtime");
const { handleHealthRoute } = require("./core-api-health-runtime");

function sanitizeStringArray(values) {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function sanitizePreferences(preferences) {
  if (!preferences || typeof preferences !== "object" || Array.isArray(preferences)) return {};
  const out = {};
  if (preferences.depth != null) out.depth = String(preferences.depth || "").trim() || "headline_plus_why";
  if (preferences.delivery_time != null) out.delivery_time = String(preferences.delivery_time || "").trim();
  if (preferences.frequency != null) out.frequency = String(preferences.frequency || "").trim();
  if (Array.isArray(preferences.days_of_week)) {
    out.days_of_week = preferences.days_of_week
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value >= 0 && value <= 6);
  }
  if (preferences.email_enabled != null) out.email_enabled = normalizeBooleanLike(preferences.email_enabled);
  if (preferences.timezone != null) out.timezone = String(preferences.timezone || "").trim();
  if (preferences.consultant_lens_mode != null) out.consultant_lens_mode = normalizeBooleanLike(preferences.consultant_lens_mode);
  return out;
}

function normalizeBooleanLike(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return false;
    if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") return false;
    if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") return true;
  }
  return Boolean(value);
}

function buildPublicUserRecord(user) {
  if (!user || typeof user !== "object" || Array.isArray(user)) return null;
  return {
    chatId: String(user.chatId || ""),
    email: String(user.email || ""),
    name: String(user.name || ""),
    status: String(user.status || "active"),
    topics: sanitizeStringArray(user.topics),
    preferences: sanitizePreferences(user.preferences),
  };
}

function createCoreApiRouteHandler(deps) {
  const {
    json,
    DEFAULT_TOPICS,
    INDUSTRY_TOPICS,
    digestRunStatus,
    getCachedOrRefreshSchedulerHeartbeat,
    findUserByToken,
    handleSignup,
    handleSettings,
    requestSchedulerWorkerRestart,
    forkSchedulerWorker,
    getRuntimeStateHealth,
  } = deps;

  return async function handleCoreApiRoutes(ctx) {
    const { req, res, url, pathname } = ctx;

    if (handleHealthRoute(ctx, {
      json,
      getCachedOrRefreshSchedulerHeartbeat,
      digestRunStatus,
      requestSchedulerWorkerRestart,
      forkSchedulerWorker,
      getRuntimeStateHealth,
    })) return true;

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
      const runtimeState = typeof getRuntimeStateHealth === "function"
        ? getRuntimeStateHealth()
        : { ok: true, status: "ok" };
      const healthy = heartbeatHealthy && !lockUnhealthy && !workerBlocked && runtimeState.ok !== false;
      const statusCode = healthy ? 200 : 503;

      json(res, {
        ok: healthy,
        checked_at: new Date(now).toISOString(),
        scheduler: {
          available: !!heartbeat?.available,
          healthy: heartbeatHealthy,
          summary: heartbeat?.summary || null,
          status: heartbeat?.status || null,
          blocked: workerBlocked,
          updated_at: heartbeat?.updated_at || null,
          age_seconds: heartbeat?.age_seconds ?? null,
          in_flight: heartbeat?.in_flight ?? null,
        },
        digest_lock: {
          running: !!digestRun?.running,
          state: lockState,
          unhealthy: lockUnhealthy,
        },
        runtime_state: runtimeState,
      }, statusCode);
      return true;
    }

    if (pathname === "/api/topics" && req.method === "GET") {
      json(res, { topics: DEFAULT_TOPICS, industries: INDUSTRY_TOPICS });
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
      json(res, buildPublicUserRecord(user));
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

    const archiveRouteResult = await handleCoreArchiveRoutes(ctx, deps);
    if (archiveRouteResult !== false) return archiveRouteResult;

    if (await handleCoreEngagementRoutes(ctx, deps)) return true;
    if (await handleCoreFeedbackRoute(ctx, deps)) return true;
    if (await handleCoreRequestLinkRoute(ctx, deps)) return true;
    if (await handleCheckAvailabilityRoute(ctx, deps)) return true;

    return false;
  };
}

async function handleCoreApiRoutes(ctx, deps) {
  const routeHandler = createCoreApiRouteHandler(deps);
  return routeHandler(ctx);
}

module.exports = {
  buildPublicUserRecord,
  createCoreApiRouteHandler,
  handleCoreApiRoutes,
};
