const {
  sendReferralThankYouEmail,
  sendReengagementDay4EmailForUser,
  sendReengagementDay8EmailForUser,
  sendAutoPauseConfirmationEmailForUser,
} = require("./mailer/lifecycle/lifecycle-senders");
const { sendWelcomeEmailForUser } = require("./mailer/lifecycle/welcome-sender");

function createSharedDeps(deps) {
  return {
    sendEmail: deps.sendEmail,
    getBaseUrl: deps.getBaseUrl,
    loadWelcomeTemplate: deps.loadWelcomeTemplate,
    normalizeBaseUrl: deps.normalizeBaseUrl,
    buildMailResult: deps.buildMailResult,
  };
}

function createLifecycleMailer(deps) {
  const sharedDeps = createSharedDeps(deps);
  return {
    sendReferralThankYou: (referrerUser, newUser) => sendReferralThankYouEmail(referrerUser, newUser, sharedDeps),
    sendReengagementDay4Email: (user) => sendReengagementDay4EmailForUser(user, sharedDeps),
    sendReengagementDay8Email: (user) => sendReengagementDay8EmailForUser(user, sharedDeps),
    sendAutoPauseConfirmationEmail: (user) => sendAutoPauseConfirmationEmailForUser(user, sharedDeps),
    sendWelcomeEmail: (user) => sendWelcomeEmailForUser(user, sharedDeps),
  };
}

module.exports = {
  createLifecycleMailer,
};
