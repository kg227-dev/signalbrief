#!/usr/bin/env node
"use strict";

const runtime = require("./src/entrypoints/scheduler-worker");

if (require.main === module && typeof runtime.startSchedulerWorker === "function") {
  runtime.startSchedulerWorker();
}

module.exports = runtime;
