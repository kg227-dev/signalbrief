"use strict";

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
  handleUpdateDeliveryTimeRoute,
  normalizeManagedStatus,
  applyManagedStatus,
  handleSetUserStatusRoute,
  handleDeleteUserRoute,
  handleRestartSchedulerWorkerRoute,
};
