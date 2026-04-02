"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/digest/runtime/digest-headline-preview-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);

assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const { normalizeDigestHeadlinePreview } = runtime;

(() => {
  assert.strictEqual(
    normalizeDigestHeadlinePreview("  Opinion: Banks brace for tighter capital rules — board vote ahead  "),
    "Opinion: Banks brace for tighter capital rules — board vote ahead"
  );
  assert.strictEqual(
    normalizeDigestHeadlinePreview("How these providers\nare building a nurse pipeline"),
    "How these providers are building a nurse pipeline"
  );
})();

process.stdout.write("[digest-headline-preview-runtime] all assertions passed\n");
