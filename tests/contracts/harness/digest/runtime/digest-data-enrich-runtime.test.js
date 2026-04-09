"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/digest/runtime/digest-data-enrich-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
const { createDigestDataEnrichRuntime } = runtime;
assertModuleExports(() => runtime, TARGET_REL);

function createDeps(httpsPostWithRetry) {
  return {
    CONFIG: {
      keys: { anthropic: "test-anthropic-key" },
      digest: {
        providerResilience: {
          anthropic: {
            timeoutMs: 5678,
            retries: 1,
            retryDelayMs: 5,
            retryStatusCodes: [429, 503],
          },
        },
      },
    },
    log: () => {},
    httpsPostWithRetry,
  };
}

function makeResponse(text, usage = { input_tokens: 12, output_tokens: 3 }) {
  return {
    status: 200,
    body: {
      usage,
      content: [{ text }],
    },
  };
}

async function testRequestFailureDegradesCleanly() {
  let calls = 0;
  const enrichRuntime = createDigestDataEnrichRuntime(createDeps(async () => {
    calls += 1;
    throw new Error("HTTP timeout after 6s");
  }));
  const out = await enrichRuntime.enrichItems([{ headline: "A" }]);
  assert.strictEqual(calls, 1);
  assert.strictEqual(out.degraded, true);
  assert.strictEqual(out.degradation.provider, "anthropic");
  assert.strictEqual(out.degradation.reason, "request_failed");
  assert.strictEqual(out.items[0].wim, null);
  assert.strictEqual(out.items[0].writeup_status, "failed_dropped");
  assert.strictEqual(out.writeupDiagnostics.provider_failure_details[0].stage, "extraction");
  assert.strictEqual(out.writeupDiagnostics.provider_failure_details[0].provider, "anthropic");
}

async function testStatusFailureRespectsProviderPolicy() {
  const optsSeen = [];
  const enrichRuntime = createDigestDataEnrichRuntime(createDeps(async (_host, _path, _headers, _body, opts) => {
    optsSeen.push(opts);
    return {
      status: 503,
      body: { error: { message: "service unavailable" }, usage: { input_tokens: 12, output_tokens: 2 } },
    };
  }));
  const out = await enrichRuntime.enrichItems([{ headline: "B" }]);
  assert.strictEqual(out.degraded, true);
  assert.strictEqual(out.degradation.reason, "status_failure");
  assert.strictEqual(out.degradation.status_code, 503);
  assert.strictEqual(out.usage.input_tokens, 12);
  assert.deepStrictEqual(optsSeen[0].retryStatusCodes, [429, 503]);
  assert.strictEqual(optsSeen[0].timeoutMs, 5678);
  assert.strictEqual(out.items[0].writeup_status, "failed_dropped");
  assert.strictEqual(out.writeupDiagnostics.provider_failure_details[0].reason, "provider_status_failure");
}

async function testParseFailureTracksStageDiagnostics() {
  const enrichRuntime = createDigestDataEnrichRuntime(createDeps(async () => makeResponse("{bad-json")));
  const out = await enrichRuntime.enrichItems([{ headline: "C" }]);
  assert.strictEqual(out.degraded, true);
  assert.strictEqual(out.items[0].writeup_status, "failed_dropped");
  assert.strictEqual(out.items[0].parse_failure_type, "truncation");
  assert.strictEqual(out.items[0].writeup_stage_diagnostics.extraction.failure_reason, "provider_parse_failure");
  assert.strictEqual(out.writeupDiagnostics.parse_failure_counts.truncation, 1);
}

async function testEmptySelectionSkipsProviderCall() {
  let calls = 0;
  const enrichRuntime = createDigestDataEnrichRuntime(createDeps(async () => {
    calls += 1;
    return { status: 200, body: {} };
  }));
  const out = await enrichRuntime.enrichItems([]);
  assert.strictEqual(calls, 0);
  assert.deepStrictEqual(out.items, []);
  assert.strictEqual(out.degraded, false);
}

