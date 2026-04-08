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
  classifyParseFailure,
  deriveWimBrief,
  normalizeEnrichedItems,
  parseJsonObjectLenient,
  validateExtractionOutput,
  validateStrategicWriteup,
} = runtime;
assertModuleExports(() => runtime, TARGET_REL);

function testParseHelpers() {
  assert.strictEqual(classifyParseFailure("", []), "empty_response");
  assert.strictEqual(classifyParseFailure("{bad-json", []), "truncation");
  assert.strictEqual(classifyParseFailure("{\"wim\":\"x\"", []), "truncation");

  const parsed = parseJsonObjectLenient('```json\n{"wim":"Shift"}\n```');
  assert.strictEqual(parsed.ok, true);
  assert.strictEqual(parsed.value.wim, "Shift");
  assert.strictEqual(parseJsonObjectLenient("").parseFailureType, "empty_response");
}

function testExtractionValidation() {
  const valid = validateExtractionOutput(
    {
      headline: "Blackwell supply expands",
      summary: "Capacity commitments tighten near-term GPU supply.",
    },
    {
      what_happened: "Nvidia expanded Blackwell supply",
      mechanism: "Capacity commitments tightened supply",
      who_it_impacts: "GPU buyers",
      implication: "buyers face tighter allocation",
      confidence: "high",
    }
  );
  assert.strictEqual(valid.ok, true);

  const invalid = validateExtractionOutput({}, {
    what_happened: "Shift",
    mechanism: "",
    who_it_impacts: "users",
    implication: "good",
    confidence: "maybe",
  });
  assert.strictEqual(invalid.ok, false);
  assert.ok(invalid.reasons.includes("missing_mechanism"));
  assert.ok(invalid.reasons.includes("invalid_confidence"));
}

function testWriteupValidation() {
  const pass = validateStrategicWriteup(
    {
      headline: "Bed Bath & Beyond agrees to acquire The Container Store for $150M",
      summary: "Stores will rebrand as The Container Store / Bed Bath and Beyond and Elfa units will anchor a home services division.",
    },
    {
      signal_shift: "Bed Bath & Beyond is combining with The Container Store",
      implication_type: "competition",
      mechanism: "The deal consolidates the assortment base",
      wim_brief: "The deal turns Bed Bath & Beyond into a broader home platform play.",
      wim: "Bed Bath & Beyond's Container Store deal consolidates the assortment base and pressures pricing for mid-tier home retailers.",
    }
  );
  assert.strictEqual(pass.ok, true);

  const rejection = validateStrategicWriteup(
    {
      headline: "A generic market update",
      summary: "A generic market update",
    },
    {
      signal_shift: "Sentiment is shifting",
      implication_type: "other",
      mechanism: "people are reacting",
      wim: "Market sentiment is shifting and people may respond.",
    }
  );
  assert.strictEqual(rejection.ok, false);
  assert.ok(rejection.reasons.includes("descriptive_only"));
  assert.ok(rejection.reasons.includes("missing_mechanism"));
  assert.ok(rejection.reasons.includes("missing_lever"));

  const overloaded = validateStrategicWriteup(
    { headline: "Supply chain update", summary: "Supply chain update" },
    {
      signal_shift: "Supply chain changed",
      implication_type: "operations",
      mechanism: "because suppliers, carriers, and buyers all changed at once",
      wim: "The supply chain changed because suppliers, carriers, and buyers all changed at once, forcing teams to revisit operations and pricing, and to manage margin pressure.",
    }
  );
  assert.ok(overloaded.reasons.includes("sentence_clause_overload"));
  assert.ok(overloaded.reasons.includes("invalid_implication_type") || overloaded.reasons.includes("missing_mechanism"));

  assert.strictEqual(deriveWimBrief("First sentence matters. Second sentence here."), "First sentence matters.");
}

function testNormalizationAndBatchValidation() {
  const normalized = normalizeEnrichedItems(
    [
      { headline: "AI pricing reset", summary: "AI pricing reset", tag: "TECHNOLOGY" },
      { headline: "Retail margin squeeze", summary: "Retail margin squeeze", tag: "TECHNOLOGY" },
    ],
    [
      {
        signal_shift: "Pricing reset",
        implication_type: "cost",
        wim_brief: "Pricing resets lift budgets.",
        wim: "Bed Bath & Beyond's Container Store deal consolidates the assortment base because it tightens pricing leverage for mid-tier home retailers.",
      },
      {
        signal_shift: "Margin squeeze",
        implication_type: "cost",
        wim_brief: "Pricing resets lift budgets.",
        wim: "Bed Bath & Beyond's Container Store deal consolidates the assortment base because it tightens pricing leverage for mid-tier home retailers.",
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

testParseHelpers();
testExtractionValidation();
testWriteupValidation();
testNormalizationAndBatchValidation();

process.stdout.write("[digest-data-enrich-result-runtime] all assertions passed\n");
