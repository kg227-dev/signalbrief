"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../../test-support/module-contract-helper.js");

const RUNTIME_REL = "scripts/deploy-rollback-by-sha-runtime.js";
const CLI_REL = "scripts/deploy-rollback-by-sha.js";
const RUNTIME_PATH = path.join(process.cwd(), RUNTIME_REL);
const CLI_PATH = path.join(process.cwd(), CLI_REL);
assertNodeSyntaxFile(RUNTIME_PATH);
assertNodeSyntaxFile(CLI_PATH);
const runtime = require(RUNTIME_PATH);
assertModuleExports(() => runtime, RUNTIME_REL);

const {
  resolveRollbackByShaOptions,
  runPublicHealthChecklist,
  runRollbackBySha,
} = runtime;

assert.strictEqual(typeof resolveRollbackByShaOptions, "function");
assert.strictEqual(typeof runPublicHealthChecklist, "function");
assert.strictEqual(typeof runRollbackBySha, "function");

const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-rollback-sha-"));
const resolved = resolveRollbackByShaOptions([
  "--rollback-sha", "abc1234",
  "--restore-sha", "def5678",
  "--public-url", "https://prod.example.com",
  "--artifact-dir", "artifacts",
  "--artifact-name", "rollback.json",
  "--verify-attempts", "5",
  "--verify-delay-ms", "1234",
  "--emergency-source-build",
  "--respect-release-window",
  "--no-hotfix",
], {}, rootDir);
assert.strictEqual(resolved.rollbackSha, "abc1234");
assert.strictEqual(resolved.restoreSha, "def5678");
assert.strictEqual(resolved.publicUrl, "https://prod.example.com");
assert.strictEqual(resolved.artifactDir, path.join(rootDir, "artifacts"));
assert.strictEqual(resolved.artifactName, "rollback.json");
assert.strictEqual(resolved.verifyAttempts, 5);
assert.strictEqual(resolved.verifyDelayMs, 1234);
assert.strictEqual(resolved.emergencySourceBuild, true);
assert.strictEqual(resolved.allowOutsideWindow, false);
assert.strictEqual(resolved.hotfix, false);

(async () => {
  const healthPass = await runPublicHealthChecklist({
    publicUrl: "https://prod.example.com",
    verifyAttempts: 1,
    verifyDelayMs: 1,
  }, {
    request: async (url) => {
      if (url.includes("/api/health/scheduler")) {
        return { status: 200, body: JSON.stringify({ ok: true }), headers: {} };
      }
      if (url.includes("index.js?v=test")) {
        return { status: 200, body: "ok", headers: {} };
      }
      return { status: 200, body: "<script src=\"index.js?v=test\"></script>", headers: {} };
    },
  });
  assert.strictEqual(healthPass.ok, true);

  const healthFail = await runPublicHealthChecklist({
    publicUrl: "https://prod.example.com",
    verifyAttempts: 1,
    verifyDelayMs: 1,
  }, {
    request: async () => ({ status: 503, body: "down", headers: {} }),
  });
  assert.strictEqual(healthFail.ok, false);

  const artifactDir = path.join(rootDir, "artifacts-run");
  const report = await runRollbackBySha({
    rollbackSha: "rollback123",
    restoreSha: "restore456",
    artifactDir,
    publicUrl: "https://prod.example.com",
    verifyAttempts: 1,
    verifyDelayMs: 1,
    hotfix: true,
    allowOutsideWindow: true,
  }, {
    runCommand(command, args) {
      if (command === "git" && args[0] === "rev-parse") {
        return { ok: true, status: 0, stdout: "ok", stderr: "", command: "git rev-parse" };
      }
      return { ok: true, status: 0, stdout: "", stderr: "", command: [command, ...args].join(" ") };
    },
    deployCommit() {
      return {
        ok: true,
        worktree_path: "/tmp/worktree",
        error: "",
      };
    },
    healthCheck: async () => ({
      ok: true,
      attempts_used: 1,
      checks: {
        home_status: 200,
        asset_path: "index.js?v=test",
        asset_status: 200,
        scheduler_status: 200,
        scheduler_ok: true,
      },
    }),
  });
  assert.strictEqual(report.pass, true);
  assert.strictEqual(report.steps.length, 2);
  assert.strictEqual(report.steps[0].label, "rollback");
  assert.strictEqual(report.steps[1].label, "restore");
  assert.ok(report.rollback_recovery_seconds >= 0);
  assert.ok(fs.existsSync(report.artifact_path));
})();
