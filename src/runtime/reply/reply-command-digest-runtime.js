"use strict";

const { queueDigestTrigger: queueDigestTriggerRuntime } = require("../../jobs/digest-runner-runtime");

function createDigestCommandHandler(deps) {
  const {
    state,
    send,
    allUsers,
    USER_STATUS,
    queueDigestTrigger,
  } = deps;
  const queueDigest = typeof queueDigestTrigger === "function"
    ? queueDigestTrigger
    : queueDigestTriggerRuntime;

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

    if (replyState.digestInflight.has(chatKey)) {
      await send(chatId, "⏳ Your digest request is already in progress. I will send it as soon as it is ready.");
      return;
    }
    replyState.digestInflight.add(chatKey);
    try {
      await send(chatId, "⏳ Pulling your digest now — takes about 45 seconds...");
      const outcome = await queueDigest({
        source: "telegram:on_demand",
        trigger: "telegram_command_digest",
        chatId,
        enforceOnDemandCooldown: true,
        maxAdmissionWaitMs: 90 * 1000,
      });
      if (!outcome.ok) {
        if (outcome.cooldown) {
          const remainingMs = Math.max(0, Number(outcome.cooldownRemainingMs || 0));
          const minsLeft = Math.max(1, Math.ceil(remainingMs / 60000));
          await send(chatId, `⏱ Your last on-demand digest was recent. Try again in ${minsLeft} min${minsLeft !== 1 ? "s" : ""}.`);
          return;
        }
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
