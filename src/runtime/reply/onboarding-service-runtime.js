const { chatKey, validateCodeInput } = require("./onboarding/keys");
const {
  beginLinkVerificationFlow,
  completeLinkVerificationFlow,
} = require("./onboarding/link-verification-flow");

const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_VERIFY_ATTEMPTS = 5;

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

  function pendingByChatId() {
    return currentState().pendingLinkVerifications;
  }

  function awaitingByChatId() {
    return currentState().awaitingEmail;
  }

  function setAwaitingEmail(chatId, enabled) {
    const pending = awaitingByChatId();
    if (enabled) pending.set(chatId, true);
    else pending.delete(chatId);
  }

  function isAwaitingEmail(chatId) {
    return awaitingByChatId().has(chatId);
  }

  function clearAllPending(chatId) {
    awaitingByChatId().delete(chatId);
    pendingByChatId().delete(chatKey(chatId));
  }

  async function startLinkVerification(chatId, user) {
    const key = chatKey(chatId);
    const pending = pendingByChatId().get(key) || null;
    const now = Date.now();
    const email = String(user?.email || "").toLowerCase().trim();
    const sameEmailPending = pending
      && String(pending.email || "").toLowerCase().trim() === email
      && Number(pending.expiresAt || 0) > now;
    const inCooldown = sameEmailPending && Number(pending.resend_after_ts || 0) > now;
    if (inCooldown) {
      await sendMessage(chatId, "A verification code was just sent. Check your email and try `/verify 123456`.");
      return true;
    }

    const started = await beginLinkVerificationFlow({
      chatId,
      user,
      linkVerifyTtlMs,
      pendingByChatId: pendingByChatId(),
      sendMessage,
      sendVerificationEmail,
    });
    if (!started) return false;

    const next = pendingByChatId().get(key);
    if (next && typeof next === "object") {
      pendingByChatId().set(key, {
        ...next,
        attempts: 0,
        resend_after_ts: now + RESEND_COOLDOWN_MS,
      });
    }
    return true;
  }

  async function handleVerifyLink(chatId, codeRaw) {
    const key = chatKey(chatId);
    const pending = pendingByChatId().get(key) || null;
    if (pending && typeof pending === "object" && Number(pending.expiresAt || 0) > Date.now()) {
      const codeInput = validateCodeInput(codeRaw);
      if (codeInput.ok && codeInput.code !== pending.code) {
        const attempts = Math.max(0, Number(pending.attempts || 0)) + 1;
        if (attempts >= MAX_VERIFY_ATTEMPTS) {
          pendingByChatId().delete(key);
          await sendMessage(chatId, "Too many incorrect attempts. Start again with `/start your@email.com`.");
          return;
        }
        pendingByChatId().set(key, {
          ...pending,
          attempts,
        });
      }
    }

    return completeLinkVerificationFlow({
      chatId,
      codeRaw,
      pendingByChatId: pendingByChatId(),
      awaitingByChatId: awaitingByChatId(),
      sendMessage,
      findUserByEmail,
      relinkUserToChat,
      formatDeliveryTime,
    });
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
