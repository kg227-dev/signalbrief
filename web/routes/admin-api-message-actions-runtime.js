function normalizeAdminMessageBody(body, summarizeMessage, hashText) {
  const email = String(body.email || "").toLowerCase().trim();
  const message = String(body.message || "").trim();
  const subject = String(body.subject || "Message from SignalBrief").trim().slice(0, 140) || "Message from SignalBrief";
  const channels = Array.isArray(body.channels)
    ? body.channels.map((channel) => String(channel).toLowerCase().trim()).filter(Boolean)
    : [];
  const messagePreview = summarizeMessage(message);
  const payloadHash = hashText(message);

  return {
    email,
    message,
    subject,
    channels,
    messagePreview,
    payloadHash,
  };
}

function validateAdminMessageRequest({ email, message, channels }) {
  if (!email) return "email required";
  if (message.length < 2) return "message too short";
  if (message.length > 4000) return "message too long (max 4000 chars)";
  if (!channels.length) return "select at least one channel";
  return null;
}

function buildAdminMessageAuditWriter({
  req,
  logAdminMessageEvent,
  email,
  channels,
  subject,
  message,
  messagePreview,
  payloadHash,
}) {
  return function writeAudit(extra = {}) {
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
}

function resolveUserChannelReadiness(user, channels) {
  const prefs = user.preferences || {};
  const emailReady = !!user.email && prefs.email_enabled !== false;
  const telegramReady = !!(user.chatId && !String(user.chatId).startsWith("email-") && prefs.telegram_enabled !== false);
  return {
    wantsEmail: channels.includes("email"),
    wantsTelegram: channels.includes("telegram"),
    emailReady,
    telegramReady,
  };
}

async function deliverAdminMessage({
  user,
  message,
  subject,
  channels,
  escapeHtml,
  sendEmail,
  sendTelegramText,
}) {
  const readiness = resolveUserChannelReadiness(user, channels);
  const sent = { email: false, telegram: false };
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

  if (readiness.wantsTelegram) {
    if (!readiness.telegramReady) {
      errors.push("telegram channel not available for this user");
    } else {
      try {
        await sendTelegramText(user.chatId, `📣 SignalBrief update\n\n${message}`);
        sent.telegram = true;
      } catch (error) {
        errors.push(`telegram failed: ${error.message}`);
      }
    }
  }

  return { sent, errors };
}

function summarizeSentChannels(sent) {
  return [
    sent.email ? "email" : null,
    sent.telegram ? "telegram" : null,
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
    sendTelegramText,
  } = deps;

  const body = await requireJsonBody(ctx.req, ctx.res);
  if (body == null) return true;

  const requestData = normalizeAdminMessageBody(body, summarizeMessage, hashText);
  const {
    email,
    message,
    subject,
    channels,
  } = requestData;
  const writeAudit = buildAdminMessageAuditWriter({
    req: ctx.req,
    logAdminMessageEvent,
    email,
    channels,
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
    channels,
    escapeHtml,
    sendEmail,
    sendTelegramText,
  });
  const sentChannels = summarizeSentChannels(sent);
  if (!sent.email && !sent.telegram) {
    writeAudit({
      target_chat_id: user.chatId || null,
      sent_channels: sentChannels,
      success: false,
      errors,
    });
    json(ctx.res, { error: errors.join(" | ") || "no channels succeeded" }, 400);
    return true;
  }

  writeAudit({
    target_chat_id: user.chatId || null,
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
