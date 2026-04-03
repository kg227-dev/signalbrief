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
  assert.strictEqual(out.items[0].watch_next, null);
  assert.deepStrictEqual(optsSeen[0].retryStatusCodes, [429, 503]);
  assert.strictEqual(optsSeen[0].timeoutMs, 5678);
}

async function testParseFailureFallsBack() {
  const enrichRuntime = createDigestDataEnrichRuntime(createDeps(async () => ({
    status: 200,
    body: {
      usage: { input_tokens: 22, output_tokens: 5 },
      content: [{ text: "{bad-json" }],
    },
  })));
  const out = await enrichRuntime.enrichItems([{ headline: "C" }]);
  assert.strictEqual(out.degraded, true);
  assert.strictEqual(out.degradation.reason, "parse_failure");
  assert.strictEqual(out.usage.input_tokens, 22);
  assert.strictEqual(out.items[0].implications, null);
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

async function testWeakWriteupTriggersRepairPass() {
  let calls = 0;
  const enrichRuntime = createDigestDataEnrichRuntime(createDeps(async () => {
    calls += 1;
    if (calls === 1) {
      return {
        status: 200,
        body: {
          usage: { input_tokens: 30, output_tokens: 10 },
          content: [{ text: JSON.stringify([{
            wim_brief: "Utility cost pressure is rising.",
            wim: "This highlights pressure across the utility sector. Companies should watch developments.",
            implications: null,
            watch_next: null,
          }]) }],
        },
      };
    }
    return {
      status: 200,
      body: {
        usage: { input_tokens: 12, output_tokens: 8 },
        content: [{ text: JSON.stringify([{
          wim_brief: "Fuel cost volatility is moving utility pricing decisions closer to the rate case window.",
          wim: "<strong>Duke Energy fuel-cost volatility raises rate-recovery pressure, which matters for margin protection and customer pricing over the next 2 quarters.</strong> For utility finance teams, fuel hedging and rate-case timing need to tighten because Duke and peer regulated utilities can absorb less commodity shock without affecting cost recovery.",
          implications: "For CFOs, revisit hedging assumptions and customer recovery timing before the next rate filing cycle.",
          watch_next: "Watch: Duke Energy's next rate-case filing and fuel-cost recovery disclosures.",
        }]) }],
      },
    };
  }));

  const out = await enrichRuntime.enrichItems([{
    headline: "What if Duke Energy shared the burden of fuel costs with its customers?",
    summary: "Fuel-cost volatility is testing how utilities recover costs from ratepayers.",
    tag: "ENERGY",
    source: "canarymedia.com",
    source_type: "trade_specialist",
    published_date: "2026-04-01T10:00:00.000Z",
  }]);

  assert.strictEqual(calls, 2, "weak writeups should trigger one repair pass");
  assert.strictEqual(out.degraded, false);
  assert.ok(/Duke Energy fuel-cost volatility/i.test(out.items[0].wim || ""), "repair pass should replace weak why-it-matters copy");
  assert.ok(out.usage.input_tokens >= 42, "repair pass usage should be accumulated");
}

async function testInvalidWriteupFallsBackToDeterministicStrategicCopy() {
  const enrichRuntime = createDigestDataEnrichRuntime(createDeps(async () => ({
    status: 200,
    body: {
      usage: { input_tokens: 20, output_tokens: 6 },
      content: [{ text: JSON.stringify([{
        wim_brief: null,
        wim: "This highlights the trend. Companies should watch developments.",
        implications: null,
        watch_next: null,
      }]) }],
    },
  })));

  const out = await enrichRuntime.enrichItems([{
    headline: "Frequently requested or proactively posted drug-specific and other records",
    summary: "Frequently requested or proactively posted drug-specific and other records",
    tag: "LIFE SCIENCES",
    source: "fda.gov",
    source_type: "primary_official",
    published_date: "2026-04-01T10:00:00.000Z",
  }]);

  assert.strictEqual(out.degraded, false);
  assert.ok(out.items[0].wim_brief, "fallback should populate wim_brief when the model output is unusable");
  assert.ok(/records or compliance index/i.test(out.items[0].wim || ""), "fallback should produce honest strategic text for listing-style official items");
  assert.strictEqual(out.items[0].writeup_origin, "fallback");
}

(async () => {
  await testRequestFailureDegradesCleanly();
  await testStatusFailureRespectsProviderPolicy();
  await testParseFailureFallsBack();
  await testEmptySelectionSkipsProviderCall();
  await testWeakWriteupTriggersRepairPass();
  await testInvalidWriteupFallsBackToDeterministicStrategicCopy();
})().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
