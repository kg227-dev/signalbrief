"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  createReplayRuntime,
  DEFAULT_REPLAY_THRESHOLDS,
} = require("../../../test-harness/runtime/replay-runtime");

const fixtureRuntime = createReplayRuntime({
  rootDir: process.cwd(),
  replayResultsDir: path.join(process.cwd(), "test-results", "replay-contracts"),
});

const fixture = fixtureRuntime.loadFixtureReplay("tests/fixtures/replay/kushgulati29-march-10-13.json");
const summary = fixtureRuntime.summarizeUserReplay(
  fixture.user,
  fixture.deliveries,
  DEFAULT_REPLAY_THRESHOLDS,
  3
);

assert.strictEqual(summary.summary.scheduled_duplicate_days, 1, "fixture should flag the March 10 duplicate scheduled brief");
assert.ok(summary.summary.weak_item_count >= 4, "fixture should surface multiple low-value items");
assert.ok(summary.summary.adjacent_low_novelty_pairs >= 2, "fixture should detect repeated Pfizer narrative saturation across adjacent days");

const gateById = new Map(summary.gate_results.map((gate) => [gate.id, gate]));
assert.strictEqual(gateById.get("scheduled_duplicate_days")?.status, "fail");
assert.strictEqual(gateById.get("weak_item_rate")?.status, "fail");

const weakHeadlines = summary.digests.flatMap((digest) => digest.weak_items.map((item) => item.headline));
assert.ok(weakHeadlines.some((headline) => /dividend/i.test(headline)), "dividend announcement should be treated as weak");
assert.ok(weakHeadlines.some((headline) => /business reality/i.test(headline)), "generic CEO commentary should be treated as weak");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sb-replay-"));
fs.mkdirSync(path.join(tempRoot, "data"), { recursive: true });
fs.mkdirSync(path.join(tempRoot, "archive"), { recursive: true });

const tempUser = {
  chatId: "email-test-user",
  email: "test@example.com",
  name: "test",
  topics: ["STRATEGY", "custom_pfizer"],
};
fs.writeFileSync(
  path.join(tempRoot, "data", "user-email-test-user.json"),
  JSON.stringify(tempUser, null, 2)
);

const eventLines = [
  {
    event_type: "digest_sent",
    event_key: "digest_sent:2026-03-10:email-test-user:email",
    ts_utc: "2026-03-10T11:00:00.000Z",
    date_et: "2026-03-10",
    user_chat_id: "email-test-user",
    user_email: "test@example.com",
    digest_id: "2026-03-10:email-test-user",
    run_id: "scheduled:2026-03-10T11-00-00-000Z",
    channel: "email",
    source: "scheduled-job",
    metadata: {
      items: [
        {
          index: 1,
          headline: "Pfizer declares $0.43 quarterly dividend payable in March 2026",
          url: "https://ng.investing.com/news/company-news/pfizer-dividend-march-2026",
          tag: "PFIZER",
          base_score: 2.5,
          relevance_score: 7.2,
        },
      ],
    },
  },
  {
    event_type: "digest_sent",
    event_key: "digest_sent:2026-03-10:email-test-user:telegram",
    ts_utc: "2026-03-10T11:00:01.000Z",
    date_et: "2026-03-10",
    user_chat_id: "email-test-user",
    user_email: "test@example.com",
    digest_id: "2026-03-10:email-test-user",
    run_id: "scheduled:2026-03-10T11-00-00-000Z",
    channel: "telegram",
    source: "scheduled-job",
    metadata: {
      items: [
        {
          index: 1,
          headline: "Pfizer declares $0.43 quarterly dividend payable in March 2026",
          url: "https://ng.investing.com/news/company-news/pfizer-dividend-march-2026",
          tag: "PFIZER",
          base_score: 2.5,
          relevance_score: 7.2,
        },
      ],
    },
  },
  {
    event_type: "digest_sent",
    event_key: "digest_sent:2026-03-10:email-test-user:email-2",
    ts_utc: "2026-03-10T11:06:00.000Z",
    date_et: "2026-03-10",
    user_chat_id: "email-test-user",
    user_email: "test@example.com",
    digest_id: "2026-03-10:email-test-user",
    run_id: "scheduled:2026-03-10T11-06-00-000Z",
    channel: "email",
    source: "scheduled-job",
    metadata: {
      items: [
        {
          index: 1,
          headline: "Pfizer Provides 2026 Guidance: $59.5-$62.5B Revenue, Increased R&D Investment",
          url: "https://www.pfizer.com/news/press-release/pfizer-2026-guidance",
          tag: "PFIZER",
          base_score: 7.8,
          relevance_score: 9,
        },
      ],
    },
  },
];

fs.writeFileSync(
  path.join(tempRoot, "data", "engagement-events.jsonl"),
  eventLines.map((row) => JSON.stringify(row)).join("\n") + "\n"
);

const tempRuntime = createReplayRuntime({
  rootDir: tempRoot,
  replayResultsDir: path.join(tempRoot, "test-results", "replay"),
});

const loadedDeliveries = tempRuntime.loadUserDeliveries(
  tempUser,
  { mode: "all" },
  { start: "2026-03-10", end: "2026-03-10" }
);

assert.strictEqual(loadedDeliveries.length, 2, "channel fan-out should collapse to unique delivery instances");
assert.ok(
  loadedDeliveries.some((delivery) => Array.isArray(delivery.channels) && delivery.channels.length === 2),
  "grouped delivery should retain both email and telegram channels"
);
