"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/eval/retrieval/storage-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const {
  createRetrievalEvalStorageRuntime,
  normalizeBudget,
} = runtime;

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-retrieval-eval-storage-"));
const storage = createRetrievalEvalStorageRuntime({
  fs,
  rootDir: tempDir,
  appRoot: process.cwd(),
});

const normalized = normalizeBudget({
  cap_usd: 20,
  reserve_usd: 4,
  spent_usd: 3.5,
  stop_reason: "budget_cap_before:custom_adversarial",
});
assert.strictEqual(normalized.remaining_usd, 16.5);
assert.strictEqual(normalized.stop_reason, "budget_cap_before:custom_adversarial");

storage.ensureRoot();
const savedBudget = storage.saveBudget(normalized);
assert.strictEqual(savedBudget.cap_usd, 20);
assert.strictEqual(storage.loadBudget().spent_usd, 3.5);

storage.saveActiveRun({
  run_id: "retrieval-eval:test-active",
  status: "running",
});
assert.strictEqual(storage.loadActiveRun().run_id, "retrieval-eval:test-active");

storage.saveRun({
  run_id: "retrieval-eval:test-run",
  status: "completed",
  started_at: "2026-03-21T12:00:00.000Z",
  completed_at: "2026-03-21T12:05:00.000Z",
  budget: savedBudget,
  overall_summary: {
    overall_score: 78.2,
    strongest_band: "strong",
    weakest_band: "decent",
  },
  scenarios: [{ id: "standard_full" }],
});

const runs = storage.listRuns(5);
assert.strictEqual(runs.length, 1);
assert.strictEqual(runs[0].run_id, "retrieval-eval:test-run");
assert.strictEqual(runs[0].budget_spent_usd, 3.5);
assert.strictEqual(storage.loadRun("retrieval-eval:test-run").status, "completed");
assert.strictEqual(fs.existsSync(path.join(tempDir, "runs", "retrieval-eval:test-run.json")), true);

storage.clearActiveRun();
assert.strictEqual(storage.loadActiveRun(), null);

process.stdout.write("[retrieval-storage-runtime] all assertions passed\n");
