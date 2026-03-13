const { handleCoreArchiveRoutes } = require("./core-api-archive-runtime");
const { handleCoreUnsubscribeRoutes } = require("./core-api-unsubscribe-runtime");
const { handleCoreEngagementRoutes } = require("./core-api-engagement-runtime");
const { handleCoreBookmarksRoute } = require("./core-api-bookmarks-runtime");
const { handleCoreRequestLinkRoute } = require("./core-api-link-runtime");

function sanitizeStringArray(values) {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function sanitizeBookmarks(bookmarks) {
  if (!Array.isArray(bookmarks)) return [];
  return bookmarks
    .filter((row) => row && typeof row === "object")
    .map((row) => ({
      url: String(row.url || "").trim(),
      title: String(row.title || "").trim(),
      date: String(row.date || "").trim(),
      tag: String(row.tag || "").trim(),
    }))
    .filter((row) => row.url);
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
  if (preferences.items_per_digest != null) {
    const parsedItems = Number(preferences.items_per_digest);
    if (Number.isInteger(parsedItems) && parsedItems > 0) out.items_per_digest = parsedItems;
  }
  if (preferences.email_enabled != null) out.email_enabled = normalizeBooleanLike(preferences.email_enabled);
  if (preferences.telegram_enabled != null) out.telegram_enabled = normalizeBooleanLike(preferences.telegram_enabled);
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

function sanitizeTopicWeights(topicWeights) {
  if (!topicWeights || typeof topicWeights !== "object" || Array.isArray(topicWeights)) return {};
  const out = {};
  for (const [key, value] of Object.entries(topicWeights)) {
    const tag = String(key || "").trim();
    if (!tag) continue;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) continue;
    out[tag] = numeric;
  }
  return out;
}

function buildPublicUserRecord(user) {
  if (!user || typeof user !== "object" || Array.isArray(user)) return null;
  return {
    chatId: String(user.chatId || ""),
    email: String(user.email || ""),
    telegram: String(user.telegram || ""),
    name: String(user.name || ""),
    status: String(user.status || "active"),
    topics: sanitizeStringArray(user.topics),
    custom_keywords: sanitizeStringArray(user.custom_keywords),
    watchlist: sanitizeStringArray(user.watchlist),
    bookmarks: sanitizeBookmarks(user.bookmarks),
    preferences: sanitizePreferences(user.preferences),
    topic_weights: sanitizeTopicWeights(user.topic_weights),
  };
}

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
  buildPublicUserRecord,
  createCoreApiRouteHandler,
  handleCoreApiRoutes,
};
