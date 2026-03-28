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

function resolveDigestDateKeyForAdminAction(body, adminUser) {
  let digestDateKey = String(body?.date_et || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(digestDateKey)) {
    digestDateKey = parseDigestDateKeyFromUser(adminUser);
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(digestDateKey) ? digestDateKey : "";
}

function loadOperableDigestSnapshot({ adminUser, body, loadCurrentDigestSnapshot }) {
  const digestDateKey = resolveDigestDateKeyForAdminAction(body, adminUser);
  if (!digestDateKey) {
    return { digestDateKey: "", snapshot: null, selectedCount: 0, snapshotStatus: "" };
  }
  const snapshot = typeof loadCurrentDigestSnapshot === "function"
    ? loadCurrentDigestSnapshot(adminUser.chatId, digestDateKey, "scheduled")
    : null;
  const itemCount = Array.isArray(snapshot?.items) ? snapshot.items.length : 0;
  const selectedCount = Math.max(0, Number(snapshot?.selected_count || itemCount));
  const snapshotStatus = String(snapshot?.status || "").trim().toLowerCase();
  return {
    digestDateKey,
    snapshot,
    selectedCount,
    snapshotStatus,
  };
}

function isOperableDigestSnapshot(snapshot, selectedCount, snapshotStatus) {
  const operableStatuses = new Set(["sent", "failed", "selected", "sending"]);
  return !!snapshot && selectedCount >= 5 && operableStatuses.has(String(snapshotStatus || "").trim().toLowerCase());
}

async function handleResendDigestRoute({ ctx, deps }) {
  const { req, res } = ctx;
  const {
    json,
    isAdminAuthed,
    requireJsonBody,
    allUsers,
    loadCurrentDigestSnapshot,
    resendDigestSnapshot,
    logAdminActionEvent,
  } = deps;

  if (!isAdminAuthed(req)) {
    json(res, { error: "admin access only" }, 403);
    return true;
  }

  const body = await requireJsonBody(req, res);
  if (body == null) return true;

  const email = String(body?.email || "").trim().toLowerCase();
  if (!email) {
    json(res, { error: "email required" }, 400);
    return true;
  }

  const adminUser = allUsers().find((user) => (user.email || "").toLowerCase().trim() === email);
  if (!adminUser) {
    json(res, { error: "user not found" }, 404);
    return true;
  }
  if (!String(adminUser?.email || "").trim()) {
    json(res, { error: "subscriber has no email address" }, 400);
    return true;
  }
  if (String(adminUser?.status || "").trim().toLowerCase() === "unsubscribed") {
    json(res, { error: "cannot resend digest to an unsubscribed user" }, 409);
    return true;
  }

  const {
    digestDateKey,
    snapshot,
    selectedCount,
    snapshotStatus,
  } = loadOperableDigestSnapshot({
    adminUser,
    body,
    loadCurrentDigestSnapshot,
  });
  if (!digestDateKey) {
    json(res, { error: "valid digest date required" }, 400);
    return true;
  }

  if (!isOperableDigestSnapshot(snapshot, selectedCount, snapshotStatus)) {
    logAdminActionEvent(req, {
      action: "resend_digest_precise",
      success: false,
      target_email: adminUser.email,
      details: {
        date_et: digestDateKey,
        reason: "snapshot_unavailable",
        status: snapshotStatus || null,
        selected_count: selectedCount,
      },
    });
    json(res, { error: "No resendable 5-item digest snapshot found for that user/date." }, 409);
    return true;
  }

  try {
    const outcome = await resendDigestSnapshot({
      user: adminUser,
      snapshot,
    });

    logAdminActionEvent(req, {
      action: "resend_digest_precise",
      success: true,
      target_email: adminUser.email,
      details: {
        date_et: digestDateKey,
        status: snapshotStatus,
        item_count: outcome.item_count,
        subject: outcome.subject,
      },
    });

    json(res, {
      success: true,
      email: adminUser.email,
      date_et: digestDateKey,
      item_count: outcome.item_count,
      status: snapshotStatus,
      message: "Stored digest snapshot resent",
    });
  } catch (error) {
    logAdminActionEvent(req, {
      action: "resend_digest_precise",
      success: false,
      target_email: adminUser.email,
      details: {
        date_et: digestDateKey,
        status: snapshotStatus,
        error: error?.message || "resend failed",
      },
    });
    json(res, {
      error: `Failed to resend stored digest snapshot: ${error?.message || "unknown error"}`,
    }, 500);
  }
  return true;
}

async function handleRegenerateDigestRoute({ ctx, deps }) {
  const { req, res } = ctx;
  const {
    json,
    isAdminAuthed,
    requireJsonBody,
    allUsers,
    loadCurrentDigestSnapshot,
    regenerateDigestSnapshot,
    logAdminActionEvent,
    getAdminActor,
  } = deps;

  if (!isAdminAuthed(req)) {
    json(res, { error: "admin access only" }, 403);
    return true;
  }

  const body = await requireJsonBody(req, res);
  if (body == null) return true;

  const email = String(body?.email || "").trim().toLowerCase();
  if (!email) {
    json(res, { error: "email required" }, 400);
    return true;
  }

  const adminUser = allUsers().find((user) => (user.email || "").toLowerCase().trim() === email);
  if (!adminUser) {
    json(res, { error: "user not found" }, 404);
    return true;
  }

  const {
    digestDateKey,
    snapshot,
    selectedCount,
    snapshotStatus,
  } = loadOperableDigestSnapshot({
    adminUser,
    body,
    loadCurrentDigestSnapshot,
  });
  if (!digestDateKey) {
    json(res, { error: "valid digest date required" }, 400);
    return true;
  }

  if (!isOperableDigestSnapshot(snapshot, selectedCount, snapshotStatus)) {
    logAdminActionEvent(req, {
      action: "regenerate_digest_summaries",
      success: false,
      target_email: adminUser.email,
      details: {
        date_et: digestDateKey,
        reason: "snapshot_unavailable",
        status: snapshotStatus || null,
        selected_count: selectedCount,
      },
    });
    json(res, { error: "No regenable 5-item digest snapshot found for that user/date." }, 409);
    return true;
  }

  try {
    const outcome = await regenerateDigestSnapshot({
      user: adminUser,
      snapshot,
      actor: typeof getAdminActor === "function" ? getAdminActor(req) : "admin",
    });

    logAdminActionEvent(req, {
      action: "regenerate_digest_summaries",
      success: true,
      target_email: adminUser.email,
      details: {
        date_et: digestDateKey,
        status: snapshotStatus,
        item_count: outcome.item_count,
        regenerated_at: outcome.regenerated_at,
        subject: outcome.subject,
      },
    });

    json(res, {
      success: true,
      email: adminUser.email,
      date_et: digestDateKey,
      item_count: outcome.item_count,
      status: snapshotStatus,
      regenerated_at: outcome.regenerated_at,
      message: "Stored digest summaries regenerated",
    });
  } catch (error) {
    logAdminActionEvent(req, {
      action: "regenerate_digest_summaries",
      success: false,
      target_email: adminUser.email,
      details: {
        date_et: digestDateKey,
        status: snapshotStatus,
        error: error?.message || "regeneration failed",
      },
    });
    json(res, {
      error: `Failed to regenerate stored digest summaries: ${error?.message || "unknown error"}`,
    }, 500);
  }
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

async function handleUpdateDeliveryTimeRoute({ ctx, deps }) {
  const { req, res } = ctx;
  const {
    json,
    isAdminAuthed,
    requireJsonBody,
    allUsers,
    normalizeDeliveryTimeInput,
    writeUser,
    logAdminActionEvent,
    formatTimeEt,
  } = deps;

  if (!isAdminAuthed(req)) {
    json(res, { error: "admin access only" }, 403);
    return true;
  }

  const body = await requireJsonBody(req, res);
  if (body == null) return true;
  const email = String(body.email || "").toLowerCase().trim();
  const deliveryTime = normalizeDeliveryTimeInput(body.delivery_time);

  if (!email) {
    json(res, { error: "email required" }, 400);
    return true;
  }
  if (!deliveryTime) {
    json(res, { error: "invalid delivery time (use HH:MM or H:MM AM/PM)" }, 400);
    return true;
  }

  const user = allUsers().find((row) => (row.email || "").toLowerCase().trim() === email);
  if (!user) {
    json(res, { error: "user not found" }, 404);
    return true;
  }
  const previousDeliveryTime = String((user.preferences || {}).delivery_time || "07:00");
  const [h, m] = deliveryTime.split(":").map(Number);
  const updated = {
    ...user,
    preferences: {
      ...(user.preferences || {}),
      delivery_time: deliveryTime,
    },
    last_updated: new Date().toISOString(),
  };
  writeUser(user.chatId, updated);
  logAdminActionEvent(req, {
    action: "set_delivery_time",
    target_email: email,
    success: true,
    details: {
      from: previousDeliveryTime,
      to: deliveryTime,
    },
  });
  json(res, {
    success: true,
    email,
    delivery_time: deliveryTime,
    delivery_time_label: formatTimeEt(h, m),
  });
  return true;
}

function normalizeManagedStatus(rawStatus) {
  const normalized = String(rawStatus || "").toLowerCase().trim();
  if (normalized === "active" || normalized === "paused" || normalized === "unsubscribed") {
    return normalized;
  }
  return "";
}

const PRE_UNSUBSCRIBE_CHANNELS_KEY = "_pre_unsubscribe_channels";

function deriveRestoredChannelPreferences(user, previousStatus) {
  const prefs = user && user.preferences && typeof user.preferences === "object"
    ? user.preferences
    : {};
  const saved = prefs[PRE_UNSUBSCRIBE_CHANNELS_KEY] && typeof prefs[PRE_UNSUBSCRIBE_CHANNELS_KEY] === "object"
    ? prefs[PRE_UNSUBSCRIBE_CHANNELS_KEY]
    : null;

  if (saved) {
    return {
      email_enabled: saved.email_enabled === true && !!user?.email,
    };
  }

  if (previousStatus === "paused") {
    return {
      email_enabled: !!user?.email,
    };
  }

  return {
    email_enabled: !!user?.email,
  };
}

function buildStatusUpdateMessage(previousStatus, nextStatus) {
  if (previousStatus === "unsubscribed" && nextStatus === "active") {
    return "Subscriber re-subscribed";
  }
  if (previousStatus === "paused" && nextStatus === "active") {
    return "Subscriber resumed";
  }
  return `Subscriber set to ${nextStatus}`;
}

function applyManagedStatus(user, nextStatus, opts = {}) {
  const previousStatus = String(opts.previousStatus || user?.status || "active").toLowerCase().trim();
  const nowIso = new Date().toISOString();
  const updated = {
    ...user,
    status: nextStatus,
    last_updated: nowIso,
    preferences: {
      ...(user.preferences || {}),
    },
  };
  if (nextStatus === "unsubscribed") {
    updated.preferences[PRE_UNSUBSCRIBE_CHANNELS_KEY] = {
      email_enabled: updated.preferences.email_enabled !== false && !!user?.email,
    };
    updated.email_unsubscribed_at = nowIso;
    updated.preferences.email_enabled = false;
  } else if (nextStatus === "active") {
    const restored = deriveRestoredChannelPreferences(user, previousStatus);
    updated.preferences.email_enabled = restored.email_enabled;
    delete updated.preferences[PRE_UNSUBSCRIBE_CHANNELS_KEY];
    delete updated.email_unsubscribed_at;
  }
  return updated;
}

async function handleSetUserStatusRoute({ ctx, deps }) {
  const { req, res } = ctx;
  const {
    json,
    isAdminAuthed,
    requireJsonBody,
    allUsers,
    writeUser,
    logAdminActionEvent,
  } = deps;

  if (!isAdminAuthed(req)) {
    json(res, { error: "admin access only" }, 403);
    return true;
  }

  const body = await requireJsonBody(req, res);
  if (body == null) return true;
  const email = String(body.email || "").toLowerCase().trim();
  const nextStatus = normalizeManagedStatus(body.status);

  if (!email) {
    json(res, { error: "email required" }, 400);
    return true;
  }
  if (!nextStatus) {
    json(res, { error: "invalid status (expected active|paused|unsubscribed)" }, 400);
    return true;
  }

  const user = allUsers().find((row) => (row.email || "").toLowerCase().trim() === email);
  if (!user) {
    json(res, { error: "user not found" }, 404);
    return true;
  }

  const previousStatus = String(user.status || "active");
  if (previousStatus === nextStatus) {
    json(res, {
      success: true,
      email,
      status: nextStatus,
      message: `Subscriber already ${nextStatus}`,
    });
    return true;
  }

  const updated = applyManagedStatus(user, nextStatus, {
    previousStatus,
  });
  writeUser(user.chatId, updated);
  logAdminActionEvent(req, {
    action: "set_user_status",
    target_email: email,
    success: true,
    details: {
      from: previousStatus,
      to: nextStatus,
      chat_id: user.chatId || null,
    },
  });

  json(res, {
    success: true,
    email,
    from: previousStatus,
    status: nextStatus,
    message: buildStatusUpdateMessage(previousStatus, nextStatus),
  });
  return true;
}

async function handleDeleteUserRoute({ ctx, deps }) {
  const { req, res } = ctx;
  const {
    json,
    isAdminAuthed,
    requireJsonBody,
    allUsers,
    deleteUser,
    logAdminActionEvent,
  } = deps;

  if (!isAdminAuthed(req)) {
    json(res, { error: "admin access only" }, 403);
    return true;
  }

  const body = await requireJsonBody(req, res);
  if (body == null) return true;
  const email = String(body.email || "").toLowerCase().trim();
  const confirm = String(body.confirm || "").trim().toUpperCase();
  if (!email) {
    json(res, { error: "email required" }, 400);
    return true;
  }
  if (confirm !== "DELETE") {
    json(res, { error: "confirmation required (confirm: DELETE)" }, 400);
    return true;
  }

  const user = allUsers().find((row) => (row.email || "").toLowerCase().trim() === email);
  if (!user) {
    logAdminActionEvent(req, {
      action: "delete_user",
      target_email: email,
      success: true,
      details: {
        existed: false,
        idempotent: true,
      },
    });
    json(res, {
      success: true,
      email,
      existed: false,
      message: "Subscriber already deleted",
    });
    return true;
  }

  const result = deleteUser(user.chatId);
  if (!result || result.ok !== true) {
    const reason = result && result.reason ? result.reason : "delete failed";
    logAdminActionEvent(req, {
      action: "delete_user",
      target_email: email,
      success: false,
      details: { reason, chat_id: user.chatId || null },
    });
    json(res, { error: `failed to delete user: ${reason}` }, 500);
    return true;
  }

  logAdminActionEvent(req, {
    action: "delete_user",
    target_email: email,
    success: true,
    details: {
      chat_id: user.chatId || null,
      existed: result.existed !== false,
    },
  });
  json(res, {
    success: true,
    email,
    message: "Subscriber deleted",
  });
  return true;
}

function normalizeRestartReason(rawReason) {
  const trimmed = String(rawReason || "").trim();
  if (!trimmed) return "manual_admin_request";
  return trimmed.slice(0, 180);
}

async function handleRestartSchedulerWorkerRoute({ ctx, deps }) {
  const { req, res } = ctx;
  const {
    json,
    isAdminAuthed,
    requireJsonBody,
    requestSchedulerWorkerRestart,
    logAdminActionEvent,
  } = deps;

  if (!isAdminAuthed(req)) {
    json(res, { error: "admin access only" }, 403);
    return true;
  }

  const body = await requireJsonBody(req, res);
  if (body == null) return true;
  const reason = normalizeRestartReason(body.reason);

  try {
    const restart = requestSchedulerWorkerRestart({
      reason,
      source: "admin_ui",
    });

    logAdminActionEvent(req, {
      action: "restart_scheduler_worker",
      success: true,
      details: {
        reason,
        request_id: restart.request_id,
        requested_at: restart.requested_at,
      },
    });

    json(res, {
      success: true,
      message: "Scheduler worker restart requested. It will restart safely after in-flight work finishes.",
      request_id: restart.request_id,
      requested_at: restart.requested_at,
    });
  } catch (error) {
    logAdminActionEvent(req, {
      action: "restart_scheduler_worker",
      success: false,
      details: {
        reason,
        error: error.message || "restart request failed",
      },
    });

    json(res, {
      error: `Failed to request scheduler restart: ${error.message || "unknown error"}`,
    }, 500);
  }
  return true;
}

module.exports = {
  handleUserByEmailRoute,
  handleRegenerateDigestRoute,
  handleResendDigestRoute,
  handleAuditRoute,
  handleUpdateDeliveryTimeRoute,
  handleSetUserStatusRoute,
  handleDeleteUserRoute,
  handleRestartSchedulerWorkerRoute,
};
