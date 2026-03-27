const { createSignupHandler } = require("./web-user-signup-runtime");
const { createSettingsHandler } = require("./web-user-settings-runtime");
const { createAdminRunDigestHandler } = require("./web-user-admin-runtime");

function createWebUserHandlers(deps) {
  const {
    requireJsonBody,
    json,
    getClientIp,
    checkRateLimit,
    checkSettingsRateLimit,
    allUsers,
    findUserByToken,
    normalizeReferralToken,
    generateToken,
    writeUser,
    sendReferralThankYou,
    sendWelcomeEmail,
    startDigestTrigger,
    BASE_URL,
    getBaseUrl,
    DEFAULT_TOPICS,
    MAX_CUSTOM_KEYWORDS,
    allowExampleEmails,
    PROTECTED_FIELDS,
    isAdminAuthed,
    logAdminActionEvent,
  } = deps;

  const resolveBaseUrl = typeof getBaseUrl === "function"
    ? () => String(getBaseUrl() || "http://localhost:3003")
    : () => String(BASE_URL || "http://localhost:3003");

  function toRouteCtx(ctxOrReq, maybeRes) {
    if (ctxOrReq && typeof ctxOrReq === "object" && ctxOrReq.req && ctxOrReq.res) {
      return ctxOrReq;
    }
    return { req: ctxOrReq, res: maybeRes };
  }

  const handleSignup = createSignupHandler({
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
    MAX_CUSTOM_KEYWORDS,
    allowExampleEmails,
  });

  const handleSettings = createSettingsHandler({
    toRouteCtx,
    requireJsonBody,
    json,
    getClientIp,
    checkSettingsRateLimit,
    findUserByToken,
    allUsers,
    writeUser,
    DEFAULT_TOPICS,
    MAX_CUSTOM_KEYWORDS,
    PROTECTED_FIELDS,
  });

  const handleAdminRunDigest = createAdminRunDigestHandler({
    toRouteCtx,
    json,
    isAdminAuthed,
    requireJsonBody,
    allUsers,
    startDigestTrigger,
    logAdminActionEvent,
  });

  return {
    handleSignup,
    handleSettings,
    handleAdminRunDigest,
  };
}

module.exports = {
  createWebUserHandlers,
};
