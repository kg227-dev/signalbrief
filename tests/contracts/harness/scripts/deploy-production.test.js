"use strict";

const path = require("path");
const { assertNodeSyntaxFile, assertSourceIncludesFile } = require("../../../../test-support/module-contract-helper.js");

const TARGET_REL = "scripts/deploy-production.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
assertSourceIncludesFile(TARGET_PATH, [
  "DEPLOY_PUBLIC_VERIFY_ATTEMPTS",
  "DEPLOY_APP_IMAGE",
  "DEPLOY_EMERGENCY_SOURCE_BUILD",
  "deploy mode=image",
  "deploy mode=emergency_source_build",
  "remote registry login",
  "remote: compose pull",
  "--deploy-sha",
  "archive-sha",
  "legacy alias for --deploy-sha",
  "--emergency-source-build",
  "pack source commit=",
  "production deploy requires a CI-built image or an explicit emergency fallback",
  "app image inferred from git remote",
  "registry deploy requires DEPLOY_REGISTRY_USER and DEPLOY_REGISTRY_PASSWORD together",
  "staging promotion gate",
  "--skip-staging-gate",
  "release window gate",
  "Use --hotfix only for active incidents",
  "remote: runtime verify",
  "scheduler health check failed after retries",
]);
