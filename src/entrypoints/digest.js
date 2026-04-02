#!/usr/bin/env node
"use strict";

/**
 * @module src/entrypoints/digest
 * CLI entrypoint and stable export surface for the digest orchestration runtime.
 * Import this module when callers need the public digest runtime API plus `main` and `runCli`.
 */
const runtime = require("./digest-orchestrator-runtime");
const service = require("../digest/application/digest-service-runtime");

if (require.main === module) {
  runtime.runCli();
}

module.exports = {
  ...service,
  main: runtime.main,
  runCli: runtime.runCli,
};
