"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "web/services/admin-stats-delivery.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);

assertNodeSyntaxFile(TARGET_PATH);
assertModuleExports(() => require(TARGET_PATH), TARGET_REL);

const { buildDeliveryOperationsSnapshot } = require(TARGET_PATH);

const roster = [
  {
    status: "active",
    email: "ceo@example.com",
    delivery_time: "07:00",
    days_of_week: [0, 1, 2, 3, 4, 5, 6],
  },
];

const healthyOps = buildDeliveryOperationsSnapshot({
  runs: [
    {
      date: "2026-03-14",
      run_at: "2026-03-14T11:00:00.000Z",
      on_demand: false,
      users_targeted: 1,
      users_served: 1,
      per_user: [{ id: "ceo@example.com" }],
      per_user_failed: [],
    },
  ],
  roster,
  parseEtNowParts: () => ({ year: 2026, month: 3, day: 14, hour: 8, minute: 0 }),
  readJsonLineLog: () => [],
  digestIncidentLog: "/tmp/fake-incidents.jsonl",
});

assert.strictEqual(healthyOps.latest_scheduled_run_clean, true, "latest scheduled run should be marked clean when no failures exist");
assert.strictEqual(healthyOps.active_recovery_queue, 0, "healthy run should not create a recovery queue");
assert.strictEqual(healthyOps.backfill_needed, false, "same-day scheduled run should not require backfill");

const backfillOps = buildDeliveryOperationsSnapshot({
  runs: [
    {
      date: "2026-03-13",
      run_at: "2026-03-13T11:00:00.000Z",
      on_demand: false,
      users_targeted: 1,
      users_served: 1,
      per_user: [{ id: "ceo@example.com" }],
      per_user_failed: [],
    },
  ],
  roster,
  parseEtNowParts: () => ({ year: 2026, month: 3, day: 14, hour: 8, minute: 0 }),
  readJsonLineLog: () => [],
  digestIncidentLog: "/tmp/fake-incidents.jsonl",
});

assert.strictEqual(backfillOps.backfill_needed, true, "past-due scheduled users with no same-day run should require backfill");

const targetedIncidentOps = buildDeliveryOperationsSnapshot({
  runs: [],
  roster,
  parseEtNowParts: () => ({ year: 2026, month: 3, day: 14, hour: 8, minute: 0 }),
  readJsonLineLog: () => [
    {
      ts_utc: new Date().toISOString(),
      summary: "targeted issue only",
      metadata: { mode: "targeted" },
    },
  ],
  digestIncidentLog: "/tmp/fake-incidents.jsonl",
});

assert.strictEqual(targetedIncidentOps.active_incident_open, false, "targeted incidents should not page the CEO status");

const scheduledIncidentOps = buildDeliveryOperationsSnapshot({
  runs: [],
  roster,
  parseEtNowParts: () => ({ year: 2026, month: 3, day: 14, hour: 8, minute: 0 }),
  readJsonLineLog: () => [
    {
      ts_utc: new Date().toISOString(),
      summary: "scheduled delivery degradation",
      metadata: { mode: "scheduled" },
    },
  ],
  digestIncidentLog: "/tmp/fake-incidents.jsonl",
});

assert.strictEqual(scheduledIncidentOps.active_incident_open, true, "scheduled incidents should mark the CEO status as having an active incident");
assert.strictEqual(scheduledIncidentOps.active_incident_summary, "scheduled delivery degradation");
