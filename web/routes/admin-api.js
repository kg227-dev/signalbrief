const { handleAdminStatsRoute } = require("./admin-api-stats-runtime");

const BULK_ACTIONS = new Set(["set_time", "pause", "resume", "resend_link"]);

function normalizeBulkEmails(emailsRaw) {
  return [...new Set(
    (Array.isArray(emailsRaw) ? emailsRaw : [])
      .map((value) => String(value || "").toLowerCase().trim())
      .filter(Boolean)
  )].slice(0, 200);
}

function planBulkActionEntries({ action, normalizedTime, uniqueEmails, usersByEmail }) {
  const planned = [];
  const skipped = [];

  for (const email of uniqueEmails) {
    const user = usersByEmail.get(email);
    if (!user) {
      skipped.push({ email, reason: "user not found" });
      continue;
    }

    if (action === "set_time") {
      const from = String((user.preferences || {}).delivery_time || "07:00");
      if (from === normalizedTime) {
        skipped.push({ email, reason: "delivery time unchanged" });
        continue;
      }
      planned.push({ email, user, kind: "bulk_set_time", from, to: normalizedTime });
      continue;
    }

    if (action === "pause") {
      const from = String(user.status || "active");
      if (from === "paused") {
        skipped.push({ email, reason: "already paused" });
        continue;
      }
      planned.push({ email, user, kind: "bulk_pause", from, to: "paused" });
      continue;
    }

    if (action === "resume") {
      const from = String(user.status || "active");
      if (from === "active") {
        skipped.push({ email, reason: "already active" });
        continue;
      }
      planned.push({ email, user, kind: "bulk_resume", from, to: "active" });
      continue;
    }

    if (!user.token) {
      skipped.push({ email, reason: "missing user token" });
      continue;
    }
    planned.push({ email, user, kind: "bulk_resend_link" });
  }

  return { planned, skipped };
}

function mapBulkAffected(items, status) {
  return items.map((item) => ({
    email: item.email,
    name: item.user.name || item.user.email || item.user.chatId || "",
    action: item.kind,
    from: item.from || null,
    to: item.to || null,
    status,
  }));
}

async function applyBulkActionEntries({
  req,
  planned,
  skipped,
  writeUser,
  sendMagicLinkEmail,
  logAdminActionEvent,
}) {
  const applied = [];
  for (const item of planned) {
    try {
      if (item.kind === "bulk_set_time") {
        const updated = {
          ...item.user,
          preferences: {
            ...(item.user.preferences || {}),
            delivery_time: item.to,
          },
          last_updated: new Date().toISOString(),
        };
        writeUser(item.user.chatId, updated);
      } else if (item.kind === "bulk_pause" || item.kind === "bulk_resume") {
        const updated = {
          ...item.user,
          status: item.to,
          last_updated: new Date().toISOString(),
        };
        writeUser(item.user.chatId, updated);
      } else if (item.kind === "bulk_resend_link") {
        await sendMagicLinkEmail(item.user);
      }
      logAdminActionEvent(req, {
        action: item.kind,
        target_email: item.email,
        success: true,
        details: { from: item.from || null, to: item.to || null },
      });
      applied.push({ ...item, status: "applied" });
    } catch (err) {
      const reason = err.message || "failed";
      skipped.push({ email: item.email, reason });
      logAdminActionEvent(req, {
        action: item.kind,
        target_email: item.email,
        success: false,
        details: { reason, from: item.from || null, to: item.to || null },
      });
    }
  }
  return { applied, skipped };
}

