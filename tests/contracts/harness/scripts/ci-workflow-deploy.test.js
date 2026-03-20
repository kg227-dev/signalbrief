"use strict";

const path = require("path");
const { assertSourceIncludesFile } = require("../../../../test-support/module-contract-helper.js");

const TARGET_REL = ".github/workflows/ci.yml";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);

assertSourceIncludesFile(TARGET_PATH, [
  "build-app-image:",
  "docker/build-push-action@v5",
  "ghcr.io/${GITHUB_REPOSITORY_OWNER}/signalbrief",
  "DEPLOY_APP_IMAGE:",
  "DEPLOY_REGISTRY: ghcr.io",
  "DEPLOY_REGISTRY_PASSWORD: ${{ secrets.GITHUB_TOKEN }}",
]);
