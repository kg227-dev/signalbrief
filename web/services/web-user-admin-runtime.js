const {
  handleFullDigestRun,
  handleTopicAuditRerun,
} = require("./web-user-admin-actions-runtime");

function createAdminRunDigestHandler({
  toRouteCtx,
  json,
  isAdminAuthed,
  requireJsonBody,
  allUsers,
  startDigestTrigger,
  logAdminActionEvent,
  formatEtDateKey,
}) {
  return async function handleAdminRunDigest(ctxOrReq, maybeRes) {
    const { req, res } = toRouteCtx(ctxOrReq, maybeRes);
    if (!isAdminAuthed(req)) return json(res, { error: "admin access only" }, 403);
    const body = await requireJsonBody(req, res);
    if (body == null) return;

    if (String(body?.scope || "").trim().toLowerCase() === "topic_audit" || body?.topic || body?.topic_tag) {
      return handleTopicAuditRerun({
        req,
        res,
        json,
        body,
        startDigestTrigger,
        logAdminActionEvent,
        formatEtDateKey,
      });
    }

    return handleFullDigestRun({
      req,
      res,
      json,
      startDigestTrigger,
      logAdminActionEvent,
    });
  };
}

module.exports = {
  createAdminRunDigestHandler,
};