function createAdminApiRouteHandler(deps) {
  const {
    json, isAdminAuthed, getClientIp, checkLoginRate, requireJsonBody, CONFIG,
    verifyAdminPassword, createAdminSession, clearAdminSessionByRequest, BASE_URL,
    emitIgnoredEventsIfDue, loadCostRunsNewest, allUsers, loadEngagementEvents, parseIsoTs,
    computeFeedbackTrend, digestRunStatus, getCachedOrRefreshSchedulerHeartbeat, readSchedulerHeartbeat, readJsonLineLog,
    ADMIN_MESSAGE_LOG, ADMIN_ACTION_LOG, maskEmail, getRecentAutoAdjustmentsForUser,
    logAdminActionEvent, normalizeDeliveryTimeInput, writeUser, sendMagicLinkEmail,
    handleAdminRunDigest, logAdminMessageEvent, summarizeMessage, hashText, escapeHtml,
    sendEmail, sendTelegramText, formatTimeEt, parseEtNowParts, computeNextDeliveryEt,
    formatDaysLabel, computeQualityTrend, estimateSandboxCost, runSandboxPipeline,
  } = deps;
  return async function handleAdminApiRoutes(ctx) {
  const { req, res, url, pathname } = ctx;
  const loadSchedulerHeartbeat = typeof getCachedOrRefreshSchedulerHeartbeat === "function"
    ? getCachedOrRefreshSchedulerHeartbeat
    : (typeof readSchedulerHeartbeat === "function" ? readSchedulerHeartbeat : (() => null));
  if (pathname === "/api/admin/login" && req.method === "POST") {
    const ip = getClientIp(req);
    if (checkLoginRate(ip)) return json(res, { error: "Too many attempts. Try again in 15 minutes." }, 429);

    const body = await requireJsonBody(req, res);
    if (body == null) return;
    const { email, password } = body;
    if (!email || !password) return json(res, { error: "Email and password required" }, 400);

    const adminEmail = (CONFIG.admin && CONFIG.admin.email) || "";
    if (email.toLowerCase().trim() !== adminEmail.toLowerCase() || !verifyAdminPassword(password, CONFIG.admin || {})) {
      return json(res, { error: "Invalid credentials" }, 401);
    }

    const sessionToken = createAdminSession(email);
    const isSecure = BASE_URL.startsWith("https");
    const cookieFlags = [
      `sb_admin=${sessionToken}`,
      "HttpOnly",
      "Path=/",
      `Max-Age=${7 * 24 * 60 * 60}`,
      "SameSite=Strict",
      isSecure ? "Secure" : "",
    ].filter(Boolean).join("; ");

    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Set-Cookie": cookieFlags,
    });
    return res.end(JSON.stringify({ success: true }));
  }

  // POST /api/admin/logout — clear admin session
  if (pathname === "/api/admin/logout" && req.method === "POST") {
    clearAdminSessionByRequest(req);

    const isSecure = BASE_URL.startsWith("https");
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Set-Cookie": [
        "sb_admin=deleted",
        "HttpOnly",
        "Path=/",
        "Max-Age=0",
        "SameSite=Strict",
        isSecure ? "Secure" : "",
      ].filter(Boolean).join("; "),
    });
    return res.end(JSON.stringify({ success: true }));
  }

  // GET /api/admin/check — check if current session is authenticated
  if (pathname === "/api/admin/check" && req.method === "GET") {
    return json(res, { authenticated: isAdminAuthed(req) });
  }

  // GET /api/admin/stats — cost dashboard data
  if (pathname === "/api/admin/stats" && req.method === "GET") {
    return handleAdminStatsRoute(ctx, deps);
  }

  // GET /api/admin/user-by-email?email=... — admin user lookup
  if (pathname === "/api/admin/user-by-email" && req.method === "GET") {
    if (!isAdminAuthed(req)) return json(res, { error: "admin access only" }, 403);
    const emailParam = url.searchParams.get("email");
    if (!emailParam) return json(res, { error: "email required" }, 400);
    const requestedAutoLimit = parseInt(url.searchParams.get("auto_limit"), 10);
    const autoLimit = Number.isFinite(requestedAutoLimit)
      ? Math.min(Math.max(requestedAutoLimit, 1), 20)
      : 8;
    const lookup = emailParam.toLowerCase().trim();
    const adminUser = allUsers().find(u => (u.email || "").toLowerCase().trim() === lookup);
    if (!adminUser) return json(res, { error: "not found" }, 404);
    return json(res, {
      ...adminUser,
      auto_adjustments_recent: getRecentAutoAdjustmentsForUser(adminUser, autoLimit),
    });
  }

  // GET /api/admin/audit?email=... — unified admin timeline per user
  if (pathname === "/api/admin/audit" && req.method === "GET") {
    if (!isAdminAuthed(req)) return json(res, { error: "admin access only" }, 403);
    const email = String(url.searchParams.get("email") || "").toLowerCase().trim();
    if (!email) return json(res, { error: "email required" }, 400);
    const requestedLimit = parseInt(url.searchParams.get("limit"), 10);
    const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 120) : 30;

    const actionRows = readJsonLineLog(ADMIN_ACTION_LOG, limit * 6)
      .filter(row => String(row.target_email || "").toLowerCase().trim() === email)
      .map(row => {
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

    const messageRows = readJsonLineLog(ADMIN_MESSAGE_LOG, limit * 6)
      .filter(row => String(row.target_email || "").toLowerCase().trim() === email)
      .map(row => ({
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

    const entries = [...actionRows, ...messageRows]
      .sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")))
      .slice(0, limit);
    return json(res, { entries });
  }

  // POST /api/admin/bulk-action — dry-run + apply safe admin bulk ops
  if (pathname === "/api/admin/bulk-action" && req.method === "POST") {
    if (!isAdminAuthed(req)) return json(res, { error: "admin access only" }, 403);
    const body = await requireJsonBody(req, res);
    if (body == null) return;
    const action = String(body.action || "").toLowerCase().trim();
    const dryRun = body.dry_run !== false;
    const uniqueEmails = normalizeBulkEmails(body.emails);

    if (!uniqueEmails.length) return json(res, { error: "at least one email required" }, 400);
    if (!BULK_ACTIONS.has(action)) return json(res, { error: "unsupported bulk action" }, 400);

    let normalizedTime = null;
    if (action === "set_time") {
      normalizedTime = normalizeDeliveryTimeInput(body.delivery_time);
      if (!normalizedTime) return json(res, { error: "invalid delivery_time" }, 400);
    }

    const usersByEmail = new Map(
      allUsers()
        .filter(u => u.email)
        .map(u => [String(u.email).toLowerCase().trim(), u])
    );

    const { planned, skipped } = planBulkActionEntries({
      action,
      normalizedTime,
      uniqueEmails,
      usersByEmail,
    });
    const affected = mapBulkAffected(planned, "planned");

    if (dryRun) {
      return json(res, {
        success: true,
        dry_run: true,
        action,
        requested: uniqueEmails.length,
        applicable: planned.length,
        skipped,
        affected,
      });
    }

    const { applied, skipped: finalSkipped } = await applyBulkActionEntries({
      req,
      planned,
      skipped,
      writeUser,
      sendMagicLinkEmail,
      logAdminActionEvent,
    });

    return json(res, {
      success: true,
      dry_run: false,
      action,
      requested: uniqueEmails.length,
      applicable: planned.length,
      applied: applied.length,
      skipped: finalSkipped,
      affected: mapBulkAffected(applied, "applied"),
    });
  }

  // POST /api/admin/update-delivery-time — admin inline schedule editor
  if (pathname === "/api/admin/update-delivery-time" && req.method === "POST") {
    if (!isAdminAuthed(req)) return json(res, { error: "admin access only" }, 403);

    const body = await requireJsonBody(req, res);
    if (body == null) return;
    const email = String(body.email || "").toLowerCase().trim();
    const deliveryTime = normalizeDeliveryTimeInput(body.delivery_time);

    if (!email) return json(res, { error: "email required" }, 400);
    if (!deliveryTime) {
      return json(res, { error: "invalid delivery time (use HH:MM or H:MM AM/PM)" }, 400);
    }

    const user = allUsers().find(u => (u.email || "").toLowerCase().trim() === email);
    if (!user) return json(res, { error: "user not found" }, 404);
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
    return json(res, {
      success: true,
      email,
      delivery_time: deliveryTime,
      delivery_time_label: formatTimeEt(h, m),
    });
  }

  // POST /api/admin/run-digest — trigger a digest run
  if (pathname === "/api/admin/run-digest" && req.method === "POST") {
    return handleAdminRunDigest(ctx);
  }

  // POST /api/admin/message-user — send custom admin message via configured channels
  // Accept trailing slash variant for proxy/canonicalization compatibility.
  if ((pathname === "/api/admin/message-user" || pathname === "/api/admin/message-user/") && req.method === "POST") {
    if (!isAdminAuthed(req)) return json(res, { error: "admin access only" }, 403);
    const body = await requireJsonBody(req, res);
    if (body == null) return;
    const email = String(body.email || "").toLowerCase().trim();
    const message = String(body.message || "").trim();
    const subject = String(body.subject || "Message from SignalBrief").trim().slice(0, 140) || "Message from SignalBrief";
    const channels = Array.isArray(body.channels)
      ? body.channels.map(c => String(c).toLowerCase().trim()).filter(Boolean)
      : [];
    const messagePreview = summarizeMessage(message);
    const payloadHash = hashText(message);
    const writeAudit = (extra = {}) => {
      logAdminMessageEvent(req, {
        action: "message_user",
        target_email: email || null,
        target_chat_id: extra.target_chat_id || null,
        requested_channels: channels,
        sent_channels: Array.isArray(extra.sent_channels) ? extra.sent_channels : [],
        subject,
        message_length: message.length,
        message_preview: messagePreview,
        payload_hash: payloadHash,
        success: !!extra.success,
        errors: Array.isArray(extra.errors) ? extra.errors : [],
      });
    };

    if (!email) {
      writeAudit({ success: false, errors: ["email required"] });
      return json(res, { error: "email required" }, 400);
    }
    if (message.length < 2) {
      writeAudit({ success: false, errors: ["message too short"] });
      return json(res, { error: "message too short" }, 400);
    }
    if (message.length > 4000) {
      writeAudit({ success: false, errors: ["message too long (max 4000 chars)"] });
      return json(res, { error: "message too long (max 4000 chars)" }, 400);
    }
    if (!channels.length) {
      writeAudit({ success: false, errors: ["select at least one channel"] });
      return json(res, { error: "select at least one channel" }, 400);
    }

    const user = allUsers().find(u => (u.email || "").toLowerCase().trim() === email);
    if (!user) {
      writeAudit({ success: false, errors: ["user not found"] });
      return json(res, { error: "user not found" }, 404);
    }

    const prefs = user.preferences || {};
    const emailReady = !!user.email && prefs.email_enabled !== false;
    const tgReady = !!(user.chatId && !String(user.chatId).startsWith("email-") && prefs.telegram_enabled !== false);
    const wantsEmail = channels.includes("email");
    const wantsTelegram = channels.includes("telegram");

    const sent = { email: false, telegram: false };
    const errors = [];

    if (wantsEmail) {
      if (!emailReady) {
        errors.push("email channel not available for this user");
      } else {
        try {
          const html = `
            <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:28px 22px;color:#111;">
              <div style="font-size:21px;font-weight:700;margin-bottom:12px;">☀️ SignalBrief</div>
              <div style="font-size:14px;color:#6B7280;margin-bottom:14px;">Message from the SignalBrief team</div>
              <div style="font-size:15px;line-height:1.65;color:#1F2937;white-space:pre-wrap;">${escapeHtml(message)}</div>
            </div>`;
          await sendEmail(user.email, subject, html, user.token || null);
          sent.email = true;
        } catch (e) {
          errors.push(`email failed: ${e.message}`);
        }
      }
    }

    if (wantsTelegram) {
      if (!tgReady) {
        errors.push("telegram channel not available for this user");
      } else {
        try {
          await sendTelegramText(user.chatId, `📣 SignalBrief update\n\n${message}`);
          sent.telegram = true;
        } catch (e) {
          errors.push(`telegram failed: ${e.message}`);
        }
      }
    }

    if (!sent.email && !sent.telegram) {
      writeAudit({
        target_chat_id: user.chatId || null,
        sent_channels: [],
        success: false,
        errors,
      });
      return json(res, { error: errors.join(" | ") || "no channels succeeded" }, 400);
    }

    writeAudit({
      target_chat_id: user.chatId || null,
      sent_channels: [
        sent.email ? "email" : null,
        sent.telegram ? "telegram" : null,
      ].filter(Boolean),
      success: true,
      errors,
    });

    return json(res, {
      success: true,
      sent,
      warnings: errors,
      message: `Sent via ${[
        sent.email ? "email" : null,
        sent.telegram ? "telegram" : null,
      ].filter(Boolean).join(" + ")}`,
    });
  }

  // ── Sandbox API ──────────────────────────────────────────────────────────────

  // POST /api/admin/sandbox/estimate — cost estimate without API calls
  if (pathname === "/api/admin/sandbox/estimate" && req.method === "POST") {
    if (!isAdminAuthed(req)) return json(res, { error: "admin access only" }, 403);
    const body = await requireJsonBody(req, res);
    if (body == null) return;
    try {
      const estimate = estimateSandboxCost(body);
      return json(res, estimate);
    } catch (err) {
      return json(res, { error: err.message }, 500);
    }
  }

  // POST /api/admin/sandbox/run — run pipeline, return results (no delivery)
  if (pathname === "/api/admin/sandbox/run" && req.method === "POST") {
    if (!isAdminAuthed(req)) return json(res, { error: "admin access only" }, 403);
    const body = await requireJsonBody(req, res);
    if (body == null) return;
    try {
      const result = await runSandboxPipeline(body);
      return json(res, result);
    } catch (err) {
      return json(res, { error: err.message }, 500);
    }
  }

  return false;
  };
}

async function handleAdminApiRoutes(ctx, deps) {
  const routeHandler = createAdminApiRouteHandler(deps);
  return routeHandler(ctx);
}

module.exports = {
  createAdminApiRouteHandler,
  handleAdminApiRoutes,
};
