"use strict";
const assert = require("assert");
const { buildPublicUserRecord } = require("./core-api");

const user = {
  chatId: "u1",
  email: "a@b.com",
  name: "Alice",
  status: "active",
  topics: ["TECHNOLOGY"],
  bookmarks: [{ url: "https://example.com", title: "t", date: "2026-03-25", tag: "TECHNOLOGY" }],
  topic_weights: { TECHNOLOGY: 1.5 },
  preferences: {
    depth: "headline_plus_why",
    delivery_time: "07:00",
    frequency: "daily_weekday",
    timezone: "America/New_York",
    items_per_digest: 5,
    telegram_enabled: true,
  },
};

const pub = buildPublicUserRecord(user);

assert.ok(!("bookmarks" in pub), "bookmarks must not be in public record");
assert.ok(!("topic_weights" in pub), "topic_weights must not be in public record");
assert.ok(!("telegram" in pub), "telegram must not be in public record");
assert.ok("topics" in pub, "topics still present");
assert.ok(!("source_preferences" in pub), "source preferences must not be in public record");
assert.ok(!("custom_keywords" in pub), "deprecated keyword fields must not be in public record");
assert.ok(!("watchlist" in pub), "watchlist must not be in public record");

// sanitizePreferences must also strip items_per_digest and telegram_enabled
const prefs = pub.preferences || {};
assert.ok(!("items_per_digest" in prefs), "items_per_digest must not be in public preferences");
assert.ok(!("telegram_enabled" in prefs), "telegram_enabled must not be in public preferences");
assert.ok("depth" in prefs, "depth still present in preferences");

console.log("buildPublicUserRecord strips deprecated fields ✓");
