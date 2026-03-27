const {
  handleFullDigestRun,
} = require("./web-user-admin-actions-runtime");

function createAdminRunDigestHandler({
  toRouteCtx,
  json,
  isAdminAuthed,
  requireJsonBody,
  allUsers,
  startDigestTrigger,
  logAdminActionEvent,
}) {
  return async function handleAdminRunDigest(ctxOrReq, maybeRes) {
    const { req, res } = toRouteCtx(ctxOrReq, maybeRes);
    if (!isAdminAuthed(req)) return json(res, { error: "admin access only" }, 403);
    const body = await requireJsonBody(req, res);
    if (body == null) return;

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
