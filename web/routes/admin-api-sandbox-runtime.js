async function handleAdminSandboxRoutes(ctx, deps) {
  const { req, pathname } = ctx;
  const {
    json,
    isAdminAuthed,
    requireJsonBody,
    estimateSandboxCost,
    runSandboxPipeline,
  } = deps;

  if (pathname === "/api/admin/sandbox/estimate" && req.method === "POST") {
    if (!isAdminAuthed(req)) {
      json(ctx.res, { error: "admin access only" }, 403);
      return true;
    }
    const body = await requireJsonBody(req, ctx.res);
    if (body == null) return true;
    try {
      const estimate = estimateSandboxCost(body);
      json(ctx.res, estimate);
    } catch (error) {
      json(ctx.res, { error: error.message }, 500);
    }
    return true;
  }

  if (pathname === "/api/admin/sandbox/run" && req.method === "POST") {
    if (!isAdminAuthed(req)) {
      json(ctx.res, { error: "admin access only" }, 403);
      return true;
    }
    const body = await requireJsonBody(req, ctx.res);
    if (body == null) return true;
    try {
      const result = await runSandboxPipeline(body);
      json(ctx.res, result);
    } catch (error) {
      json(ctx.res, { error: error.message }, 500);
    }
    return true;
  }

  return false;
}

module.exports = {
  handleAdminSandboxRoutes,
};
