"use strict";

function parseLimit(url) {
  const value = Number(url.searchParams.get("limit"));
  if (!Number.isFinite(value)) return 20;
  return Math.min(100, Math.max(1, Math.trunc(value)));
}

async function handleAdminRetrievalEvalRoutes(ctx, deps) {
  const { req, res, pathname, url } = ctx;
  const {
    json,
    isAdminAuthed,
    loadRetrievalEvalRuns,
    loadRetrievalEvalRun,
    loadRetrievalEvalStatus,
  } = deps;

  if (pathname === "/api/admin/retrieval-eval/runs" && req.method === "GET") {
    if (!isAdminAuthed(req)) {
      json(res, { error: "admin access only" }, 403);
      return true;
    }
    json(res, {
      runs: typeof loadRetrievalEvalRuns === "function"
        ? loadRetrievalEvalRuns(parseLimit(url))
        : [],
    });
    return true;
  }

  if (pathname === "/api/admin/retrieval-eval/run" && req.method === "GET") {
    if (!isAdminAuthed(req)) {
      json(res, { error: "admin access only" }, 403);
      return true;
    }
    const runId = String(url.searchParams.get("run_id") || "").trim();
    if (!runId) {
      json(res, { error: "run_id required" }, 400);
      return true;
    }
    const run = typeof loadRetrievalEvalRun === "function" ? loadRetrievalEvalRun(runId) : null;
    if (!run) {
      json(res, { error: "run not found" }, 404);
      return true;
    }
    json(res, run);
    return true;
  }

  if (pathname === "/api/admin/retrieval-eval/status" && req.method === "GET") {
    if (!isAdminAuthed(req)) {
      json(res, { error: "admin access only" }, 403);
      return true;
    }
    json(res, typeof loadRetrievalEvalStatus === "function" ? loadRetrievalEvalStatus() : {});
    return true;
  }

  return false;
}

module.exports = {
  handleAdminRetrievalEvalRoutes,
};
