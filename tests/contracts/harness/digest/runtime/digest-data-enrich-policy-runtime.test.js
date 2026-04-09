"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/digest/runtime/digest-data-enrich-policy-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const {
  buildAttemptPolicy,
  collectWriteupStats,
  mapRepairType,
  normalizeStatusCodes,
  toBoundedInt,
} = runtime;

assert.strictEqual(toBoundedInt("12", 5, { min: 1, max: 20 }), 12);
assert.deepStrictEqual(normalizeStatusCodes([429, "503", 503, "bad"], [500]), [429, 503]);
assert.strictEqual(buildAttemptPolicy({ source_tier: "strong" }).extractionAttempts, 2);
assert.strictEqual(mapRepairType(["generic_language"]), "sharpen_implication");
assert.strictEqual(
  collectWriteupStats([
    {
      writeup_status: "repair_pass",
      first_pass_succeeded: true,
      validation_tier: "soft_fail",
      writeup_stage_diagnostics: { candidate_tier: "strong", extraction: { status: "done" }, generation: { attempt_count: 1, status: "model_pass" }, repair: { attempted: true } },
    },
  ]).repair_attempted_count,
  1
);

process.stdout.write("[digest-data-enrich-policy-runtime] all assertions passed\n");
