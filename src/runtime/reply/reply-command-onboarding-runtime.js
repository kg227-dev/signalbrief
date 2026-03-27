"use strict";

function createOnboardingCommandHandlers(deps) {
  const {
    send,
    readUser,
    writeUser,
    allUsers,
    generateToken,
    getConfig,
    getBaseUrl,
    formatDeliveryTime,
    sendWelcomeEmail,
    isReplyHandlerDebug,
    onboardingService,
    USER_STATUS,
  } = deps;

  const allowExampleEmails = (
    String(process.env.ALLOW_EXAMPLE_SIGNUPS || "").trim() === "1"
    || String(process.env.NODE_ENV || "").toLowerCase() !== "production"
  );

  function isBlockedExampleEmail(email) {
    if (allowExampleEmails) return false;
    return /@example\.com$/i.test(String(email || "").trim());
  }

  function buildActiveTelegramUser(user) {
    const nowIso = new Date().toISOString();
    const safeUser = user && typeof user === "object" ? user : {};
    const { telegram, ...restUser } = safeUser;
    const safePreferences = safeUser.preferences && typeof safeUser.preferences === "object"
      ? safeUser.preferences
      : {};
    const { telegram_enabled, ...restPreferences } = safePreferences;
    return {
      ...restUser,
      status: USER_STATUS.ACTIVE,
      joined_at: safeUser.joined_at || nowIso,
      preferences: { ...restPreferences },
      last_updated: nowIso,
    };
  }

  function refreshActiveTelegramUser(chatId, user) {
    const refreshed = buildActiveTelegramUser(user);
    writeUser(chatId, refreshed);
    return refreshed;
  }

  async function handleStart(chatId, email) {
    onboardingService.clearAllPending(chatId);

    if (email) {
      const normalised = email.toLowerCase().trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalised)) {
        await send(chatId, "❌ That doesn't look like a valid email. Try:\n`/start you@example.com`");
        return;
      }
      if (isBlockedExampleEmail(normalised)) {
        await send(chatId, "❌ example.com emails are blocked in production. Use your real email address.");
        return;
      }

      const users = allUsers();
      const match = users.find((user) => (user.email || "").toLowerCase() === normalised);
      if (!match) {
        await handleEmailCapture(chatId, normalised);
        return;
      }
      if (match.chatId === chatId) {
        const wasInactive = (match.status || USER_STATUS.ACTIVE) !== USER_STATUS.ACTIVE;
        const refreshed = refreshActiveTelegramUser(chatId, match);
        const lead = wasInactive ? "✅ Re-activated and linked." : "✅ Already linked.";
        await send(chatId, `${lead} Your digest arrives at *${formatDeliveryTime(refreshed.preferences)}* on weekdays by email.\n\nUse ⚙️ /settings to manage your topics and delivery time.`);
        return;
      }

      await onboardingService.startLinkVerification(chatId, match);
      return;
    }

    const user = readUser(chatId);
    if (user.email) {
      const wasInactive = (user.status || USER_STATUS.ACTIVE) !== USER_STATUS.ACTIVE;
      const refreshed = refreshActiveTelegramUser(chatId, user);
      if (refreshed.digests_received > 0) {
        const intro = wasInactive ? "✅ You're active again." : "Welcome back!";
        await send(chatId, `${intro} You've received *${refreshed.digests_received}* digests so far.\n\nUse /settings to update your preferences.`);
        return;
      }
      await send(
        chatId,
        `☀️ *Welcome to SignalBrief*\n\n`
          + `Your daily signal across AI, strategy, and business — every morning at *${formatDeliveryTime(refreshed.preferences)}*.\n\n`
          + "📊 *more AI* · 📉 *less pharma* · ➕ *add topic* · ⚙️ /settings\n\n"
          + "First digest arrives at your scheduled time. See you then.",
      );
      return;
    }

    if (user.digests_received > 0) {
      await send(chatId, `Welcome back! You've received *${user.digests_received}* digests so far.\n\nUse /settings to update your preferences.`);
      return;
    }

    onboardingService.setAwaitingEmail(chatId, true);
    await send(
      chatId,
      "☀️ *Welcome to SignalBrief*\n\n"
        + "Your daily signal across AI, strategy, and business.\n\n"
        + "What's your email address? I'll create your account and send your first digest at your chosen time.",
    );
  }

  async function handleEmailCapture(chatId, text) {
    const emailMatch = text.match(/[^\s@]+@[^\s@]+\.[^\s@]+/);
    const email = emailMatch ? emailMatch[0].toLowerCase().replace(/[.,;!?]+$/, "") : "";
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      await send(chatId, "That doesn't look like a valid email. Try again — e.g. *you@gmail.com*");
      return;
    }
    if (isBlockedExampleEmail(email)) {
      await send(chatId, "❌ example.com emails are blocked in production. Please send your real email.");
      return;
    }

    onboardingService.setAwaitingEmail(chatId, false);

    const existing = allUsers().find((user) => (user.email || "").toLowerCase() === email);
    if (existing) {
      const oldChatId = existing.chatId;
      if (oldChatId !== chatId) {
        await onboardingService.startLinkVerification(chatId, existing);
        return;
      }

      const refreshed = refreshActiveTelegramUser(chatId, existing);

      const firstName = (existing.name || "").split(" ")[0] || "there";
      await send(
        chatId,
        `✅ *Linked, ${firstName}!* Your existing account is now connected to Telegram.\n\n`
          + `Digest arrives at *${formatDeliveryTime(existing.preferences)}* by email.\nUse ⚙️ /settings to manage your topics and delivery time.`,
      );
      return;
    }

    const userToken = generateToken();
    const user = {
      chatId,
      email,
      name: email.split("@")[0],
      token: userToken,
      topics: (getConfig().topics || []).slice(0, 3).map((topic) => topic.tag),
      status: USER_STATUS.ACTIVE,
      joined_at: new Date().toISOString(),
      last_updated: new Date().toISOString(),
      digests_received: 0,
      digest_dates: [],
      last_digest_items: [],
      preferences: {
        depth: "headline_plus_why",
        delivery_time: "07:00",
        frequency: "daily_weekday",
        days_of_week: [1, 2, 3, 4, 5],
        timezone: "America/New_York",
        email_enabled: true,
      },
    };
    writeUser(chatId, user);

    sendWelcomeEmail(user).catch((error) => console.error("[welcome email]", error));

    const settingsUrl = `${getBaseUrl()}/settings?token=${userToken}`;
    await send(
      chatId,
      "✅ *You're in!*\n\n"
        + "Your account is set up. SignalBrief is email-only in the reduced-scope MVP, so your digest will arrive at your scheduled time.\n\n"
        + `🔗 [Manage preferences](${settingsUrl})\n\n`
        + "Use ⚙️ /settings to manage your topics and delivery time.",
    );
  }

  return {
    handleStart,
    handleEmailCapture,
  };
}

module.exports = {
  createOnboardingCommandHandlers,
};
