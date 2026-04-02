"use strict";

function buildAuditEntries({ email, limit, readJsonLineLog, adminActionLog, adminMessageLog }) {
  const actionRows = readJsonLineLog(adminActionLog, limit * 6)
    .filter((row) => String(row.target_email || "").toLowerCase().trim() === email)
    .map((row) => {
      const action = String(row.action || "action");
      const details = row.details && typeof row.details === "object" ? row.details : {};
      let summary = action;
      if (action === "set_delivery_time" && details.from && details.to) {
        summary = `Delivery time ${details.from} → ${details.to}`;
      } else if (action === "bulk_pause") {
        summary = "Paused deliveries";
      } else if (action === "bulk_resume") {
        summary = "Resumed deliveries";
      } else if (action === "bulk_resend_link") {
        summary = "Resent settings link";
      } else if (action === "bulk_set_time" && details.to) {
        summary = `Set delivery time to ${details.to}`;
      } else if (action.startsWith("run_digest_")) {
        summary = "Legacy digest action ignored";
      } else if (action === "restart_scheduler_worker") {
        summary = row.success ? "Requested scheduler worker restart" : "Scheduler worker restart failed";
      } else if (action === "set_user_status") {
        const from = String(details.from || "").trim();
        const to = String(details.to || "").trim();
        summary = from && to ? `Status ${from} → ${to}` : "Updated subscriber status";
      } else if (action === "delete_user") {
        summary = row.success ? "Deleted subscriber" : "Delete subscriber failed";
      } else if (action === "resend_digest_precise") {
        summary = row.success ? "Resent stored digest snapshot" : "Stored digest resend failed";
      } else if (action === "regenerate_digest_summaries") {
        summary = row.success ? "Regenerated stored digest summaries" : "Digest summary regeneration failed";
      }
      return {
        at: row.at || null,
        actor: row.actor || "unknown",
        type: "action",
        action,
        success: row.success !== false,
        summary,
        details,
      };
    });

  const messageRows = readJsonLineLog(adminMessageLog, limit * 6)
    .filter((row) => String(row.target_email || "").toLowerCase().trim() === email)
    .map((row) => ({
      at: row.at || null,
      actor: row.actor || "unknown",
      type: "message",
      action: "message_user",
      success: !!row.success,
      summary: row.success
        ? `Message sent via ${(row.sent_channels || []).join(" + ") || "email"}`
        : `Message failed: ${(row.errors || []).join(" | ") || "unknown error"}`,
      details: {
        requested_channels: Array.isArray(row.requested_channels) ? row.requested_channels : [],
        sent_channels: Array.isArray(row.sent_channels) ? row.sent_channels : [],
        errors: Array.isArray(row.errors) ? row.errors : [],
        message_preview: row.message_preview || "",
      },
    }));

  return [...actionRows, ...messageRows]
    .sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")))
    .slice(0, limit);
}

function parseDigestDateKeyFromUser(user) {
  const fromLastQualityDate = String(user?.last_quality_score?.date_et || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(fromLastQualityDate)) return fromLastQualityDate;

  const fromLastQualityDigestId = String(user?.last_quality_score?.digest_id || "").trim().match(/^(\d{4}-\d{2}-\d{2}):/);
  if (fromLastQualityDigestId) return fromLastQualityDigestId[1];

  const history = Array.isArray(user?.quality_history) ? user.quality_history : [];
  for (let idx = history.length - 1; idx >= 0; idx -= 1) {
    const row = history[idx] || {};
    const dateEt = String(row.date_et || "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateEt)) return dateEt;
    const digestIdMatch = String(row.digest_id || "").trim().match(/^(\d{4}-\d{2}-\d{2}):/);
    if (digestIdMatch) return digestIdMatch[1];
  }

  const lastDigestAt = String(user?.last_digest_at || "").trim();
  const ts = Date.parse(lastDigestAt);
  if (Number.isFinite(ts)) {
    return new Date(ts).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  }
  return "";
}

function handleUserByEmailRoute({ ctx, deps }) {
  const { req, res, url } = ctx;
  const {
    json,
    isAdminAuthed,
    allUsers,
    countArchiveDigestsForUser,
    loadLatestDigestSnapshot,
    buildRecentDigestsExport,
  } = deps;

  if (!isAdminAuthed(req)) {
    json(res, { error: "admin access only" }, 403);
    return true;
  }
  const emailParam = url.searchParams.get("email");
  if (!emailParam) {
    json(res, { error: "email required" }, 400);
    return true;
  }
  const lookup = emailParam.toLowerCase().trim();
  const adminUser = allUsers().find((user) => (user.email || "").toLowerCase().trim() === lookup);
  if (!adminUser) {
    json(res, { error: "not found" }, 404);
    return true;
  }
  const latestDigestDateKey = parseDigestDateKeyFromUser(adminUser);
  const latestDigestRecord = latestDigestDateKey && typeof loadLatestDigestSnapshot === "function"
    ? loadLatestDigestSnapshot(adminUser.chatId, latestDigestDateKey)
    : null;
  const archiveDigestCountRaw = typeof countArchiveDigestsForUser === "function"
    ? Number(countArchiveDigestsForUser(adminUser))
    : NaN;
  const archiveDigestCount = Number.isFinite(archiveDigestCountRaw)
    ? Math.max(0, archiveDigestCountRaw)
    : Math.max(0, Number(adminUser?.digests_received || 0));
  const recentDigests = typeof buildRecentDigestsExport === "function"
    ? buildRecentDigestsExport({ days: 7 })
    : { rows: [] };
  const recentDigestRows = (Array.isArray(recentDigests?.rows) ? recentDigests.rows : [])
    .filter((row) => (
      String(row?.user_id || "").trim() === String(adminUser.chatId || "").trim()
      || String(row?.recipient || "").trim().toLowerCase() === lookup
      || String(row?.user_email || "").trim().toLowerCase() === lookup
    ))
    .slice(0, 14);
  json(res, {
    ...adminUser,
    archive_digest_count: archiveDigestCount,
    latest_digest_record: latestDigestRecord,
    recent_digests: recentDigestRows,
  });
  return true;
}

function handleAuditRoute({ ctx, deps }) {
  const { req, res, url } = ctx;
  const {
    json,
    isAdminAuthed,
    readJsonLineLog,
    adminActionLog,
    adminMessageLog,
  } = deps;

  if (!isAdminAuthed(req)) {
    json(res, { error: "admin access only" }, 403);
    return true;
  }
  const email = String(url.searchParams.get("email") || "").toLowerCase().trim();
  if (!email) {
    json(res, { error: "email required" }, 400);
    return true;
  }
  const requestedLimit = parseInt(url.searchParams.get("limit"), 10);
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 120) : 30;
  const entries = buildAuditEntries({
    email,
    limit,
    readJsonLineLog,
    adminActionLog,
    adminMessageLog,
  });
  json(res, { entries });
  return true;
}

module.exports = {
  buildAuditEntries,
  parseDigestDateKeyFromUser,
  handleUserByEmailRoute,
  handleAuditRoute,
};
