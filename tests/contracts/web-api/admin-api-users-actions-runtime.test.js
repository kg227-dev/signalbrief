"use strict";

const path = require("path");
const fs = require("fs");
const assert = require("assert");
const { assertNodeSyntaxFile, assertModuleExports } = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "web/routes/admin-api-users-actions-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
assertModuleExports(() => require(TARGET_PATH), TARGET_REL);

const {
  handleSetUserStatusRoute,
  handleRegenerateDigestRoute,
  handleResendDigestRoute,
} = require(TARGET_PATH);

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
if (!source.includes('action: "resend_digest_precise"')) {
  throw new Error("admin user actions should audit precise digest resends");
}
if (!source.includes('message: "Stored digest snapshot resent"')) {
  throw new Error("precise digest resend handler should return a clear success message");
}
if (!source.includes('action: "regenerate_digest_summaries"')) {
  throw new Error("admin user actions should audit digest summary regeneration");
}
if (!source.includes('message: "Stored digest summaries regenerated"')) {
  throw new Error("digest summary regeneration handler should return a clear success message");
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
      _pre_unsubscribe_channels: {
        email_enabled: true,
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
    },
  });

  assert.strictEqual(ctx.res.statusCode, 200);
  assert.strictEqual(ctx.res.body.message, "Subscriber re-subscribed");
  assert.strictEqual(writes.length, 1, "resubscribe should persist exactly one update");
  assert.strictEqual(writes[0].payload.status, "active");
  assert.strictEqual(writes[0].payload.preferences.email_enabled, true);
  assert.ok(!("telegram_enabled" in writes[0].payload.preferences), "resubscribe should not restore telegram in email-only MVP");
  assert.ok(!("_pre_unsubscribe_channels" in writes[0].payload.preferences), "resubscribe should clear backup channel state");
  assert.ok(!("email_unsubscribed_at" in writes[0].payload), "resubscribe should clear unsubscribe timestamp");
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
    },
  });

  assert.strictEqual(ctx.res.statusCode, 200);
  assert.strictEqual(writes.length, 1);
  assert.strictEqual(writes[0].preferences.email_enabled, false);
  assert.deepStrictEqual(writes[0].preferences._pre_unsubscribe_channels, {
    email_enabled: true,
  });
  assert.ok(typeof writes[0].email_unsubscribed_at === "string" && writes[0].email_unsubscribed_at.length > 10);
}

async function testPreciseResendUsesStoredSnapshot() {
  const actions = [];
  const resendCalls = [];
  const user = {
    chatId: "123456",
    email: "ops@example.com",
    status: "active",
    token: "tok-1",
    preferences: {
      depth: "headline_plus_why",
    },
  };
  const snapshot = {
    status: "failed",
    date_et: "2026-03-27",
    selected_count: 5,
    items: Array.from({ length: 5 }, (_, index) => ({
      headline: `Story ${index + 1}`,
    })),
  };
  const ctx = buildCtx({ email: user.email, date_et: "2026-03-27" });
  await handleResendDigestRoute({
    ctx,
    deps: {
      json,
      isAdminAuthed: () => true,
      requireJsonBody: async () => ctx.body,
      allUsers: () => [user],
      loadCurrentDigestSnapshot: () => snapshot,
      resendDigestSnapshot: async (input) => {
        resendCalls.push(input);
        return {
          subject: "SignalBrief: Story 1",
          item_count: 5,
        };
      },
      logAdminActionEvent: (_req, entry) => actions.push(entry),
    },
  });

  assert.strictEqual(ctx.res.statusCode, 200);
  assert.strictEqual(ctx.res.body.success, true);
  assert.strictEqual(ctx.res.body.message, "Stored digest snapshot resent");
  assert.strictEqual(resendCalls.length, 1, "precise resend should call the resend runtime exactly once");
  assert.strictEqual(resendCalls[0].user.email, user.email);
  assert.strictEqual(resendCalls[0].snapshot, snapshot);
  assert.strictEqual(actions[0].action, "resend_digest_precise");
  assert.strictEqual(actions[0].success, true);
}

