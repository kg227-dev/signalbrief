"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../test-support/module-contract-helper.js");

const SCHEDULE_REL = "src/entrypoints/digest-orchestrator-schedule-runtime.js";
const SCHEDULE_PATH = path.join(process.cwd(), SCHEDULE_REL);
assertNodeSyntaxFile(SCHEDULE_PATH);
const scheduleRuntime = require(SCHEDULE_PATH);
assertModuleExports(() => scheduleRuntime, SCHEDULE_REL);

const CORE_REL = "src/entrypoints/digest-orchestrator-core-runtime.js";
const CORE_PATH = path.join(process.cwd(), CORE_REL);
assertNodeSyntaxFile(CORE_PATH);
const coreRuntime = require(CORE_PATH);
assertModuleExports(() => coreRuntime, CORE_REL);

const { resolveDueUsers } = scheduleRuntime;
const { getEtNowParts, toEtDateString } = coreRuntime;

function buildUser(lastDigestAt = null) {
  return {
    chatId: "8711828141",
    email: "rishigulati129@gmail.com",
    status: "active",
    last_digest_at: lastDigestAt,
    preferences: {
      delivery_time: "21:30",
      days_of_week: [0, 1, 2, 3, 4, 5, 6],
    },
  };
}

function runResolveDueUsers({ nowIso, lastDigestAt, catchupWindowMinutes = 12 * 60 }) {
  return resolveDueUsers({
    targetChatId: null,
    allUsers: () => [buildUser(lastDigestAt)],
    USER_STATUS: { ACTIVE: "active" },
    getEtNow: () => new Date(nowIso),
    getEtNowParts,
    toEtDateString,
    CONFIG: {
      digest: {
        catchupWindowMinutes,
      },
    },
    log: () => {},
    allowExampleEmails: true,
  });
}

function buildRetryStateRuntime(entry) {
  return {
    getRetryState: () => entry || null,
  };
}

{
  const parts = getEtNowParts(new Date("2026-03-14T05:09:11.391Z"));
  assert.strictEqual(parts.todayET, "2026-03-14");
  assert.strictEqual(parts.todayDOW, 6);
  assert.strictEqual(parts.hour, 1);
  assert.strictEqual(parts.minute, 9);
  assert.strictEqual(parts.nowMinutes, 69);
}

{
  const out = runResolveDueUsers({
    nowIso: "2026-03-14T04:59:11.391Z",
    lastDigestAt: "2026-03-13T11:01:11.417Z",
  });
  assert.strictEqual(out.todayET, "2026-03-14");
  assert.strictEqual(out.dueUsers.length, 1, "user should be due during the first late-night catch-up run");
  assert.strictEqual(out.dueUsers[0].email, "rishigulati129@gmail.com");
}

{
  const out = runResolveDueUsers({
    nowIso: "2026-03-14T05:09:11.391Z",
    lastDigestAt: "2026-03-14T04:59:27.460Z",
  });
  assert.strictEqual(out.todayET, "2026-03-14");
  assert.strictEqual(out.dueUsers.length, 0, "user already sent on the same ET date should not be due again");
}

// catchupWindowMinutes=60 regression: midnight (12:04 AM ET) must NOT fire for a 21:30 delivery
// (diff wraps to 154 min, which exceeds the 60-min window)
{
  const out = runResolveDueUsers({
    nowIso: "2026-03-15T04:04:00.000Z", // 12:04 AM EDT on March 15
    lastDigestAt: "2026-03-02T02:28:09.897Z", // last digest was Mar 1 ET — no delivery today
    catchupWindowMinutes: 60,
  });
  assert.strictEqual(out.todayET, "2026-03-15");
  assert.strictEqual(out.dueUsers.length, 0, "60-min window should not catch a 21:30 delivery at midnight (154 min gap)");
}

// catchupWindowMinutes=60: 9:30 PM sharp is still due
{
  const out = runResolveDueUsers({
    nowIso: "2026-03-16T01:30:00.000Z", // 9:30 PM EDT on March 15
    lastDigestAt: "2026-03-14T04:04:00.000Z", // last digest was Mar 13 ET
    catchupWindowMinutes: 60,
  });
  assert.strictEqual(out.todayET, "2026-03-15");
  assert.strictEqual(out.dueUsers.length, 1, "60-min window: user is due at exactly 21:30 ET");
}

// catchupWindowMinutes=60: 59 min late (10:29 PM) is still due
{
  const out = runResolveDueUsers({
    nowIso: "2026-03-16T02:29:00.000Z", // 10:29 PM EDT on March 15
    lastDigestAt: "2026-03-14T04:04:00.000Z",
    catchupWindowMinutes: 60,
  });
  assert.strictEqual(out.todayET, "2026-03-15");
  assert.strictEqual(out.dueUsers.length, 1, "60-min window: user is still due 59 min after 21:30 ET");
}

