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

function runResolveDueUsers({ nowIso, lastDigestAt }) {
  return resolveDueUsers({
    targetChatId: null,
    allUsers: () => [buildUser(lastDigestAt)],
    USER_STATUS: { ACTIVE: "active" },
    getEtNow: () => new Date(nowIso),
    getEtNowParts,
    toEtDateString,
    CONFIG: {
      digest: {
        catchupWindowMinutes: 12 * 60,
      },
    },
    log: () => {},
    allowExampleEmails: true,
  });
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
