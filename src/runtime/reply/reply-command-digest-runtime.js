"use strict";

const { queueDigestTrigger } = require("../../jobs/digest-runner-runtime");

function createDigestCommandHandler(deps) {
  const {
    state,
    send,
    allUsers,
    USER_STATUS,
  } = deps;

  function currentState() {
    return typeof state === "function" ? state() : state;
  }

  async function handleDigest(chatId) {
    const replyState = currentState();
    const chatKey = String(chatId);
    const linkedUser = allUsers().find((user) => String(user.chatId) === String(chatId));
    if (!linkedUser) {
      await send(chatId, "I couldn't find an account linked to this chat yet. Send /start and share your email to link your account.");
      return;
    }
    if (linkedUser.status !== USER_STATUS.ACTIVE) {
      await send(chatId, `Your account is currently *${linkedUser.status}*. Send /start to re-link or reactivate before requesting a digest.`);
      return;
    }

    const now = Date.now();
    if (replyState.digestInflight.has(chatKey)) {
      await send(chatId, "⏳ Your digest request is already in progress. I will send it as soon as it is ready.");
      return;
    }
    const cooldownEnd = replyState.digestCooldown.get(chatKey);
    if (cooldownEnd && cooldownEnd > now) {
      const minsLeft = Math.ceil((cooldownEnd - now) / 60000);
      await send(chatId, `⏱ Your last on-demand digest was recent. Try again in ${minsLeft} min${minsLeft !== 1 ? "s" : ""}.`);
      return;
    }

    replyState.digestInflight.add(chatKey);
    try {
      await send(chatId, "⏳ Pulling your digest now — takes about 45 seconds...");
      const outcome = await queueDigestTrigger({
        source: "telegram:on_demand",
        trigger: "telegram_command_digest",
        chatId,
        maxAdmissionWaitMs: 90 * 1000,
      });
      if (!outcome.ok) {
        if (outcome.busy) {
          await send(chatId, "⏱ Another digest run is in progress right now. Try again in a minute.");
          return;
        }
        if (outcome.lockUnhealthy) {
          await send(chatId, "⚠️ Digest delivery is temporarily paused due to a runner lock issue. Please try again shortly.");
          return;
        }
        await send(chatId, "❌ Failed to trigger digest. Please try /digest again in a moment.");
        return;
      }
      replyState.digestCooldown.set(chatKey, Date.now() + 15 * 60 * 1000);
    } catch (error) {
      await send(chatId, `❌ Failed to trigger digest: ${error.message}`);
    } finally {
      replyState.digestInflight.delete(chatKey);
    }
  }

  return {
    handleDigest,
  };
}

module.exports = {
  createDigestCommandHandler,
};
