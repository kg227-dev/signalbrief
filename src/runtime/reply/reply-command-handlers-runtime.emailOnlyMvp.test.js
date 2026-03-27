"use strict";

const assert = require("assert");
const {
  buildActiveTelegramUser,
  refreshActiveTelegramUser,
} = require("./reply-command-handlers-runtime");

{
  const updated = buildActiveTelegramUser({
    status: "paused",
    joined_at: "2026-03-01T00:00:00.000Z",
    telegram: "@old",
    preferences: {
      email_enabled: true,
      telegram_enabled: true,
    },
  });
  assert.strictEqual(updated.status, "active");
  assert.strictEqual(updated.preferences.email_enabled, true);
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(updated.preferences, "telegram_enabled"),
    false,
    "helper must strip deprecated telegram_enabled in email-only MVP"
  );
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(updated, "telegram"),
    false,
    "helper must strip deprecated top-level telegram field"
  );
}

{
  let writeArgs = null;
  const refreshed = refreshActiveTelegramUser("chat-1", {
    status: "paused",
    preferences: {
      email_enabled: true,
    },
  }, (chatId, payload) => {
    writeArgs = { chatId, payload };
  });
  assert.strictEqual(refreshed.status, "active");
  assert.ok(writeArgs);
  assert.strictEqual(writeArgs.chatId, "chat-1");
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(writeArgs.payload.preferences, "telegram_enabled"),
    false,
    "refresh helper must not reintroduce telegram_enabled in email-only MVP"
  );
  console.log("reply command handler helpers avoid reintroducing telegram_enabled ✓");
}
