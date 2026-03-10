"use strict";

const path = require("path");
const fs = require("fs");
const { assertNodeSyntaxFile, assertModuleExports, assertSourceIncludesFile } = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/entrypoints/bot-server.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
assertSourceIncludesFile(TARGET_PATH, ["function loadConfig()", "function getBotToken()"]);
const source = fs.readFileSync(TARGET_PATH, "utf8");
if (source.includes("const CONFIG =")) {
  throw new Error("bot-server should avoid import-time CONFIG snapshots");
}
const botServer = require(TARGET_PATH);
assertModuleExports(() => botServer, TARGET_REL);
["loadConfig", "getBotToken", "poll", "processUpdate", "answerCallbackQuery", "runLoop", "startBotServer"].forEach((name) => {
  if (typeof botServer[name] !== "function") {
    throw new Error(`Expected bot-server export '${name}' to be a function`);
  }
});
