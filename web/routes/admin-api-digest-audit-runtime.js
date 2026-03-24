"use strict";

const fs = require("fs");
const path = require("path");

/**
 * GET /api/admin/digest-audit
 *
 * Returns the selection audit log for a given date.
 * Query params:
 *   date  — YYYY-MM-DD (defaults to today ET)
 *
 * Response shape:
 *   { ok: true, date_et, run_id, mode, generated_at, summary, topics }
 *   topics[TAG].candidates[] has { headline, url, source, source_tier, lane, _score, selected }
 *
 * This gives the operator the full candidate funnel — all scored items,
 * what was selected, what was missed, and lane breakdown — in one call.
 */
async function handleAdminDigestAuditRoutes(ctx, deps) {
  const { req, res, pathname, url, json, isAdminAuthed } = ctx;
  const { digestAuditDir, formatEtDateKey } = deps;

  if (!pathname.startsWith("/api/admin/digest-audit")) return false;
  if (req.method !== "GET") return false;
  if (!isAdminAuthed(ctx)) {
    json(res, { ok: false, error: "unauthorized" }, 401);
    return true;
  }

  const requestedDate = String(url.searchParams.get("date") || "").trim();
  const todayEt = typeof formatEtDateKey === "function"
    ? formatEtDateKey(new Date())
    : new Date().toISOString().slice(0, 10);
  const dateKey = requestedDate.match(/^\d{4}-\d{2}-\d{2}$/) ? requestedDate : todayEt;

  const auditDir = String(digestAuditDir || "");
  if (!auditDir) {
    json(res, { ok: false, error: "audit_dir_not_configured" }, 500);
    return true;
  }

  const filePath = path.join(auditDir, `${dateKey}.json`);
  let auditDoc;
  try {
    auditDoc = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") {
      // List available audit dates so the caller can pick one.
      let available = [];
      try {
        available = fs.readdirSync(auditDir)
          .filter((f) => f.endsWith(".json"))
          .map((f) => f.replace(/\.json$/, ""))
          .sort()
          .reverse()
          .slice(0, 30);
      } catch (_) { /* dir may not exist yet */ }
      json(res, {
        ok: false,
        error: "not_found",
        date_requested: dateKey,
        available_dates: available,
      }, 404);
      return true;
    }
    json(res, { ok: false, error: "read_error", detail: String(err?.message || err).slice(0, 120) }, 500);
    return true;
  }

  json(res, { ok: true, ...auditDoc });
  return true;
}

module.exports = { handleAdminDigestAuditRoutes };
