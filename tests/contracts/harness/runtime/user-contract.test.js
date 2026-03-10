"use strict";

const assert = require("assert");
const path = require("path");
const { assertNodeSyntaxFile, assertModuleExports } = require("../../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/runtime/user-contract-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const userContract = require(TARGET_PATH);
assertModuleExports(() => userContract, TARGET_REL);

const { USER_STATUS, createDefaultUser, normalizeUserRecord, validateUserRecord } = userContract;
assert.strictEqual(USER_STATUS.ACTIVE, "active");
assert.strictEqual(USER_STATUS.PAUSED, "paused");
assert.strictEqual(USER_STATUS.UNSUBSCRIBED, "unsubscribed");

const defaults = createDefaultUser("chat-1", "2026-03-08T00:00:00.000Z");
assert.strictEqual(defaults.chatId, "chat-1");
assert.strictEqual(defaults.status, USER_STATUS.ACTIVE);
assert.strictEqual(defaults.preferences.delivery_time, "07:00");

const normalized = normalizeUserRecord({
  chatId: "chat-1",
  email: " USER@EXAMPLE.COM ",
  status: "PAUSED",
  token: "abc",
  topics: [" AI×TECH ", "AI×TECH", ""],
  custom_topics: ["custom_glp_1", "custom_glp_1"],
  topic_weights: { " AI×TECH ": "2.5", bad: "x" },
  preferences: {
    delivery_time: " 08:15 ",
    items_per_digest: "7.1",
    days_of_week: [1, "2", 2, 7],
    email_enabled: false,
  },
}, { chatId: "chat-1" });
assert.strictEqual(normalized.email, "user@example.com");
assert.strictEqual(normalized.status, USER_STATUS.PAUSED);
assert.strictEqual(normalized.token, "abc");
assert.deepStrictEqual(normalized.topics, ["AI×TECH"]);
assert.deepStrictEqual(normalized.custom_topics, ["custom_glp_1"]);
assert.strictEqual(normalized.topic_weights["AI×TECH"], 2.5);
assert.strictEqual(normalized.topic_weights.bad, 0);
assert.strictEqual(normalized.preferences.items_per_digest, 7);
assert.deepStrictEqual(normalized.preferences.days_of_week, [1, 2]);
assert.strictEqual(normalized.preferences.email_enabled, false);

const validation = validateUserRecord(normalized);
assert.strictEqual(validation.ok, true);

const invalidStatus = validateUserRecord({ ...normalized, status: "invalid-status" });
assert.strictEqual(invalidStatus.ok, false);
assert.ok(invalidStatus.errors.includes("status is invalid"));

const missingStatus = validateUserRecord({ ...normalized, status: "" });
assert.strictEqual(missingStatus.ok, false);
assert.ok(missingStatus.errors.includes("status is invalid"));
