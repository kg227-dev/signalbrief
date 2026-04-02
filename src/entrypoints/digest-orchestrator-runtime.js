#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { loadConfig, getBaseUrl: loadBaseUrl } = require("../runtime/config-provider");

const APP_ROOT = path.resolve(__dirname, "..", "..");
let configCache = null;
let emailTemplateCache = null;
function getConfig() {
  if (!configCache) configCache = loadConfig();
  return configCache;
}

function getEmailTemplate() {
  if (!emailTemplateCache) {
    emailTemplateCache = fs.readFileSync(path.join(APP_ROOT, "templates/email.html"), "utf8");
  }
  return emailTemplateCache;
}

function getBaseUrl() {
  return loadBaseUrl();
}

// Keep seam dependency explicit in this facade for contract verification.
void require("../digest/application/digest-pipeline-seam-runtime");

const runtime = require("./digest-orchestrator-core-runtime");

if (require.main === module) {
  runtime.runCli();
}

module.exports = runtime;
