function createOnboardingService(deps) {
  const {
    state,
    linkVerifyTtlMs,
    sendMessage,
    sendVerificationEmail,
    findUserByEmail,
    relinkUserToChat,
    formatDeliveryTime,
  } = deps;

  function currentState() {
    return typeof state === "function" ? state() : state;
  }

  function pendingMap() {
    return currentState().pendingLinkVerifications;
  }

  function awaitingMap() {
    return currentState().awaitingEmail;
  }

  function setAwaitingEmail(chatId, enabled) {
    if (enabled) awaitingMap().set(chatId, true);
    else awaitingMap().delete(chatId);
  }

  function isAwaitingEmail(chatId) {
    return awaitingMap().has(chatId);
  }

  function clearAllPending(chatId) {
    awaitingMap().delete(chatId);
    pendingMap().delete(String(chatId));
  }

  function generateVerificationCode() {
    return String(Math.floor(100000 + Math.random() * 900000));
  }

  async function startLinkVerification(chatId, user) {
    const email = String(user?.email || "").toLowerCase().trim();
    if (!email) {
      await sendMessage(chatId, "I couldn't start verification because this account has no email on file. Contact support.");
      return false;
    }

    const code = generateVerificationCode();
    pendingMap().set(String(chatId), {
      email,
      code,
      expiresAt: Date.now() + linkVerifyTtlMs,
    });

    try {
      await sendVerificationEmail(email, code);
    } catch (e) {
      pendingMap().delete(String(chatId));
      await sendMessage(chatId, `I couldn't send the verification code right now (${e.message}). Try again in a minute.`);
      return false;
    }

    await sendMessage(chatId,
      `🔐 I sent a 6-digit verification code to *${email}*.\n\n` +
      `Reply here with \`/verify 123456\` to link this Telegram chat to your existing account.\n\n` +
      `Code expires in 10 minutes.`
    );
    return true;
  }

  async function handleVerifyLink(chatId, codeRaw) {
    const key = String(chatId);
    const pending = pendingMap().get(key);
    if (!pending) {
      await sendMessage(chatId, "No pending verification request. Start with `/start your@email.com`.");
      return;
    }

    if (Date.now() > pending.expiresAt) {
      pendingMap().delete(key);
      await sendMessage(chatId, "That verification code expired. Run `/start your@email.com` again to get a new code.");
      return;
    }

    const code = String(codeRaw || "").trim();
    if (!/^\d{6}$/.test(code)) {
      await sendMessage(chatId, "Please provide a 6-digit code, e.g. `/verify 123456`.");
      return;
    }
    if (code !== pending.code) {
      await sendMessage(chatId, "That code doesn't match. Check your email and try again.");
      return;
    }

    const existing = findUserByEmail(pending.email);
    if (!existing) {
      pendingMap().delete(key);
      await sendMessage(chatId, "I couldn't find that account anymore. Try `/start your@email.com`.");
      return;
    }

    const updated = relinkUserToChat(existing, chatId);
    pendingMap().delete(key);
    awaitingMap().delete(chatId);

    const firstName = (updated.name || "").split(" ")[0] || "there";
    await sendMessage(chatId,
      `✅ *Verified, ${firstName}!* Telegram is now linked to your SignalBrief account.\n\n` +
      `Digest arrives at *${formatDeliveryTime(updated.preferences)}*. Or get one now:\n\n` +
      `⚡ /digest · 💾 save [#] · 📊 more/less [topic] · ⚙️ /settings`
    );
  }

  return {
    setAwaitingEmail,
    isAwaitingEmail,
    clearAllPending,
    startLinkVerification,
    handleVerifyLink,
  };
}

module.exports = {
  createOnboardingService,
};
