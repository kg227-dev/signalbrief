"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/entrypoints/digest-orchestrator-core-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
const PREFERRED_SOURCE_REGISTRY_PATH = require.resolve(path.join(
  process.cwd(),
  "src/runtime/preferred-source-registry-runtime.js"
));

delete require.cache[TARGET_PATH];
delete require.cache[PREFERRED_SOURCE_REGISTRY_PATH];

assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

assert.strictEqual(
  Object.prototype.hasOwnProperty.call(require.cache, PREFERRED_SOURCE_REGISTRY_PATH),
  false,
  "active core orchestrator import should not eagerly load legacy preferred-source registry runtime"
);

process.stdout.write("[digest-orchestrator-core-runtime-imports] all assertions passed\n");