async function testPreciseResendRejectsThinSnapshot() {
  const actions = [];
  const user = {
    chatId: "123456",
    email: "ops@example.com",
    status: "active",
  };
  const ctx = buildCtx({ email: user.email, date_et: "2026-03-27" });
  await handleResendDigestRoute({
    ctx,
    deps: {
      json,
      isAdminAuthed: () => true,
      requireJsonBody: async () => ctx.body,
      allUsers: () => [user],
      loadCurrentDigestSnapshot: () => ({
        status: "failed",
        date_et: "2026-03-27",
        selected_count: 4,
        items: Array.from({ length: 4 }, (_, index) => ({ headline: `Story ${index + 1}` })),
      }),
      resendDigestSnapshot: async () => {
        throw new Error("should not be called");
      },
      logAdminActionEvent: (_req, entry) => actions.push(entry),
    },
  });

  assert.strictEqual(ctx.res.statusCode, 409);
  assert.strictEqual(ctx.res.body.error, "No resendable 5-item digest snapshot found for that user/date.");
  assert.strictEqual(actions[0].action, "resend_digest_precise");
  assert.strictEqual(actions[0].success, false);
}

async function testRegenerateSummariesUsesStoredSnapshot() {
  const actions = [];
  const regenerateCalls = [];
  const user = {
    chatId: "123456",
    email: "ops@example.com",
    status: "paused",
  };
  const snapshot = {
    status: "sent",
    date_et: "2026-03-27",
    selected_count: 5,
    items: Array.from({ length: 5 }, (_, index) => ({
      headline: `Story ${index + 1}`,
    })),
  };
  const ctx = buildCtx({ email: user.email, date_et: "2026-03-27" });
  await handleRegenerateDigestRoute({
    ctx,
    deps: {
      json,
      isAdminAuthed: () => true,
      requireJsonBody: async () => ctx.body,
      allUsers: () => [user],
      loadCurrentDigestSnapshot: () => snapshot,
      regenerateDigestSnapshot: async (input) => {
        regenerateCalls.push(input);
        return {
          subject: "SignalBrief: Story 1",
          item_count: 5,
          regenerated_at: "2026-03-27T12:00:00.000Z",
        };
      },
      logAdminActionEvent: (_req, entry) => actions.push(entry),
      getAdminActor: () => "qa-admin",
    },
  });

  assert.strictEqual(ctx.res.statusCode, 200);
  assert.strictEqual(ctx.res.body.success, true);
  assert.strictEqual(ctx.res.body.message, "Stored digest summaries regenerated");
  assert.strictEqual(regenerateCalls.length, 1, "summary regeneration should call the regen runtime exactly once");
  assert.strictEqual(regenerateCalls[0].user.email, user.email);
  assert.strictEqual(regenerateCalls[0].snapshot, snapshot);
  assert.strictEqual(regenerateCalls[0].actor, "qa-admin");
  assert.strictEqual(actions[0].action, "regenerate_digest_summaries");
  assert.strictEqual(actions[0].success, true);
}

async function testRegenerateSummariesRejectsThinSnapshot() {
  const actions = [];
  const user = {
    chatId: "123456",
    email: "ops@example.com",
    status: "active",
  };
  const ctx = buildCtx({ email: user.email, date_et: "2026-03-27" });
  await handleRegenerateDigestRoute({
    ctx,
    deps: {
      json,
      isAdminAuthed: () => true,
      requireJsonBody: async () => ctx.body,
      allUsers: () => [user],
      loadCurrentDigestSnapshot: () => ({
        status: "sent",
        date_et: "2026-03-27",
        selected_count: 4,
        items: Array.from({ length: 4 }, (_, index) => ({ headline: `Story ${index + 1}` })),
      }),
      regenerateDigestSnapshot: async () => {
        throw new Error("should not be called");
      },
      logAdminActionEvent: (_req, entry) => actions.push(entry),
      getAdminActor: () => "qa-admin",
    },
  });

  assert.strictEqual(ctx.res.statusCode, 409);
  assert.strictEqual(ctx.res.body.error, "No regenable 5-item digest snapshot found for that user/date.");
  assert.strictEqual(actions[0].action, "regenerate_digest_summaries");
  assert.strictEqual(actions[0].success, false);
}

Promise.resolve()
  .then(testResubscribeRestoresChannels)
  .then(testUnsubscribeBacksUpChannels)
  .then(testPreciseResendUsesStoredSnapshot)
  .then(testPreciseResendRejectsThinSnapshot)
  .then(testRegenerateSummariesUsesStoredSnapshot)
  .then(testRegenerateSummariesRejectsThinSnapshot)
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
