const {
  parseSignupInput,
  findSignupConflict,
  resolveReferralContext,
  buildSignupUser,
  runSignupSideEffects,
  buildSignupResponse,
} = require("./web-user-signup-actions-runtime");

function createSignupHandler({
  toRouteCtx,
  requireJsonBody,
  json,
  getClientIp,
  checkRateLimit,
  allUsers,
  findUserByToken,
  normalizeReferralToken,
  generateToken,
  writeUser,
  sendReferralThankYou,
  sendWelcomeEmail,
  queueDigestTrigger,
  resolveBaseUrl,
  DEFAULT_TOPICS,
}) {
  return async function handleSignup(ctxOrReq, maybeRes) {
    const { req, res } = toRouteCtx(ctxOrReq, maybeRes);
    const body = await requireJsonBody(req, res);
    if (body == null) return;

    const parsedInput = parseSignupInput({
      body,
      normalizeReferralToken,
    });
    if (!parsedInput.ok) return json(res, { error: parsedInput.error }, parsedInput.status);
    const input = parsedInput.value;

    const ip = getClientIp(req);
    const rl = checkRateLimit(ip, input.emailNorm);
    if (rl.limited) return json(res, { error: rl.reason }, 429);

    const users = allUsers();
    const conflict = findSignupConflict({
      users,
      emailNorm: input.emailNorm,
      telegramClean: input.telegramClean,
    });
    if (conflict) return json(res, { error: conflict.error }, conflict.status);

    const chatId = `email-${Date.now()}`;
    const {
      referrerUser,
      signupReferralSource,
    } = resolveReferralContext({
      referralToken: input.referralToken,
      findUserByToken,
    });

    const user = buildSignupUser({
      chatId,
      input,
      token: generateToken(),
      defaultTopics: DEFAULT_TOPICS,
      signupReferralSource,
    });

    writeUser(chatId, user);
    console.log(`[signup] ${input.name} <${input.emailNorm}>`);
    if (referrerUser) {
      console.log(`[signup] referred by ${referrerUser.email || referrerUser.chatId}`);
    }

    const sideEffectFailures = await runSignupSideEffects({
      user,
      chatId,
      referrerUser,
      sendReferralThankYou,
      sendWelcomeEmail,
      queueDigestTrigger,
      resolveBaseUrl,
    });
    if (sideEffectFailures.length && process.env.DEBUG_WEB_SERVER === "1") {
      console.warn(`[signup] side effects degraded for ${chatId}:`, sideEffectFailures);
    }

    const response = buildSignupResponse({
      user,
      chatId,
      sideEffectFailures,
      resolveBaseUrl,
    });
    return json(res, response, sideEffectFailures.length ? 202 : 200);
  };
}

module.exports = {
  createSignupHandler,
};
