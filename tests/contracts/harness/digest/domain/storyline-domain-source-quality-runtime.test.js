"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
  assertSourceIncludesFile,
} = require("../../../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/digest/domain/storyline-domain-source-quality-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
assertSourceIncludesFile(TARGET_PATH, [
  'require("./storyline-domain-source-quality-registry-runtime")',
  'require("../../runtime/source-policy-registry-runtime")',
  'require("../../runtime/topic-normalization-runtime")',
]);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const {
  classifySourceTier,
  computeOriginalitySignal,
  explainSourcePolicy,
  normalizeSourceDomain,
  setAdminSourceRegistry,
} = runtime;

assert.strictEqual(normalizeSourceDomain("ng.investing.com"), "investing.com");

const healthcare = classifySourceTier("statnews.com", "HEALTHCARE");
assert.strictEqual(healthcare.source_tier, "strong");
assert.ok(healthcare.source_authority >= 0.8);

const original = computeOriginalitySignal(
  { headline: "FDA approves new cancer treatment for rare disease" },
  { source_type: "reported_media", originality_profile: "original_reporting" }
);
const derivative = computeOriginalitySignal(
  { headline: "What you need to know about companies investing billions" },
  { source_type: "aggregator_republisher", originality_profile: "rewrite_aggregator" }
);
assert.ok(original > derivative);

setAdminSourceRegistry(new Map([
  ["benzinga.com", {
    domain: "benzinga.com",
    tier_override: "premium",
    authority_override: 0.99,
    hard_block: false,
    note: "Reviewed manually",
  }],
]));

const effective = explainSourcePolicy("benzinga.com");
assert.strictEqual(effective.source_tier, "premium");
assert.strictEqual(effective.source_authority, 0.99);
assert.strictEqual(effective.policy_source, "admin_override");
setAdminSourceRegistry(null);
