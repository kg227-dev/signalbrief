"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "scripts/migrate-runtime-state-root.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const {
  inventoryCopyPlan,
  executePlan,
} = runtime;

(() => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-runtime-state-migrate-"));
  const sourceDir = path.join(rootDir, "source");
  const targetDir = path.join(rootDir, "target");
  fs.mkdirSync(path.join(sourceDir, "nested"), { recursive: true });
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(path.join(sourceDir, "alpha.json"), JSON.stringify({ ok: true }));
  fs.writeFileSync(path.join(sourceDir, "nested", "beta.json"), JSON.stringify({ beta: 1 }));

  try {
    const initialPlan = inventoryCopyPlan(sourceDir, targetDir, { includeEphemeral: false, overwrite: false });
    assert.strictEqual(initialPlan.filter((entry) => entry.action === "copy").length, 2);

    const dryRunSummary = executePlan(initialPlan, { dryRun: true });
    assert.strictEqual(dryRunSummary.copied, 2);
    assert.strictEqual(fs.existsSync(path.join(targetDir, "alpha.json")), false);

    const executeSummary = executePlan(initialPlan, { dryRun: false });
    assert.strictEqual(executeSummary.copied, 2);
    assert.strictEqual(fs.existsSync(path.join(targetDir, "alpha.json")), true);

    const rerunPlan = inventoryCopyPlan(sourceDir, targetDir, { includeEphemeral: false, overwrite: false });
    assert.strictEqual(rerunPlan.every((entry) => entry.action === "skip_identical"), true);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
})();

process.stdout.write("[migrate-runtime-state-root] all assertions passed\n");
