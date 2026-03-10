const {
  processAdminMessageRequest,
} = require("./admin-api-message-actions-runtime");

async function handleAdminMessageRoute(ctx, deps) {
  const { req, pathname } = ctx;
  const {
    json,
    isAdminAuthed,
  } = deps;

  if ((pathname !== "/api/admin/message-user" && pathname !== "/api/admin/message-user/") || req.method !== "POST") {
    return false;
  }
  if (!isAdminAuthed(req)) {
    json(ctx.res, { error: "admin access only" }, 403);
    return true;
  }

  return processAdminMessageRequest({ ctx, deps });
}

module.exports = {
  handleAdminMessageRoute,
};
