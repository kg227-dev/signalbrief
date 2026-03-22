"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/eval/retrieval/runner-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const {
  budgetGuardStatus,
  buildScenarioEstimate,
  runRetrievalEval,
} = runtime;
const { createRetrievalEvalStorageRuntime } = require(path.join(process.cwd(), "src/eval/retrieval/storage-runtime.js"));

(async () => {
  const guard = budgetGuardStatus({
    remaining_usd: 6,
    reserve_usd: 5,
  }, 1.2);
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

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-retrieval-eval-runner-"));
  const storage = createRetrievalEvalStorageRuntime({
    fs,
    rootDir: tempDir,
    appRoot: process.cwd(),
  });
  const services = {
    CONFIG: {
      digest: {
        search_budget: {
          scheduled: { hard_calls: 2 },
        },
      },
    },
    runtimePaths: { appRoot: process.cwd() },
    sourceRegistryRuntime: {
      loadSourceRegistry: () => ({ version: 1, domains: {}, identities: {} }),
      buildRegistryMap: () => ({ domains: new Map(), identities: new Map() }),
    },
    preferredSourceRegistryRuntime: {
      loadPreferredSourceRegistry: () => ({ version: 1, global: { reported: [], official: [] }, topics: {} }),
    },
    deliveryRecordRuntime: {
      loadAllCurrentRecords: () => [],
    },
  };

  const result = await runRetrievalEval({
    runId: "retrieval-eval:test-budget-stop",
    resetBudget: true,
    budgetCapUsd: 0.05,
    budgetReserveUsd: 0,
    scenarioDefs: [{
      id: "budget_stop",
      label: "budget stop",
      dueUsers: [{ chatId: "eval-budget-stop", preferences: { items_per_digest: 5 } }],
      personaCount: 1,
    }],
    services,
    storage,
  });

  assert.strictEqual(result.status, "completed");
  assert.strictEqual(result.delivery_disabled, true);
  assert.deepStrictEqual(result.transport_channels_disabled, ["email", "telegram"]);
  assert.strictEqual(result.budget.stop_reason, "budget_cap_before:budget_stop");
  assert.strictEqual(result.scenarios.length, 0);
  assert.ok(result.recommendations.some((row) => String(row).includes("Stopped before")));
  assert.strictEqual(storage.loadRun("retrieval-eval:test-budget-stop").status, "completed");

  process.stdout.write("[retrieval-runner-runtime] all assertions passed\n");
})().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
