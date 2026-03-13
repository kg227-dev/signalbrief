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

(async () => {
  await testRequestFailureDegradesCleanly();
  await testStatusFailureRespectsProviderPolicy();
  await testParseFailureFallsBack();
  await testEmptySelectionSkipsProviderCall();
})().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
