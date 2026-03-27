const { USER_STATUS } = require("../user-contract-runtime");
const {
  createReplyCommandHandlers: createReplyCommandHandlersCore,
} = require("./reply-command-handlers-core-runtime");

function buildActiveTelegramUser(user) {
  const nowIso = new Date().toISOString();
  const safeUser = user && typeof user === "object" ? user : {};
  const { telegram, ...restUser } = safeUser;
  const safePreferences = safeUser.preferences && typeof safeUser.preferences === "object"
    ? safeUser.preferences
    : {};
  const { telegram_enabled, ...restPreferences } = safePreferences;
  return {
    ...restUser,
    status: USER_STATUS.ACTIVE,
    joined_at: safeUser.joined_at || nowIso,
    preferences: { ...restPreferences },
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
