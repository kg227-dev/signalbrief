"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/entrypoints/digest-orchestrator-core-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const { filterAlreadySentScheduledDueUsers } = runtime;
assert.strictEqual(typeof filterAlreadySentScheduledDueUsers, "function");

{
  const alpha = { chatId: "user-1", email: "alpha@example.com" };
  const beta = { chatId: "user-2", email: "beta@example.com" };
  const out = filterAlreadySentScheduledDueUsers(
    [alpha, beta],
    "2026-03-14",
    {
      hasSentDigestRecord: (userId, dateKey, mode) => (
        userId === "user-1" && dateKey === "2026-03-14" && mode === "scheduled"
      ),
    }
  );
  assert.deepStrictEqual(out.dueUsers, [beta]);
  assert.deepStrictEqual(out.skippedUsers, [alpha]);
}

{
  const gamma = { chatId: "user-3", email: "gamma@example.com" };
  const out = filterAlreadySentScheduledDueUsers(
    [gamma],
    "2026-03-14",
    null
  );
  assert.deepStrictEqual(out.dueUsers, [gamma]);
  assert.deepStrictEqual(out.skippedUsers, []);
}
