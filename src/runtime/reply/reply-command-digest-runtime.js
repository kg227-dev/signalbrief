"use strict";

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

    if (replyState.digestInflight.has(chatKey)) {
      await send(chatId, "⏳ Your digest request is already in progress. I will send it as soon as it is ready.");
      return;
    }
    await send(
      chatId,
      "Email-only MVP mode is active. On-demand Telegram digests are disabled; your scheduled digest will arrive by email at the time in /settings."
    );
  }

  return {
    handleDigest,
  };
}

module.exports = {
  createDigestCommandHandler,
};
