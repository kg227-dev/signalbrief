"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../../test-support/module-contract-helper.js");

const TARGET_REL = "scripts/deploy-promotion-gate-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);

const runtime = require(TARGET_PATH);
const {
  evaluateStagingPromotionGate,
  formatStagingPromotionGateFailure,
  writeStagingDeployArtifact,
  normalizeArtifactPath,
} = runtime;
assertModuleExports(() => runtime, TARGET_REL);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-promotion-gate-"));
const artifactPath = path.join(tempDir, "latest-staging-deploy.json");

try {
  const missing = evaluateStagingPromotionGate({
    targetEnv: "production",
    deploySha: "abc1234",
    artifactPath,
    maxAgeMinutes: 60,
  });
  assert.strictEqual(missing.allowed, false);
  assert.strictEqual(missing.enforced, true);
  assert.ok(String(formatStagingPromotionGateFailure(missing)).includes("ops:deploy:staging"));

  const stagingBypass = evaluateStagingPromotionGate({
    targetEnv: "production",
    deploySha: "abc1234",
    artifactPath,
    bypass: true,
    bypassMode: "manual_override",
  });
  assert.strictEqual(stagingBypass.allowed, true);
  assert.strictEqual(stagingBypass.enforced, false);
  assert.strictEqual(stagingBypass.mode, "manual_override");

  const completedAt = "2026-03-13T19:00:00.000Z";
  const writeResult = writeStagingDeployArtifact({
    sha: "abc1234",
    host: "10.0.0.2",
    publicUrl: "https://staging.getsignalbrief.com",
    services: ["web", "bot", "worker"],
    publicVerificationPassed: true,
    completedAt,
  }, { artifactPath });
  assert.strictEqual(writeResult.artifact.sha, "abc1234");
  assert.strictEqual(writeResult.artifact.target_env, "staging");
  assert.strictEqual(writeResult.artifact.public_verification_passed, true);
  assert.strictEqual(normalizeArtifactPath(artifactPath), artifactPath);

  const pass = evaluateStagingPromotionGate({
    targetEnv: "production",
    deploySha: "abc1234",
    artifactPath,
    maxAgeMinutes: 90,
    nowMs: Date.parse("2026-03-13T20:00:00.000Z"),
  });
  assert.strictEqual(pass.allowed, true);
  assert.strictEqual(pass.enforced, true);
  assert.strictEqual(pass.mode, "require_staging");
  assert.strictEqual(pass.artifact.sha, "abc1234");
  assert.ok(pass.artifactAgeMinutes <= 60);

  const stale = evaluateStagingPromotionGate({
    targetEnv: "production",
    deploySha: "abc1234",
    artifactPath,
    maxAgeMinutes: 30,
    nowMs: Date.parse("2026-03-13T20:00:00.000Z"),
  });
  assert.strictEqual(stale.allowed, false);
  assert.ok(String(stale.message).includes("too old"));

  const mismatch = evaluateStagingPromotionGate({
    targetEnv: "production",
    deploySha: "zzz9999",
    artifactPath,
    maxAgeMinutes: 90,
    nowMs: Date.parse("2026-03-13T20:00:00.000Z"),
  });
  assert.strictEqual(mismatch.allowed, false);
  assert.ok(String(mismatch.message).includes("SHA mismatch"));

  const nonProd = evaluateStagingPromotionGate({
    targetEnv: "staging",
    deploySha: "abc1234",
    artifactPath,
  });
  assert.strictEqual(nonProd.allowed, true);
  assert.strictEqual(nonProd.enforced, false);
  assert.strictEqual(nonProd.mode, "non_production_target");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
