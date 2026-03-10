#!/usr/bin/env node
"use strict";

const runtime = require("./src/entrypoints/bot-server");

if (require.main === module && typeof runtime.startBotServer === "function") {
  runtime.startBotServer();
}

module.exports = runtime;
