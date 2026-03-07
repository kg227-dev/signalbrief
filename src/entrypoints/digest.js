#!/usr/bin/env node
"use strict";

const runtime = require("./digest-runtime");

if (require.main === module) {
  runtime.runCli();
}

module.exports = runtime;
