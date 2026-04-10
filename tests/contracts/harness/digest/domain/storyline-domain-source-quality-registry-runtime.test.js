"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
  assertSourceIncludesFile,
} = require("../../../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/digest/domain/storyline-domain-source-quality-registry-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
assertSourceIncludesFile(TARGET_PATH, []);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

assert.ok(runtime.SOURCE_TIER_RULES.premium.domains.includes("reuters.com"));
assert.ok(runtime.PRIMARY_OFFICIAL_DOMAINS.has("sec.gov"));
assert.ok(runtime.TOPIC_AUTHORITY_OVERRIDES["statnews.com"].healthcare >= 0.9);
assert.ok(runtime.STANDARD_TOPIC_TOKENS.has("healthcare"));
