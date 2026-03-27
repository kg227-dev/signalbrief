"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../../test-support/module-contract-helper.js");

const TARGET_REL = "web/services/admin-stats-costs.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);

assertNodeSyntaxFile(TARGET_PATH);
const {
  buildTrailingWindowCostSummary,
  buildProjectedWindowCostSummary,
} = require(TARGET_PATH);
assertModuleExports(() => require(TARGET_PATH), TARGET_REL);

const trailing = buildTrailingWindowCostSummary([
  { date: "2026-03-14", total_cost_usd: 0.10, users_served: 2, on_demand: false },
  { date: "2026-03-13", total_cost_usd: 0.05, users_served: 1, on_demand: true },
  { date: "2026-03-08", total_cost_usd: 0.04, users_served: 1, on_demand: false },
  { date: "2026-03-07", total_cost_usd: 0.20, users_served: 3, on_demand: false },
], {
  nowParts: { year: 2026, month: 3, day: 14, hour: 12, minute: 0 },
  days: 7,
});

assert.strictEqual(trailing.start_date_et, "2026-03-08");
assert.strictEqual(trailing.end_date_et, "2026-03-14");
assert.strictEqual(trailing.runs.length, 2, "trailing window should include only scheduled runs in the last 7 ET dates");
assert.strictEqual(trailing.total_cost, 0.14);
assert.strictEqual(trailing.scheduled_cost, 0.14);
assert.strictEqual(trailing.scheduled_runs, 2);
assert.strictEqual(Object.prototype.hasOwnProperty.call(trailing, "on_demand_cost"), false);
assert.strictEqual(Object.prototype.hasOwnProperty.call(trailing, "on_demand_runs"), false);
assert.strictEqual(trailing.deliveries, 3);

const projected = buildProjectedWindowCostSummary({
  roster: [
    {
      status: "active",
      days_of_week: [1, 2, 3, 4, 5],
      delivery_time_raw: "07:00",
      topics_raw: ["HEALTHCARE"],
    },
    {
      status: "active",
      days_of_week: [1, 2, 3, 4, 5],
      delivery_time_raw: "21:30",
      topics_raw: ["TECHNOLOGY"],
    },
    {
      status: "active",
      days_of_week: [0, 1, 2, 3, 4, 5, 6],
      delivery_time_raw: "07:00",
      topics_raw: ["TECHNOLOGY"],
    },
    {
      status: "paused",
      days_of_week: [1, 2, 3, 4, 5],
      delivery_time_raw: "07:00",
      topics_raw: ["ENERGY"],
    },
  ],
  nowParts: { year: 2026, month: 3, day: 16, hour: 9, minute: 0 },
  config: {
    topics: [{ tag: "HEALTHCARE" }, { tag: "FINANCIAL SERVICES" }, { tag: "TECHNOLOGY" }],
  },
  estimateSandboxCost: ({ topics, itemCount }) => ({
    totalUsd: parseFloat((topics.length * 0.01 + itemCount * 0.001).toFixed(5)),
  }),
  days: 7,
});

assert.strictEqual(projected.scheduled_runs, 11, "projection should batch users by ET date and delivery time");
assert.strictEqual(projected.projected_deliveries, 15, "projection should count all future active deliveries in window");
assert.strictEqual(projected.active_users, 3);
assert.strictEqual(projected.total_cost, 0.385);
assert.strictEqual(projected.projected_runs[0].date_et, "2026-03-16");
assert.strictEqual(projected.projected_runs[0].delivery_time_raw, "21:30");
