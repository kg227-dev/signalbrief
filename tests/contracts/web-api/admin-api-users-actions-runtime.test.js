"use strict";

const path = require("path");
const fs = require("fs");
const assert = require("assert");
const { assertNodeSyntaxFile, assertModuleExports } = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "web/routes/admin-api-users-actions-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
assertModuleExports(() => require(TARGET_PATH), TARGET_REL);

const { handleSetUserStatusRoute } = require(TARGET_PATH);

const source = fs.readFileSync(TARGET_PATH, "utf8");
if (!source.includes('message: "Subscriber already deleted"')) {
  throw new Error("delete-user handler should return an idempotent already-deleted message");
}
if (!source.includes('json(res, { error: "user not found" }, 404);')) {
  throw new Error("non-delete user operations should still return user not found");
}
if (!source.includes("latest_digest_record: latestDigestRecord")) {
  throw new Error("user-by-email handler should expose the latest digest record for admin debug");
}
if (!source.includes("archive_digest_count: archiveDigestCount")) {
  throw new Error("user-by-email handler should expose the canonical archive digest count");
}
if (!source.includes("recent_digests: recentDigestRows")) {
  throw new Error("user-by-email handler should expose recent digest outcomes for admin review");
}

function buildCtx(body) {
  return {
    req: { method: "POST" },
    res: {},
    body,
  };
}

function json(res, payload, status = 200) {
  res.statusCode = status;
  res.body = payload;
}

async function testResubscribeRestoresChannels() {
  const writes = [];
  const actions = [];
  const user = {
    chatId: "123456",
    email: "rishi@example.com",
    status: "unsubscribed",
    email_unsubscribed_at: "2026-03-01T10:00:00.000Z",
    preferences: {
      email_enabled: false,
      telegram_enabled: false,
      _pre_unsubscribe_channels: {
        email_enabled: true,
        telegram_enabled: false,
      },
    },
  };
  const ctx = buildCtx({ email: user.email, status: "active" });
  await handleSetUserStatusRoute({
    ctx,
    deps: {
      json,
      isAdminAuthed: () => true,
      requireJsonBody: async () => ctx.body,
      allUsers: () => [user],
      writeUser: (chatId, payload) => writes.push({ chatId, payload }),
      logAdminActionEvent: (_req, entry) => actions.push(entry),
      blankReengagementState: () => ({ reopened: true }),
    },
  });

  assert.strictEqual(ctx.res.statusCode, 200);
  assert.strictEqual(ctx.res.body.message, "Subscriber re-subscribed");
  assert.strictEqual(writes.length, 1, "resubscribe should persist exactly one update");
  assert.strictEqual(writes[0].payload.status, "active");
  assert.strictEqual(writes[0].payload.preferences.email_enabled, true);
  assert.strictEqual(writes[0].payload.preferences.telegram_enabled, false);
  assert.ok(!("_pre_unsubscribe_channels" in writes[0].payload.preferences), "resubscribe should clear backup channel state");
  assert.ok(!("email_unsubscribed_at" in writes[0].payload), "resubscribe should clear unsubscribe timestamp");
  assert.deepStrictEqual(writes[0].payload.reengagement_state, { reopened: true });
  assert.strictEqual(actions[0].details.from, "unsubscribed");
  assert.strictEqual(actions[0].details.to, "active");
}

async function testUnsubscribeBacksUpChannels() {
  const writes = [];
  const user = {
    chatId: "999",
    email: "active@example.com",
    status: "active",
    preferences: {
      email_enabled: true,
      telegram_enabled: true,
    },
  };
  const ctx = buildCtx({ email: user.email, status: "unsubscribed" });
  await handleSetUserStatusRoute({
    ctx,
    deps: {
      json,
      isAdminAuthed: () => true,
      requireJsonBody: async () => ctx.body,
      allUsers: () => [user],
      writeUser: (_chatId, payload) => writes.push(payload),
      logAdminActionEvent: () => {},
      blankReengagementState: () => ({}),
    },
  });

  assert.strictEqual(ctx.res.statusCode, 200);
  assert.strictEqual(writes.length, 1);
  assert.strictEqual(writes[0].preferences.email_enabled, false);
  assert.strictEqual(writes[0].preferences.telegram_enabled, false);
  assert.deepStrictEqual(writes[0].preferences._pre_unsubscribe_channels, {
    email_enabled: true,
    telegram_enabled: true,
  });
  assert.ok(typeof writes[0].email_unsubscribed_at === "string" && writes[0].email_unsubscribed_at.length > 10);
}

Promise.resolve()
  .then(testResubscribeRestoresChannels)
  .then(testUnsubscribeBacksUpChannels)
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
