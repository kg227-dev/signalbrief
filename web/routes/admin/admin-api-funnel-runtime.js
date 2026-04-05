"use strict";

const fs = require("fs");
const path = require("path");
const {
  STAGES,
  normalizeLane,
  normalizeCanonicalUrl,
  normalizeDomain,
  normalizeReason,
  computeDropPct,
  computeConversionRate,
} = require("./admin-api-funnel-shared");

const DATE_FILE_RE = /^(\d{4}-\d{2}-\d{2})\.json$/;

function readAuditFile(auditDir, dateKey) {
  try {
    const raw = fs.readFileSync(path.join(auditDir, `${dateKey}.json`), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function listAuditDates(auditDir) {
  try {
    return fs.readdirSync(auditDir)
      .map((f) => { const m = DATE_FILE_RE.exec(f); return m ? m[1] : null; })
      .filter(Boolean)
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

function buildDatesResponse(auditDir) {
  const dates = listAuditDates(auditDir);
  return {
    available_dates: dates,
    oldest: dates.length > 0 ? dates[dates.length - 1] : null,
    newest: dates.length > 0 ? dates[0] : null,
    total_run_days: dates.length,
  };
}

// Expand "from"/"to" range into individual date strings (inclusive), most recent first
function expandDateRange(from, to) {
  const dates = [];
  const start = new Date(from + "T00:00:00Z");
  const end   = new Date(to   + "T00:00:00Z");
  if (isNaN(start) || isNaN(end) || start > end) return dates;
  for (let d = new Date(end); d >= start; d.setUTCDate(d.getUTCDate() - 1)) {
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

async function handleAdminFunnelRoutes(ctx, deps) {
  const { req, res, pathname, url } = ctx;
  const { json, isAdminAuthed, digestAuditDir } = deps;

  if (!pathname.startsWith("/api/admin/funnel")) return false;
  if (req.method !== "GET") return false;
  if (!isAdminAuthed(req)) {
    json(res, { ok: false, error: "unauthorized" }, 401);
    return true;
  }

  const auditDir = String(digestAuditDir || "");

  if (pathname === "/api/admin/funnel/dates") {
    json(res, { ok: true, ...buildDatesResponse(auditDir) });
    return true;
  }

  // /summary and /topic handled in later tasks
  json(res, { ok: false, error: "not_implemented" }, 501);
  return true;
}

module.exports = {
  handleAdminFunnelRoutes,
  buildDatesResponse,
  expandDateRange,
  listAuditDates,
  readAuditFile,
};
