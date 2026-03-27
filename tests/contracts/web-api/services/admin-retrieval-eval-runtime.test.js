"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../../test-support/module-contract-helper.js");

const TARGET_REL = "web/services/admin-retrieval-eval-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const {
  createAdminRetrievalEvalRuntime,
  loadRetrievalEvalProgress,
} = runtime;

(() => {
  const files = new Map();
  const stats = new Map();
  const mockFs = {
    readFileSync(filePath) {
      if (!files.has(filePath)) throw new Error("missing");
      return files.get(filePath);
    },
    statSync(filePath) {
      if (!stats.has(filePath)) throw new Error("missing");
      return stats.get(filePath);
    },
  };

  const appRoot = process.cwd();
  const worklogPath = path.join(appRoot, "docs", "retrieval-eval-worklog.md");
  files.set(worklogPath, [
    "# Retrieval Eval Worklog",
    "",
    "### Pass 4: Coverage recovery",
    "",
    "Completed in this pass:",
    "- added better retries",
    "",
    "Key findings:",
    "- custom runs still thin",
    "",
    "### Pass 5: One more broad-query step",
    "",
    "Completed in this pass:",
    "- added one more broad-query step",
    "  - HEALTHCARE",
    "- reserved deep-retry budget",
    "",
    "Key findings:",
    "- helped ENERGY",
    "- did not improve low-yield standard-topic fallback",
    "",
    "## Important Run IDs",
    "- `retrieval-eval:2026-03-22T06-06-01-508Z`",
    "- `retrieval-eval:2026-03-22T06-10-49-849Z`",
    "",
    "## Remaining Problems",
    "- healthcare still stops too early",
    "- standard-topic retries still leave unused depth",
    "",
    "## Next Planned Work",
    "1. Improve query shaping",
    "2. Keep fail-closed behavior",
  ].join("\n"));
  stats.set(worklogPath, {
    mtime: new Date("2026-03-22T06:20:00.000Z"),
  });

  const progress = loadRetrievalEvalProgress({
    fs: mockFs,
    appRoot,
  });
  assert.strictEqual(progress.available, true);
  assert.strictEqual(progress.pass_count, 2);
  assert.strictEqual(progress.latest_pass.title, "Pass 5: One more broad-query step");
  assert.strictEqual(progress.latest_pass.completed.includes("added one more broad-query step"), true);
  assert.strictEqual(progress.latest_pass.completed.includes("HEALTHCARE"), true);
  assert.strictEqual(progress.latest_pass.findings[0], "helped ENERGY");
  assert.strictEqual(progress.remaining_problems[0], "healthcare still stops too early");
  assert.strictEqual(progress.next_steps[0], "Improve query shaping");
  assert.strictEqual(progress.important_runs[0], "retrieval-eval:2026-03-22T06-10-49-849Z");

  files.delete(worklogPath);
  const fallbackWorklogPath = path.join(appRoot, "data", "retrieval-evals", "worklog.md");
  files.set(fallbackWorklogPath, [
    "### Pass 1: Fallback progress",
    "",
    "Completed in this pass:",
    "- synced prod data path",
  ].join("\n"));
  stats.set(fallbackWorklogPath, {
    mtime: new Date("2026-03-22T06:30:00.000Z"),
  });
  const fallbackProgress = loadRetrievalEvalProgress({
    fs: mockFs,
    appRoot,
  });
  assert.strictEqual(fallbackProgress.available, true);
  assert.strictEqual(fallbackProgress.worklog_path, "data/retrieval-evals/worklog.md");
  assert.strictEqual(fallbackProgress.latest_pass.title, "Pass 1: Fallback progress");

  const adminRuntime = createAdminRetrievalEvalRuntime({
    fs: mockFs,
    appRoot,
    storage: {
      listRuns: () => [{ run_id: "retrieval-eval:latest", status: "completed" }],
      loadRun: (runId) => ({ run_id: runId, status: "completed" }),
      loadActiveRun: () => null,
      loadBudget: () => ({ cap_usd: 25, spent_usd: 4.1, remaining_usd: 20.9, reserve_usd: 5 }),
    },
  });
  const status = adminRuntime.loadStatus();
  assert.strictEqual(status.progress.latest_pass.title, "Pass 1: Fallback progress");
  assert.strictEqual(status.latest_runs[0].run_id, "retrieval-eval:latest");

  process.stdout.write("[admin-retrieval-eval-runtime] all assertions passed\n");
})();