async function testStrongTierGetsRetryBudgetAndRepairPass() {
  const calls = [];
  const enrichRuntime = createDigestDataEnrichRuntime(createDeps(async (_host, _path, _headers, body) => {
    calls.push(String(body?.messages?.[0]?.content || ""));
    if (calls.length === 1) {
      return makeResponse("{bad-json", { input_tokens: 10, output_tokens: 1 });
    }
    if (calls.length === 2) {
      return makeResponse("{still-bad", { input_tokens: 8, output_tokens: 1 });
    }
    if (calls.length === 3) {
      return makeResponse(JSON.stringify({
        what_happened: "GPU supply expanded",
        mechanism: "capacity commitments loosened",
        who_it_impacts: "GPU buyers",
        implication: "buyers face easier allocation",
        confidence: "high",
      }), { input_tokens: 9, output_tokens: 2 });
    }
    if (calls.length === 4) {
      return makeResponse(JSON.stringify({
        wim: "GPU supply expanded and buyers may respond.",
      }), { input_tokens: 11, output_tokens: 3 });
    }
    if (calls.length === 5) {
      return makeResponse(JSON.stringify({
        wim: "GPU supply expanded, which eases allocation pressure for buyers and shifts leverage toward buyers in pricing talks.",
      }), { input_tokens: 13, output_tokens: 4 });
    }
    if (calls.length === 6) {
      return makeResponse(JSON.stringify({
        wim: "GPU supply tightening forces GPU buyers to choose between margin protection and capex commitments.",
      }), { input_tokens: 13, output_tokens: 4 });
    }
    throw new Error(`Unexpected call ${calls.length}`);
  }));

  const out = await enrichRuntime.enrichItems([{
    headline: "Nvidia expands Blackwell supply",
    summary: "Capacity commitments tighten near-term GPU supply.",
    tag: "AI",
    source: "reuters.com",
    source_type: "reported_media",
    source_tier: "strong",
    published_date: "2026-04-01T10:00:00.000Z",
  }]);

  assert.ok(calls.length >= 5, "strong-tier candidate should get repair after a soft validator failure");
  assert.strictEqual(out.degraded, false);
  assert.strictEqual(out.items[0].writeup_status, "repair_pass");
  assert.strictEqual(out.items[0].final_status, "repair_pass");
  assert.ok(out.items[0].wim.includes("pricing talks"));
  assert.strictEqual(out.items[0].writeup_stage_diagnostics.candidate_tier, "strong");
  assert.strictEqual(out.items[0].writeup_stage_diagnostics.extraction.attempt_count, 2);
  assert.strictEqual(out.items[0].writeup_stage_diagnostics.generation.attempt_count, 1);
  assert.strictEqual(out.items[0].writeup_stage_diagnostics.repair.attempted, true);
  assert.strictEqual(out.items[0].writeup_stage_diagnostics.repair.status, "soft_fail");
  assert.strictEqual(out.items[0].validation_tier, "soft_fail");
}

async function testInvalidWriteupIsDroppedWithoutFallback() {
  const enrichRuntime = createDigestDataEnrichRuntime(createDeps(async () => makeResponse(JSON.stringify({
    what_happened: "The FDA updated information",
    mechanism: "the agency changed reporting timing",
    who_it_impacts: "drug makers",
    implication: "companies may need to adjust filings",
    confidence: "high",
  }), { input_tokens: 20, output_tokens: 6 })));

  const out = await enrichRuntime.enrichItems([{
    headline: "Frequently requested or proactively posted drug-specific and other records",
    summary: "Frequently requested or proactively posted drug-specific and other records",
    tag: "LIFE SCIENCES",
    source: "fda.gov",
    source_type: "primary_official",
    source_tier: "standard",
    published_date: "2026-04-01T10:00:00.000Z",
  }]);

  assert.strictEqual(out.degraded, false);
  assert.strictEqual(out.items[0].writeup_status, "failed_dropped");
  assert.strictEqual(out.items[0].wim_brief, null);
  assert.ok(Array.isArray(out.items[0].writeup_rejection_reasons) && out.items[0].writeup_rejection_reasons.length > 0);
  assert.strictEqual(out.items[0].final_status, "failed_dropped");
  assert.strictEqual(out.items[0].validation_tier, "hard_fail");
}

async function testSoftFailMinimumViableAcceptSkipsRepair() {
  let callCount = 0;
  const enrichRuntime = createDigestDataEnrichRuntime(createDeps(async () => {
    callCount += 1;
    if (callCount === 1) {
      return makeResponse(JSON.stringify({
        what_happened: "Bed Bath & Beyond combined with The Container Store",
        mechanism: "the deal broadens assortment and services",
        who_it_impacts: "mid-tier home retailers",
        implication: "competitors face tighter pricing pressure",
        confidence: "high",
      }));
    }
    return makeResponse(JSON.stringify({
      wim: "Bed Bath & Beyond's Container Store deal tightens pricing leverage for mid-tier home retailers and raises execution pressure on rivals.",
    }));
  }));

  const out = await enrichRuntime.enrichItems([{
    headline: "Bed Bath & Beyond acquires The Container Store",
    summary: "The deal broadens assortment and services.",
    tag: "CONSUMER & RETAIL",
    source: "retaildive.com",
    source_type: "trade_specialist",
    source_tier: "standard",
    published_date: "2026-04-01T10:00:00.000Z",
  }]);

  assert.strictEqual(callCount, 2);
  assert.strictEqual(out.items[0].writeup_status, "model_pass");
  assert.strictEqual(out.items[0].minimum_viable_accept, true);
  assert.strictEqual(out.items[0].validation_tier, "soft_fail");
  assert.strictEqual(out.items[0].writeup_stage_diagnostics.repair.attempted, false);
}

(async () => {
  await testRequestFailureDegradesCleanly();
  await testStatusFailureRespectsProviderPolicy();
  await testParseFailureTracksStageDiagnostics();
  await testEmptySelectionSkipsProviderCall();
  await testStrongTierGetsRetryBudgetAndRepairPass();
  await testInvalidWriteupIsDroppedWithoutFallback();
  await testSoftFailMinimumViableAcceptSkipsRepair();
})().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