// catchupWindowMinutes=60: 61 min late (10:31 PM) is NOT due
{
  const out = runResolveDueUsers({
    nowIso: "2026-03-16T02:31:00.000Z", // 10:31 PM EDT on March 15
    lastDigestAt: "2026-03-14T04:04:00.000Z",
    catchupWindowMinutes: 60,
  });
  assert.strictEqual(out.todayET, "2026-03-15");
  assert.strictEqual(out.dueUsers.length, 0, "60-min window: user is not due 61 min after 21:30 ET");
}

{
  const out = resolveDueUsers({
    targetChatId: null,
    allUsers: () => [buildUser("2026-03-14T04:04:00.000Z")],
    USER_STATUS: { ACTIVE: "active" },
    getEtNow: () => new Date("2026-03-16T02:05:00.000Z"),
    getEtNowParts,
    toEtDateString,
    CONFIG: { digest: { catchupWindowMinutes: 60 } },
    log: () => {},
    allowExampleEmails: true,
    retryStateRuntime: buildRetryStateRuntime({
      user_id: "8711828141",
      date_et: "2026-03-15",
      attempt_count: 1,
      next_retry_at: "2026-03-16T02:00:00.000Z",
      retry_pending: true,
    }),
  });
  assert.strictEqual(out.dueUsers.length, 1, "ready retry should be due even outside normal schedule diff");
  assert.strictEqual(out.dueUsers[0].__digest_retry.attempt_count, 1);
}

{
  const out = resolveDueUsers({
    targetChatId: null,
    allUsers: () => [buildUser("2026-03-14T04:04:00.000Z")],
    USER_STATUS: { ACTIVE: "active" },
    getEtNow: () => new Date("2026-03-16T01:40:00.000Z"),
    getEtNowParts,
    toEtDateString,
    CONFIG: { digest: { catchupWindowMinutes: 60 } },
    log: () => {},
    allowExampleEmails: true,
    retryStateRuntime: buildRetryStateRuntime({
      user_id: "8711828141",
      date_et: "2026-03-15",
      attempt_count: 1,
      next_retry_at: "2026-03-16T02:00:00.000Z",
      retry_pending: true,
    }),
  });
  assert.strictEqual(out.dueUsers.length, 0, "retry should wait until next_retry_at");
}

{
  const out = resolveDueUsers({
    targetChatId: null,
    allUsers: () => [{
      ...buildUser("2026-03-14T04:04:00.000Z"),
      preferences: {
        delivery_time: "21:30",
        days_of_week: [0, 1, 2, 3, 4, 5, 6],
        email_enabled: false,
        telegram_enabled: false,
      },
    }],
    USER_STATUS: { ACTIVE: "active" },
    getEtNow: () => new Date("2026-03-16T01:30:00.000Z"),
    getEtNowParts,
    toEtDateString,
    CONFIG: { digest: { catchupWindowMinutes: 60 } },
    log: () => {},
    allowExampleEmails: true,
  });
  assert.strictEqual(out.dueUsers.length, 0, "scheduled runs should ignore users with no enabled delivery channel");
}

{
  const out = resolveDueUsers({
    targetChatId: null,
    allUsers: () => [buildUser("2026-03-14T04:04:00.000Z")],
    USER_STATUS: { ACTIVE: "active" },
    getEtNow: () => new Date("2026-03-16T02:05:00.000Z"),
    getEtNowParts,
    toEtDateString,
    CONFIG: { digest: { catchupWindowMinutes: 60 } },
    log: () => {},
    allowExampleEmails: true,
    retryStateRuntime: buildRetryStateRuntime({
      user_id: "8711828141",
      date_et: "2026-03-15",
      attempt_count: 2,
      delivery_outcome: "delivery_failed_after_retry",
      retry_pending: false,
    }),
  });
  assert.strictEqual(out.dueUsers.length, 0, "terminal delivery failures should halt further scheduled retries");
}

{
  const out = resolveDueUsers({
    targetChatId: null,
    allUsers: () => [buildUser("2026-03-14T04:04:00.000Z")],
    USER_STATUS: { ACTIVE: "active" },
    getEtNow: () => new Date("2026-03-16T02:05:00.000Z"),
    getEtNowParts,
    toEtDateString,
    CONFIG: { digest: { catchupWindowMinutes: 60 } },
    log: () => {},
    allowExampleEmails: true,
    retryStateRuntime: buildRetryStateRuntime({
      user_id: "8711828141",
      date_et: "2026-03-15",
      attempt_count: 2,
      delivery_outcome: "withheld_retry_pending",
      retry_pending: true,
      next_retry_at: "2026-03-16T02:00:00.000Z",
    }),
  });
  assert.strictEqual(out.dueUsers.length, 0, "scheduler should hard-stop users that already exhausted the single retry budget");
}
