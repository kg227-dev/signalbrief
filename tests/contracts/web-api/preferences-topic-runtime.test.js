"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { assertNodeSyntaxFile } = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "web/preferences-topic-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);

assertNodeSyntaxFile(TARGET_PATH);

const source = fs.readFileSync(TARGET_PATH, "utf8");
const context = {
  window: {},
};

vm.runInNewContext(source, context, { filename: TARGET_PATH });

const runtime = context.window.SignalBriefPrefsTopicRuntime;

assert.ok(runtime && typeof runtime.topicKeyFromInput === "function", "topic runtime should expose topicKeyFromInput");

assert.equal(
  runtime.topicKeyFromInput("Private Equity & M&A", {
    matchDefault: true,
    defaultTopics: ["PE×M&A"],
    topicLabels: { "PE×M&A": "Private Equity & M&A" },
  }),
  "PE×M&A",
  "display labels should map back to their default topic keys"
);

assert.equal(
  runtime.topicKeyFromInput("AI & Technology", {
    matchDefault: true,
    defaultTopics: ["AI×TECH"],
    topicLabels: { "AI×TECH": "AI & Technology" },
  }),
  "AI×TECH",
  "friendly labels should resolve to existing defaults"
);

assert.equal(
  runtime.topicKeyFromInput("GLP-1", {
    matchDefault: true,
    defaultTopics: ["ENERGY"],
    topicLabels: { ENERGY: "Energy" },
  }),
  "",
  "non-default labels should fail closed in the reduced-scope MVP"
);
