"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../../test-support/module-contract-helper.js");

const TARGET_REL = "scripts/store-canary-cohort-update.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const {
  resolveCanaryCohortUpdateOptions,
  runCanaryCohortUpdate,
  runCiGateChecks,
  runStagingGateChecks,
} = runtime;

assert.strictEqual(typeof resolveCanaryCohortUpdateOptions, "function");
assert.strictEqual(typeof runCanaryCohortUpdate, "function");
assert.strictEqual(typeof runCiGateChecks, "function");
assert.strictEqual(typeof runStagingGateChecks, "function");

const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-canary-cohort-update-"));
const artifactDir = path.join(rootDir, "artifacts");

const resolved = resolveCanaryCohortUpdateOptions([
  "--cohort-chat-ids", "111, 222 333",
  "--staging-url", "https://staging.example.com",
  "--max-canary-size", "4",
  "--artifact-dir", "artifacts",
  "--artifact-name", "cohort.json",
  "--skip-local-ci",
], {}, rootDir);
assert.deepStrictEqual(resolved.cohortChatIds, ["111", "222", "333"]);
assert.strictEqual(resolved.stagingUrl, "https://staging.example.com");
assert.strictEqual(resolved.sqlitePath, path.join(rootDir, "data", "signalbrief.sqlite"));
assert.strictEqual(resolved.maxCanarySize, 4);
assert.strictEqual(resolved.skipLocalCi, true);
assert.strictEqual(resolved.artifactDir, artifactDir);
assert.strictEqual(resolved.artifactName, "cohort.json");

const envResolved = resolveCanaryCohortUpdateOptions([
  "--cohort-chat-ids", "777",
], { DEPLOY_STAGING_PUBLIC_URL: "https://staging-from-env.example.com" }, rootDir);
assert.strictEqual(envResolved.stagingUrl, "https://staging-from-env.example.com");

const skippedCi = runCiGateChecks({ skipLocalCi: true });
assert.strictEqual(skippedCi.ci_green, true);
assert.strictEqual(skippedCi.checks.length, 1);

const failedCi = runCiGateChecks({}, {
  runCommand(command, args) {
    const joined = [command, ...args].join(" ");
    if (joined === "npm test") {
      return { ok: false, status: 1, stderr: "forced test failure" };
    }
    return { ok: true, status: 0, stderr: "" };
  },
});
assert.strictEqual(failedCi.ci_green, false);
assert.strictEqual(failedCi.checks.length, 4);
assert.ok(failedCi.checks.some((entry) => entry.name === "critical-tests" && entry.ok === false));

(async () => {
  try {
    const stagingOk = await runStagingGateChecks({
      stagingUrl: "https://staging.example.com",
    }, {
      request: async (url) => {
        if (url.endsWith("/api/health/scheduler")) {
          return {
            statusCode: 200,
            body: JSON.stringify({ ok: true }),
            headers: {},
          };
        }
        return {
          statusCode: 200,
          body: "<html><script src=\"/index.js?v=test-123\"></script></html>",
          headers: {},
        };
      },
    });
    assert.strictEqual(stagingOk.staging_green, true);
    assert.strictEqual(stagingOk.checks.length, 2);

    const stagingMissing = await runStagingGateChecks({}, {});
    assert.strictEqual(stagingMissing.staging_green, false);
    assert.strictEqual(stagingMissing.checks[0].name, "staging-url");

    const success = await runCanaryCohortUpdate({
      stagingUrl: "https://staging.example.com",
      cohortChatIds: ["a", "b"],
      maxCanarySize: 3,
      artifactDir,
      artifactName: "cohort-success.json",
      skipLocalCi: false,
    }, {
      runCommand: () => ({ ok: true, status: 0, stderr: "" }),
      request: async (url) => {
        if (url.endsWith("/api/health/scheduler")) {
          return { statusCode: 200, body: JSON.stringify({ ok: true }), headers: {} };
        }
        return { statusCode: 200, body: "<script src=\"/index.js?v=abc\"></script>", headers: {} };
      },
    });
    assert.strictEqual(success.pass, true);
    assert.strictEqual(success.export.SIGNALBRIEF_STORE_BACKEND, "canary");
    assert.strictEqual(success.export.SIGNALBRIEF_SQLITE_PATH, path.join(process.cwd(), "data", "signalbrief.sqlite"));
    assert.strictEqual(success.export.SIGNALBRIEF_STORE_CANARY_CHAT_IDS, "a,b");
    assert.strictEqual(success.export.SIGNALBRIEF_STORE_CANARY_MIRROR_WRITES, "1");
    assert.ok(fs.existsSync(success.artifact_path));

    const failed = await runCanaryCohortUpdate({
      stagingUrl: "https://staging.example.com",
      cohortChatIds: ["a"],
      maxCanarySize: 3,
      artifactDir,
      artifactName: "cohort-failed.json",
      skipLocalCi: false,
    }, {
      runCommand: () => ({ ok: false, status: 1, stderr: "forced fail" }),
      request: async (url) => {
        if (url.endsWith("/api/health/scheduler")) {
          return { statusCode: 200, body: JSON.stringify({ ok: true }), headers: {} };
        }
        return { statusCode: 200, body: "<script src=\"/index.js?v=abc\"></script>", headers: {} };
      },
    });
    assert.strictEqual(failed.pass, false);
    assert.ok(fs.existsSync(failed.artifact_path));

    await assert.rejects(
      runCanaryCohortUpdate({
        stagingUrl: "https://staging.example.com",
        cohortChatIds: ["1", "2", "3", "4"],
        maxCanarySize: 3,
        artifactDir,
      }, {
        runCommand: () => ({ ok: true, status: 0, stderr: "" }),
        request: async () => ({ statusCode: 200, body: JSON.stringify({ ok: true }), headers: {} }),
      }),
      /exceeds max-canary-size/
    );
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
})();
