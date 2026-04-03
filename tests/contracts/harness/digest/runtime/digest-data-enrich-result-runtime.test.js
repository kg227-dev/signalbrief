"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/digest/runtime/digest-data-enrich-result-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
const {
  applyBatchWriteupValidation,
  normalizeEnrichedItems,
  validateStrategicWriteup,
} = runtime;
assertModuleExports(() => runtime, TARGET_REL);

function testValidatorRejectsReusableCategoryBoilerplate() {
  const result = validateStrategicWriteup(
    {
      headline: "Bed Bath & Beyond agrees to acquire The Container Store for $150M",
      summary: "Stores will rebrand as The Container Store / Bed Bath and Beyond and Elfa units will anchor a home services division.",
    },
    {
      signal_shift: "Bed Bath & Beyond is buying The Container Store",
      implication_type: "competition",
      wim_brief: "This matters for home retail strategy.",
      wim: "For consumer operators, this matters for demand, pricing power, inventory, and channel strategy.",
    }
  );
  assert.strictEqual(result.ok, false);
  assert.ok(result.reasons.includes("generic_language") || result.reasons.includes("missing_interpretation"));
}

function testValidatorAcceptsStorySpecificInterpretation() {
  const result = validateStrategicWriteup(
    {
      headline: "Bed Bath & Beyond agrees to acquire The Container Store for $150M",
      summary: "Stores will rebrand as The Container Store / Bed Bath and Beyond and Elfa units will anchor a home services division.",
    },
    {
      signal_shift: "Bed Bath & Beyond is combining with The Container Store",
      implication_type: "competition",
      wim_brief: "The deal turns Bed Bath & Beyond into a broader home platform play.",
      wim: "Bed Bath & Beyond is using the Container Store deal to build a more consolidated home platform, which changes the competitive set for mid-tier home retailers. If the integration holds, rivals will face more bundled assortment and services pressure rather than just another store footprint.",
    }
  );
  assert.strictEqual(result.ok, true);
}

function testBatchValidationRejectsRepeatedLeadPhrases() {
  const normalized = normalizeEnrichedItems(
    [
      { headline: "Amazon surcharge", summary: "Amazon passes logistics costs through to sellers.", tag: "CONSUMER & RETAIL" },
      { headline: "Retail AI ROI shift", summary: "Retail budgets tighten around ROI proof.", tag: "CONSUMER & RETAIL" },
    ],
    [
      {
        signal_shift: "Amazon is passing logistics costs through to sellers",
        implication_type: "cost",
        wim_brief: "Amazon is raising the effective cost of access for smaller sellers.",
        wim: "Amazon is passing logistics costs through to sellers, which tightens already thin third-party merchant margins. Smaller brands now have less room to absorb marketplace fees without repricing or sacrificing contribution.",
      },
      {
        signal_shift: "Retail AI budgets are shifting from pilots to ROI proof",
        implication_type: "workflow",
        wim_brief: "Retail AI budgets are shifting from pilots to measurable productivity gains.",
        wim: "Amazon is passing logistics costs through to sellers, which tightens already thin third-party merchant margins. Retail tech vendors now face tougher proof-of-value demands before buyers renew pilots.",
      },
    ],
    {
      validateWriteups: true,
      writeupAttemptCount: 1,
      writeupStatusOnPass: "model_pass",
    }
  );
  const batch = applyBatchWriteupValidation(normalized.items);
  assert.strictEqual(batch.items[0].writeup_status, "model_pass");
  assert.strictEqual(batch.items[1].writeup_status, "failed_dropped");
  assert.ok(batch.items[1].writeup_rejection_reasons.includes("repeated_lead_phrase"));
}

testValidatorRejectsReusableCategoryBoilerplate();
testValidatorAcceptsStorySpecificInterpretation();
testBatchValidationRejectsRepeatedLeadPhrases();
