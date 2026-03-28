"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/runtime/digest-depth-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);

assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const { applyDigestDepth } = runtime;

(() => {
  const items = [{ headline: "A", wim: "Full context.", wim_brief: "Brief context." }];
  const scanItems = applyDigestDepth(items, "scan");
  assert.strictEqual(scanItems[0].wim, null);

  const briefItems = applyDigestDepth(items, "headline_plus_oneliner");
  assert.strictEqual(briefItems[0].wim, "Brief context.");

  const fullItems = applyDigestDepth(items, "deep");
  assert.strictEqual(fullItems[0].wim, "Full context.");
})();

process.stdout.write("[digest-depth-runtime] all assertions passed\n");
