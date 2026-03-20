"use strict";

const path = require("path");
const { assertNodeSyntaxFile, assertSourceIncludesFile } = require("../../../../test-support/module-contract-helper.js");

const TARGET_REL = "scripts/deploy-production.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
assertSourceIncludesFile(TARGET_PATH, [
  "DEPLOY_PUBLIC_VERIFY_ATTEMPTS",
  "DEPLOY_APP_IMAGE",
  "deploy mode=image",
  "remote registry login",
  "remote: compose pull",
  "archive-sha",
  "pack source commit=",
  "staging promotion gate",
  "--skip-staging-gate",
  "release window gate",
  "Use --hotfix only for active incidents",
  "remote: runtime verify",
  "scheduler health check failed after retries",
]);
