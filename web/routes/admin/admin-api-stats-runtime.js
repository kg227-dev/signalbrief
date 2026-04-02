const {
  resolveSchedulerHeartbeatLoader,
  emitIgnoredBackfillSafe,
  buildAdminStatsPayload,
} = require("./admin-api-stats-actions-runtime");

async function handleAdminStatsRoute(ctx, deps) {
  const { req, res } = ctx;
  const {
    json,
    isAdminAuthed,
    emitIgnoredEventsIfDue,
    CONFIG,
    getCachedOrRefreshSchedulerHeartbeat,
    readSchedulerHeartbeat,
  } = deps;

  const loadSchedulerHeartbeat = resolveSchedulerHeartbeatLoader({
    getCachedOrRefreshSchedulerHeartbeat,
    readSchedulerHeartbeat,
  });

  if (!isAdminAuthed(req)) return json(res, { error: "admin access only" }, 403);

  const ignoredBackfill = emitIgnoredBackfillSafe({
    emitIgnoredEventsIfDue,
    config: CONFIG,
  });

  const payload = buildAdminStatsPayload({
    deps,
    loadSchedulerHeartbeat,
    ignoredBackfill,
  });

  return json(res, payload);
}

module.exports = {
  handleAdminStatsRoute,
};
