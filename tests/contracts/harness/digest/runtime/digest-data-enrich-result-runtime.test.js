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
  assert.strictEqual(valid.validation_tier, "pass");

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

  const conciseSoftFail = validateExtractionOutput(
    {
      headline: "Bank consortium expands payment rail coverage",
      summary: "Operators are broadening same-day settlement and treasury routing options.",
    },
    {
      what_happened: "A bank consortium expanded same-day payment rail coverage across treasury and settlement workflows. The change also reaches exception-handling queues.",
      mechanism: "The rollout broadens routing choices for treasury teams while keeping bank-controlled settlement paths intact across multi-bank payment, reconciliation, and exception-resolution workflows",
      who_it_impacts: "treasury teams",
      implication: "operators gain more routing flexibility",
      confidence: "high",
    }
  );
  assert.strictEqual(conciseSoftFail.ok, true);
  assert.strictEqual(conciseSoftFail.validation_tier, "soft_fail");
  assert.strictEqual(conciseSoftFail.minimum_viable_accept, true);
  assert.ok(conciseSoftFail.soft_failure_reasons.includes("what_happened_not_concise"));
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
  assert.strictEqual(pass.validation_tier, "pass");

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
  assert.strictEqual(rejection.validation_tier, "hard_fail");
  assert.ok(rejection.hard_failure_reasons.includes("missing_operational_anchor"));
  assert.ok(rejection.soft_failure_reasons.includes("descriptive_only"));

  const overloaded = validateStrategicWriteup(
    { headline: "Supply chain update", summary: "Supply chain update" },
    {
      signal_shift: "Supply chain changed",
      implication_type: "workflow",
      mechanism: "because suppliers, carriers, and buyers all changed at once",
      wim: "The supply chain changed because suppliers, carriers, and buyers all changed at once, forcing teams to revisit operations and pricing, and to manage margin pressure.",
    }
  );
  assert.strictEqual(overloaded.ok, true);
  assert.strictEqual(overloaded.validation_tier, "soft_fail");
  assert.strictEqual(overloaded.minimum_viable_accept, true);
  assert.ok(overloaded.soft_failure_reasons.includes("sentence_clause_overload"));

  const genericTemplate = validateStrategicWriteup(
    { headline: "Generic market update", summary: "Generic market update" },
    {
      signal_shift: "Conditions changed",
      implication_type: "other",
      mechanism: "",
      wim: "This highlights a shift stakeholders should monitor closely because conditions changed.",
    }
  );
  assert.strictEqual(genericTemplate.validation_tier, "hard_fail");
  assert.ok(genericTemplate.reasons.includes("generic_language"));

  const highLevelButConcrete = validateStrategicWriteup(
    { headline: "UK government pay shift", summary: "New digital pay bands affect hiring." },
    {
      signal_shift: "Digital roles now pay more than prior bands",
      implication_type: "workflow",
      mechanism: "higher pay bands shift hiring leverage",
      wim: "Higher UK government tech pay resets hiring leverage for public-sector digital teams and pressures competing employers on compensation.",
    }
  );
  assert.strictEqual(highLevelButConcrete.validation_tier, "soft_fail");
  assert.strictEqual(highLevelButConcrete.minimum_viable_accept, true);

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
