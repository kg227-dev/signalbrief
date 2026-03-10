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
