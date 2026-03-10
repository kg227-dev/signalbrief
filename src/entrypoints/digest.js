#!/usr/bin/env node
"use strict";

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
