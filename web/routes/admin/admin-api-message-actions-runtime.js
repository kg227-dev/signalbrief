function normalizeAdminMessageBody(body, summarizeMessage, hashText) {
  const email = String(body.email || "").toLowerCase().trim();
  const message = String(body.message || "").trim();
  const subject = String(body.subject || "Message from SignalBrief").trim().slice(0, 140) || "Message from SignalBrief";
  const messagePreview = summarizeMessage(message);
  const payloadHash = hashText(message);

  return {
    email,
    message,
    subject,
    messagePreview,
    payloadHash,
  };
}

function validateAdminMessageRequest({ email, message }) {
  if (!email) return "email required";
  if (message.length < 2) return "message too short";
  if (message.length > 4000) return "message too long (max 4000 chars)";
  return null;
}

function buildAdminMessageAuditWriter({
  req,
  logAdminMessageEvent,
  email,
  subject,
  message,
  messagePreview,
  payloadHash,
}) {
  return function writeAudit(extra = {}) {
    logAdminMessageEvent(req, {
      action: "message_user",
      target_email: email || null,
      requested_channels: ["email"],
      sent_channels: Array.isArray(extra.sent_channels) ? extra.sent_channels : [],
      subject,
      message_length: message.length,
      message_preview: messagePreview,
      payload_hash: payloadHash,
      success: !!extra.success,
      errors: Array.isArray(extra.errors) ? extra.errors : [],
    });
  };
}

function resolveUserChannelReadiness(user) {
  const prefs = user.preferences || {};
  const emailReady = !!user.email && prefs.email_enabled !== false;
  return {
    wantsEmail: true,
    emailReady,
  };
}

async function deliverAdminMessage({
  user,
  message,
  subject,
  escapeHtml,
  sendEmail,
}) {
  const readiness = resolveUserChannelReadiness(user);
  const sent = { email: false };
  const errors = [];

  if (readiness.wantsEmail) {
    if (!readiness.emailReady) {
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
      } catch (error) {
        errors.push(`email failed: ${error.message}`);
      }
    }
  }

  return { sent, errors };
}

function summarizeSentChannels(sent) {
  return [
    sent.email ? "email" : null,
  ].filter(Boolean);
}

async function processAdminMessageRequest({ ctx, deps }) {
  const {
    json,
    requireJsonBody,
    allUsers,
    summarizeMessage,
    hashText,
    logAdminMessageEvent,
    escapeHtml,
    sendEmail,
  } = deps;

  const body = await requireJsonBody(ctx.req, ctx.res);
  if (body == null) return true;

  const requestData = normalizeAdminMessageBody(body, summarizeMessage, hashText);
  const {
    email,
    message,
    subject,
  } = requestData;
  const writeAudit = buildAdminMessageAuditWriter({
    req: ctx.req,
    logAdminMessageEvent,
    email,
    subject,
    message,
    messagePreview: requestData.messagePreview,
    payloadHash: requestData.payloadHash,
  });

  const requestError = validateAdminMessageRequest(requestData);
  if (requestError) {
    writeAudit({ success: false, errors: [requestError] });
    json(ctx.res, { error: requestError }, 400);
    return true;
  }

  const user = allUsers().find((row) => (row.email || "").toLowerCase().trim() === email);
  if (!user) {
    writeAudit({ success: false, errors: ["user not found"] });
    json(ctx.res, { error: "user not found" }, 404);
    return true;
  }

  const { sent, errors } = await deliverAdminMessage({
    user,
    message,
    subject,
    escapeHtml,
    sendEmail,
  });
  const sentChannels = summarizeSentChannels(sent);
  if (!sent.email) {
    writeAudit({
      sent_channels: sentChannels,
      success: false,
      errors,
    });
    json(ctx.res, { error: errors.join(" | ") || "no channels succeeded" }, 400);
    return true;
  }

  writeAudit({
    sent_channels: sentChannels,
    success: true,
    errors,
  });
  json(ctx.res, {
    success: true,
    sent,
    warnings: errors,
    message: `Sent via ${sentChannels.join(" + ")}`,
  });
  return true;
}

module.exports = {
  normalizeAdminMessageBody,
  validateAdminMessageRequest,
  buildAdminMessageAuditWriter,
  deliverAdminMessage,
  summarizeSentChannels,
  processAdminMessageRequest,
};
