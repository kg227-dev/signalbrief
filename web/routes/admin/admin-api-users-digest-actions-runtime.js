"use strict";

const { parseDigestDateKeyFromUser } = require("./admin-api-users-query-actions-runtime");

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

module.exports = {
  resolveDigestDateKeyForAdminAction,
  loadOperableDigestSnapshot,
  isOperableDigestSnapshot,
  handleResendDigestRoute,
  handleRegenerateDigestRoute,
};
