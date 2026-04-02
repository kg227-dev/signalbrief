const { isDebugWebServerEnabled } = require("../server-runtime-env-runtime");
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
  resolveBaseUrl,
  DEFAULT_TOPICS,
  allowExampleEmails,
}) {
  return async function handleSignup(ctxOrReq, maybeRes) {
    const { req, res } = toRouteCtx(ctxOrReq, maybeRes);
    const body = await requireJsonBody(req, res);
    if (body == null) return;

    const parsedInput = parseSignupInput({
      body,
      normalizeReferralToken,
      defaultTopics: DEFAULT_TOPICS,
      allowExampleEmails,
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
      signupReferralSource,
    });

    writeUser(chatId, user);
    console.log(`[signup] ${input.name} <${input.emailNorm}>`);
    if (referrerUser) {
      console.log(`[signup] referred by ${referrerUser.email || referrerUser.chatId}`);
    }

    const sideEffectFailures = await runSignupSideEffects({
      user,
      referrerUser,
      sendReferralThankYou,
      sendWelcomeEmail,
    });
    if (sideEffectFailures.length && isDebugWebServerEnabled()) {
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
