"use strict";

const assert = require("assert");
const path = require("path");
const { assertNodeSyntaxFile, assertModuleExports } = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/entrypoints/digest-orchestrator-admission-gate-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);
const {
  createDigestOrchestratorAdmissionGateRuntime,
  RUN_VALUE_STATE_ABORTED,
  RUN_VALUE_STATE_ALLOWED,
} = runtime;
assert.strictEqual(typeof createDigestOrchestratorAdmissionGateRuntime, "function");
assert.strictEqual(RUN_VALUE_STATE_ABORTED, "aborted_non_deliverable_pre_spend");
assert.strictEqual(RUN_VALUE_STATE_ALLOWED, "pending_delivery");

const DUE_USERS = [
  { chatId: "u1", email: "a@test.com" },
  { chatId: "u2", email: "b@test.com" },
];

function makeSpendGuard({ rollingHit = false, dailyHit = false, userDateHit = false } = {}) {
  return {
    checkRollingWindowCap: () => ({ hit: rollingHit, spent: rollingHit ? 1.1 : 0.1, threshold: 1.0 }),
    checkDailyCap: () => ({ hit: dailyHit, spent: dailyHit ? 2.6 : 0.5, threshold: 2.5 }),
    hasUserDateZeroValueAttempt: () => userDateHit,
  };
}

function makeCb(open = false) {
  return { isOpen: () => open };
}

function makeRetryState(stateByUserId = {}) {
  return { getRetryState: (userId) => stateByUserId[userId] || null };
}

// 1. Circuit open blocks run
{
  const gate = createDigestOrchestratorAdmissionGateRuntime({
    circuitBreakerRuntime: makeCb(true),
    spendGuardRuntime: makeSpendGuard(),
    log: () => {},
  });
  const result = gate.checkScheduledAdmission({ dueUsers: DUE_USERS, dateEt: "2026-03-23", retryStateRuntime: makeRetryState() });
  assert.strictEqual(result.allowed, false);
  assert.strictEqual(result.blockedReason, "circuit_breaker_open");
  assert.strictEqual(result.runValueState, RUN_VALUE_STATE_ABORTED);
  assert.deepStrictEqual(result.eligibleUsers, []);
}

// 2. Rolling window cap hit blocks run
{
  const gate = createDigestOrchestratorAdmissionGateRuntime({
    circuitBreakerRuntime: makeCb(false),
    spendGuardRuntime: makeSpendGuard({ rollingHit: true }),
    log: () => {},
  });
  const result = gate.checkScheduledAdmission({ dueUsers: DUE_USERS, dateEt: "2026-03-23", retryStateRuntime: makeRetryState() });
  assert.strictEqual(result.allowed, false);
  assert.ok(result.blockedReason.startsWith("rolling_window_cap_hit"));
}

// 3. Daily cap hit blocks run
{
  const gate = createDigestOrchestratorAdmissionGateRuntime({
    circuitBreakerRuntime: makeCb(false),
    spendGuardRuntime: makeSpendGuard({ dailyHit: true }),
    log: () => {},
  });
  const result = gate.checkScheduledAdmission({ dueUsers: DUE_USERS, dateEt: "2026-03-23", retryStateRuntime: makeRetryState() });
  assert.strictEqual(result.allowed, false);
  assert.ok(result.blockedReason.startsWith("daily_cap_hit"));
}

// 4. User with non-transient underfill in retry state is filtered out
{
  const gate = createDigestOrchestratorAdmissionGateRuntime({
    circuitBreakerRuntime: makeCb(false),
    spendGuardRuntime: makeSpendGuard(),
    log: () => {},
  });
  const retryState = makeRetryState({ u1: { underfill_reason: "retrieval_thin", retry_pending: true } });
  const result = gate.checkScheduledAdmission({ dueUsers: DUE_USERS, dateEt: "2026-03-23", retryStateRuntime: retryState });
  assert.strictEqual(result.allowed, true, "run allowed because u2 is still eligible");
  assert.strictEqual(result.eligibleUsers.length, 1, "only u2 eligible");
  assert.strictEqual(result.eligibleUsers[0].chatId, "u2");
}

// 5. All users filtered → blocked
{
  const gate = createDigestOrchestratorAdmissionGateRuntime({
    circuitBreakerRuntime: makeCb(false),
    spendGuardRuntime: makeSpendGuard({ userDateHit: true }),
    log: () => {},
  });
  const result = gate.checkScheduledAdmission({ dueUsers: DUE_USERS, dateEt: "2026-03-23", retryStateRuntime: makeRetryState() });
  assert.strictEqual(result.allowed, false);
  assert.strictEqual(result.blockedReason, "all_users_at_zero_value_cap");
}

// 6. All clear → allowed with all due users
{
  const gate = createDigestOrchestratorAdmissionGateRuntime({
    circuitBreakerRuntime: makeCb(false),
    spendGuardRuntime: makeSpendGuard(),
    log: () => {},
  });
  const result = gate.checkScheduledAdmission({ dueUsers: DUE_USERS, dateEt: "2026-03-23", retryStateRuntime: makeRetryState() });
  assert.strictEqual(result.allowed, true);
  assert.strictEqual(result.eligibleUsers.length, 2);
  assert.strictEqual(result.runValueState, RUN_VALUE_STATE_ALLOWED);
}

// 7. On-demand runs bypass all gates
{
  const gate = createDigestOrchestratorAdmissionGateRuntime({
    circuitBreakerRuntime: makeCb(true),
    spendGuardRuntime: makeSpendGuard({ rollingHit: true, dailyHit: true }),
    log: () => {},
  });
  const result = gate.checkOnDemandAdmission({ dueUsers: DUE_USERS });
  assert.strictEqual(result.allowed, true, "on-demand bypasses all gates");
  assert.strictEqual(result.eligibleUsers.length, 2);
}

console.log("PASS: admission gate runtime");
