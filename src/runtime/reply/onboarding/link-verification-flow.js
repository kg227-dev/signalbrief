const {
  normalizeEmail,
  generateVerificationCode,
  validateCodeInput,
} = require("./keys");
const {
  createPendingVerification,
  withPendingVerificationAttempts,
} = require("./pending-verification");
const { verificationPrompt, linkSuccessMessage } = require("./messages");

async function beginLinkVerificationFlow({
  chatId,
  user,
  context,
}) {
  const email = normalizeEmail(user?.email);
  if (!email) {
    await context.messaging.send(
      chatId,
      "I couldn't start verification because this account has no email on file. Contact support."
    );
    return false;
  }

  const code = generateVerificationCode();
  context.pending.set(chatId, createPendingVerification({
    email,
    code,
    expiresAt: Date.now() + context.linkVerifyTtlMs,
  }));

  try {
    await context.accounts.sendVerificationEmail(email, code);
  } catch (err) {
    context.pending.delete(chatId);
    await context.messaging.send(
      chatId,
      `I couldn't send the verification code right now (${err.message}). Try again in a minute.`
    );
    return false;
  }

  await context.messaging.send(chatId, verificationPrompt(email));
  return true;
}

async function completeLinkVerificationFlow({
  chatId,
  codeRaw,
  context,
  maxAttempts = 5,
}) {
  const pending = context.pending.get(chatId) || null;
  if (!pending) {
    await context.messaging.send(chatId, "No pending verification request. Start with `/start your@email.com`.");
    return;
  }

  if (Date.now() > pending.expiresAt) {
    context.pending.delete(chatId);
    await context.messaging.send(chatId, "That verification code expired. Run `/start your@email.com` again to get a new code.");
    return;
  }

  const codeInput = validateCodeInput(codeRaw);
  if (!codeInput.ok) {
    await context.messaging.send(chatId, codeInput.message);
    return;
  }
  if (codeInput.code !== pending.code) {
    const attempts = Math.max(0, Number(pending.attempts || 0)) + 1;
    if (attempts >= Math.max(1, Number(maxAttempts || 5))) {
      context.pending.delete(chatId);
      await context.messaging.send(chatId, "Too many incorrect attempts. Start again with `/start your@email.com`.");
      return;
    }
    context.pending.set(chatId, withPendingVerificationAttempts(pending, attempts));
    await context.messaging.send(chatId, "That code doesn't match. Check your email and try again.");
    return;
  }

  const existingUser = context.accounts.findByEmail(pending.email);
  if (!existingUser) {
    context.pending.delete(chatId);
    await context.messaging.send(chatId, "I couldn't find that account anymore. Try `/start your@email.com`.");
    return;
  }

  const updatedUser = context.accounts.relink(existingUser, chatId);
  context.pending.delete(chatId);
  context.awaiting.delete(chatId);
  await context.messaging.send(chatId, linkSuccessMessage(updatedUser, context.formatDeliveryTime));
}

module.exports = {
  beginLinkVerificationFlow,
  completeLinkVerificationFlow,
};
