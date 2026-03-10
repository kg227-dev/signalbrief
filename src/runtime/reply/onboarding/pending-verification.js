// @ts-check
/** @typedef {import("../../runtime-types").PendingVerification} PendingVerification */

/**
 * @param {Partial<PendingVerification>|Record<string, any>} input
 * @returns {PendingVerification}
 */
function createPendingVerification(input) {
  const raw = input && typeof input === "object" ? input : {};
  return {
    email: String(raw.email || "").toLowerCase().trim(),
    code: String(raw.code || "").trim(),
    expiresAt: Math.max(0, Number(raw.expiresAt || 0)),
    attempts: Math.max(0, Number(raw.attempts || 0)),
    resend_after_ts: Math.max(0, Number(raw.resend_after_ts || 0)),
  };
}

/**
 * @param {PendingVerification} pending
 * @param {number} attempts
 * @returns {PendingVerification}
 */
function withPendingVerificationAttempts(pending, attempts) {
  return createPendingVerification({
    ...pending,
    attempts: Math.max(0, Number(attempts || 0)),
  });
}

/**
 * @param {PendingVerification} pending
 * @param {number} resendAfterTs
 * @returns {PendingVerification}
 */
function withPendingVerificationResendAfter(pending, resendAfterTs) {
  return createPendingVerification({
    ...pending,
    resend_after_ts: Math.max(0, Number(resendAfterTs || 0)),
    attempts: 0,
  });
}

module.exports = {
  createPendingVerification,
  withPendingVerificationAttempts,
  withPendingVerificationResendAfter,
};
