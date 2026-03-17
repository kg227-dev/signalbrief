const { USER_STATUS } = require("../user-contract-runtime");
const { createDigestCommandHandler } = require("./reply-command-digest-runtime");
const { createOnboardingCommandHandlers } = require("./reply-command-onboarding-runtime");
const { createEngagementCommandHandlers } = require("./reply-command-engagement-runtime");

function createReplyCommandHandlers({
  state,
  send,
  userStore,
  runtimeConfig,
  onboarding,
  taxonomy,
}) {
  const {
    readUser,
    writeUser,
    allUsers,
    generateToken,
  } = userStore;
  const {
    getConfig,
    getBaseUrl,
    formatDeliveryTime,
    sendWelcomeEmail,
    isReplyHandlerDebug,
  } = runtimeConfig;
  const { onboardingService } = onboarding;
  const { standardTopics } = taxonomy;

  const { handleDigest } = createDigestCommandHandler({
    state,
    send,
    allUsers,
    USER_STATUS,
  });

  const {
    handleStart,
    handleEmailCapture,
  } = createOnboardingCommandHandlers({
    send,
    readUser,
    writeUser,
    allUsers,
    generateToken,
    getConfig,
    getBaseUrl,
    formatDeliveryTime,
    sendWelcomeEmail,
    isReplyHandlerDebug,
    onboardingService,
    USER_STATUS,
  });

  const {
    handleSave,
    handleTopicMore,
    handleTopicLess,
    handleDigestFeedback,
    handleTopicAdd,
    handleSourceBlock,
    handleSourceTrust,
    handleSourceUnblock,
    handleCallback,
  } = createEngagementCommandHandlers({
    send,
    readUser,
    writeUser,
    standardTopics,
  });

  return {
    handleDigest,
    handleStart,
    handleEmailCapture,
    handleSave,
    handleTopicMore,
    handleTopicLess,
    handleDigestFeedback,
    handleTopicAdd,
    handleSourceBlock,
    handleSourceTrust,
    handleSourceUnblock,
    handleCallback,
  };
}

module.exports = {
  createReplyCommandHandlers,
};
