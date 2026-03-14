"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "web/routes/admin-api-stats-payload-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);

assertNodeSyntaxFile(TARGET_PATH);
assertModuleExports(() => require(TARGET_PATH), TARGET_REL);

const { buildExecutiveHealthSummary } = require(TARGET_PATH);

function buildHealthyScheduler() {
  return {
    available: true,
    healthy: true,
    status: "healthy",
    blocked: false,
    age_seconds: 12,
    last_error: null,
  };
}

function buildIdleRunner() {
  return {
    running: false,
    unhealthy: false,
    state: "absent",
  };
}

const yellowSummary = buildExecutiveHealthSummary({
  deliveryWarnings: [],
  deliveryReliability: {
    success_rate_7d: 64.3,
    missed_current_7d: 1,
    last_successful_scheduled_run: "2026-03-13T11:01:00.000Z",
    next_expected_delivery_et: "Sat, Mar 14 · 7:00 AM ET",
    next_expected_countdown: "6h 56m",
  },
  deliveryOperations: {
    active_recovery_queue: 0,
    latest_scheduled_run_at: "2026-03-13T11:01:00.000Z",
    latest_scheduled_run_clean: true,
    latest_scheduled_run_failed_users: 0,
    backfill_needed: false,
    active_incident_open: false,
  },
  schedulerWorker: buildHealthyScheduler(),
  digestRunner: buildIdleRunner(),
});

assert.strictEqual(yellowSummary.status, "yellow", "historical misses alone should create a yellow watch state");
assert.strictEqual(yellowSummary.can_deliver_next_run, true, "healthy scheduler + idle runner should still be deliverable");
assert.ok(
  !yellowSummary.commands.some((command) => command.id === "run_full_digest"),
  "yellow reliability watch should not recommend a full digest backfill"
);
assert.ok(
  !yellowSummary.commands.some((command) => command.id === "review_missed_users"),
  "yellow reliability watch should not recommend missed-user recovery without an active queue"
);

const recoverySummary = buildExecutiveHealthSummary({
  deliveryWarnings: [],
  deliveryReliability: {
    success_rate_7d: 96.2,
    missed_current_7d: 0,
    last_successful_scheduled_run: "2026-03-13T11:01:00.000Z",
    next_expected_delivery_et: "Sat, Mar 14 · 7:00 AM ET",
    next_expected_countdown: "6h 56m",
  },
  deliveryOperations: {
    active_recovery_queue: 2,
    latest_scheduled_run_at: "2026-03-13T11:01:00.000Z",
    latest_scheduled_run_clean: false,
    latest_scheduled_run_failed_users: 2,
    backfill_needed: false,
    active_incident_open: false,
  },
  schedulerWorker: buildHealthyScheduler(),
  digestRunner: buildIdleRunner(),
});

assert.strictEqual(recoverySummary.status, "red", "active recovery queue should be red");
assert.ok(
  recoverySummary.commands.some((command) => command.id === "review_missed_users"),
  "active recovery queue should expose review missed users"
);
assert.ok(
  !recoverySummary.commands.some((command) => command.id === "run_full_digest"),
  "recovery queue alone should not expose full digest backfill"
);

const backfillSummary = buildExecutiveHealthSummary({
  deliveryWarnings: [],
  deliveryReliability: {
    success_rate_7d: 96.2,
    missed_current_7d: 0,
    last_successful_scheduled_run: "2026-03-13T11:01:00.000Z",
    next_expected_delivery_et: "Sat, Mar 14 · 7:00 AM ET",
    next_expected_countdown: "6h 56m",
  },
  deliveryOperations: {
    active_recovery_queue: 0,
    latest_scheduled_run_at: "2026-03-13T11:01:00.000Z",
    latest_scheduled_run_clean: true,
    latest_scheduled_run_failed_users: 0,
    backfill_needed: true,
    active_incident_open: false,
  },
  schedulerWorker: buildHealthyScheduler(),
  digestRunner: buildIdleRunner(),
});

assert.strictEqual(backfillSummary.status, "red", "missed scheduled window should be red");
assert.ok(
  backfillSummary.commands.some((command) => command.id === "run_full_digest"),
  "backfill condition should expose run full digest now"
);
assert.ok(
  !backfillSummary.commands.some((command) => command.id === "review_missed_users"),
  "backfill without failed recipients should not expose review missed users"
);
