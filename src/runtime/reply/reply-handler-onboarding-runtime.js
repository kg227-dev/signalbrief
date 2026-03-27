"use strict";

const fs = require("fs");
const path = require("path");
const { sendEmail: sendEmailViaMailer } = require("../mailer/mailer-runtime");
const { createOnboardingService } = require("./onboarding-service");
const { resolveSignalBriefRuntimePaths } = require("../runtime-state-paths-runtime");

function createReplyOnboardingService(deps) {
  const {
    options,
    state,
    appRoot,
    linkVerifyTtlMs,
    send,
    allUsers,
    writeUser,
    USER_STATUS,
    formatDeliveryTime,
  } = deps;

  async function sendLinkVerificationEmail(email, code) {
    if (typeof options.sendLinkVerificationEmail === "function") {
      return options.sendLinkVerificationEmail(email, code);
    }
    const target = String(email || "").toLowerCase().trim();
    const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:540px;margin:0 auto;padding:32px 22px;color:#111;">
        <div style="font-size:22px;font-weight:700;margin-bottom:10px;">☀️ SignalBrief</div>
        <div style="font-size:15px;color:#374151;line-height:1.6;margin-bottom:14px;">
          Someone requested to link a Telegram chat to your SignalBrief account.
        </div>
        <div style="font-size:14px;color:#6B7280;margin-bottom:8px;">Verification code (expires in 10 minutes):</div>
        <div style="font-size:32px;letter-spacing:0.08em;font-weight:700;color:#2563EB;margin-bottom:14px;">${code}</div>
        <div style="font-size:14px;color:#374151;line-height:1.6;">
          In Telegram, reply with: <strong>/verify ${code}</strong><br>
          If this wasn't you, ignore this email.
        </div>
      </div>`;
    const result = await sendEmailViaMailer(target, "Your SignalBrief verification code", html);
    if (!result.ok) throw new Error(`verification email failed via ${result.via || "mailer"}`);
  }

  function relinkExistingUserToChat(existing, chatId) {
    const oldChatId = existing.chatId;
    const safeExisting = existing && typeof existing === "object" ? existing : {};
    const { telegram, ...restExisting } = safeExisting;
    const safePreferences = safeExisting.preferences && typeof safeExisting.preferences === "object"
      ? safeExisting.preferences
      : {};
    const { telegram_enabled, ...restPreferences } = safePreferences;
    const updated = {
      ...restExisting,
      chatId,
      status: USER_STATUS.ACTIVE,
      joined_at: safeExisting.joined_at || new Date().toISOString(),
      preferences: { ...restPreferences },
      last_updated: new Date().toISOString(),
    };
    writeUser(chatId, updated);
    if (oldChatId && String(oldChatId) !== String(chatId)) {
      const oldFile = path.join(
        resolveSignalBriefRuntimePaths({ appRoot, env: process.env }).dataDir,
        `user-${oldChatId}.json`
      );
      if (fs.existsSync(oldFile)) fs.unlinkSync(oldFile);
    }
    return updated;
  }

  function findUserByEmail(email) {
    const lookup = String(email || "").toLowerCase().trim();
    if (!lookup) return null;
    return allUsers().find((user) => String(user.email || "").toLowerCase().trim() === lookup) || null;
  }

  return createOnboardingService({
    state,
    linkVerifyTtlMs,
    sendMessage: send,
    sendVerificationEmail: sendLinkVerificationEmail,
    findUserByEmail,
    relinkUserToChat: relinkExistingUserToChat,
    formatDeliveryTime,
  });
}

module.exports = {
  createReplyOnboardingService,
};
