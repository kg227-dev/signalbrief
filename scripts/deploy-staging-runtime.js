"use strict";

const os = require("os");
const path = require("path");

function readTrimmed(value) {
  return String(value || "").trim();
}

function resolveStagingDeployConfig(env = process.env) {
  const host = readTrimmed(env.DEPLOY_STAGING_SSH_HOST);
  const publicUrl = readTrimmed(env.DEPLOY_STAGING_PUBLIC_URL);
  if (!host) {
    throw new Error("DEPLOY_STAGING_SSH_HOST is required");
  }
  if (!publicUrl) {
    throw new Error("DEPLOY_STAGING_PUBLIC_URL is required");
  }

  const user = readTrimmed(env.DEPLOY_STAGING_SSH_USER) || readTrimmed(env.DEPLOY_SSH_USER) || "ubuntu";
  const key = readTrimmed(env.DEPLOY_STAGING_SSH_KEY)
    || readTrimmed(env.DEPLOY_SSH_KEY)
    || path.join(os.homedir(), ".ssh", "signalbrief_vm");
  const remoteDir = readTrimmed(env.DEPLOY_STAGING_REMOTE_DIR) || "/opt/signalbrief-staging/app";
  const remoteTmpDir = readTrimmed(env.DEPLOY_STAGING_REMOTE_TMP_DIR) || "/tmp";
  const services = readTrimmed(env.DEPLOY_STAGING_SERVICES) || "web bot worker";
  const artifactPath = readTrimmed(env.DEPLOY_STAGING_ARTIFACT_PATH)
    || readTrimmed(env.DEPLOY_PROMOTION_ARTIFACT_PATH);

  return {
    host,
    publicUrl,
    user,
    key,
    remoteDir,
    remoteTmpDir,
    services,
    artifactPath,
  };
}

function buildDeployProductionArgs(config, passthroughArgs = []) {
  return [
    "scripts/deploy-production.js",
    "--host",
    config.host,
    "--user",
    config.user,
    "--key",
    config.key,
    "--remote-dir",
    config.remoteDir,
    "--remote-tmp-dir",
    config.remoteTmpDir,
    "--public-url",
    config.publicUrl,
    "--target-env",
    "staging",
    "--services",
    config.services,
    ...(config.artifactPath
      ? ["--staging-artifact-path", config.artifactPath]
      : []),
    ...passthroughArgs,
  ];
}

module.exports = {
  resolveStagingDeployConfig,
  buildDeployProductionArgs,
};
