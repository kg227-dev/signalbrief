"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../../test-support/module-contract-helper.js");

const TARGET_REL = "web/services/web-user-handlers.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const { createWebUserHandlers } = require(TARGET_PATH);
assertModuleExports(() => ({ createWebUserHandlers }), TARGET_REL);

function createDeps(overrides = {}) {
  const responses = [];
  return {
    deps: {
      requireJsonBody: async () => ({}),
      json: (_res, data, status = 200) => {
        responses.push({ status, data });
        return { status, data };
      },
      getClientIp: () => "127.0.0.1",
      checkRateLimit: () => ({ limited: false }),
      checkSettingsRateLimit: () => ({ limited: false }),
      allUsers: () => [],
      findUserByToken: () => null,
      normalizeReferralToken: () => "",
      generateToken: () => "token-1",
      writeUser: () => {},
      sendReferralThankYou: async () => {},
      sendWelcomeEmail: async () => {},
      startDigestTrigger: async () => ({ status: "queued", raw: {} }),
      BASE_URL: "http://localhost:3003",
      DEFAULT_TOPICS: ["TECHNOLOGY", "HEALTHCARE"],
      MAX_CUSTOM_KEYWORDS: 0,
      allowExampleEmails: true,
      PROTECTED_FIELDS: [],
      isAdminAuthed: () => true,
      logAdminActionEvent: () => {},
      ...overrides,
    },
    responses,
  };
}

(async () => {
  {
    const { deps, responses } = createDeps({
      requireJsonBody: async () => ({ chatId: "chat-1" }),
    });
    const handlers = createWebUserHandlers(deps);
    await handlers.handleAdminRunDigest({}, {});
    const last = responses[responses.length - 1];
    assert.ok(last);
    assert.strictEqual(last.status, 410);
    assert.strictEqual(last.data.error, "Targeted digests are disabled in the reduced-scope email-only MVP.");
  }

  {
    const { deps, responses } = createDeps({
      requireJsonBody: async () => ({}),
      startDigestTrigger: async () => ({ status: "queued", raw: {} }),
    });
    const handlers = createWebUserHandlers(deps);
    await handlers.handleAdminRunDigest({}, {});
    const last = responses[responses.length - 1];
    assert.ok(last);
    assert.strictEqual(last.status, 200);
    assert.strictEqual(last.data.success, true);
    assert.strictEqual(last.data.message, "Full scheduled digest run triggered");
  }
})();
