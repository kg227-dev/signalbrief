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
      } else if (action === "run_digest_targeted") {
        summary = row.success ? "Triggered digest run" : "Digest run failed";
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
        ? `Message sent via ${(row.sent_channels || []).join(" + ") || "channel"}`
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

function handleUserByEmailRoute({ ctx, deps }) {
  const { req, res, url } = ctx;
  const {
    json,
    isAdminAuthed,
    allUsers,
    getRecentAutoAdjustmentsForUser,
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
  const requestedAutoLimit = parseInt(url.searchParams.get("auto_limit"), 10);
  const autoLimit = Number.isFinite(requestedAutoLimit)
    ? Math.min(Math.max(requestedAutoLimit, 1), 20)
    : 8;
  const lookup = emailParam.toLowerCase().trim();
  const adminUser = allUsers().find((user) => (user.email || "").toLowerCase().trim() === lookup);
  if (!adminUser) {
    json(res, { error: "not found" }, 404);
    return true;
  }
  json(res, {
    ...adminUser,
    auto_adjustments_recent: getRecentAutoAdjustmentsForUser(adminUser, autoLimit),
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

module.exports = {
  handleUserByEmailRoute,
  handleAuditRoute,
  handleUpdateDeliveryTimeRoute,
};
