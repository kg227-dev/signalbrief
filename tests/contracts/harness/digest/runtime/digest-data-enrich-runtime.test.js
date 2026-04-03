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
  assert.strictEqual(out.items[0].writeup_status, "failed_dropped");
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
}

async function testParseFailureDropsItems() {
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
  assert.strictEqual(out.items[0].writeup_status, "failed_dropped");
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
            signal_shift: "Retail AI spending is evolving",
            implication_type: "other",
            wim_brief: "Retailers are still discussing AI strategy.",
            wim: "For consumer operators, this matters for demand, pricing power, inventory, and channel strategy.",
          }]) }],
        },
      };
    }
    return {
      status: 200,
      body: {
        usage: { input_tokens: 12, output_tokens: 8 },
        content: [{ text: JSON.stringify([{
          signal_shift: "Shoptalk vendors are being pushed from pilots to ROI proof",
          implication_type: "workflow",
          wim_brief: "Retail AI budgets are shifting from pilots to measurable productivity gains.",
          wim: "Shoptalk's AI messaging has shifted from experimentation to proof of ROI, which raises the bar for retail tech vendors selling into tighter budgets. Retailers now have more leverage to cut pilots that do not show labor or conversion gains before the next planning cycle.",
        }]) }],
      },
    };
  }));

  const out = await enrichRuntime.enrichItems([{
    headline: "In 2026, AI talk at retail events shifts to proving real results, defining a true strategy",
    summary: "At this year's Shoptalk Spring, it wasn't enough for brands and retailers to talk about the ways that they think they will use AI.",
    tag: "CONSUMER & RETAIL",
    source: "modernretail.co",
    source_type: "trade_specialist",
    published_date: "2026-04-01T10:00:00.000Z",
  }]);

  assert.strictEqual(calls, 2, "weak writeups should trigger one repair pass");
  assert.strictEqual(out.degraded, false);
  assert.strictEqual(out.items[0].writeup_status, "repair_pass");
  assert.ok(/proof of ROI/i.test(out.items[0].wim || ""), "repair pass should replace weak why-it-matters copy");
  assert.ok(out.usage.input_tokens >= 42, "repair pass usage should be accumulated");
}

async function testInvalidWriteupIsDroppedWithoutFallback() {
  const enrichRuntime = createDigestDataEnrichRuntime(createDeps(async () => ({
    status: 200,
    body: {
      usage: { input_tokens: 20, output_tokens: 6 },
      content: [{ text: JSON.stringify([{
        signal_shift: "The FDA updated information",
        implication_type: "other",
        wim_brief: "This matters for life sciences companies broadly.",
        wim: "For life sciences teams, this matters for regulatory timing, development risk, and commercial potential.",
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
  assert.strictEqual(out.items[0].writeup_status, "failed_dropped");
  assert.strictEqual(out.items[0].wim_brief, null);
  assert.ok(
    Array.isArray(out.items[0].writeup_rejection_reasons)
      && out.items[0].writeup_rejection_reasons.length > 0,
    "failed writeups should preserve rejection reasons instead of falling back to deterministic copy"
  );
}

(async () => {
  await testRequestFailureDegradesCleanly();
  await testStatusFailureRespectsProviderPolicy();
  await testParseFailureDropsItems();
  await testEmptySelectionSkipsProviderCall();
  await testWeakWriteupTriggersRepairPass();
  await testInvalidWriteupIsDroppedWithoutFallback();
})().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
