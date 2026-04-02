"use strict";

function parseDaysParam(url) {
  const requested = parseInt(url.searchParams.get("days"), 10);
  if (!Number.isFinite(requested)) return 7;
  return Math.min(60, Math.max(1, requested));
}

async function handleAdminRuntimeStateRoutes(ctx, deps) {
  const { req, res, pathname, url } = ctx;
  const {
    json,
    isAdminAuthed,
    getRuntimeStateDiagnostics,
    buildRecentDigestsExport,
  } = deps;

  if (pathname === "/api/admin/runtime-state" && req.method === "GET") {
    if (!isAdminAuthed(req)) return json(res, { error: "admin access only" }, 403);
    const payload = typeof getRuntimeStateDiagnostics === "function"
      ? getRuntimeStateDiagnostics()
      : { error: "runtime state diagnostics unavailable" };
    return json(res, payload, payload?.error ? 500 : 200);
  }

  if (pathname === "/api/admin/export/recent-digests" && req.method === "GET") {
    if (!isAdminAuthed(req)) return json(res, { error: "admin access only" }, 403);
    if (typeof buildRecentDigestsExport !== "function") {
      return json(res, { error: "recent digest export unavailable" }, 500);
    }
    return json(res, buildRecentDigestsExport({ days: parseDaysParam(url) }));
  }

  return false;
}

module.exports = {
  handleAdminRuntimeStateRoutes,
};
