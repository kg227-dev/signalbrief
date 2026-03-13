"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../../test-support/module-contract-helper.js");

const TARGET_REL = "scripts/store-rollback-verify.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const {
  resolveRollbackVerifyOptions,
  runRollbackVerify,
} = runtime;
assert.strictEqual(typeof resolveRollbackVerifyOptions, "function");
assert.strictEqual(typeof runRollbackVerify, "function");

const opts = resolveRollbackVerifyOptions([
  "--data-dir", "/tmp/data",
  "--sqlite-path", "/tmp/data/signalbrief.sqlite",
  "--allow-diff",
  "--allow-extra-sqlite",
], {}, process.cwd());
assert.strictEqual(opts.allowDiff, false, "rollback verify should force strict diff behavior");
assert.strictEqual(opts.allowExtraSqlite, false, "rollback verify should not allow extra sqlite users");
assert.strictEqual(opts.strictTokenMatch, true, "rollback verify should force strict token parity");
