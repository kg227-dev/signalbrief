#!/usr/bin/env node
"use strict";

// Root launch shim retained for CLI compatibility.
const runtime = require("./src/entrypoints/digest");

if (require.main === module) {
  runtime.runCli();
}

module.exports = runtime;
