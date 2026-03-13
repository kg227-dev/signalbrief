"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/runtime/store-adapter-contract-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
const {
  STORE_ADAPTER_METHODS,
  assertStoreAdapterContract,
} = runtime;
assertModuleExports(() => runtime, TARGET_REL);

assert.ok(Array.isArray(STORE_ADAPTER_METHODS));
assert.ok(STORE_ADAPTER_METHODS.includes("readUser"));
assert.throws(
  () => assertStoreAdapterContract(null),
  /must be an object/
);

const adapter = {
  readUser: () => null,
  writeUser: () => {},
  deleteUser: () => ({ ok: true }),
  allUsers: () => [],
  rebuildTokenIndex: () => {},
  findUserByToken: () => null,
};
assert.strictEqual(assertStoreAdapterContract(adapter), adapter);

const broken = { ...adapter };
delete broken.findUserByToken;
assert.throws(
  () => assertStoreAdapterContract(broken, { label: "custom adapter" }),
  /custom adapter missing required method: findUserByToken/
);
