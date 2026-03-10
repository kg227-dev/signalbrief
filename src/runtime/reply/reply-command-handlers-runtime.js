const { USER_STATUS } = require("../user-contract-runtime");
const {
  createReplyCommandHandlers: createReplyCommandHandlersCore,
} = require("./reply-command-handlers-core-runtime");

function buildActiveTelegramUser(user) {
  const nowIso = new Date().toISOString();
  return {
    ...user,
    status: USER_STATUS.ACTIVE,
    joined_at: user.joined_at || nowIso,
    preferences: { ...(user.preferences || {}), telegram_enabled: true },
    last_updated: nowIso,
  };
}

function refreshActiveTelegramUser(chatId, user, writeUser) {
  const refreshed = buildActiveTelegramUser(user);
  if (typeof writeUser === "function") {
    writeUser(chatId, refreshed);
  }
  return refreshed;
}

function createReplyCommandHandlers(args) {
  return createReplyCommandHandlersCore(args);
}

module.exports = {
  createReplyCommandHandlers,
  buildActiveTelegramUser,
  refreshActiveTelegramUser,
};
