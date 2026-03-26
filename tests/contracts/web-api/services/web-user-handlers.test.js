"use strict";

const assert = require("assert");
const path = require("path");
const { assertNodeSyntaxFile, assertModuleExports } = require("../../../../test-support/module-contract-helper.js");

const TARGET_REL = "web/services/web-user-handlers.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const { createWebUserHandlers } = require(TARGET_PATH);
assertModuleExports(() => ({ createWebUserHandlers }), TARGET_REL);

function createDeps(overrides = {}) {
  const writes = [];
  const responses = [];
  const deps = {
    requireJsonBody: async () => null,
    json: (_res, data, status = 200) => {
      responses.push({ status, data });
      return { status, data };
    },
    getClientIp: () => "127.0.0.1",
    checkRateLimit: () => ({ limited: false }),
    allUsers: () => [],
    findUserByToken: () => null,
    normalizeReferralToken: () => "",
    generateToken: () => "token-1",
    writeUser: (_chatId, payload) => {
      writes.push(payload);
    },
    sendReferralThankYou: async () => {},
    sendWelcomeEmail: async () => {},
    queueDigestTrigger: async () => ({ ok: true, code: "queued" }),
    runDigestTrigger: async () => ({ ok: true, status: "ok", raw: { run: { code: 0 } } }),
    startDigestTrigger: async () => ({ ok: true, status: "queued", raw: {} }),
    BASE_URL: "http://localhost:3003",
    DEFAULT_TOPICS: ["AI×TECH", "HEALTHCARE"],
    PROTECTED_FIELDS: [],
    isAdminAuthed: () => false,
    logAdminActionEvent: () => {},
    ...overrides,
  };
  return { deps, writes, responses };
}

async function assertSignupValidation(body, expectedStatus, expectedMessage) {
  const { deps, responses } = createDeps({
    requireJsonBody: async () => body,
  });
  const handlers = createWebUserHandlers(deps);
  await handlers.handleSignup({}, {});
  const last = responses[responses.length - 1];
  assert.ok(last, "expected a JSON response");
  assert.strictEqual(last.status, expectedStatus);
  assert.strictEqual(last.data.error, expectedMessage);
}

async function assertSettingsValidation(body, expectedStatus, expectedMessage) {
  const existingUser = {
    chatId: "c1",
    token: "token-1",
    email: "a@example.com",
    preferences: {
      depth: "headline_plus_why",
      delivery_time: "07:00",
      frequency: "daily_weekday",
      days_of_week: [1, 2, 3, 4, 5],
      items_per_digest: 5,
      email_enabled: true,
      telegram_enabled: true,
    },
  };
  const { deps, responses } = createDeps({
    requireJsonBody: async () => body,
    findUserByToken: (token) => (token === "token-1" ? existingUser : null),
    allUsers: () => [existingUser],
  });
  const handlers = createWebUserHandlers(deps);
  await handlers.handleSettings({}, {});
  const last = responses[responses.length - 1];
  assert.ok(last, "expected a JSON response");
  assert.strictEqual(last.status, expectedStatus);
  assert.strictEqual(last.data.error, expectedMessage);
}

(async () => {
  await assertSignupValidation(
    { name: "A", email: "a@example.com", topics: "not-array" },
    400,
    "topics must be an array"
  );

  await assertSignupValidation(
    { name: "A", email: "a@example.com", topics: ["AI×TECH", "   ", 42] },
    400,
    "topics must contain non-empty strings"
  );

  const { deps, writes, responses } = createDeps({
    requireJsonBody: async () => ({
      name: "A",
      email: "a@example.com",
      topics: [" AI×TECH ", "AI×TECH", " HEALTHCARE "],
      telegram: "",
    }),
  });
  const handlers = createWebUserHandlers(deps);
  await handlers.handleSignup({}, {});

  const last = responses[responses.length - 1];
  assert.ok(last, "expected signup response");
  assert.strictEqual(last.status, 200);
  assert.strictEqual(last.data.success, true);
  assert.strictEqual(last.data.account_created, true);
  assert.strictEqual(writes.length, 1);
  assert.deepStrictEqual(writes[0].topics, ["AI×TECH", "HEALTHCARE"]);

  const degradedRun = createDeps({
    requireJsonBody: async () => ({
      name: "A",
      email: "degraded@example.com",
      topics: ["AI×TECH", "HEALTHCARE"],
    }),
    queueDigestTrigger: async () => ({ ok: false, code: "busy" }),
  });
  await createWebUserHandlers(degradedRun.deps).handleSignup({}, {});
  const degraded = degradedRun.responses[degradedRun.responses.length - 1];
  assert.strictEqual(degraded.status, 202);
  assert.strictEqual(degraded.data.success, false);
  assert.strictEqual(degraded.data.account_created, true);
  assert.ok(Array.isArray(degraded.data.warnings));
  assert.strictEqual(degraded.data.warnings.length, 1);
  assert.strictEqual(degraded.data.warnings[0].code, "welcome_digest_trigger_failed");

  await assertSettingsValidation(
    { token: "token-1", preferences: "bad-payload" },
    400,
    "preferences must be an object"
  );

  await assertSettingsValidation(
    { token: "token-1", preferences: { unknown: true } },
    400,
    "preferences.unknown is not allowed"
  );

  await assertSettingsValidation(
    { token: "token-1", preferences: { days_of_week: [] } },
    400,
    "preferences.days_of_week must include at least one day index"
  );

  const existingUser = {
    chatId: "c1",
    token: "token-1",
    email: "a@example.com",
    preferences: {
      depth: "headline_plus_why",
      delivery_time: "07:00",
      frequency: "daily_weekday",
      days_of_week: [1, 2, 3, 4, 5],
      items_per_digest: 5,
      email_enabled: true,
      telegram_enabled: true,
    },
  };
  const settingsRun = createDeps({
    requireJsonBody: async () => ({
      token: "token-1",
      preferences: {
        delivery_time: " 08:15 ",
        days_of_week: [1, "2", 2, 3],
      },
    }),
    findUserByToken: (token) => (token === "token-1" ? existingUser : null),
    allUsers: () => [existingUser],
  });
  await createWebUserHandlers(settingsRun.deps).handleSettings({}, {});
  assert.strictEqual(settingsRun.responses[settingsRun.responses.length - 1].status, 200);
  assert.strictEqual(settingsRun.writes.length, 1);
  assert.deepStrictEqual(settingsRun.writes[0].preferences.days_of_week, [1, 2, 3]);
  assert.strictEqual(settingsRun.writes[0].preferences.delivery_time, "08:15");
  assert.strictEqual(settingsRun.writes[0].preferences.frequency, "custom");

  const settingsTopicsRun = createDeps({
    requireJsonBody: async () => ({
      token: "token-1",
      topics: [" ai×tech ", "custom_Cloud Security", "Cloud security", "AI×TECH"],
    }),
    findUserByToken: (token) => (token === "token-1" ? existingUser : null),
    allUsers: () => [existingUser],
  });
  await createWebUserHandlers(settingsTopicsRun.deps).handleSettings({}, {});
  assert.strictEqual(settingsTopicsRun.responses[settingsTopicsRun.responses.length - 1].status, 200);
  assert.strictEqual(settingsTopicsRun.writes.length, 1);
  assert.deepStrictEqual(
    settingsTopicsRun.writes[0].topics,
    ["AI×TECH", "custom_cloud_security"]
  );
  assert.deepStrictEqual(
    settingsTopicsRun.writes[0].custom_topics,
    ["custom_cloud_security"]
  );
})();
