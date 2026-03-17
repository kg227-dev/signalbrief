"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../../test-support/module-contract-helper.js");

const TARGET_REL = "web/routes/core-api-bookmarks-actions-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
const { validateBookmarkRequest, addBookmarkForUser, removeBookmarkForUser } = runtime;
assertModuleExports(() => runtime, TARGET_REL);

// --------------- validateBookmarkRequest ---------------

assert.strictEqual(
  validateBookmarkRequest({ token: "", action: "add", itemUrl: "https://a.com" }),
  "token required",
  "missing token should fail"
);

assert.strictEqual(
  validateBookmarkRequest({ token: "tok", action: "invalid", itemUrl: "https://a.com" }),
  "action must be add or remove",
  "invalid action should fail"
);

assert.strictEqual(
  validateBookmarkRequest({ token: "tok", action: "add", itemUrl: "" }),
  "item.url required",
  "missing URL should fail"
);

assert.strictEqual(
  validateBookmarkRequest({ token: "tok", action: "add", itemUrl: "https://a.com" }),
  null,
  "valid add request should pass"
);

assert.strictEqual(
  validateBookmarkRequest({ token: "tok", action: "remove", itemUrl: "https://a.com" }),
  null,
  "valid remove request should pass"
);

// --------------- addBookmarkForUser ---------------

{
  const engagementEvents = [];
  const result = addBookmarkForUser({
    user: { chatId: "123", email: "a@b.com" },
    item: { url: "https://example.com/article", headline: "Test", date: "2026-03-16", tag: "AI" },
    itemUrl: "https://example.com/article",
    bookmarks: [],
    normalizeBookmarkUrl: (u) => String(u || "").toLowerCase().replace(/\/+$/, ""),
    toEtDateKey: () => "2026-03-16",
    buildDigestId: (date, chatId) => `${date}:${chatId}`,
    appendEngagementEventChecked: (evt) => engagementEvents.push(evt),
  });

  assert.strictEqual(result.deduped, false, "new bookmark should not be deduped");
  assert.strictEqual(result.bookmarks.length, 1, "should have 1 bookmark");
  assert.strictEqual(result.bookmarks[0].url, "https://example.com/article");
  assert.strictEqual(result.bookmarks[0].headline, "Test");
  assert.strictEqual(result.bookmarks[0].tag, "AI");
  assert.ok(result.bookmarks[0].saved_at, "saved_at should be set");
  assert.strictEqual(engagementEvents.length, 1, "should emit engagement event");
  assert.strictEqual(engagementEvents[0].event_type, "item_saved");
}

// dedup: adding same URL twice
{
  const existing = [{ url: "https://example.com/article", headline: "Old" }];
  const result = addBookmarkForUser({
    user: { chatId: "123", email: "a@b.com" },
    item: { url: "https://example.com/article", headline: "New" },
    itemUrl: "https://example.com/article",
    bookmarks: existing,
    normalizeBookmarkUrl: (u) => String(u || "").toLowerCase().replace(/\/+$/, ""),
    toEtDateKey: () => "2026-03-16",
    buildDigestId: (date, chatId) => `${date}:${chatId}`,
    appendEngagementEventChecked: () => {},
  });

  assert.strictEqual(result.deduped, true, "duplicate URL should be deduped");
  assert.strictEqual(result.bookmarks.length, 1, "should not add duplicate");
}

// --------------- removeBookmarkForUser ---------------

{
  const bookmarks = [
    { url: "https://a.com/1", headline: "A" },
    { url: "https://b.com/2", headline: "B" },
  ];
  const result = removeBookmarkForUser({
    bookmarks,
    itemUrl: "https://a.com/1",
    normalizeBookmarkUrl: (u) => String(u || "").toLowerCase().replace(/\/+$/, ""),
  });

  assert.strictEqual(result.removed, true, "should report removal");
  assert.strictEqual(result.filtered.length, 1, "should have 1 remaining");
  assert.strictEqual(result.filtered[0].url, "https://b.com/2");
}

// remove non-existent
{
  const bookmarks = [{ url: "https://a.com/1", headline: "A" }];
  const result = removeBookmarkForUser({
    bookmarks,
    itemUrl: "https://missing.com",
    normalizeBookmarkUrl: (u) => String(u || "").toLowerCase().replace(/\/+$/, ""),
  });

  assert.strictEqual(result.removed, false, "should report no removal");
  assert.strictEqual(result.filtered.length, 1, "original bookmarks unchanged");
}

process.stdout.write("[bookmarks-actions-runtime] all assertions passed\n");
