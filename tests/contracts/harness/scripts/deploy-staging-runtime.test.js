"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../../test-support/module-contract-helper.js");

const TARGET_REL = "scripts/deploy-staging-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
const {
  resolveStagingDeployConfig,
  buildDeployProductionArgs,
} = runtime;
assertModuleExports(() => runtime, TARGET_REL);

assert.throws(() => resolveStagingDeployConfig({}), /DEPLOY_STAGING_SSH_HOST/);
assert.throws(() => resolveStagingDeployConfig({
  DEPLOY_STAGING_SSH_HOST: "10.0.0.1",
}), /DEPLOY_STAGING_PUBLIC_URL/);

const config = resolveStagingDeployConfig({
  DEPLOY_STAGING_SSH_HOST: "10.0.0.1",
  DEPLOY_STAGING_PUBLIC_URL: "https://staging.getsignalbrief.com",
  DEPLOY_STAGING_SSH_USER: "ubuntu",
  DEPLOY_STAGING_SSH_KEY: "/tmp/key",
  DEPLOY_STAGING_REMOTE_DIR: "/opt/staging/app",
  DEPLOY_STAGING_REMOTE_TMP_DIR: "/tmp",
  DEPLOY_STAGING_SERVICES: "web worker",
});
assert.strictEqual(config.host, "10.0.0.1");
assert.strictEqual(config.publicUrl, "https://staging.getsignalbrief.com");
assert.strictEqual(config.user, "ubuntu");
assert.strictEqual(config.key, "/tmp/key");
assert.strictEqual(config.remoteDir, "/opt/staging/app");
assert.strictEqual(config.remoteTmpDir, "/tmp");
assert.strictEqual(config.services, "web worker");

const args = buildDeployProductionArgs(config, ["--skip-build"]);
assert.deepStrictEqual(args.slice(0, 2), ["scripts/deploy-production.js", "--host"]);
assert.ok(args.includes("--public-url"));
assert.ok(args.includes("https://staging.getsignalbrief.com"));
assert.strictEqual(args[args.length - 1], "--skip-build");
