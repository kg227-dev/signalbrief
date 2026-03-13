"use strict";

const { createWebUserHandlers } = require("./services/web-user-handlers");

function createSharedRouteHandlers(deps) {
  const {
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
    runDigestTrigger,
    startDigestTrigger,
    getBaseUrl,
    DEFAULT_TOPICS,
    MAX_CUSTOM_KEYWORDS,
    allowExampleSignups,
    PROTECTED_FIELDS,
    isAdminAuthed,
    logAdminActionEvent,
  } = deps;

  return createWebUserHandlers({
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
    runDigestTrigger,
    startDigestTrigger,
    getBaseUrl,
    DEFAULT_TOPICS,
    MAX_CUSTOM_KEYWORDS,
    allowExampleEmails: allowExampleSignups,
    PROTECTED_FIELDS,
    isAdminAuthed,
    logAdminActionEvent,
  });
}

module.exports = {
  createSharedRouteHandlers,
};
