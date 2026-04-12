"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../../test-support/module-contract-helper.js");

const TARGET_REL = "web/services/admin-stats-referrals.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);

assertNodeSyntaxFile(TARGET_PATH);
const { buildEngagementMetrics } = require(TARGET_PATH);
assertModuleExports(() => require(TARGET_PATH), TARGET_REL);

const parseIsoTs = (s) => Date.parse(s);

// Anchor: 2026-04-10T12:00:00Z
const NOW = Date.parse("2026-04-10T12:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;

function runMetrics(events) {
  return buildEngagementMetrics({
    usersAll: [],
    referrals: [],
    loadEngagementEvents: () => events,
    parseIsoTs,
    nowMs: NOW,
  });
}

// ── Test 1: Opens from digests sent within the window → counted ───────────────
{
  const events = [
    { event_type: "digest_sent", channel: "email", digest_id: "d1", ts_utc: "2026-04-05T10:00:00Z", event_key: "sent-d1" },
    { event_type: "email_open", digest_id: "d1", ts_utc: "2026-04-06T10:00:00Z", event_key: "open-d1" },
  ];
  const result = runMetrics(events);
  assert.strictEqual(result.open_rate_7d, 1, "test 1: open from a within-window sent digest should be counted");
}

// ── Test 2: Opens from digests sent BEFORE the window → excluded ──────────────
{
  // digest_sent is 10 days ago (outside 7d window); email_open is 3 days ago (inside 7d window)
  const events = [
    { event_type: "digest_sent", channel: "email", digest_id: "d2", ts_utc: new Date(NOW - 10 * DAY_MS).toISOString(), event_key: "sent-d2" },
    { event_type: "email_open", digest_id: "d2", ts_utc: new Date(NOW - 3 * DAY_MS).toISOString(), event_key: "open-d2" },
  ];
  const result = runMetrics(events);
  assert.strictEqual(result.open_rate_7d, 0, "test 2: open for a digest sent before the window must not inflate open_rate_7d");
  assert.ok(result.open_rate_7d <= 1, "test 2: open_rate_7d must not exceed 1");
}

// ── Test 3: Zero sends in window → rate = 0 (not NaN / Infinity) ─────────────
{
  const events = [
    { event_type: "email_open", digest_id: "d3", ts_utc: "2026-04-08T10:00:00Z", event_key: "open-d3" },
  ];
  const result = runMetrics(events);
  assert.strictEqual(result.open_rate_7d, 0, "test 3: zero sends must yield open_rate_7d = 0, not NaN/Infinity");
  assert.ok(Number.isFinite(result.open_rate_7d), "test 3: open_rate_7d must be finite when no sends");
}

// ── Test 4: Multiple opens for same digest → deduplicated ─────────────────────
{
  const events = [
    { event_type: "digest_sent", channel: "email", digest_id: "d4", ts_utc: "2026-04-05T10:00:00Z", event_key: "sent-d4" },
    { event_type: "email_open", digest_id: "d4", ts_utc: "2026-04-06T10:00:00Z", event_key: "open-d4-a" },
    { event_type: "email_open", digest_id: "d4", ts_utc: "2026-04-07T10:00:00Z", event_key: "open-d4-b" },
  ];
  const result = runMetrics(events);
  // 1 sent, 2 distinct open keys → rate = 2/1 = 2.0 without dedup, but same event_key dedup
  // Here both opens have distinct event_keys, so they each count once: 2 opens / 1 sent = 2
  // The dedup is per event_key; two distinct keys means both count.
  // What we're testing: the opens ARE constrained to the sent-window Set, preventing cross-window inflation.
  assert.ok(Number.isFinite(result.open_rate_7d), "test 4: rate must be finite");
  // Reset with same event_key to verify dedup collapses them to 1
  const eventsDeduped = [
    { event_type: "digest_sent", channel: "email", digest_id: "d4", ts_utc: "2026-04-05T10:00:00Z", event_key: "sent-d4" },
    { event_type: "email_open", digest_id: "d4", ts_utc: "2026-04-06T10:00:00Z", event_key: "open-d4-same" },
    { event_type: "email_open", digest_id: "d4", ts_utc: "2026-04-07T10:00:00Z", event_key: "open-d4-same" },
  ];
  const resultDeduped = runMetrics(eventsDeduped);
  assert.strictEqual(resultDeduped.open_rate_7d, 1, "test 4: duplicate event_key must be deduplicated to 1 open");
}

// ── Test 5: Opens exactly at window boundary → included ───────────────────────
{
  // 7d window: events at exactly (nowMs - 7 * dayMs) should be included (>=)
  const boundaryTs = new Date(NOW - 7 * DAY_MS).toISOString();
  const events = [
    { event_type: "digest_sent", channel: "email", digest_id: "d5", ts_utc: boundaryTs, event_key: "sent-d5" },
    { event_type: "email_open", digest_id: "d5", ts_utc: boundaryTs, event_key: "open-d5" },
  ];
  const result = runMetrics(events);
  assert.strictEqual(result.open_rate_7d, 1, "test 5: events exactly at the 7d boundary must be included");
}

console.log("admin-stats-referrals open-rate: all tests passed");
