const { handleAdminStatsRoute } = require("./admin-api-stats-runtime");
const { handleAdminAuthRoutes } = require("./admin-api-auth-runtime");
const { handleAdminBulkRoute } = require("./admin-api-bulk-runtime");
const { handleAdminUserRoutes } = require("./admin-api-users-runtime");
const { handleAdminMessageRoute } = require("./admin-api-message-runtime");
const { handleAdminRuntimeStateRoutes } = require("./admin-api-runtime-state-runtime");
const { handleAdminSourceRegistryRoutes } = require("./admin-api-source-registry-runtime");
const { handleAdminDigestAuditRoutes } = require("./admin-api-digest-audit-runtime");
const { handleAdminSourceHealthRoutes } = require("./admin-api-source-health-runtime");
const { handleAdminDigestTuningRoutes } = require("./admin-api-digest-tuning-runtime");
const { handleAdminEditorialOverridesRoutes } = require("./admin-api-editorial-overrides-runtime");

function createAdminApiRouteHandler(deps) {
  return async function handleAdminApiRoutes(ctx) {
    const { req, pathname } = ctx;

    if (await handleAdminAuthRoutes(ctx, deps)) return true;

    if (pathname === "/api/admin/stats" && req.method === "GET") {
      await handleAdminStatsRoute(ctx, deps);
      return true;
    }

    if (await handleAdminRuntimeStateRoutes(ctx, deps)) return true;
    if (await handleAdminSourceRegistryRoutes(ctx, deps)) return true;
    if (await handleAdminDigestAuditRoutes(ctx, deps)) return true;
    if (await handleAdminSourceHealthRoutes(ctx, deps)) return true;
    if (await handleAdminDigestTuningRoutes(ctx, deps)) return true;
    if (await handleAdminEditorialOverridesRoutes(ctx, deps)) return true;
    if (await handleAdminUserRoutes(ctx, deps)) return true;
    if (await handleAdminBulkRoute(ctx, deps)) return true;
    if (await handleAdminMessageRoute(ctx, deps)) return true;

    return false;
  };
}

async function handleAdminApiRoutes(ctx, deps) {
  const routeHandler = createAdminApiRouteHandler(deps);
  return routeHandler(ctx);
}

module.exports = {
  createAdminApiRouteHandler,
  handleAdminApiRoutes,
};
