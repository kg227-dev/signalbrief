"use strict";

const path = require("path");
const assert = require("assert");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "web/routes/admin-api-message-actions-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);

assertNodeSyntaxFile(TARGET_PATH);
assertModuleExports(() => require(TARGET_PATH), TARGET_REL);

const {
  validateAdminMessageRequest,
  processAdminMessageRequest,
} = require(TARGET_PATH);

assert.strictEqual(
  validateAdminMessageRequest({ email: "user@example.com", message: "hello" }),
  null,
  "email-only admin messaging should not require channel selection"
);

async function testProcessAdminMessageRequestUsesEmailOnlyAuditShape() {
  const auditEvents = [];
  const sent = [];
  const ctx = {
    req: { method: "POST" },
    res: {},
  };

  await processAdminMessageRequest({
    ctx,
    deps: {
      json(res, payload, status = 200) {
        res.statusCode = status;
        res.body = payload;
      },
      requireJsonBody: async () => ({
        email: "user@example.com",
        subject: "Quick note",
        message: "Email-only path",
      }),
      allUsers: () => [{
        chatId: "email-user",
        email: "user@example.com",
        token: "token-123",
        preferences: { email_enabled: true },
      }],
      summarizeMessage: (text) => text.slice(0, 40),
      hashText: () => "hash-123",
      logAdminMessageEvent: (_req, entry) => auditEvents.push(entry),
      escapeHtml: (value) => String(value || ""),
      sendEmail: async (...args) => sent.push(args),
    },
  });

  assert.strictEqual(ctx.res.statusCode, 200);
  assert.strictEqual(ctx.res.body.success, true);
  assert.deepStrictEqual(ctx.res.body.sent, { email: true });
  assert.strictEqual(sent.length, 1, "admin message route should send exactly one email");
  assert.deepStrictEqual(auditEvents[0].requested_channels, ["email"]);
  assert.deepStrictEqual(auditEvents[0].sent_channels, ["email"]);
}

Promise.resolve()
  .then(testProcessAdminMessageRequestUsesEmailOnlyAuditShape)
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
