#!/usr/bin/env node
"use strict";

const { spawnSync } = require("child_process");
const {
  resolveStagingDeployConfig,
  buildDeployProductionArgs,
} = require("./deploy-staging-runtime");

function printHelp() {
  process.stdout.write(
    [
      "Usage: node scripts/deploy-staging.js [deploy-production flags]",
      "",
      "Required env vars:",
      "  DEPLOY_STAGING_SSH_HOST",
      "  DEPLOY_STAGING_PUBLIC_URL",
      "",
      "Optional env vars:",
      "  DEPLOY_STAGING_SSH_USER",
      "  DEPLOY_STAGING_SSH_KEY",
      "  DEPLOY_STAGING_REMOTE_DIR",
      "  DEPLOY_STAGING_REMOTE_TMP_DIR",
      "  DEPLOY_STAGING_SERVICES",
      "  DEPLOY_STAGING_ARTIFACT_PATH",
      "  DEPLOY_PROMOTION_ARTIFACT_PATH",
      "",
      "All args are forwarded to scripts/deploy-production.js",
      "(for example: --skip-build --skip-remote-verify).",
    ].join("\n")
  );
}

function fail(message) {
  process.stderr.write(`[deploy-staging] FAIL: ${message}\n`);
  process.exit(1);
}

function main() {
  const passthroughArgs = process.argv.slice(2);
  if (passthroughArgs.includes("--help") || passthroughArgs.includes("-h")) {
    printHelp();
    return;
  }

  let config;
  try {
    config = resolveStagingDeployConfig(process.env);
  } catch (error) {
    fail(error.message || String(error));
  }

  const args = buildDeployProductionArgs(config, passthroughArgs);
  const result = spawnSync(process.execPath, args, {
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    process.exit(Number(result.status || 1));
  }
}

main();
