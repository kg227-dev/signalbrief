"use strict";

const assert = require("assert");
const { createOnboardingCommandHandlers } = require("./reply-command-onboarding-runtime");

(async () => {
  const messages = [];
  const writes = [];
  const welcomeCalls = [];
  const onboardingService = {
    clearAllPending() {},
    setAwaitingEmail() {},
    startLinkVerification: async () => {
      throw new Error("unexpected link verification");
    },
  };

  const handlers = createOnboardingCommandHandlers({
    send: async (chatId, text) => {
      messages.push({ chatId, text });
    },
    readUser: () => ({}),
    writeUser: (_chatId, payload) => {
      writes.push(payload);
    },
    allUsers: () => [],
    generateToken: () => "tok-123",
    getConfig: () => ({
      topics: [
        { tag: "TECHNOLOGY" },
        { tag: "HEALTHCARE" },
        { tag: "ENERGY" },
        { tag: "INDUSTRIALS" },
      ],
    }),
    getBaseUrl: () => "https://getsignalbrief.com",
    formatDeliveryTime: () => "7:00 AM ET",
    sendWelcomeEmail: async (user) => {
      welcomeCalls.push(user.email);
    },
    isReplyHandlerDebug: () => false,
    onboardingService,
    USER_STATUS: { ACTIVE: "active" },
  });

  await handlers.handleEmailCapture("chat-1", "person@example.org");

  assert.strictEqual(writes.length, 1);
  const created = writes[0];
  assert.deepStrictEqual(created.topics, ["TECHNOLOGY", "HEALTHCARE", "ENERGY"]);
  assert.strictEqual(created.preferences.email_enabled, true);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(created.preferences, "telegram_enabled"), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(created.preferences, "items_per_digest"), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(created, "telegram"), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(created, "bookmarks"), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(created, "topic_weights"), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(created, "custom_topics"), false);
  assert.deepStrictEqual(welcomeCalls, ["person@example.org"]);
  assert.strictEqual(messages.length, 1);
  assert.ok(
    messages[0].text.includes("SignalBrief is email-only in the reduced-scope MVP"),
    "onboarding confirmation should no longer promise an immediate Telegram-triggered digest"
  );
  console.log("reply onboarding creates email-only MVP users without legacy telegram fields ✓");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
