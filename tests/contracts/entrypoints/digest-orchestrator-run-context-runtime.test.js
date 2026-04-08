"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/entrypoints/digest-orchestrator-run-context-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);

assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const {
  validateDigestRunOptions,
  createDigestOrchestratorRunContextRuntime,
} = runtime;

assert.throws(() => validateDigestRunOptions({
  inventoryRefreshOnly: true,
  auditOnly: true,
  auditTopicRerun: false,
}), /Inventory refresh runs cannot be combined/);

assert.throws(() => validateDigestRunOptions({
  inventoryRefreshOnly: false,
  auditOnly: true,
  auditTopicRerun: false,
}), /Audit-only digest runs require --auditTopic=TOPIC/);

assert.throws(() => validateDigestRunOptions({
  inventoryRefreshOnly: false,
  auditOnly: true,
  auditTopicRerun: true,
  auditDateKey: "2026-04-07",
  todayEt: "2026-04-08",
}), /only support today ET/);

function buildRuntime(overrides = {}) {
  const state = {
    logs: [],
    events: [],
    costCalls: [],
    releaseCalls: [],
  };
  const deps = {
    allUsers: () => [],
    USER_STATUS: { ACTIVE: "active" },
    standardMvpTopicTags: ["TECHNOLOGY", "HEALTHCARE"],
    log: (message) => state.logs.push(message),
    logEvent: (_level, event, fields) => state.events.push({ event, fields }),
    resolveDueUsers: () => ({ todayET: "2026-04-08", dueUsers: [] }),
    getEtNow: () => new Date("2026-04-08T14:00:00.000Z"),
    getEtNowParts: () => ({}),
    toEtDateString: () => "2026-04-08",
    CONFIG: { digest: {} },
    filterAlreadySentScheduledDueUsers: (dueUsers) => ({ dueUsers, skippedUsers: [] }),
    getDigestDeliveryRecordRuntime: () => ({ label: "delivery-record" }),
    getDigestRetryStateRuntime: () => ({ label: "retry-state" }),
    allowExampleEmails: true,
    createDigestOrchestratorAdmissionGateRuntime: () => ({
      checkScheduledAdmission: () => ({ allowed: true, eligibleUsers: [] }),
    }),
    getDigestOrchestratorSpendGuardRuntime: () => ({ label: "spend-guard" }),
    getDigestOrchestratorCircuitBreakerRuntime: () => ({ label: "circuit-breaker" }),
    rollingWindowCapUsd: 1,
    rollingWindowHours: 24,
    dailyCapUsd: 1,
    recordRunCost: (payload) => state.costCalls.push(payload),
    releaseDigestLock: (runMode) => state.releaseCalls.push(runMode),
    ...overrides,
  };
  return {
    state,
    runtime: createDigestOrchestratorRunContextRuntime(deps),
  };
}

{
  const { state, runtime: contextRuntime } = buildRuntime();
  const out = contextRuntime.prepareDigestRunContext({
    runOptions: {
      dryRun: false,
      auditOnly: false,
      runMode: "inventory_refresh",
      inventoryRefreshOnly: true,
      auditTopicTag: "",
      auditDateKey: "2026-04-08",
      todayEt: "2026-04-08",
      auditTopicRerun: false,
    },
    runId: "inventory:run",
  });
  assert.strictEqual(out.shouldExit, false);
  assert.strictEqual(out.fetchDueUsers.length, 1);
  assert.strictEqual(out.fetchDueUsers[0].chatId, "inventory-refresh:2026-04-08");
  assert.ok(state.logs.some((line) => line.includes("inventory refresh starting")));
}

{
  const { state, runtime: contextRuntime } = buildRuntime({
    resolveDueUsers: () => ({ todayET: "2026-04-08", dueUsers: [] }),
  });
  const out = contextRuntime.prepareDigestRunContext({
    runOptions: {
      dryRun: false,
      auditOnly: false,
      runMode: "scheduled",
      inventoryRefreshOnly: false,
      auditTopicTag: "",
      auditDateKey: "2026-04-08",
      todayEt: "2026-04-08",
      auditTopicRerun: false,
    },
    runId: "scheduled:no-due",
  });
  assert.strictEqual(out.shouldExit, true);
  assert.strictEqual(out.exitCode, 0);
  assert.ok(state.events.some((entry) => entry.event === "digest.run.skipped" && entry.fields.outcome === "no_due_users"));
}

{
  const dueUsers = [{ chatId: "u1", email: "user@example.com" }];
  const { state, runtime: contextRuntime } = buildRuntime({
    resolveDueUsers: () => ({ todayET: "2026-04-08", dueUsers }),
    createDigestOrchestratorAdmissionGateRuntime: () => ({
      checkScheduledAdmission: () => ({
        allowed: false,
        runValueState: "blocked_daily_cap",
        blockedReason: "daily cap reached",
      }),
    }),
  });
  const out = contextRuntime.prepareDigestRunContext({
    runOptions: {
      dryRun: false,
      auditOnly: false,
      runMode: "scheduled",
      inventoryRefreshOnly: false,
      auditTopicTag: "",
      auditDateKey: "2026-04-08",
      todayEt: "2026-04-08",
      auditTopicRerun: false,
    },
    runId: "scheduled:blocked",
    now: new Date("2026-04-08T15:00:00.000Z"),
  });
  assert.strictEqual(out.shouldExit, true);
  assert.strictEqual(out.exitCode, 0);
  assert.strictEqual(state.costCalls.length, 1);
  assert.strictEqual(state.costCalls[0].runValueState, "blocked_daily_cap");
  assert.deepStrictEqual(state.releaseCalls, ["scheduled"]);
  assert.ok(state.events.some((entry) => entry.event === "digest.run.blocked"));
}

{
  const dueUsers = [{ chatId: "u1", email: "user@example.com" }];
  const { state, runtime: contextRuntime } = buildRuntime({
    resolveDueUsers: () => ({ todayET: "2026-04-08", dueUsers }),
    createDigestOrchestratorAdmissionGateRuntime: () => ({
      checkScheduledAdmission: () => ({
        allowed: true,
        eligibleUsers: dueUsers,
      }),
    }),
  });
  const out = contextRuntime.prepareDigestRunContext({
    runOptions: {
      dryRun: true,
      auditOnly: false,
      runMode: "scheduled",
      inventoryRefreshOnly: false,
      auditTopicTag: "",
      auditDateKey: "2026-04-08",
      todayEt: "2026-04-08",
      auditTopicRerun: false,
    },
    runId: "scheduled:dry-run",
  });
  assert.strictEqual(out.shouldExit, true);
  assert.strictEqual(out.exitCode, 0);
  assert.ok(state.events.some((entry) => entry.event === "digest.run.skipped" && entry.fields.outcome === "dry_run"));
}

process.stdout.write("[digest-orchestrator-run-context-runtime] all assertions passed\n");
