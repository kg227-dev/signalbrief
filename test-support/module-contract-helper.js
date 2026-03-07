"use strict";

const assert = require("assert");
const { execFileSync } = require("child_process");
const fs = require("fs");

function assertNodeSyntaxFile(absPath) {
  execFileSync(process.execPath, ["--check", absPath], { stdio: "pipe" });
}

function assertSourceIncludesFile(absPath, snippets) {
  const source = fs.readFileSync(absPath, "utf8");
  for (const snippet of snippets) {
    assert.ok(source.includes(snippet), `${absPath} should include snippet: ${snippet}`);
  }
}

function assertModuleExports(loadFn, label) {
  const exported = loadFn();
  assert.ok(exported !== undefined && exported !== null, `${label} should export a value`);
  const type = typeof exported;
  assert.ok(type === "object" || type === "function", `${label} should export object/function, got ${type}`);
}

module.exports = {
  assertNodeSyntaxFile,
  assertSourceIncludesFile,
  assertModuleExports,
};
