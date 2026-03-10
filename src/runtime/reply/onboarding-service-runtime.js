// @ts-check
/** @typedef {import("../runtime-types").OnboardingDeps} OnboardingDeps */
const {
  withPendingVerificationResendAfter,
} = require("./onboarding/pending-verification");
const {
  createOnboardingVerificationContext,
} = require("./onboarding/onboarding-context");
const {
  beginLinkVerificationFlow,
  completeLinkVerificationFlow,
} = require("./onboarding/link-verification-flow");

const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_VERIFY_ATTEMPTS = 5;

/**
 * @param {OnboardingDeps} deps
 */
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

  const verificationContext = createOnboardingVerificationContext({
    state,
    linkVerifyTtlMs,
    sendMessage,
    sendVerificationEmail,
    findUserByEmail,
    relinkUserToChat,
    formatDeliveryTime,
  });

  function setAwaitingEmail(chatId, enabled) {
    verificationContext.awaiting.set(chatId, enabled);
  }

  function isAwaitingEmail(chatId) {
    return verificationContext.awaiting.has(chatId);
  }

  function clearAllPending(chatId) {
    verificationContext.awaiting.delete(chatId);
    verificationContext.pending.delete(chatId);
  }

  async function startLinkVerification(chatId, user) {
    const pending = verificationContext.pending.get(chatId);
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
      context: verificationContext,
    });
    if (!started) return false;

    const nextPending = verificationContext.pending.get(chatId);
    if (nextPending && typeof nextPending === "object") {
      verificationContext.pending.set(
        chatId,
        withPendingVerificationResendAfter(nextPending, now + RESEND_COOLDOWN_MS)
      );
    }
    return true;
  }

  async function handleVerifyLink(chatId, codeRaw) {
    return completeLinkVerificationFlow({
      chatId,
      codeRaw,
      context: verificationContext,
      maxAttempts: MAX_VERIFY_ATTEMPTS,
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
