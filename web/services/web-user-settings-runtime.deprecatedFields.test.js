"use strict";
const assert = require("assert");

const {
  createSettingsHandler,
} = require("./web-user-settings-runtime");

let capturedJsonBody, capturedJsonStatus;
const mockJson = (res, b, s = 200) => {
  capturedJsonBody = b;
  capturedJsonStatus = s;
};

const mockUser = {
  chatId: "u1",
  email: "a@b.com",
  topics: ["TECHNOLOGY"],
  preferences: { depth: "headline_plus_why", delivery_time: "07:00", frequency: "daily_weekday", timezone: "America/New_York", days_of_week: [1,2,3,4,5] },
  topic_weights: {},
  source_preferences: { trusted_sources: [], blocked_sources: [] },
};

(async () => {
  // Test: items_per_digest rejected (not a known preference in MVP)
  {
    capturedJsonBody = null; capturedJsonStatus = null;
    const fakeHandler = createSettingsHandler({
      toRouteCtx: (ctx) => ctx,
      requireJsonBody: async () => ({ token: "tok", preferences: { items_per_digest: 5 } }),
      json: mockJson,
      getClientIp: () => "127.0.0.1",
      checkSettingsRateLimit: () => ({ limited: false }),
      findUserByToken: () => ({ ...mockUser }),
      allUsers: () => [{ ...mockUser }],
      writeUser: () => {},
      DEFAULT_TOPICS: ["TECHNOLOGY"],
      MAX_CUSTOM_KEYWORDS: 0,
      PROTECTED_FIELDS: [],
      normalizeUserRecord: (u) => u,
      normalizeTopicsForUserInput: () => ({ ok: true, topics: [] }),
    });
    await fakeHandler({ req: { method: "POST" }, res: {}, pathname: "/api/settings", url: new URL("http://x/api/settings") });
    assert.strictEqual(capturedJsonStatus, 400, "items_per_digest should be rejected with 400");
    console.log("items_per_digest rejected ✓");
  }

  // Test: telegram_enabled rejected (not a known preference in MVP)
  {
    capturedJsonBody = null; capturedJsonStatus = null;
    const fakeHandler = createSettingsHandler({
      toRouteCtx: (ctx) => ctx,
      requireJsonBody: async () => ({ token: "tok", preferences: { telegram_enabled: false } }),
      json: mockJson,
      getClientIp: () => "127.0.0.1",
      checkSettingsRateLimit: () => ({ limited: false }),
      findUserByToken: () => ({ ...mockUser }),
      allUsers: () => [{ ...mockUser }],
      writeUser: () => {},
      DEFAULT_TOPICS: ["TECHNOLOGY"],
      MAX_CUSTOM_KEYWORDS: 0,
      PROTECTED_FIELDS: [],
      normalizeUserRecord: (u) => u,
      normalizeTopicsForUserInput: () => ({ ok: true, topics: [] }),
    });
    await fakeHandler({ req: { method: "POST" }, res: {}, pathname: "/api/settings", url: new URL("http://x/api/settings") });
    assert.strictEqual(capturedJsonStatus, 400, "telegram_enabled should be rejected with 400");
    console.log("telegram_enabled rejected ✓");
  }

  // Test: topic_weights in body is stripped — not written to user record
  {
    let writtenUser = null;
    const fakeHandler = createSettingsHandler({
      toRouteCtx: (ctx) => ctx,
      requireJsonBody: async () => ({ token: "tok", topic_weights: { TECHNOLOGY: 2 } }),
      json: mockJson,
      getClientIp: () => "127.0.0.1",
      checkSettingsRateLimit: () => ({ limited: false }),
      findUserByToken: () => ({ ...mockUser }),
      allUsers: () => [{ ...mockUser }],
      writeUser: (id, u) => { writtenUser = u; },
      DEFAULT_TOPICS: ["TECHNOLOGY"],
      MAX_CUSTOM_KEYWORDS: 0,
      PROTECTED_FIELDS: [],
      normalizeUserRecord: (u) => u,
      normalizeTopicsForUserInput: () => ({ ok: true, topics: [] }),
    });
    await fakeHandler({ req: { method: "POST" }, res: {}, pathname: "/api/settings", url: new URL("http://x/api/settings") });
    assert.ok(
      !writtenUser || writtenUser.topic_weights === undefined || JSON.stringify(writtenUser.topic_weights) === "{}",
      "topic_weights from request body must not reach written user record"
    );
    console.log("topic_weights stripped from write path ✓");
  }

  console.log("All deprecated-fields settings tests passed ✓");
})();
