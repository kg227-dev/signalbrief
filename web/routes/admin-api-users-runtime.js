const {
  handleUserByEmailRoute,
  handleAuditRoute,
  handleUpdateDeliveryTimeRoute,
  handleSetUserStatusRoute,
  handleDeleteUserRoute,
  handleResendDigestRoute,
  handleRestartSchedulerWorkerRoute,
} = require("./admin-api-users-actions-runtime");

async function handleAdminUserRoutes(ctx, deps) {
  const { req, pathname, url } = ctx;
  const {
    json,
    isAdminAuthed,
    requireJsonBody,
    allUsers,
    countArchiveDigestsForUser,
    loadCurrentDigestSnapshot,
    readJsonLineLog,
    ADMIN_ACTION_LOG,
    ADMIN_MESSAGE_LOG,
    normalizeDeliveryTimeInput,
    writeUser,
    deleteUser,
    logAdminActionEvent,
    formatTimeEt,
    handleAdminRunDigest,
    requestSchedulerWorkerRestart,
    loadLatestDigestSnapshot,
    resendDigestSnapshot,
    buildRecentDigestsExport,
  } = deps;

  if (pathname === "/api/admin/run-digest" && req.method === "POST") {
    await handleAdminRunDigest(ctx);
    return true;
  }

  if (pathname === "/api/admin/resend-digest" && req.method === "POST") {
    return handleResendDigestRoute({
      ctx,
      deps: {
        json,
        isAdminAuthed,
        requireJsonBody,
        allUsers,
        loadCurrentDigestSnapshot,
        resendDigestSnapshot,
        logAdminActionEvent,
      },
    });
  }

  if (pathname === "/api/admin/user-by-email" && req.method === "GET") {
    return handleUserByEmailRoute({
      ctx,
      deps: {
        json,
        isAdminAuthed,
        allUsers,
        countArchiveDigestsForUser,
        loadLatestDigestSnapshot,
        buildRecentDigestsExport,
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

  if (pathname === "/api/admin/set-user-status" && req.method === "POST") {
    return handleSetUserStatusRoute({
      ctx,
      deps: {
        json,
        isAdminAuthed,
        requireJsonBody,
        allUsers,
        writeUser,
        logAdminActionEvent,
      },
    });
  }

  if (pathname === "/api/admin/delete-user" && req.method === "POST") {
    return handleDeleteUserRoute({
      ctx,
      deps: {
        json,
        isAdminAuthed,
        requireJsonBody,
        allUsers,
        deleteUser,
        logAdminActionEvent,
      },
    });
  }

  if (pathname === "/api/admin/restart-scheduler-worker" && req.method === "POST") {
    return handleRestartSchedulerWorkerRoute({
      ctx,
      deps: {
        json,
        isAdminAuthed,
        requireJsonBody,
        requestSchedulerWorkerRestart,
        logAdminActionEvent,
      },
    });
  }

  return false;
}

module.exports = {
  handleAdminUserRoutes,
};
