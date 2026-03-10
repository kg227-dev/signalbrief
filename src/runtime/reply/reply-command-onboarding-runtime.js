"use strict";

const { queueDigestTrigger } = require("../../jobs/digest-runner-runtime");

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
    return {
      ...user,
      status: USER_STATUS.ACTIVE,
      joined_at: user.joined_at || nowIso,
      preferences: { ...(user.preferences || {}), telegram_enabled: true },
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
        await send(chatId, `${lead} Your digest arrives at *${formatDeliveryTime(refreshed.preferences)}* on weekdays.\n\n💾 save [#] · 📊 more/less [topic] · ⚙️ /settings`);
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
        await send(chatId, `${intro} You've received *${refreshed.digests_received}* digests so far.\n\nUse /settings to update your preferences or /bookmarks to see saved items.`);
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
      await send(chatId, `Welcome back! You've received *${user.digests_received}* digests so far.\n\nUse /settings to update your preferences or /bookmarks to see saved items.`);
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
          + `Digest arrives at *${formatDeliveryTime(existing.preferences)}*. Or:\n⚡ /digest · 💾 save [#] · ⚙️ /settings`,
      );
      return;
    }

    const userToken = generateToken();
    const user = {
      chatId,
      email,
      name: email.split("@")[0],
      telegram: null,
      token: userToken,
      topics: (getConfig().topics || []).slice(0, 5).map((topic) => topic.tag),
      status: USER_STATUS.ACTIVE,
      joined_at: new Date().toISOString(),
      last_updated: new Date().toISOString(),
      digests_received: 0,
      bookmarks: [],
      topic_weights: {},
      custom_topics: [],
      digest_dates: [],
      last_digest_items: [],
      preferences: {
        depth: "headline_plus_why",
        delivery_time: "07:00",
        frequency: "daily_weekday",
        days_of_week: [1, 2, 3, 4, 5],
        items_per_digest: 5,
        timezone: "America/New_York",
        email_enabled: true,
        telegram_enabled: true,
      },
    };
    writeUser(chatId, user);

    sendWelcomeEmail(user).catch((error) => console.error("[welcome email]", error));

    queueDigestTrigger({
      source: "telegram:signup_welcome",
      trigger: "telegram_signup_welcome",
      chatId,
      maxAdmissionWaitMs: 10 * 60 * 1000,
      env: { BASE_URL: getBaseUrl() },
    }).then((outcome) => {
      if (!outcome.ok && isReplyHandlerDebug()) {
        console.warn(`[reply-handler] welcome digest skipped for ${chatId}: ${outcome.code || "unknown"}`);
      }
    }).catch((error) => {
      console.error(`[reply-handler] welcome digest failed for ${chatId}: ${error.message}`);
    });

    const settingsUrl = `${getBaseUrl()}/settings?token=${userToken}`;
    await send(
      chatId,
      "✅ *You're in!*\n\n"
        + "Sending your first digest now — 7 signals across strategy, AI, and business.\n\n"
        + `🔗 [Manage preferences](${settingsUrl})\n\n`
        + "💾 save [#] · 📊 more/less [topic] · ⚙️ /settings",
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
