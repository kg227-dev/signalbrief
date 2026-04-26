"use strict";

const assert = require("assert");
const {
  hasScheduledDeliveryChannel,
  resolveDueUsers,
} = require("./digest-orchestrator-schedule-runtime");

assert.strictEqual(
  hasScheduledDeliveryChannel({
    chatId: "12345",
    preferences: { telegram_enabled: true, email_enabled: false },
  }),
  false,
  "telegram-only users must not count as schedulable in the email-only MVP"
);

assert.strictEqual(
  hasScheduledDeliveryChannel({
    email: "user@example.com",
    preferences: { email_enabled: true, telegram_enabled: true },
  }),
  true,
  "email-enabled users should remain schedulable"
);

const fixedNow = new Date("2026-03-25T12:00:00.000Z");
const result = resolveDueUsers({
  targetChatId: null,
  allUsers() {
    return [
      {
        chatId: "telegram-only",
        status: "active",
        topics: ["HEALTHCARE"],
        preferences: { telegram_enabled: true, email_enabled: false, delivery_time: "07:00", days_of_week: [3] },
      },
      {
        chatId: "email-user",
        email: "user@example.com",
        status: "active",
        topics: ["HEALTHCARE"],
        preferences: { email_enabled: true, delivery_time: "07:00", days_of_week: [3] },
      },
    ];
  },
  USER_STATUS: { ACTIVE: "active" },
  getEtNow() {
    return fixedNow;
  },
  getEtNowParts() {
    return {
      todayET: "2026-03-25",
      todayDOW: 3,
      nowMinutes: 7 * 60,
      hour: 7,
      minute: 0,
    };
  },
  toEtDateString() {
    return "";
  },
  CONFIG: { digest: { catchupWindowMinutes: 60 } },
  scheduledTopicAllowlist: ["HEALTHCARE"],
  log() {},
});

assert.deepStrictEqual(
  result.dueUsers.map((user) => user.chatId),
  ["email-user"],
  "scheduled resolution must exclude telegram-only users from the active path"
);

const scopeFilteredResult = resolveDueUsers({
  targetChatId: null,
  allUsers() {
    return [
      {
        chatId: "healthcare-user",
        email: "healthcare@example.com",
        status: "active",
        topics: ["HEALTHCARE"],
        preferences: { email_enabled: true, delivery_time: "07:00", days_of_week: [3] },
      },
      {
        chatId: "mixed-user",
        email: "mixed@example.com",
        status: "active",
        topics: ["LIFE SCIENCES", "TECHNOLOGY"],
        preferences: { email_enabled: true, delivery_time: "07:00", days_of_week: [3] },
      },
    ];
  },
  USER_STATUS: { ACTIVE: "active" },
  getEtNow() {
    return fixedNow;
  },
  getEtNowParts() {
    return {
      todayET: "2026-03-25",
      todayDOW: 3,
      nowMinutes: 7 * 60,
      hour: 7,
      minute: 0,
    };
  },
  toEtDateString() {
    return "";
  },
  CONFIG: { digest: { catchupWindowMinutes: 60 } },
  scheduledTopicAllowlist: ["HEALTHCARE", "LIFE SCIENCES"],
  log() {},
});

assert.deepStrictEqual(
  scopeFilteredResult.dueUsers.map((user) => user.chatId),
  ["healthcare-user"],
  "scheduled resolution must exclude mixed-topic users when topic scope is narrowed"
);

console.log("schedule runtime enforces email-only MVP delivery channels ✓");
