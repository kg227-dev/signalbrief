"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/digest/runtime/digest-data-fetch-request-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const request = runtime.buildSearchRequest("AI×TECH", "enterprise AI funding", "sonar", {
  searchDomainFilter: ["theinformation.com", "reuters.com"],
  promptBias: "Prefer direct reporting from the preferred domains when available.",
});

assert.deepStrictEqual(request.search_domain_filter, ["theinformation.com", "reuters.com"]);
assert.ok(request.messages[1].content.includes("Prefer direct reporting from the preferred domains"));
assert.ok(request.messages[0].content.includes("Return fewer than 3 items rather than including stale or uncertain results."));
assert.ok(request.messages[0].content.includes("topic-focused sector news researcher"));
assert.ok(request.messages[0].content.includes("one digest topic only"));
assert.ok(request.messages[0].content.includes("Prefer original reporting, trade coverage, company releases, and regulator or official source material"));
assert.ok(!request.messages[0].content.includes("private equity"));
assert.ok(!request.messages[0].content.includes("consulting"));

process.stdout.write("[digest-data-fetch-request-runtime] all assertions passed\n");
