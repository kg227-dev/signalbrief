"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertSourceIncludesFile,
  assertModuleExports,
} = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "web/services/admin-stats-roster.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
assertSourceIncludesFile(TARGET_PATH, ["buildSettingsPath", "admin_return", "/settings?email=", "archive_digest_count", "countArchiveDigestsForUser"]);
assertModuleExports(() => require(TARGET_PATH), TARGET_REL);

const { buildAdminRoster } = require(TARGET_PATH);

(() => {
  const roster = buildAdminRoster({
    usersAll: [{
      chatId: "6297966907",
      name: "Kush",
      email: "kgman29@gmail.com",
      status: "active",
      joined_at: "2026-03-01T12:00:00.000Z",
      last_updated: "2026-03-21T22:19:51.640Z",
      last_digest_at: "2026-03-20T11:01:35.519Z",
      last_digest_items: [],
      digests_received: 28,
      topics: ["technology", "ai_tech", "strategy"],
      topic_weights: {},
      bookmarks: [],
      quality_history: [],
      preferences: {
        delivery_time: "07:00",
        timezone: "America/New_York",
        frequency: "daily_all",
        depth: "headline_plus_why",
        days_of_week: [0, 1, 2, 3, 4, 5, 6],
        items_per_digest: 5,
        email_enabled: true,
        telegram_enabled: true,
      },
    }],
    recentDigestRows: [{
      user_id: "6297966907",
      user_email: "kgman29@gmail.com",
      recipient: "kgman29@gmail.com",
      mode: "scheduled",
      date_et: "2026-03-21",
      run_at_utc: "2026-03-21T11:03:08.850Z",
      digest_url: "https://getsignalbrief.com/digest/2026-03-21",
      sent_items: [
        { headline: "Story one", tag: "TECHNOLOGY", url: "https://example.com/1" },
        { headline: "Story two", tag: "AI TECH", url: "https://example.com/2" },
      ],
    }],
    countArchiveDigestsForUser: () => 28,
    computeQualityTrend: () => ({ current: null, avg_7d: null, delta_14d: null, floor_14d: null, band: null, sample_14d: 0 }),
    formatDaysLabel: () => "Every day",
    computeNextDeliveryEt: () => ({ label: "Tomorrow · 7:00 AM ET", key: "2026-03-22" }),
  });

  assert.strictEqual(roster.length, 1);
  assert.strictEqual(roster[0].last_digest, "2026-03-21");
  assert.strictEqual(roster[0].last_scheduled_digest, "2026-03-21");
  assert.strictEqual(roster[0].last_scheduled_digest_item_count, 2);
  assert.strictEqual(roster[0].last_scheduled_digest_url, "https://getsignalbrief.com/digest/2026-03-21");
  assert.strictEqual(roster[0].last_scheduled_archive_url, "/archive?email=kgman29%40gmail.com&admin=1&admin_return=%2Fadmin%2Fuser%3Femail%3Dkgman29%2540gmail.com&date=2026-03-21");
  assert.strictEqual(roster[0].last_digest_item_count, 2);
})();
