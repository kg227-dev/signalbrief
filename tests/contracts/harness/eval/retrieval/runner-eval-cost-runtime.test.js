"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
  assertSourceIncludesFile,
} = require("../../../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/eval/retrieval/runner-eval-cost-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
assertSourceIncludesFile(TARGET_PATH, []);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const {
  budgetGuardStatus,
  buildScenarioEstimate,
  computeScenarioCost,
  resolveEvalSelectionTarget,
} = runtime;

const guard = budgetGuardStatus({ remaining_usd: 6, reserve_usd: 5 }, 1.2);
assert.strictEqual(guard.ok, false);
assert.strictEqual(guard.remaining_after_reserve_usd, 1);

const estimate = buildScenarioEstimate({
  CONFIG: {
    digest: {
      search_budget: {
        scheduled: { hard_calls: 2 },
      },
    },
  },
}, {
  dueUsers: [{ chatId: "one" }, { chatId: "two" }],
});
assert.strictEqual(estimate, 0.091);

const scenarioCost = computeScenarioCost({
  fetchResult: {
    standardFetchCalls: 3,
  },
  enrichResult: {
    claudeUsage: {
      input_tokens: 1000,
      output_tokens: 2000,
    },
  },
});
assert.strictEqual(scenarioCost.perplexityCost, 0.015);
assert.strictEqual(scenarioCost.claudeCost, 0.0088);
assert.strictEqual(scenarioCost.totalCost, 0.0238);

assert.strictEqual(
  resolveEvalSelectionTarget({
    scenarioId: "standard_full",
    dueUsers: [{ topics: ["TECHNOLOGY"] }],
    baseSelectionTarget: 5,
  }),
  5
);
