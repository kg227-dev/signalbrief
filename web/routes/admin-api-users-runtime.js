const {
  handleUserByEmailRoute,
  handleAuditRoute,
  handleUpdateDeliveryTimeRoute,
} = require("./admin-api-users-actions-runtime");

async function handleAdminUserRoutes(ctx, deps) {
  const { req, pathname, url } = ctx;
  const {
    json,
    isAdminAuthed,
    requireJsonBody,
    allUsers,
    getRecentAutoAdjustmentsForUser,
    readJsonLineLog,
    ADMIN_ACTION_LOG,
    ADMIN_MESSAGE_LOG,
    normalizeDeliveryTimeInput,
    writeUser,
    logAdminActionEvent,
    formatTimeEt,
    handleAdminRunDigest,
  } = deps;

  if (pathname === "/api/admin/run-digest" && req.method === "POST") {
    await handleAdminRunDigest(ctx);
    return true;
  }

  if (pathname === "/api/admin/user-by-email" && req.method === "GET") {
    return handleUserByEmailRoute({
      ctx,
      deps: {
        json,
        isAdminAuthed,
        allUsers,
        getRecentAutoAdjustmentsForUser,
      },
    });
  }

  if (pathname === "/api/admin/audit" && req.method === "GET") {
    return handleAuditRoute({
      ctx,
      deps: {
        json,
        isAdminAuthed,
        readJsonLineLog,
        adminActionLog: ADMIN_ACTION_LOG,
        adminMessageLog: ADMIN_MESSAGE_LOG,
      },
    });
  }

  if (pathname === "/api/admin/update-delivery-time" && req.method === "POST") {
    return handleUpdateDeliveryTimeRoute({
      ctx,
      deps: {
        json,
        isAdminAuthed,
        requireJsonBody,
        allUsers,
        normalizeDeliveryTimeInput,
        writeUser,
        logAdminActionEvent,
        formatTimeEt,
      },
    });
  }

  return false;
}

module.exports = {
  handleAdminUserRoutes,
};
